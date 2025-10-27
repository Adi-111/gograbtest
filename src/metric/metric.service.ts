import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentFRTQuery, AgentFRTSummary } from './types';
import { IssueType } from '@prisma/client';
type IssueSummary = {
  machineName: string;
  total: number;
  active: number;
  byType: Record<IssueType, number>;
  latestIssue: { id: number; at: Date } | null;
  refundStats: {
    manualStats: {
      manualRefundCount: number;
      totalRefundAmount: number;
    }
    autoStats: {
      autoRefundCount: number;
    }
  };
};


@Injectable()
export class MetricService {
  private readonly logger = new Logger(MetricService.name);
  constructor(
    private readonly prisma: PrismaService
  ) { }


  async percentResolvedWithoutAgent(params: {
    from: Date;
    to: Date;
    mode?: "opened" | "updated";
  }) {
    const { from, to, mode = "opened" } = params;

    // Filter dimension - same pattern as issueTaggedPerMachineInRange
    const timeFilter =
      mode === "updated"
        ? { updatedAt: { gte: from, lt: to } }
        : { openedAt: { gte: from, lt: to } };

    // All solved issues within the time range
    const issues = await this.prisma.issueEvent.findMany({
      where: {
        status: "CLOSED",
        ...timeFilter,
      },
      select: {
        userId: true,
        agentCalledAt: true,
        agentLinkedAt: true
      }
    });

    // Aggregate in JS
    const totalResolved = issues.length;
    if (totalResolved === 0) {
      return { totalResolved: 0, resolvedWithoutAgent: 0, percentage: 0 };
    }

    const resolvedWithoutAgent = issues.filter(
      (i) => i.userId === null
    ).length;

    const percentage = (resolvedWithoutAgent / totalResolved) * 100;

    return {
      totalResolved,
      resolvedWithoutAgent,
      percentage: Math.round(percentage * 100) / 100, // 2 decimals
    };
  }

  async UserMessageSummary(params: {
    from: Date;
    to: Date;
    mode?: "opened" | "updated"; // how to include issues in the window
  }) {
    const { from, to } = params;

    // Filter dimension

    const summaries = await this.prisma.dailyUserMessageSummary.findMany({
      where: {
        date: { gte: from, lte: to },
      },
      include: { user: true },
      orderBy: { date: 'desc' },
    });
    return summaries;
  }




