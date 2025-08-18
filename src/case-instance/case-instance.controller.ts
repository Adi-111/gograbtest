import { Controller, Get, Query } from '@nestjs/common';
import { CaseInstanceService } from './case-instance.service';

@Controller('metrics')
export class CaseInstanceController {
  constructor(private readonly caseInstanceService: CaseInstanceService) { }

  // Example: GET /metrics/chats-per-agent?start=2025-08-01&end=2025-08-18
  @Get('chats-per-agent')
  async totalChatsPerAgent(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.totalChatsPerAgent({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  @Get('chat-volume-per-machine')
  async chatVolumePerMachine(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.chatVolumePerMachine({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  @Get('fcr')
  async firstContactResolution(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.firstContactResolution({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  @Get('chat-to-transaction')
  async chatToTransactionRatioTop(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.chatToTransactionRatioTop(
      { start: start ? new Date(start) : undefined, end: end ? new Date(end) : undefined },
      10
    );
  }

  @Get('frt')
  async firstResponseTime(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.firstResponseTime({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  @Get('pct-over-4h')
  async pctChatsOver4h(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.pctChatsOver4h({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  @Get('abandonment')
  async chatAbandonmentRate(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.chatAbandonmentRate({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  @Get('refunds-manual')
  async refundsProcessedManual(@Query('start') start?: string, @Query('end') end?: string) {
    return this.caseInstanceService.refundsProcessedManual({
      start: start ? new Date(start) : undefined,
      end: end ? new Date(end) : undefined,
    });
  }

  
}
