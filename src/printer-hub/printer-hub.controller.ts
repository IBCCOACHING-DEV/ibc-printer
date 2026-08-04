import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PrinterHubService } from './printer-hub.service';

class ClaimJobsDto {
  event_id!: string;
  agent_key!: string;
  batch_size?: number;
  supported_printers?: string[];
}

@ApiTags('printer-hub')
@Controller('printer-hub/jobs')
export class PrinterHubController {
  constructor(private readonly printerHubService: PrinterHubService) {}

  @Post('claim')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Claim printer jobs for an agent',
    description: 'Claims eligible pending print jobs for a printer agent.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Jobs claimed successfully',
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Printer agent not found',
  })
  async claimJobs(@Body() payload: ClaimJobsDto) {
    return this.printerHubService.claimJobs(payload);
  }
}
