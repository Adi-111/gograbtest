import { Controller, Get } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { OverviewAnalytics, DailyTicketStats } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) { }

  @Get('overview')
  async getOverview(): Promise<OverviewAnalytics[]> {
    return this.analyticsService.getOverviewAnalytics();
  }

  @Get('tags')
  async getTagCountBarData(): Promise<{ tag: string; count: number }[]> {
    return this.analyticsService.getTagCountBarData();
  }

  @Get('ticket-duration-vs-count')
  async getTicketDurationVsCount(): Promise<{ date: string; duration: number; count: number }[]> {
    return this.analyticsService.getTicketDurationVsCountData();
  }

  @Get('ticket-status-bar')
  async getTicketStatusBar(): Promise<{ status: string; count: number }[]> {
    return this.analyticsService.getTicketStatusBarData();
  }


  @Get('ticket-status-over-time')
  async getTicketStatusOverTime(): Promise<DailyTicketStats[]> {
    return this.analyticsService.getTicketStatusOverTimeData();
  }


  @Get('back')
  async backfill(): Promise<void> {
    return await this.analyticsService.backfillAllAnalytics();
  }
}
