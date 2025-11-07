import {
  Controller,
  Post,
  Body,
  Get,
  Query,
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
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/auth.guard';
import { Public } from '../auth/decorators/public.decorator';
import { PrintPdfDto } from './dto/print-pdf.dto';
import { PrintTextDto } from './dto/print-text.dto';
import { QueueService } from '../queue/queue.service';
import { PrintService } from './print.service';

@ApiTags('print')
@ApiBearerAuth()
@Controller('print')
@UseGuards(JwtAuthGuard)
export class PrintController {
  private readonly logger = new Logger(PrintController.name);

  constructor(
    private readonly queueService: QueueService,
    private readonly printService: PrintService,
  ) {}

  @Post('pdf')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enviar PDF para impressão',
    description: 'Adiciona um trabalho de impressão PDF na fila sequencial',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'PDF aceito para impressão na fila',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Dados inválidos',
  })
  async printPDF(@Body() printDto: PrintPdfDto) {
    this.logger.log(
      `Recebida solicitação de impressão PDF - Printer: ${printDto.printerName || 'default'}`,
    );

    const { jobId, requestId } = await this.queueService.addPdfJob(printDto);

    return {
      success: true,
      message: 'PDF adicionado à fila de impressão',
      data: {
        jobId,
        requestId,
        queue: 'print',
        timestamp: new Date(),
        estimatedPosition: await this.getEstimatedPosition(),
      },
    };
  }

  @Post('text')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Enviar texto para impressão',
    description:
      'Adiciona um trabalho de impressão de texto na fila sequencial',
  })
  @ApiResponse({
    status: HttpStatus.ACCEPTED,
    description: 'Texto aceito para impressão na fila',
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Dados inválidos',
  })
  async printText(@Body() printDto: PrintTextDto) {
    this.logger.log(
      `Recebida solicitação de impressão texto - Printer: ${printDto.printerName || 'default'}`,
    );

    const { jobId, requestId } = await this.queueService.addTextJob(printDto);

    return {
      success: true,
      message: 'Texto adicionado à fila de impressão',
      data: {
        jobId,
        requestId,
        queue: 'print',
        timestamp: new Date(),
        estimatedPosition: await this.getEstimatedPosition(),
      },
    };
  }

  @Get('printers')
  @ApiOperation({
    summary: 'Listar impressoras disponíveis',
    description: 'Retorna todas as impressoras detectadas no sistema',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Lista de impressoras obtida com sucesso',
  })
  async getPrinters() {
    this.logger.log('Solicitada lista de impressoras');

    const printers = await this.printService.getPrinters();

    return {
      success: true,
      data: {
        printers,
        total: printers.length,
        default: printers.find((p) => p.isDefault)?.name || null,
        timestamp: new Date(),
      },
    };
  }

  @Get('queue/status')
  @ApiOperation({
    summary: 'Status da fila de impressão',
    description: 'Retorna o status atual da fila de impressão',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Status da fila obtido com sucesso',
  })
  async getQueueStatus() {
    const status = await this.queueService.getQueueStatus();

    return {
      success: true,
      data: {
        ...status,
        timestamp: new Date(),
      },
    };
  }

  @Get('job/status')
  @ApiQuery({ name: 'jobId', required: true, description: 'ID do job na fila' })
  @ApiOperation({
    summary: 'Status de um job específico',
    description: 'Retorna o status detalhado de um job na fila',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Status do job obtido com sucesso',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Job não encontrado',
  })
  async getJobStatus(@Query('jobId') jobId: string) {
    const jobStatus = await this.queueService.getJobStatus(jobId);

    if (!jobStatus) {
      return {
        success: false,
        message: 'Job não encontrado',
        data: null,
      };
    }

    return {
      success: true,
      data: jobStatus,
    };
  }

  @Post('queue/clean')
  @ApiOperation({
    summary: 'Limpar fila de impressão',
    description: 'Remove jobs antigos da fila (completados e falhados)',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Fila limpa com sucesso',
  })
  async cleanQueue() {
    this.logger.log('Solicitada limpeza da fila');

    await this.queueService.cleanQueue();

    return {
      success: true,
      message: 'Fila limpa com sucesso',
      timestamp: new Date(),
    };
  }

  @Get('health')
  @Public()
  @ApiOperation({
    summary: 'Health check do serviço de impressão',
    description: 'Verifica se o serviço está funcionando corretamente',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Serviço saudável',
  })
  async healthCheck() {
    const printers = await this.printService.getPrinters();
    const queueStatus = await this.queueService.getQueueStatus();

    const hasPrinters = printers.length > 0;
    const hasDefaultPrinter = printers.some((p) => p.isDefault);

    return {
      success: true,
      status: 'healthy',
      data: {
        service: 'IBCPrinter',
        version: '1.0.0',
        timestamp: new Date(),
        printers: {
          available: hasPrinters,
          total: printers.length,
          hasDefault: hasDefaultPrinter,
          defaultPrinter: printers.find((p) => p.isDefault)?.name || 'Nenhuma',
        },
        queue: queueStatus,
        system: {
          platform: process.platform,
          arch: process.arch,
          node: process.version,
        },
      },
    };
  }

  private async getEstimatedPosition(): Promise<number> {
    const status = await this.queueService.getQueueStatus();
    return status.waiting + status.delayed + 1;
  }
}
