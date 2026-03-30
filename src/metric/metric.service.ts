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
    const agentIds = [3, 6, 8];

    const users = await this.prisma.user.findMany({
      where: { id: { in: agentIds } },
      select: { id: true, firstName: true, lastName: true, email: true },
    });
    const userLookup = new Map(users.map((u) => [u.id, u]));

    // totalCases: case-level, deduplicated, scoped by case.createdAt
    const allCases = await this.prisma.case.findMany({
      where: {
        userId: { in: agentIds },
        createdAt: { gte: from, lte: to },
      },
      select: { id: true, userId: true },
    });
    const totalCasesPerUser = new Map<number, number>();
    for (const c of allCases) {
      totalCasesPerUser.set(c.userId!, (totalCasesPerUser.get(c.userId!) ?? 0) + 1);
    }

    // Ratings: issue-level (no case deduplication), scoped by issueEvent.closedAt
    const ratedIssues = await this.prisma.issueEvent.findMany({
      where: {
        status: IssueEventStatus.CLOSED,
        agentRating: { not: null },
        userId: { in: agentIds },
        closedAt: { gte: from, lte: to },
      },
      select: { userId: true, agentRating: true },
    });

    type UserAgg = { totalCases: number; ratingSum: number; totalRatings: number };
    const perUser = new Map<number, UserAgg>();
    const initAgg = (): UserAgg => ({ totalCases: 0, ratingSum: 0, totalRatings: 0 });

    for (const [userId, count] of totalCasesPerUser) {
      if (!perUser.has(userId)) perUser.set(userId, initAgg());
      perUser.get(userId)!.totalCases = count;
    }

    let globalSum = 0;
    for (const issue of ratedIssues) {
      const uid = issue.userId!;
      const rating = issue.agentRating!;
      globalSum += rating;
      if (!perUser.has(uid)) perUser.set(uid, initAgg());
      const agg = perUser.get(uid)!;
      agg.ratingSum += rating;
      agg.totalRatings += 1;
    }

    const globalCount = ratedIssues.length;

    const agents = Array.from(perUser.entries()).map(([uid, agg]) => {
      const user = userLookup.get(uid);
      const maxRating = agg.totalRatings * 5;
      return {
        user,
        totalCases: agg.totalCases,
        totalRatings: agg.totalRatings,
        avgRating: agg.totalRatings > 0 ? agg.ratingSum / agg.totalRatings : 0,
        percentage: maxRating ? (agg.ratingSum / maxRating) * 100 : 0,
      };
    });

    const overallAvg = globalCount > 0 ? globalSum / globalCount : 0;
    const overallPercentage = (overallAvg / 5) * 100;

    return { agents, overallAvg, overallPercentage };
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
    const agentIds = [3, 6, 8];

    // Step 1: Parallel Fetch with optimized selection
    const [users, allIssues] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.issueEvent.findMany({
        where: {
          userId: { in: agentIds },
          status: IssueEventStatus.CLOSED,
          closedAt: { gte: from, lte: to },
        },
        include: { // Using include to get messages in one query if relations allow, 
          // but keeping your structure for clarity
          messages: { orderBy: { timestamp: 'asc' }, select: { senderType: true, timestamp: true } }
        }
      }),
    ]);

    // Step 2: Initialize Accumulator Object - O(Agents)
    const stats = new Map();
    for (const user of users) {
      stats.set(user.id, {
        userId: user.id,
        userName: `${user.firstName} ${user.lastName}`,
        caseIds: new Set<number>(),
        manualRefundCases: new Set<number>(),
        autoRefundCases: new Set<number>(),
        manualRefundAmount: 0,
        frtList: [] as number[],
      });
    }

    // Step 3: Single Pass Distribution - O(n) where n = allIssues
    for (const issue of allIssues) {
      const userStats = stats.get(issue.userId);
      if (!userStats) continue;

      if (issue.caseId) userStats.caseIds.add(issue.caseId);

      // Refund Aggregation
      if (issue.issueType === IssueType.REFUND) {
        if (issue.refundMode === RefundMode.MANUAL) {
          if (issue.caseId) userStats.manualRefundCases.add(issue.caseId);
          userStats.manualRefundAmount += (issue.refundAmountMinor || 0);
        } else if (issue.refundMode === RefundMode.AUTO && issue.caseId) {
          userStats.autoRefundCases.add(issue.caseId);
        }
      }

      // FRT Calculation Logic - O(m) where m = messages per issue
      let lastCustomerMsg: number | null = null;
      for (const msg of issue.messages) {
        if (msg.senderType === SenderType.CUSTOMER) {
          lastCustomerMsg = msg.timestamp.getTime();
        } else if (msg.senderType === SenderType.USER && lastCustomerMsg) {
          const diffMinutes = (msg.timestamp.getTime() - lastCustomerMsg) / 60000;
          if (diffMinutes >= 0) userStats.frtList.push(diffMinutes);
          lastCustomerMsg = null; // Reset to find the NEXT response pair
        }
      }
    }

    // Step 4: Final Formatting - O(Agents)
    return Array.from(stats.values()).map(s => ({
      userId: s.userId,
      userName: s.userName,
      totalChats: s.caseIds.size,
      manualRefunds: s.manualRefundCases.size,
      manualRefundAmount: s.manualRefundAmount,
      autoRefunds: s.autoRefundCases.size,
      avgFRTMinutes: s.frtList.length
        ? Number((s.frtList.reduce((a, b) => a + b, 0) / s.frtList.length).toFixed(2))
        : null,
      frtList: s.frtList
    }));
  }




  async agentIssueClosureAnalytics(params: {
    fromIST: Date;
    toIST: Date;
    mode?: "opened" | "updated";
  }) {
    const { fromIST, toIST } = params;

    this.logger.log(`Running agentIssueClosureAnalytics with`, params);

    // Issue stats: scoped by closedAt (issue-level, no case dedup) — same ruleset
    const issues = await this.prisma.issueEvent.findMany({
      where: {
        status: IssueEventStatus.CLOSED,
        userId: { not: null },
        closedAt: { gte: fromIST, lte: toIST },
      },
      select: { id: true, userId: true, openedAt: true, closedAt: true },
    });

    if (!issues.length) {
      this.logger.log("No closed issues found in the range");
      return { total: 0, summary: [] };
    }

    const uniqueUserIds = Array.from(
      new Set(issues.map((i) => i.userId).filter(Boolean))
    ) as number[];

    // Fetch user names and totalCases in parallel
    const [users, allCases] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: uniqueUserIds } },
        select: { id: true, firstName: true, lastName: true, email: true },
      }),
      // totalCases: case-level, deduplicated, scoped by case.createdAt
      this.prisma.case.findMany({
        where: {
          userId: { in: uniqueUserIds },
          createdAt: { gte: fromIST, lte: toIST },
        },
        select: { id: true, userId: true },
      }),
    ]);

    const userMap = new Map(
      users.map((u) => [
        u.id,
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || u.email || "Unknown",
      ])
    );
    const totalCasesPerUser = new Map<number, number>();
    for (const c of allCases) {
      totalCasesPerUser.set(c.userId!, (totalCasesPerUser.get(c.userId!) ?? 0) + 1);
    }

    // Group issues by user and compute durations (issue-level, closedAt scope)
    const grouped = new Map<number, {
      agentName: string;
      totalClosed: number;
      closedAfter4Hrs: number;
      totalDurationHrs: number;
    }>();

    for (const issue of issues) {
      const uid = issue.userId!;
      const durationMs = new Date(issue.closedAt!).getTime() - new Date(issue.openedAt).getTime();
      const durationHrs = durationMs / (1000 * 60 * 60);

      if (!grouped.has(uid)) {
        grouped.set(uid, {
          agentName: userMap.get(uid) || "Unassigned",
          totalClosed: 0,
          closedAfter4Hrs: 0,
          totalDurationHrs: 0,
        });
      }

      const entry = grouped.get(uid)!;
      entry.totalClosed += 1;
      entry.totalDurationHrs += durationHrs;
      if (durationHrs > 4) entry.closedAfter4Hrs += 1;
    }

    const summary = Array.from(grouped.entries()).map(([userId, g]) => {
      const avg = g.totalClosed ? g.totalDurationHrs / g.totalClosed : 0;
      const slowRate = g.totalClosed ? (g.closedAfter4Hrs / g.totalClosed) * 100 : 0;
      return {
        userId,
        agentName: g.agentName,
        totalCases: totalCasesPerUser.get(userId) ?? 0,
        totalClosed: g.totalClosed,
        closedAfter4Hrs: g.closedAfter4Hrs,
        avgClosureTimeHrs: Number(avg.toFixed(2)),
        slowRate: Number(slowRate.toFixed(2)),
      };
    });

    summary.sort((a, b) => b.slowRate - a.slowRate);

    this.logger.log(`✅ Agent closure analytics generated: ${summary.length} agents`);

    return { total: issues.length, summary };
  }





  async getManualRefundTrendPerAgent(params: {
    fromIST: Date;
    toIST: Date;
  }) {
    const { fromIST, toIST } = params;
    const agentIds = [3, 6, 8];

    // Same ruleset: CLOSED issues, closedAt scope, restricted to known agentIds
    const issues = await this.prisma.issueEvent.findMany({
      where: {
        userId: { in: agentIds },
        status: IssueEventStatus.CLOSED,
        issueType: IssueType.REFUND,
        refundMode: RefundMode.MANUAL,
        closedAt: { gte: fromIST, lte: toIST },
      },
      select: {
        userId: true,
        caseId: true,
        closedAt: true,
        refundAmountMinor: true,
      },
    });

    // Step 1: Aggregate per unique case — earliest closedAt date + summed amount.
    // This ensures each case is counted exactly once globally, matching CalculateUserWiseFRT.
    const caseAgg = new Map<number, { date: string; userId: number; amount: number }>();

    for (const issue of issues) {
      if (!issue.caseId) continue;
      const dateKey = format(new Date(issue.closedAt!), 'yyyy-MM-dd');
      const existing = caseAgg.get(issue.caseId);
      if (!existing) {
        caseAgg.set(issue.caseId, { date: dateKey, userId: issue.userId!, amount: issue.refundAmountMinor ?? 0 });
      } else {
        if (dateKey < existing.date) existing.date = dateKey; // pin to earliest date
        existing.amount += issue.refundAmountMinor ?? 0;
      }
    }

    // Step 2: Group unique cases into date + agent buckets
    const grouped: Record<string, Record<number, { count: number; amount: number }>> = {};

    for (const { date, userId, amount } of caseAgg.values()) {
      if (!grouped[date]) grouped[date] = {};
      if (!grouped[date][userId]) grouped[date][userId] = { count: 0, amount: 0 };
      grouped[date][userId].count += 1;
      grouped[date][userId].amount += amount;
    }

    const dates = Object.keys(grouped).sort();
    const presentAgentIds = Array.from(
      new Set(dates.flatMap((d) => Object.keys(grouped[d]).map(Number))),
    );

    // Build dataset with hover info
    const datasets = presentAgentIds.map((agentId) => {
      const label = issues.find((i) => i.userId === agentId)?.userId || `Agent#${agentId}`;

      return {
        label,
        data: dates.map((d) => {
          const val = grouped[d][agentId];
          const count = val ? val.count : 0;
          const amount = val ? val.amount : 0;
          return {
            x: d,
            y: count,
            refundAmount: amount,
            tooltip: val
              ? `Refunds: ${count} | Amount: ₹${amount.toFixed(2)}`
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
    // [NEW] Fetch Current Expired
    const currentExpired = await this.getExpiredChatAnalytics(currentFrom, currentTo);

    // ---- Fetch metrics for previous window ----
    const previousFRT = await this.CalculateUserWiseFRT(previousFrom, previousTo);
    const previousMachine = await this.GetMachinePerIssues(previousFrom, previousTo);
    const previousRating = await this.GetAgentRatings(previousFrom, previousTo);
    // [NEW] Fetch Previous Expired
    const previousExpired = await this.getExpiredChatAnalytics(previousFrom, previousTo);


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

    // [NEW] Expired Chats Logic
    // We compare raw counts, but you could also calculate rate (Expired / Total Chats)
    const expCurrent = currentExpired.totalExpired;
    const expPrevious = previousExpired.totalExpired;
    const expChange = this.safePct(expCurrent, expPrevious);


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
      expiredChats: {
        current: expCurrent,
        previous: expPrevious,
        changeValue: expChange,
        isPositive: expChange < 0, // Lower expired chats is better
        topBottlenecks: currentExpired.bottlenecks, // Useful context for the UI
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
    const agentIds = [3, 6, 8];

    // Step 1: Fetch users and closed issues in parallel
    // totalCases derived from unique caseIds in closed issues — no separate case query needed.
    const [users, closedIssues] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: agentIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
      this.prisma.issueEvent.findMany({
        where: {
          userId: { in: agentIds },
          status: IssueEventStatus.CLOSED,
          closedAt: { gte: from, lte: to },
        },
        select: { id: true, userId: true, caseId: true, agentRating: true },
      }),
    ]);

    const closedIssueIds = closedIssues.map(i => i.id);

    // Build issueId → userId lookup for message aggregation
    const issueUserMap = new Map(closedIssues.map(i => [i.id, i.userId]));

    // Step 2: Fetch all messages for those issues — used for both rating detection and unique case counting.
    const issueMessages = await this.prisma.message.findMany({
      where: { issueEventId: { in: closedIssueIds } },
      select: { issueEventId: true, caseId: true, type: true, text: true },
    });

    // Unique caseIds per user derived from messages linked to their issues
    const casesPerUser = new Map<number, Set<number>>();
    const issueIdsWithMessage = new Set<number>();

    for (const msg of issueMessages) {
      if (!msg.issueEventId) continue;
      const userId = issueUserMap.get(msg.issueEventId);

      // Count unique cases via message caseId
      if (userId && msg.caseId) {
        if (!casesPerUser.has(userId)) casesPerUser.set(userId, new Set());
        casesPerUser.get(userId)!.add(msg.caseId);
      }

      // Detect rating messages
      if (msg.type === MessageType.INTERACTIVE && msg.text?.includes('How would you rate your experience')) {
        issueIdsWithMessage.add(msg.issueEventId);
      }
    }

    // Step 3: Aggregate per user.
    // totalCases: unique caseIds from messages linked to closed issues.
    // totalIssues + withRating + messageSent: counted at issue level.
    type UserAgg = { totalCases: number; totalIssues: number; messageSent: number; withRating: number; ratingButNoMsg: number };
    const perUser = new Map<number, UserAgg>();
    const initAgg = (): UserAgg => ({ totalCases: 0, totalIssues: 0, messageSent: 0, withRating: 0, ratingButNoMsg: 0 });

    for (const [userId, caseSet] of casesPerUser) {
      if (!perUser.has(userId)) perUser.set(userId, initAgg());
      perUser.get(userId)!.totalCases = caseSet.size;
    }

    for (const issue of closedIssues) {
      const userId = issue.userId!;
      if (!perUser.has(userId)) perUser.set(userId, initAgg());
      const agg = perUser.get(userId)!;
      agg.totalIssues += 1;
      const hasMessage = issueIdsWithMessage.has(issue.id);
      if (hasMessage) agg.messageSent += 1;
      if (issue.agentRating !== null) {
        agg.withRating += 1;
        if (!hasMessage) agg.ratingButNoMsg += 1;
      }
    }

    let totalCases = 0;
    let totalIssues = 0;
    let totalWithMessage = 0;
    let totalWithRating = 0;
    let totalRatingButNoMsg = 0;

    const userTable = users.map(user => {
      const agg = perUser.get(user.id) ?? initAgg();
      totalCases += agg.totalCases;
      totalIssues += agg.totalIssues;
      totalWithMessage += agg.messageSent;
      totalWithRating += agg.withRating;
      totalRatingButNoMsg += agg.ratingButNoMsg;
      return {
        agent: `${user.firstName} ${user.lastName}`,
        totalCases: agg.totalCases,
        totalIssues: agg.totalIssues,
        messageSent: agg.messageSent,
        withRating: agg.withRating,
        ratingButNoMsg: agg.ratingButNoMsg,
        // What % of closed issues got a rating reply from the customer
        ratingRate: agg.totalIssues > 0
          ? `${Math.round((agg.withRating / agg.totalIssues) * 100)}%`
          : '0%',
        // What % of issues where we sent the message actually got rated
        conversionRate: agg.messageSent > 0
          ? `${Math.round((agg.withRating / agg.messageSent) * 100)}%`
          : '0%',
      };
    });

    return {
      period: `${from.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short', hour12: false })} to ${to.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short', hour12: false })} IST`,
      summary: {
        totalCases,
        totalIssues,
        messagesSent: totalWithMessage,
        casesWithRating: totalWithRating,
        ratingWithoutMessage: totalRatingButNoMsg,
        // % of closed issues that received a rating
        ratingRate: totalIssues > 0
          ? `${Math.round((totalWithRating / totalIssues) * 100)}%`
          : '0%',
        // % of issues where the message was sent that got rated
        conversionRate: totalWithMessage > 0
          ? `${Math.round((totalWithRating / totalWithMessage) * 100)}%`
          : '0%',
      },
      userTable,
    };
  }

  async getExpiredChatAnalytics(from: Date, to: Date) {
    // 1. Fetch expired events in range
    const expiredEvents = await this.prisma.expiredEvent.findMany({
      where: {
        expiredAt: { gte: from, lt: to },
      },
      select: {
        id: true,
        lastBotNodeId: true,
      },
    });

    const totalExpired = expiredEvents.length;

    if (totalExpired === 0) {
      return {
        totalExpired: 0,
        bottlenecks: [],
        byIssueType: {},
      };
    }

    // 2. Aggregate Bottlenecks (Where did they get stuck?)
    const nodeCounts = new Map<string, number>();
    // 3. Aggregate by Issue Type (What were they complaining about?)


    for (const event of expiredEvents) {
      // Count Node drops
      const node = event.lastBotNodeId || 'Unknown_Start';
      nodeCounts.set(node, (nodeCounts.get(node) || 0) + 1);


    }

    // 4. Sort bottlenecks to find the worst offenders
    const bottlenecks = Array.from(nodeCounts.entries())
      .map(([nodeId, count]) => ({ nodeId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5 drop-off points

    return {
      totalExpired,
      bottlenecks

    };
  }
}