import { Controller, Get, Post, Body, Patch, Param, Delete, Query, Logger } from '@nestjs/common';
import { MetricService } from './metric.service';
import { CreateMetricDto } from './dto/create-metric.dto';
import { UpdateMetricDto } from './dto/update-metric.dto';
import { resolveRange } from './utils/date-range';

@Controller('metric')
export class MetricController {
  private readonly logger = new Logger(MetricController.name);

  constructor(private readonly metricService: MetricService) { }

  @Get('agents-frt')
  async getAgentsFRT(
    @Query('preset') preset?: '1d' | '7d' | '30d',
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'issueOpened' | 'firstReply',
  ) {

    const { from, to } = resolveRange(preset, fromStr, toStr);
    const data = await this.metricService.agentsChatRefundsAndFRTInRange({ from, to, mode });
    return { range: { from, to, preset: preset ?? null, mode: mode ?? 'issueOpened' }, data };
  }

  @Get("issue-per-machine")
  async getIssuePerMachine(
    @Query("preset") preset?: "1d" | "7d" | "30d",
    @Query("from") fromStr?: string,
    @Query("to") toStr?: string,
    @Query("mode") mode?: "opened" | "updated"
  ) {
    const { from, to } = resolveRange(preset, fromStr, toStr);
    const data = await this.metricService.issueTaggedPerMachineInRange({
      from,
      to,
      mode: mode ?? "opened",
    });
    return { range: { from, to, preset: preset ?? "month", mode: mode ?? "opened" }, data };
  }

  @Get('msg-summary')
  async msgSummary(
    @Query("preset") preset?: "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    const { from, to } = resolveRange(preset, fromStr, toStr);

    return await this.metricService.UserMessageSummary({
      from,
      to,
      mode: mode || 'opened',
    });

  }

  @Get('slow-issues')
  async SlowIssues(
    @Query("preset") preset?: "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    const { from, to } = resolveRange(preset, fromStr, toStr);
    return await this.metricService.agentIssueClosureAnalytics({
      from,
      to,
      mode: mode || 'opened',
    });
  }

  @Get('agent-trend')
  async agentTrendline(
    @Query("preset") preset?: "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    const { from, to } = resolveRange(preset, fromStr, toStr);
    return await this.metricService.getManualRefundTrendPerAgent({
      from,
      to,
      mode: mode || 'opened',
    });
  }


  @Get('without-agent')
  async withoutAgent(
    @Query("preset") preset?: "1d" | "7d" | "30d",
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('mode') mode?: 'opened' | 'updated',
  ) {
    // Default to last 30 days if not provided
    const { from, to } = resolveRange(preset, fromStr, toStr);



    return await this.metricService.percentResolvedWithoutAgent({
      from,
      to,
      mode: mode || 'opened',
    });

  }
}