  async issueTaggedPerMachineInRange(params: {
    from: Date;
    to: Date;
    mode?: "opened" | "updated"; // how to include issues in the window
  }): Promise<IssueSummary[]> {
    const { from, to, mode } = params;

    // Filter dimension
    const timeFilter =
      mode === "updated"
        ? { updatedAt: { gte: from, lt: to } }
        : { openedAt: { gte: from, lt: to } };

    const issues = await this.prisma.issueEvent.findMany({
      where: {
        machineName: { not: null },
        ...timeFilter,
      },
      select: {
        id: true,
        machineName: true,
        issueType: true,
        isActive: true,
        openedAt: true,
        updatedAt: true,
        refundMode: true,
        refundAmountMinor: true

      },
      orderBy: [{ machineName: "asc" }, { updatedAt: "desc" }],
    });

    const map = new Map<string, IssueSummary>();

    for (const row of issues) {
      const name = row.machineName as string;
      let entry = map.get(name);
      if (!entry) {
        const byType = Object.create(null) as Record<IssueType, number>;
        for (const t of Object.values(IssueType)) byType[t as IssueType] = 0;

        entry = {
          machineName: name,
          total: 0,
          active: 0,
          byType,
          latestIssue: null,
          refundStats: {
            manualStats: {
              manualRefundCount: 0,
              totalRefundAmount: 0
            },
            autoStats: {
              autoRefundCount: 0
            }
          }
        };
        map.set(name, entry);
      }

      entry.total += 1;
      if (row.isActive) entry.active += 1;
      entry.byType[row.issueType] = (entry.byType[row.issueType] ?? 0) + 1;

      // Track manual refunds and amounts
      if (row.issueType === 'REFUND') {
        if (row.refundMode === 'MANUAL') {
          entry.refundStats.manualStats.manualRefundCount += 1;
          entry.refundStats.manualStats.totalRefundAmount += row.refundAmountMinor ?? 0;
        }
        else if (row.refundMode === 'AUTO') {
          entry.refundStats.autoStats.autoRefundCount += 1;
        }
      }


      const ts = row.updatedAt ?? row.openedAt;
      if (!entry.latestIssue || ts > entry.latestIssue.at) {
        entry.latestIssue = { id: row.id, at: ts };
      }
    }

    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }
  async agentsChatRefundsAndFRTInRange(query: AgentFRTQuery): Promise<AgentFRTSummary[]> {
    const { from, to, mode = 'issueOpened' } = query;

    // 1) Pull USER messages tied to an IssueEvent within the window you care about
    //    We need ordering to detect "first agent per issue"
    const rows = await this.prisma.message.findMany({
      where: {
        issueEventId: { not: null },
        senderType: 'USER',
        timestamp: { gte: new Date(0) }, // we filter via mode below to leverage composite conditions
      },
      select: {
        id: true,
        timestamp: true,
        userId: true,
        user: { select: { id: true, email: true } },
        issueEventId: true,
        issueEvent: {
          select: {
            id: true,
            openedAt: true,
            refundMode: true,
          },
        },
      },
      orderBy: [
        { issueEventId: 'asc' },
        { timestamp: 'asc' },
        { id: 'asc' },
      ],
    });

    // 2) First agent per IssueEvent
    const firstAgentByIssue = new Map<number, {
      agentId: number | null;
      agentName: string;
      firstAgentTime: Date;
      openedAt: Date;
      isManualRefund: boolean;
    }>();

    for (const r of rows) {
      const issueId = r.issueEventId!;
      if (!firstAgentByIssue.has(issueId)) {
        firstAgentByIssue.set(issueId, {
          agentId: r.userId ?? null,
          agentName: r.user?.email ?? `Agent#${r.userId ?? 'unknown'}`,
          firstAgentTime: r.timestamp,
          openedAt: r.issueEvent!.openedAt,
          isManualRefund: r.issueEvent!.refundMode === 'MANUAL',
        });
      }
    }

    // 3) Filter by mode + aggregate
    const agg = new Map<number, {
      agentName: string;
      totalChats: number;
      manualRefunds: number;
      frtSumMs: number;
      frtCount: number;
    }>();

    for (const entry of firstAgentByIssue.values()) {
      const inByOpened = entry.openedAt >= from && entry.openedAt < to;
      const inByFirst = entry.firstAgentTime >= from && entry.firstAgentTime < to;

      const include =
        (mode === 'issueOpened' && inByOpened) ||
        (mode === 'firstReply' && inByFirst);

      if (!include || entry.agentId == null) continue;

      const frtMs = entry.firstAgentTime.getTime() - entry.openedAt.getTime();

      if (!agg.has(entry.agentId)) {
        agg.set(entry.agentId, {
          agentName: entry.agentName,
          totalChats: 0,
          manualRefunds: 0,
          frtSumMs: 0,
          frtCount: 0,
        });
      }
      const a = agg.get(entry.agentId)!;
      a.totalChats += 1;
      if (entry.isManualRefund) a.manualRefunds += 1;
      if (frtMs >= 0) {
        a.frtSumMs += frtMs;
        a.frtCount += 1;
      }
    }

    // 4) Format & sort
    const result: AgentFRTSummary[] = Array.from(agg.entries()).map(([agentId, a]) => ({
      agentId,
      agentName: a.agentName,
      totalChats: a.totalChats,
      manualRefunds: a.manualRefunds,
      avgFRTMinutes: a.frtCount ? Math.round(((a.frtSumMs / a.frtCount) / 60000) * 100) / 100 : 0,
    }));

    result.sort((x, y) => y.totalChats - x.totalChats);
    return result;
  }
}
