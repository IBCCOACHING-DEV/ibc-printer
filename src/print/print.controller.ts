import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  HttpStatus,
  HttpCode,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { PrintPdfDto } from './dto/print-pdf.dto';
import { PrintTextDto } from './dto/print-text.dto';
import { PrintService } from './print.service';

/**
 * Endpoints manuais de impressão (teste/reimpressão avulsa). O fluxo
 * PRINCIPAL de credenciamento não passa por aqui — ele cria um `print_job`
 * local (ver LocalPrintModule) que é processado por um worker próprio,
 * sem fila externa. Estes endpoints imprimem de forma síncrona e direta,
 * sem depender de Redis/Bull.
 */
@ApiTags('print')
@ApiBearerAuth()
@Controller('print')
@UseGuards(JwtAuthGuard)
export class PrintController {
  private readonly logger = new Logger(PrintController.name);

  constructor(private readonly printService: PrintService) {}

  @Post('pdf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imprimir um PDF imediatamente',
    description: 'Envia o PDF direto para a impressora local, sem fila.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Resultado da impressão.' })
  async printPDF(@Body() printDto: PrintPdfDto) {
    this.logger.log(
      `Recebida solicitação de impressão PDF — impressora: ${printDto.printerName || 'padrão'}`,
    );
    const result = await this.printService.printPDF(printDto);
    return { success: result.success, data: result };
  }

  @Post('text')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Imprimir uma etiqueta de texto imediatamente',
    description: 'Envia a etiqueta direto para a impressora local, sem fila.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Resultado da impressão.' })
  async printText(@Body() printDto: PrintTextDto) {
    this.logger.log(
      `Recebida solicitação de impressão texto — impressora: ${printDto.printerName || 'padrão'}`,
    );
    const result = await this.printService.printText(printDto);
    return { success: result.success, data: result };
  }

  @Get('printers')
  @ApiOperation({
    summary: 'Listar impressoras disponíveis',
    description: 'Retorna todas as impressoras detectadas no sistema.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Lista de impressoras obtida com sucesso.' })
  async getPrinters() {
    const printers = await this.printService.getPrinters();
    return {
      success: true,
      data: {
        printers,
        total: printers.length,
        default: printers.find((p) => p.isDefault)?.name || null,
      },
    };
  }

  @Get('health')
  @Public()
  @ApiOperation({
    summary: 'Health check do serviço de impressão',
    description: 'Verifica se o serviço de impressão local está funcionando.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Serviço saudável.' })
  async healthCheck() {
    const printers = await this.printService.getPrinters();

    return {
      success: true,
      status: 'healthy',
      data: {
        service: 'Checkin Pocket',
        printers: {
          available: printers.length > 0,
          total: printers.length,
          hasDefault: printers.some((p) => p.isDefault),
          defaultPrinter: printers.find((p) => p.isDefault)?.name || 'Nenhuma',
        },
        system: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
        },
      },
    };
  }
}
