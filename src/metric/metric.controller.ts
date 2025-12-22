import { Controller, Get, Query, Logger } from '@nestjs/common';
import { MetricService } from './metric.service';

import { resolveRange } from './utils/date-range';

@Controller('metric')
export class MetricController {
  private readonly logger = new Logger(MetricController.name);

  constructor(private readonly metricService: MetricService) { }

  @Get('agents-frt')
  async getAgentsFRT(
    @Query('preset') preset?: 'today' | '1d' | '7d' | '30d',
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
  ) {

    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);
    const data = await this.metricService.CalculateUserWiseFRT(fromIST, toIST);
    return data;
  }

  @Get("issue-per-machine")
  async getIssuePerMachine(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query("from") fromStr?: string,
    @Query("to") toStr?: string,
  ) {
    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);
    const data = await this.metricService.GetMachinePerIssues(fromIST, toIST);
    return data;
  }

  @Get("get-agentRating")
  async getAgentRating(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query("from") fromStr?: string,
    @Query("to") toStr?: string,
  ) {
    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);
    const data = await this.metricService.GetAgentRatings(fromIST, toIST);
    return data;

  }

  @Get('msg-summary')
  async msgSummary(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);

    return await this.metricService.UserMessageSummary({
      fromIST,
      toIST,
      mode: mode || 'opened',
    });

  }

  @Get('slow-issues')
  async SlowIssues(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);
    return await this.metricService.agentIssueClosureAnalytics({
      fromIST,
      toIST,
      mode: mode || 'opened',
    });
  }

  @Get('agent-trend')
  async agentTrendline(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);
    return await this.metricService.getManualRefundTrendPerAgent({
      fromIST,
      toIST,
      mode: mode || 'opened',
    });
  }

  @Get("comparison")
  async comparisonMetrics(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const { fromIST, toIST } = resolveRange(preset, from, to);
    const currentTo = new Date(toIST);
    const currentFrom = new Date(fromIST);

    // You already compute your comparison windows
    const windowDays = (currentTo.getTime() - currentFrom.getTime()) / (1000 * 3600 * 24);

    const previousTo = new Date(currentFrom);
    previousTo.setDate(previousTo.getDate() - 1);

    const previousFrom = new Date(previousTo);
    previousFrom.setDate(previousFrom.getDate() - windowDays);

    return this.metricService.getComparisonMetrics({
      currentFrom,
      currentTo,
      previousFrom,
      previousTo
    });
  }
  @Get("agent-unrated-issues")
  async getAgentWiseUnratedIssues(
    @Query("preset") preset?: "today" | "1d" | "7d" | "30d",
    @Query("from") fromStr?: string,
    @Query("to") toStr?: string,
  ) {
    const { fromIST, toIST } = resolveRange(preset, fromStr, toStr);
    return await this.metricService.getAgentWiseUnratedIssues(fromIST, toIST);
  }




}
