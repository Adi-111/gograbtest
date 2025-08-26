import { BadRequestException, Controller, Get, ParseIntPipe, Query } from '@nestjs/common';
import { AgentChatStat, AnalyticsService } from './analytics.service';
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
    await this.analyticsService.backfillAnalytics();
    await this.analyticsService.backfillHourlyAnalytics();
    return;
  }

  @Get('agents/total-chats')
  async getTotalChatsPerAgent(
    @Query('start') start?: string,
    @Query('end') end?: string,
    @Query('all') all?: 'true' | 'false'
  ): Promise<AgentChatStat[]> {
    const useAll = all === 'true';
    const startDate = start ? new Date(start) : undefined;
    const endDate = end ? new Date(end) : undefined;
    return this.analyticsService.getTotalChatsPerAgent(startDate, endDate, useAll);
  }


  // GET /analytics/agents/total-chats/today
  @Get('agents/total-chats/today')
  async getTotalChatsPerAgentToday(): Promise<AgentChatStat[]> {
    return this.analyticsService.getTotalChatsPerAgentToday();
  }

  // GET /analytics/agents/total-chats/last-days?days=7
  @Get('agents/total-chats/last-days')
  async getTotalChatsPerAgentLastNDays(
    @Query('days', new ParseIntPipe({ optional: true })) days = 7,
  ): Promise<AgentChatStat[]> {
    if (days <= 0) {
      throw new BadRequestException('Query param "days" must be > 0');
    }
    return this.analyticsService.getTotalChatsPerAgentLastNDays(days);
  }

  // --- helpers ---
  private parseDate(value: string, label: 'start' | 'end'): Date {
    const d = new Date(value);
    if (Number.isNaN(d.valueOf())) {
      throw new BadRequestException(
        `Query param "${label}" must be a valid ISO date string`,
      );
    }
    return d;
  }

}
