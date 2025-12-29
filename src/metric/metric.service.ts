import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentFRTQuery, AgentFRTSummary } from './types';
import { IssueEventStatus, IssueType, MessageType, RefundMode, SenderType } from '@prisma/client';
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




  private safePct(current: number, previous: number): number {
    if (!previous || previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }


  /**
 * Shared function to fetch all issues in a given IST range.
 * Keeps filters consistent for all metrics modules (FRT, closure, refunds, tagging).
 */
  async getIssuesInRange(

    params: {
      fromIST: Date;
      toIST: Date;
      mode?: 'opened' | 'updated';
      includeClosedOnly?: boolean;
    }
  ) {
    const { fromIST, toIST, mode = 'opened', includeClosedOnly = false } = params;

    // Common time filter
    const timeFilter =
      mode === 'updated'
        ? { updatedAt: { gte: fromIST, lt: toIST } }
        : { openedAt: { gte: fromIST, lt: toIST } };

    const where = {
      ...(includeClosedOnly ? { closedAt: { not: null } } : {}),
      ...timeFilter,
      userId: { not: null }
    };
    const issues = await this.prisma.issueEvent.findMany({
      where,

      select: {
        id: true,
        userId: true,
        machineName: true,
        issueType: true,
        refundMode: true,
        refundAmountMinor: true,
        openedAt: true,
        updatedAt: true,
        closedAt: true,
        isActive: true,
        agentCalledAt: true,
        agentLinkedAt: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
    });

    // Centralized issue fields — avoids inconsistent select()s
    return issues
  }


  async GetAgentRatings(from: Date, to: Date) {
    // Step 1: Fetch rating rows
    const rows = await this.prisma.issueEvent.findMany({
      where: {
        agentRating: { not: null },
        created_at: { gte: from, lte: to },
        userId: { not: null }
      },
      select: {
        userId: true,
        agentRating: true
      }
    });

    if (rows.length === 0) {
      return {
        agents: [],
        overallAvg: 0,
        overallPercentage: 0
      };
    }

    // Step 2: Agent-wise aggregation + global aggregation
    const map = new Map<number, { ratingSum: number; total: number }>();

    let globalSum = 0;
    let globalCount = 0;

    for (const r of rows) {
      const uid = r.userId!;
      globalSum += r.agentRating ?? 0;
      globalCount += 1;

      if (!map.has(uid)) {
        map.set(uid, { ratingSum: 0, total: 0 });
      }

      const agg = map.get(uid)!;
      agg.ratingSum += r.agentRating ?? 0;
      agg.total += 1;
    }

    // Step 3: Bulk fetch users
    const users = await this.prisma.user.findMany({
      where: { id: { in: Array.from(map.keys()) } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true
      }
    });

    const userLookup = new Map(users.map(u => [u.id, u]));

    // Step 4: Build agent-wise result
    const agents = Array.from(map.entries()).map(([uid, stats]) => {
      const user = userLookup.get(uid);
      const maxRating = stats.total * 5;

      return {
        user,
        totalRatings: stats.total,
        avgRating: stats.ratingSum / stats.total,
        percentage: maxRating ? (stats.ratingSum / maxRating) * 100 : 0
      };
    });

    // Step 5: Compute overall
    const overallAvg = globalSum / globalCount;            // e.g., 4.2 out of 5
    const overallPercentage = (overallAvg / 5) * 100;      // convert to %

    return {
      agents,
      overallAvg,
      overallPercentage
    };
  }




  async GetMachinePerIssues(from: Date, to: Date) {
    // Step 1: Get all issues with machine info and refund mode
    const issues = await this.prisma.issueEvent.findMany({
      where: {
        machine_id: { not: null },
        created_at: {
          gte: from,
          lte: to,
        },
      },
      select: {
        machine_id: true,
        machineName: true,
        issueType: true,
        refundMode: true,
        refundAmountMinor: true,
      },
    });

    const TotalIssues = issues.length - 1

    // Step 2: Group issues by machine
    const machineMap = new Map<string, {
      machineName: string | null;
      totalIssues: number;
      autoRefunds: number;
      manualRefunds: number;
      manualRefundAmount: number;
      issueTypeCounts: Record<string, number>;
    }>();

    for (const issue of issues) {
      const key = issue.machine_id!;
      const machine = machineMap.get(key) ?? {
        machineName: issue.machineName || "Unknown",
        totalIssues: 0,
        autoRefunds: 0,
        manualRefunds: 0,
        manualRefundAmount: 0,
        issueTypeCounts: {},
      };

      machine.totalIssues += 1;

      const type = issue.issueType;
      machine.issueTypeCounts[type] = (machine.issueTypeCounts[type] || 0) + 1;

      if (type === IssueType.REFUND) {
        if (issue.refundMode === RefundMode.MANUAL) {
          machine.manualRefunds += 1;
          machine.manualRefundAmount += issue.refundAmountMinor || 0;
        } else if (issue.refundMode === RefundMode.AUTO) {
          machine.autoRefunds += 1;
        }
      }

      machineMap.set(key, machine);
    }

    // Step 3: Convert to array
    const result = Array.from(machineMap.entries()).map(([machineId, data]) => ({
      machineId,
      machineName: data.machineName,
      totalIssues: data.totalIssues,
      autoRefunds: data.autoRefunds,
      manualRefunds: data.manualRefunds,
      manualRefundAmount: data.manualRefundAmount,
      issueTypeCounts: data.issueTypeCounts,
    }));

    return { result, totalIssue: TotalIssues };
  }

  async CalculateUserWiseFRT(from: Date, to: Date) {
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [3, 6, 8]
        }
      },
      select: { id: true, firstName: true, lastName: true },
    });

    const result: any[] = [];

    for (const user of users) {
      // Step 1: Find all cases assigned to the user within the date range
      const cases = await this.prisma.case.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: from, lte: to },
        },
        select: { id: true },
      });

      const caseIds = cases.map(c => c.id);
      const totalChats = cases.length;

      // Step 2: Fetch all messages in those cases
      const messages = await this.prisma.message.findMany({
        where: {
          caseId: { in: caseIds },
          timestamp: { gte: from, lte: to },
        },
        orderBy: { timestamp: "asc" },
        select: {
          id: true,
          senderType: true,
          timestamp: true,
        },
      });

      // Count messages sent by the agent (USER type)
      const totalMessages = messages.filter(m => m.senderType === SenderType.USER).length;

      // Step 3: Fetch refund data from IssueEvent
      const issueEvents = await this.prisma.issueEvent.findMany({
        where: {
          userId: user.id,
          issueType: 'REFUND',
          openedAt: { gte: from, lte: to },
        },
        select: {
          refundMode: true,
          refundAmountMinor: true,
        },
      });

      const manualRefunds = issueEvents.filter(e => e.refundMode === 'MANUAL').length;
      const autoRefunds = issueEvents.filter(e => e.refundMode === 'AUTO').length;
      const manualRefundAmount = issueEvents
        .filter(e => e.refundMode === 'MANUAL')
        .reduce((sum, e) => sum + (e.refundAmountMinor || 0), 0);

      if (caseIds.length === 0) {
        result.push({
          userId: user.id,
          userName: `${user.firstName} ${user.lastName}`,
          totalChats: 0,
          totalMessages: 0,
          manualRefunds,
          manualRefundAmount,
          autoRefunds,
          avgFRTMinutes: null,
          frtList: [],
        });
        continue;
      }

      // Step 4: Calculate FRT
      let lastBotMsg: Date | null = null;
      const frtList: number[] = [];

      for (const msg of messages) {
        if (msg.senderType === SenderType.BOT) {
          lastBotMsg = msg.timestamp;
        }

        if (msg.senderType === SenderType.USER && lastBotMsg) {
          const frtMs = msg.timestamp.getTime() - lastBotMsg.getTime();
          const frtMinutes = frtMs / 1000 / 60;

          frtList.push(frtMinutes);
          lastBotMsg = null; // Reset
        }
      }

      result.push({
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        totalChats,
        totalMessages,
        manualRefunds,
        manualRefundAmount,
        autoRefunds,
        avgFRTMinutes: frtList.length
          ? Number((frtList.reduce((a, b) => a + b, 0) / frtList.length).toFixed(2))
          : null,
        frtList,
      });
    }

    return result;
  }




  async agentIssueClosureAnalytics(params: {
    fromIST: Date;
    toIST: Date;
    mode?: "opened" | "updated";
  }) {

    const { fromIST, toIST, mode = "opened" } = params;

    this.logger.log(`Running agentIssueClosureAnalytics with`, params);




    // 2️⃣ Fetch all closed issues with userId
    const issues = await this.getIssuesInRange({
      fromIST,
      toIST,
      mode,
      includeClosedOnly: true, // only closed issues
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
    fromIST: Date;
    toIST: Date;
    mode?: 'opened' | 'updated';
  }) {
    const { fromIST, toIST, mode = 'opened' } = params;

    // 1️⃣ Time filter (like other metrics)
    const timeFilter =
      mode === 'updated'
        ? { updatedAt: { gte: fromIST, lt: toIST } }
        : { openedAt: { gte: fromIST, lt: toIST } };

    // 2️⃣ Fetch manual refund issues with relevant data
    const allIssues = await this.getIssuesInRange({
      fromIST,
      toIST,
      mode,
      includeClosedOnly: true,
    });

    // 2️⃣ Filter manually refunded refund issues
    const issues = allIssues.filter(
      (i) =>
        i.issueType === 'REFUND' &&
        i.refundMode === 'MANUAL' &&
        i.userId !== null
    );

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
              ? `Refunds: ${val.count} | Amount: ₹${(val.amount).toFixed(2)}`
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







  async UserMessageSummary(params: {
    fromIST: Date;
    toIST: Date;
    mode?: "opened" | "updated"; // how to include issues in the window
  }) {
    const { fromIST, toIST } = params;

    // Filter dimension

    const summaries = await this.prisma.dailyUserMessageSummary.findMany({
      where: {
        date: { gte: fromIST, lte: toIST },
      },
      include: { user: true },
      orderBy: { date: 'desc' },
    });
    return summaries;
  }




  async issueTaggedPerMachineInRange(params: {
    fromIST: Date;
    toIST: Date;
    mode?: "opened" | "updated"; // how to include issues in the window
  }): Promise<IssueSummary[]> {
    const { mode, fromIST, toIST } = params;

    this.logger.log(fromIST, toIST);


    // Filter dimension
    const timeFilter =
      mode === "updated"
        ? { updatedAt: { gte: fromIST, lt: toIST } }
        : { openedAt: { gte: fromIST, lt: toIST } };

    const issues = await this.getIssuesInRange({
      fromIST,
      toIST,
      mode,
      includeClosedOnly: true, // includes open issues
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
    const { fromIST, toIST, mode } = query;

    this.logger.log(`Running FRT analytics (mode=${mode})`, { fromIST, toIST });

    // ✅ 1️⃣ Fetch all issues in range using the shared utility
    const issues = await this.getIssuesInRange({
      fromIST,
      toIST,
      includeClosedOnly: true,
    });

    // ✅ 2️⃣ Filter only issues that have FRT-related fields
    const validIssues = issues.filter(
      (i: any) =>
        i.agentLinkedAt &&
        i.agentCalledAt &&
        i.userId !== null // only issues handled by an agent
    );

    if (!validIssues.length) {
      this.logger.log('No FRT-eligible issues found in range');
      return [];
    }

    // ✅ 3️⃣ Group by agent
    const agg = new Map<
      number,
      {
        agentName: string;
        totalChats: number;
        manualRefunds: number;
        frtSumMs: number;
        frtCount: number;
      }
    >();

    // Preload agent info
    const uniqueAgentIds = Array.from(new Set(validIssues.map((i) => i.userId)));
    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueAgentIds } },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    const userMap = new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.email || `Agent#${u.id}`,
      ])
    );

    for (const issue of validIssues) {
      const agentId = issue.userId!;
      const agentName = userMap.get(agentId) || `Agent#${agentId}`;
      const frtMs =
        new Date(issue.agentLinkedAt).getTime() - new Date(issue.agentCalledAt).getTime();

      if (frtMs < 0) continue; // skip negative durations (data anomaly)

      if (!agg.has(agentId)) {
        agg.set(agentId, {
          agentName,
          totalChats: 0,
          manualRefunds: 0,
          frtSumMs: 0,
          frtCount: 0,
        });
      }

      const a = agg.get(agentId)!;
      a.totalChats += 1;
      if (issue.refundMode === 'MANUAL') a.manualRefunds += 1;
      a.frtSumMs += frtMs;
      a.frtCount += 1;
    }

    // ✅ 4️⃣ Compute averages and sort
    const result: AgentFRTSummary[] = Array.from(agg.entries()).map(([agentId, a]) => ({
      agentId,
      agentName: a.agentName,
      totalChats: a.totalChats,
      manualRefunds: a.manualRefunds,
      avgFRTMinutes:
        a.frtCount > 0 ? Math.round(((a.frtSumMs / a.frtCount) / 60000) * 100) / 100 : 0,
    }));

    result.sort((a, b) => b.totalChats - a.totalChats);

    this.logger.log(
      `✅ FRT analytics computed for ${result.length} agents using ${validIssues.length} issues`
    );

    return result;
  }


  async getComparisonMetrics(params: {
    currentFrom: Date;
    currentTo: Date;
    previousFrom: Date;
    previousTo: Date;
  }) {
    const { currentFrom, currentTo, previousFrom, previousTo } = params;

    // ---- Fetch metrics for current window ----
    const currentFRT = await this.CalculateUserWiseFRT(currentFrom, currentTo);
    const currentMachine = await this.GetMachinePerIssues(currentFrom, currentTo);
    const currentRating = await this.GetAgentRatings(currentFrom, currentTo);

    // ---- Fetch metrics for previous window ----
    const previousFRT = await this.CalculateUserWiseFRT(previousFrom, previousTo);
    const previousMachine = await this.GetMachinePerIssues(previousFrom, previousTo);
    const previousRating = await this.GetAgentRatings(previousFrom, previousTo);


    // ---- Metric Computations ----

    // Total chats
    const totalChatsCurrent = currentFRT.reduce((s, a) => s + (a.totalChats || 0), 0);
    const totalChatsPrevious = previousFRT.reduce((s, a) => s + (a.totalChats || 0), 0);

    const chatsChange = this.safePct(totalChatsCurrent, totalChatsPrevious);

    // Avg FRT
    const avgFRTCurrent = currentFRT.length
      ? currentFRT.reduce((s, a) => s + (a.avgFRTMinutes || 0), 0) / currentFRT.length
      : 0;

    const avgFRTPrevious = previousFRT.length
      ? previousFRT.reduce((s, a) => s + (a.avgFRTMinutes || 0), 0) / previousFRT.length
      : 0;

    const frtChange = this.safePct(avgFRTCurrent, avgFRTPrevious);

    // Refund rate
    const getRefundRate = (data) => {
      if (!data.totalIssue) return 0;
      const manualRefunds = data.result.reduce((s, r) => s + r.manualRefunds, 0)
      return (manualRefunds / data.totalIssue) * 100
    }

    const refundCurrent = getRefundRate(currentMachine);
    const refundPrevious = getRefundRate(previousMachine);
    const refundChange = this.safePct(refundCurrent, refundPrevious);

    // Satisfaction
    const satCurrent = currentRating.overallPercentage || 0;
    const satPrevious = previousRating.overallPercentage || 0;
    const satChange = this.safePct(satCurrent, satPrevious);


    return {
      chats: {
        current: totalChatsCurrent,
        previous: totalChatsPrevious,
        changeValue: chatsChange,
        isPositive: chatsChange >= 0,
      },
      avgFRT: {
        current: avgFRTCurrent,
        previous: avgFRTPrevious,
        changeValue: frtChange,
        isPositive: frtChange < 0, // lower is better
      },
      refundRate: {
        current: refundCurrent,
        previous: refundPrevious,
        changeValue: refundChange,
        isPositive: refundChange < 0,
      },
      customerSatisfaction: {
        current: satCurrent,
        previous: satPrevious,
        changeValue: satChange,
        isPositive: satChange >= 0,
      },
    };
  }


  /**
   * Analyzes rating messages by cases to identify data integrity issues.
   * Flow: Messages → Cases → User Analytics
   * 
   * @param from - Start date of the analysis period
   * @param to - End date of the analysis period
   * @returns Object containing:
   *   - period: Date range for the analysis
   *   - summary: Overall statistics (total cases, cases with ratings, messages sent, etc.)
   *   - userTable: Per-agent breakdown with case analytics
   */
  async NotSendUnratedMessageIssues(from: Date, to: Date) {
    const users = await this.prisma.user.findMany({
      where: {
        id: {
          in: [3, 6, 8]
        }
      },
      select: { id: true, firstName: true, lastName: true },
    });

    const userAnalytics: any[] = [];
    let totalCases = 0;
    let totalWithRating = 0;
    let totalWithMessage = 0;
    let totalRatingButNoMsg = 0;

    for (const user of users) {
      // Step 1: Get all cases for this user created in the date range
      const cases = await this.prisma.case.findMany({
        where: {
          userId: user.id,
          createdAt: { gte: from, lte: to },
        },
        select: {
          id: true,
          issueEvents: {
            where: {
              status: IssueEventStatus.CLOSED,
            },
            select: {
              id: true,
              agentRating: true,
              closedAt: true,
            }
          }
        }
      });

      const caseIds = cases.map(c => c.id);

      if (caseIds.length === 0) {
        userAnalytics.push({
          agent: `${user.firstName} ${user.lastName}`,
          totalCases: 0,
          withRating: 0,
          messageSent: 0,
          ratingButNoMsg: 0,
          msgRate: "0%"
        });
        continue;
      }

      // Step 2: Find rating messages for these cases
      const ratingMessages = await this.prisma.message.findMany({
        where: {
          type: MessageType.INTERACTIVE,
          text: { contains: 'How would you rate your experience' },
          timestamp: { gte: from, lte: to },
          caseId: { in: caseIds, not: null }
        },
        select: {
          id: true,
          caseId: true,
        }
      });

      // Step 3: Extract unique case IDs that have rating messages
      const caseIdsWithMessage = new Set(
        ratingMessages.map(msg => msg.caseId).filter(id => id !== null) as number[]
      );

      // Step 4: Calculate user-specific metrics
      const userCases = cases;

      // Cases where at least one issue has a rating
      const userCasesWithRating = userCases.filter(c =>
        c.issueEvents.some(issue => issue.agentRating !== null)
      );

      // Cases that have rating messages
      const userCasesWithMessage = userCases.filter(c => caseIdsWithMessage.has(c.id));

      // Cases with ratings but no message sent
      const userCasesWithRatingButNoMessage = userCasesWithRating.filter(
        c => !caseIdsWithMessage.has(c.id)
      );

      // Update overall totals
      totalCases += userCases.length;
      totalWithRating += userCasesWithRating.length;
      totalWithMessage += userCasesWithMessage.length;
      totalRatingButNoMsg += userCasesWithRatingButNoMessage.length;

      // Push user result
      userAnalytics.push({
        agent: `${user.firstName} ${user.lastName}`,
        totalCases: userCases.length,
        withRating: userCasesWithRating.length,
        messageSent: userCasesWithMessage.length,
        ratingButNoMsg: userCasesWithRatingButNoMessage.length,
        msgRate: userCasesWithRating.length > 0
          ? `${Math.round((userCasesWithMessage.length / userCasesWithRating.length) * 100)}%`
          : "0%"
      });
    }

    return {
      period: `${from.toISOString().split('T')[0]} to ${to.toISOString().split('T')[0]}`,
      summary: {
        totalCases: totalCases,
        casesWithRating: totalWithRating,
        messagesSent: totalWithMessage,
        ratingWithoutMessage: totalRatingButNoMsg,
        messageRate: totalWithRating > 0
          ? `${Math.round((totalWithMessage / totalWithRating) * 100)}%`
          : "0%"
      },
      userTable: userAnalytics
    };
  }

}
