import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentFRTQuery, AgentFRTSummary } from './types';
import { IssueType } from '@prisma/client';
import { format } from 'date-fns/format';
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




  async agentIssueClosureAnalytics(params: {
    from: Date;
    to: Date;
    mode?: "opened" | "updated";
  }) {
    const { from, to, mode = "opened" } = params;
    this.logger.log(`Running agentIssueClosureAnalytics with`, params);

    // 1️⃣ Time window filter (consistent with other metrics)
    const timeFilter =
      mode === "updated"
        ? { updatedAt: { gte: from, lt: to } }
        : { openedAt: { gte: from, lt: to } };

    // 2️⃣ Fetch all closed issues with userId
    const issues = await this.prisma.issueEvent.findMany({
      where: {
        closedAt: { not: null },
        ...timeFilter,
      },
      select: {
        id: true,
        userId: true,
        openedAt: true,
        closedAt: true,
        machineName: true,
        issueType: true,
      },
    });

    if (!issues.length) {
      this.logger.log("No closed issues found in the range");
      return { total: 0, summary: [] };
    }

    // 3️⃣ Compute durations
    const enriched = issues.map((i) => {
      const durationMs =
        new Date(i.closedAt!).getTime() - new Date(i.openedAt).getTime();
      const durationHrs = durationMs / (1000 * 60 * 60);
      return {
        ...i,
        durationHrs,
        slow: durationHrs > 4,
      };
    });

    // 4️⃣ Fetch all users in one query
    const uniqueUserIds = Array.from(
      new Set(enriched.map((i) => i.userId).filter(Boolean))
    );
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueUserIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const userMap = new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "Unknown",
      ])
    );

    // 5️⃣ Group issues by user
    const grouped = new Map<
      number,
      {
        agentName: string;
        totalClosed: number;
        closedAfter4Hrs: number;
        totalDurationHrs: number;
      }
    >();

    for (const issue of enriched) {
      const uid = issue.userId ?? 0;
      const agentName = userMap.get(uid) || "Unassigned";

      if (!grouped.has(uid)) {
        grouped.set(uid, {
          agentName,
          totalClosed: 0,
          closedAfter4Hrs: 0,
          totalDurationHrs: 0,
        });
      }

      const entry = grouped.get(uid)!;
      entry.totalClosed += 1;
      entry.totalDurationHrs += issue.durationHrs;
      if (issue.slow) entry.closedAfter4Hrs += 1;
    }

    // 6️⃣ Compute aggregates
    const summary = Array.from(grouped.entries()).map(([userId, g]) => {
      const avg = g.totalClosed ? g.totalDurationHrs / g.totalClosed : 0;
      const slowRate = g.totalClosed ? (g.closedAfter4Hrs / g.totalClosed) * 100 : 0;
      return {
        userId,
        agentName: g.agentName,
        totalClosed: g.totalClosed,
        closedAfter4Hrs: g.closedAfter4Hrs,
        avgClosureTimeHrs: Number(avg.toFixed(2)),
        slowRate: Number(slowRate.toFixed(2)),
      };
    });

    summary.sort((a, b) => b.slowRate - a.slowRate);

    this.logger.log(
      `✅ Agent closure analytics generated: ${summary.length} agents`
    );

    return { total: issues.length, summary };
  }





  async getManualRefundTrendPerAgent(params: {
    from: Date;
    to: Date;
    mode?: 'opened' | 'updated';
  }) {
    const { from, to, mode = 'opened' } = params;

    // 1️⃣ Time filter (like other metrics)
    const timeFilter =
      mode === 'updated'
        ? { updatedAt: { gte: from, lt: to } }
        : { openedAt: { gte: from, lt: to } };

    // 2️⃣ Fetch manual refund issues with relevant data
    const issues = await this.prisma.issueEvent.findMany({
      where: {
        issueType: 'REFUND',
        refundMode: 'MANUAL',
        closedAt: { not: null },
        userId: { not: null },
        ...timeFilter,
      },


      orderBy: { closedAt: 'asc' },
    });

    // 3️⃣ Group by date + agent with aggregated info
    const grouped: Record<string, Record<number, { count: number; amount: number }>> = {};

    for (const issue of issues) {
      const dateKey = format(new Date(issue.closedAt!), 'yyyy-MM-dd');
      const uid = issue.userId!;
      if (!grouped[dateKey]) grouped[dateKey] = {};
      if (!grouped[dateKey][uid]) grouped[dateKey][uid] = { count: 0, amount: 0 };
      grouped[dateKey][uid].count += 1;
      grouped[dateKey][uid].amount += issue.refundAmountMinor ?? 0;
    }

    const dates = Object.keys(grouped).sort();
    const agentIds = Array.from(
      new Set(dates.flatMap((d) => Object.keys(grouped[d]).map(Number))),
    );

    // 4️⃣ Build dataset with hover info (custom object per point)
    const datasets = agentIds.map((agentId) => {
      const label =
        issues.find((i) => i.userId === agentId)?.userId ||
        `Agent#${agentId}`;

      return {
        label,
        data: dates.map((d) => {
          const val = grouped[d][agentId];
          return {
            x: d,
            y: val ? val.count : 0,
            refundAmount: val ? val.amount : 0,
            tooltip: val
              ? `Refunds: ${val.count} | Amount: ₹${(val.amount ).toFixed(2)}`
              : 'No data',
          };
        }),
        borderWidth: 2,
        fill: false,
      };
    });

    return {
      labels: dates,
      datasets,
    };
  }





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
