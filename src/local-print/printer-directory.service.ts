import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'os';
import { LocalPrismaService } from '../database/local-prisma.service';
import { PrintService } from '../print/print.service';

const REFRESH_INTERVAL_MS = 30000;

/**
 * Mantém as tabelas locais `printer_agents` (esta estação) e `printers`
 * (impressoras físicas detectadas nela) atualizadas. Diferente do antigo
 * modelo de Printer Hub, não há mais leasing remoto: isso é só um
 * inventário local para diagnóstico/observabilidade.
 */
@Injectable()
export class PrinterDirectoryService implements OnModuleInit {
  private readonly logger = new Logger(PrinterDirectoryService.name);
  private selfAgentId: number | null = null;

  constructor(
    private readonly prisma: LocalPrismaService,
    private readonly printService: PrintService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureSelfAgent();
    await this.refreshPrinters();
  }

  @Interval(REFRESH_INTERVAL_MS)
  async refreshPrinters(): Promise<void> {
    try {
      const agentId = await this.ensureSelfAgent();
      const printers = await this.printService.getPrinters();
      const now = new Date();

      for (const printer of printers) {
        await this.prisma.printer.upsert({
          where: { printerUid: printer.name },
          create: {
            printerAgentId: agentId,
            printerUid: printer.name,
            name: printer.name,
            isDefault: printer.isDefault,
            isOnline: printer.isOnline,
            lastSeenAt: now,
          },
          update: {
            printerAgentId: agentId,
            isDefault: printer.isDefault,
            isOnline: printer.isOnline,
            lastSeenAt: now,
          },
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Falha ao atualizar o inventário local de impressoras: ${message}`);
    }
  }

  private async ensureSelfAgent(): Promise<number> {
    if (this.selfAgentId !== null) {
      return this.selfAgentId;
    }

    const agentKey = this.configService.get<string>('checkinAgent.agentKey', 'unknown-agent');
    const agentName = this.configService.get<string>('checkinAgent.agentName', hostname());

    const agent = await this.prisma.printerAgent.upsert({
      where: { agentKey },
      create: {
        agentKey,
        name: agentName,
        status: 'online',
        lastSeenAt: new Date(),
      },
      update: {
        name: agentName,
        status: 'online',
        lastSeenAt: new Date(),
      },
    });

    this.selfAgentId = agent.id;
    return agent.id;
  }
}
