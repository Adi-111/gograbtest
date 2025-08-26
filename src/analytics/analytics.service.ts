import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Status, CaseHandler, SenderType, Prisma } from '@prisma/client';
import { format, startOfDay, endOfDay, subDays, startOfHour, endOfHour, addHours } from 'date-fns';
import { PrismaService } from 'src/prisma/prisma.service';

export interface DailyTicketStats {
    date: string;
    Opened: number;
    Pending: number;
    Solved: number;
    "Solved by operator": number;
    "Solved by bot": number;
    Expired: number;
    "Missed chats": number;
}

export interface OverviewAnalytics {
    text: string;
    count: number;
}
export interface AgentChatStat {
    agentId: number | null;
    agentName: string | null;
    totalChats: number;     // distinct cases the agent touched
    totalMessages: number;  // total agent messages in the window
}


@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly prisma: PrismaService) { }

    // Run every hour to calculate previous hour's analytics
    @Cron(CronExpression.EVERY_HOUR)
    async calculateHourlyAnalytics() {
        const lastHour = addHours(new Date(), -1);
        await this.calculateAnalyticsForHour(lastHour);
    }

    // Run every day at midnight to clean up old hourly data (keep only last 7 days)
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOldHourlyData() {
        const cutoffDate = subDays(new Date(), 7);

        await this.prisma.hourlyAnalytics.deleteMany({
            where: {
                datetime: {
                    lt: cutoffDate,
                },
            },
        });

        await this.prisma.tagAnalytics.deleteMany({
            where: {
                date: {
                    lt: cutoffDate,
                },
            },
        });
    }

    // Calculate analytics for a specific hour
    async calculateAnalyticsForHour(date: Date): Promise<void> {
        const startHour = startOfHour(date);
        const endHour = endOfHour(date);

        this.logger.log(`Calculating hourly analytics for ${format(date, 'yyyy-MM-dd HH:00')}`);

        try {
            // Get cases created in this hour
            const casesCreated = await this.prisma.case.findMany({
                where: {
                    createdAt: {
                        gte: startHour,
                        lte: endHour,
                    },
                },
                include: {
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                    },
                    tags: true,
                },
            });

            // Get cases updated in this hour (for solved status)
            const casesUpdated = await this.prisma.case.findMany({
                where: {
                    updatedAt: {
                        gte: startHour,
                        lte: endHour,
                    },
                    status: Status.SOLVED,
                },
                include: {
                    messages: true,
                },
            });

            // Calculate metrics
            const casesOpened = casesCreated.length;
            const casesSolved = casesUpdated.length;
            const casesSolvedByBot = casesUpdated.filter(c => c.assignedTo === CaseHandler.BOT).length;
            const casesSolvedByOperator = casesUpdated.filter(c => c.assignedTo === CaseHandler.USER).length;

            // Calculate processing cases updated in this hour
            const casesProcessing = await this.prisma.case.count({
                where: {
                    status: Status.PROCESSING,
                    updatedAt: {
                        gte: startHour,
                        lte: endHour,
                    },
                },
            });

            // Calculate pending cases
            const casesPending = await this.prisma.case.count({
                where: {
                    status: {
                        in: [Status.ASSIGNED, Status.BOT_HANDLING, Status.INITIATED],
                    },
                    createdAt: {
                        gte: startHour,
                        lte: endHour,
                    },
                },
            });

            // Calculate expired cases
            const casesExpired = casesCreated.filter(c => {
                if (!c.timer) return false;
                const isExpired = new Date(c.timer).getTime() < Date.now();
                if (!isExpired) return false;

                const isActiveStatus = [
                    Status.ASSIGNED,
                    Status.BOT_HANDLING,
                    Status.INITIATED,
                    Status.PROCESSING,
                    Status.UNSOLVED,
                    Status.SOLVED
                ].includes(c.status);

                if (!isActiveStatus) return false;

                const lastMessage = c.messages[0];
                return !lastMessage || lastMessage.senderType !== SenderType.USER;
            }).length;

            // Calculate missed chats
            const missedChats = casesCreated.filter(c => {
                const customerMessages = c.messages?.filter(
                    msg => msg.senderType === SenderType.CUSTOMER &&
                        msg.type === 'TEXT' &&
                        !msg.replyType
                ).length || 0;
                return customerMessages > 10;
            }).length;

            // Calculate average duration for solved cases
            const solvedCasesWithDuration = casesUpdated.filter(c =>
                c.createdAt && c.updatedAt
            );

            let avgCaseDuration = 0;
            let totalCaseDuration = 0;

            if (solvedCasesWithDuration.length > 0) {
                const totalDurationMs = solvedCasesWithDuration.reduce((sum, c) =>
                    sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()), 0
                );
                totalCaseDuration = totalDurationMs / 1000 / 60; // Convert to minutes
                avgCaseDuration = totalCaseDuration / solvedCasesWithDuration.length;
            }

            // Upsert hourly analytics
            await this.prisma.hourlyAnalytics.upsert({
                where: { datetime: startHour },
                update: {
                    casesOpened,
                    casesPending,
                    casesSolved,
                    casesSolvedByOperator,
                    casesSolvedByBot,
                    casesExpired,
                    casesProcessing,
                    missedChats,
                    avgCaseDuration,
                    totalCaseDuration,
                    updatedAt: new Date(),
                },
                create: {
                    datetime: startHour,
                    casesOpened,
                    casesPending,
                    casesSolved,
                    casesSolvedByOperator,
                    casesSolvedByBot,
                    casesExpired,
                    casesProcessing,
                    missedChats,
                    avgCaseDuration,
                    totalCaseDuration,
                },
            });

            // Calculate tag analytics for this hour
            await this.calculateTagAnalyticsForHour(startHour, casesCreated);

            this.logger.log(`Hourly analytics calculated successfully for ${format(date, 'yyyy-MM-dd HH:00')}`);
        } catch (error) {
            this.logger.error(`Failed to calculate hourly analytics for ${format(date, 'yyyy-MM-dd HH:00')}:`, error);
        }
    }

    private async calculateTagAnalyticsForHour(datetime: Date, cases: any[]): Promise<void> {
        const tagCountMap: Record<string, number> = {};

        // Count tags for cases created in this hour
        for (const caseItem of cases) {
            if (!caseItem.tags || !Array.isArray(caseItem.tags)) continue;

            for (const tag of caseItem.tags) {
                const tagText = tag.text?.trim();
                if (tagText) {
                    tagCountMap[tagText] = (tagCountMap[tagText] || 0) + 1;
                }
            }
        }

        // Delete existing tag analytics for this hour
        await this.prisma.tagAnalytics.deleteMany({
            where: { date: datetime }, // Changed from datetime to date
        });

        // Insert new tag analytics
        const tagAnalyticsData = Object.entries(tagCountMap).map(([tagText, count]) => ({
            date: datetime, // maps to the Prisma field
            tagText,
            count,
        }));

        if (tagAnalyticsData.length > 0) {
            await this.prisma.tagAnalytics.createMany({
                data: tagAnalyticsData,
            });
        }
    }

    // Get real-time data for current day (not yet calculated in hourly analytics)
    private async getCurrentDayRealTimeData(): Promise<any> {
        const todayStart = startOfDay(new Date());
        const now = new Date();

        // Get current hour's data (not yet calculated)
        const currentHourStart = startOfHour(now);

        const currentHourCases = await this.prisma.case.findMany({
            where: {
                createdAt: {
                    gte: currentHourStart,
                    lte: now,
                },
            },
            include: {
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 1,
                },
                tags: true,
            },
        });

        const currentHourSolved = await this.prisma.case.findMany({
            where: {
                updatedAt: {
                    gte: currentHourStart,
                    lte: now,
                },
                status: Status.SOLVED,
            },
        });

        return {
            casesOpened: currentHourCases.length,
            casesSolved: currentHourSolved.length,
            casesSolvedByBot: currentHourSolved.filter(c => c.assignedTo === CaseHandler.BOT).length,
            casesSolvedByOperator: currentHourSolved.filter(c => c.assignedTo === CaseHandler.USER).length,
            tags: currentHourCases.flatMap(c => c.tags || []),
        };
    }

    // Update overall analytics (always real-time)
    async updateOverallAnalytics(): Promise<void> {
        const totalCases = await this.prisma.case.count();
        const casesProcessing = await this.prisma.case.count({
            where: { status: Status.PROCESSING },
        });
        const casesSolved = await this.prisma.case.count({
            where: { status: Status.SOLVED },
        });
        const casesSolvedByBot = await this.prisma.case.count({
            where: {
                status: Status.SOLVED,
                assignedTo: CaseHandler.BOT,
            },
        });
        const casesSolvedByOperator = await this.prisma.case.count({
            where: {
                status: Status.SOLVED,
                assignedTo: CaseHandler.USER,
            },
        });

        const casesOpen = await this.prisma.case.count({
            where: {
                status: {
                    in: [Status.BOT_HANDLING, Status.INITIATED],
                },
            },
        });

        const expiredCases = await this.prisma.case.findMany({
            where: {
                timer: { lt: new Date() },
                status: {
                    in: [
                        Status.ASSIGNED,
                        Status.BOT_HANDLING,
                        Status.INITIATED,
                        Status.PROCESSING,
                        Status.UNSOLVED,
                    ],
                },
            },
            include: {
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 1,
                },
            },
        });

        const casesExpired = expiredCases.filter(c => {
            const lastMessage = c.messages[0];
            return !lastMessage || lastMessage.senderType !== SenderType.USER;
        }).length;

        await this.prisma.overallAnalytics.upsert({
            where: { id: 1 }, // Single row for overall stats
            update: {
                totalCases,
                casesProcessing,
                casesSolved,
                casesSolvedByBot,
                casesSolvedByOperator,
                casesExpired,
                casesOpen,
                lastUpdated: new Date(),
            },
            create: {
                id: 1,
                totalCases,
                casesProcessing,
                casesSolved,
                casesSolvedByBot,
                casesSolvedByOperator,
                casesExpired,
                casesOpen,
            },
        });
    }

    // API Methods with hybrid approach (historical + real-time)
    async getOverviewAnalytics(): Promise<OverviewAnalytics[]> {
        await this.updateOverallAnalytics();

        const analytics = await this.prisma.overallAnalytics.findFirst({
            where: { id: 1 },
        });

        if (!analytics) {
            return [];
        }

        return [
            { text: 'PROCESSING', count: analytics.casesProcessing },
            { text: Status.SOLVED, count: analytics.casesSolved },
            { text: 'SOLVED BY BOT', count: analytics.casesSolvedByBot },
            { text: 'SOLVED BY OPERATOR', count: analytics.casesSolvedByOperator },
            { text: 'Expired', count: analytics.casesExpired },
            { text: 'Open', count: analytics.casesOpen },
        ];
    }

    async getTagCountBarData(): Promise<{ tag: string; count: number; }[]> {
        // Get historical data from tag analytics (last 7 days)
        const sevenDaysAgo = subDays(new Date(), 7);

        // Use queryRaw with Prisma.sql template for type safety
        const historicalTagAnalytics = await this.prisma.$queryRaw`
        SELECT 
            "tagText", 
            CAST(SUM("count") AS INTEGER) as count
        FROM "TagAnalytics"
        WHERE "date" >= ${sevenDaysAgo}
        GROUP BY "tagText"
    ` as { tagText: string; count: number }[];

        // Get current day real-time data
        const currentDayData = await this.getCurrentDayRealTimeData();
        const currentTagCounts: Record<string, number> = {};

        for (const tag of currentDayData.tags) {
            const tagText = tag.text?.trim();
            if (tagText) {
                currentTagCounts[tagText] = (currentTagCounts[tagText] || 0) + 1;
            }
        }

        // Combine historical and current data
        const combinedTagCounts: Record<string, number> = {};

        // Add historical data
        for (const item of historicalTagAnalytics) {
            combinedTagCounts[item.tagText] = (combinedTagCounts[item.tagText] || 0) + item.count;
        }

        // Add current day data
        for (const [tagText, count] of Object.entries(currentTagCounts)) {
            combinedTagCounts[tagText] = (combinedTagCounts[tagText] || 0) + count;
        }

        return Object.entries(combinedTagCounts)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    async getTicketDurationVsCountData(): Promise<{ date: string; duration: number; count: number; }[]> {
        // Get last 7 days of hourly data and aggregate by day
        const sevenDaysAgo = subDays(new Date(), 7);

        const hourlyAnalytics = await this.prisma.hourlyAnalytics.findMany({
            where: {
                datetime: {
                    gte: sevenDaysAgo,
                },
            },
            orderBy: { datetime: 'asc' },
        });

        // Group by day and calculate averages
        const dailyData: Record<string, { totalDuration: number; totalCases: number; count: number }> = {};

        for (const item of hourlyAnalytics) {
            const dateKey = format(item.datetime, 'dd MMM');

            if (!dailyData[dateKey]) {
                dailyData[dateKey] = { totalDuration: 0, totalCases: 0, count: 0 };
            }

            dailyData[dateKey].totalDuration += item.totalCaseDuration || 0;
            dailyData[dateKey].totalCases += item.casesSolved;
            dailyData[dateKey].count += item.casesSolved;
        }

        // Add current day real-time data
        const today = format(new Date(), 'dd MMM');
        const currentDayData = await this.getCurrentDayRealTimeData();

        if (!dailyData[today]) {
            dailyData[today] = { totalDuration: 0, totalCases: 0, count: 0 };
        }
        dailyData[today].count += currentDayData.casesSolved;

        return Object.entries(dailyData).map(([date, data]) => ({
            date,
            duration: data.totalCases > 0 ? Math.round(data.totalDuration / data.totalCases) : 0,
            count: data.count,
        }));
    }

    async getTicketStatusBarData(): Promise<{ status: string; count: number; }[]> {
        const analytics = await this.prisma.overallAnalytics.findFirst({
            where: { id: 1 },
        });

        if (!analytics) {
            await this.updateOverallAnalytics();
            return this.getTicketStatusBarData();
        }

        return [
            { status: 'Initiated', count: analytics.totalCases },
            { status: 'Processing', count: analytics.casesProcessing },
            { status: 'Solved', count: analytics.casesSolved },
            { status: 'Solved by operator', count: analytics.casesSolvedByOperator },
            { status: 'Solved by bot', count: analytics.casesSolvedByBot },
            { status: 'Expired', count: analytics.casesExpired },
        ];
    }

    async getTicketStatusOverTimeData(): Promise<DailyTicketStats[]> {
        // Get last 7 days of hourly data
        const sevenDaysAgo = subDays(new Date(), 30);

        const hourlyAnalytics = await this.prisma.hourlyAnalytics.findMany({
            where: {
                datetime: {
                    gte: sevenDaysAgo,
                },
            },
            orderBy: { datetime: 'asc' },
        });

        // Group by day
        const dailyStats: Record<string, DailyTicketStats> = {};

        for (const item of hourlyAnalytics) {
            const dateKey = format(item.datetime, 'dd MMM');

            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = {
                    date: dateKey,
                    Opened: 0,
                    Pending: 0,
                    Solved: 0,
                    'Solved by operator': 0,
                    'Solved by bot': 0,
                    Expired: 0,
                    'Missed chats': 0,
                };
            }

            dailyStats[dateKey].Opened += item.casesOpened;
            dailyStats[dateKey].Pending += item.casesPending;
            dailyStats[dateKey].Solved += item.casesSolved;
            dailyStats[dateKey]['Solved by operator'] += item.casesSolvedByOperator;
            dailyStats[dateKey]['Solved by bot'] += item.casesSolvedByBot;
            dailyStats[dateKey].Expired += item.casesExpired;
            dailyStats[dateKey]['Missed chats'] += item.missedChats;
        }

        // Add current day real-time data
        const today = format(new Date(), 'dd MMM');
        const currentDayData = await this.getCurrentDayRealTimeData();

        if (!dailyStats[today]) {
            dailyStats[today] = {
                date: today,
                Opened: 0,
                Pending: 0,
                Solved: 0,
                'Solved by operator': 0,
                'Solved by bot': 0,
                Expired: 0,
                'Missed chats': 0,
            };
        }

        dailyStats[today].Opened += currentDayData.casesOpened;
        dailyStats[today].Solved += currentDayData.casesSolved;
        dailyStats[today]['Solved by operator'] += currentDayData.casesSolvedByOperator;
        dailyStats[today]['Solved by bot'] += currentDayData.casesSolvedByBot;

        return Object.values(dailyStats);
    }

    // Utility method to backfill hourly analytics for existing data
    async backfillHourlyAnalytics(days: number = 7): Promise<void> {
        this.logger.log(`Starting backfill of hourly analytics for last ${days} days`);

        const startDate = subDays(new Date(), days);
        const endDate = new Date();

        // Generate all hours between start and end
        let currentHour = startOfHour(startDate);

        while (currentHour < endDate) {
            await this.calculateAnalyticsForHour(currentHour);
            currentHour = addHours(currentHour, 1);
        }

        await this.updateOverallAnalytics();
        this.logger.log('Hourly analytics backfill completed');
    }
    async calculateAnalyticsForDate(date: Date): Promise<void> {
        const startDate = startOfDay(date);
        const endDate = endOfDay(date);

        this.logger.log(`Calculating analytics for ${format(date, 'yyyy-MM-dd')}`);

        try {
            // Get cases created on this date
            const casesCreated = await this.prisma.case.findMany({
                where: {
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
                include: {
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                    },
                    tags: true,
                },
            });

            // Get cases updated on this date (for solved status)
            const casesUpdated = await this.prisma.case.findMany({
                where: {
                    updatedAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                    status: Status.SOLVED,
                },
                include: {
                    messages: true,
                },
            });

            // Calculate metrics
            const casesOpened = casesCreated.length;
            const casesSolved = casesUpdated.length;
            const casesSolvedByBot = casesUpdated.filter(c => c.assignedTo === CaseHandler.BOT).length;
            const casesSolvedByOperator = casesUpdated.filter(c => c.assignedTo === CaseHandler.USER).length;

            // Calculate processing cases (cases that are currently in processing state)
            const casesProcessing = await this.prisma.case.count({
                where: {
                    status: Status.PROCESSING,
                    updatedAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
            });

            // Calculate pending cases
            const casesPending = await this.prisma.case.count({
                where: {
                    status: {
                        in: [Status.ASSIGNED, Status.BOT_HANDLING, Status.INITIATED],
                    },
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    },
                },
            });

            // Calculate expired cases
            const casesExpired = casesCreated.filter(c => {
                if (!c.timer) return false;
                const isExpired = new Date(c.timer).getTime() < Date.now();
                if (!isExpired) return false;

                const isActiveStatus = [
                    Status.ASSIGNED,
                    Status.BOT_HANDLING,
                    Status.INITIATED,
                    Status.PROCESSING,
                    Status.SOLVED,
                    Status.UNSOLVED
                ].includes(c.status);

                if (!isActiveStatus) return false;

                const lastMessage = c.messages[0];
                return !lastMessage || lastMessage.senderType !== SenderType.USER;
            }).length;

            // Calculate missed chats
            const missedChats = casesCreated.filter(c => {
                const customerMessages = c.messages?.filter(
                    msg => msg.senderType === SenderType.CUSTOMER &&
                        msg.type === 'TEXT' &&
                        !msg.replyType
                ).length || 0;
                return customerMessages > 10;
            }).length;

            // Calculate average duration for solved cases
            const solvedCasesWithDuration = casesUpdated.filter(c =>
                c.createdAt && c.updatedAt
            );

            let avgCaseDuration = 0;
            let totalCaseDuration = 0;

            if (solvedCasesWithDuration.length > 0) {
                const totalDurationMs = solvedCasesWithDuration.reduce((sum, c) =>
                    sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()), 0
                );
                totalCaseDuration = totalDurationMs / 1000 / 60; // Convert to minutes
                avgCaseDuration = totalCaseDuration / solvedCasesWithDuration.length;
            }

            // Upsert daily analytics
            await this.prisma.dailyAnalytics.upsert({
                where: { date: startDate },
                update: {
                    casesOpened,
                    casesPending,
                    casesSolved,
                    casesSolvedByOperator,
                    casesSolvedByBot,
                    casesExpired,
                    casesProcessing,
                    missedChats,
                    avgCaseDuration,
                    totalCaseDuration,
                    updatedAt: new Date(),
                },
                create: {
                    date: startDate,
                    casesOpened,
                    casesPending,
                    casesSolved,
                    casesSolvedByOperator,
                    casesSolvedByBot,
                    casesExpired,
                    casesProcessing,
                    missedChats,
                    avgCaseDuration,
                    totalCaseDuration,
                },
            });

            // Calculate tag analytics for this date
            await this.calculateTagAnalyticsForDate(date, casesCreated);

            this.logger.log(`Analytics calculated successfully for ${format(date, 'yyyy-MM-dd')}`);
        } catch (error) {
            this.logger.error(`Failed to calculate analytics for ${format(date, 'yyyy-MM-dd')}:`, error);
        }
    }
    private async calculateTagAnalyticsForDate(date: Date, cases: any[]): Promise<void> {
        const startDate = startOfDay(date);
        const tagCountMap: Record<string, number> = {};

        // Count tags for cases created on this date
        for (const caseItem of cases) {
            if (!caseItem.tags || !Array.isArray(caseItem.tags)) continue;

            for (const tag of caseItem.tags) {
                const tagText = tag.text?.trim();
                if (tagText) {
                    tagCountMap[tagText] = (tagCountMap[tagText] || 0) + 1;
                }
            }
        }

        // Delete existing tag analytics for this date
        await this.prisma.tagAnalytics.deleteMany({
            where: { date: startDate },
        });

        // Insert new tag analytics
        const tagAnalyticsData = Object.entries(tagCountMap).map(([tagText, count]) => ({
            date: startDate,
            tagText,
            count,
        }));

        if (tagAnalyticsData.length > 0) {
            await this.prisma.tagAnalytics.createMany({
                data: tagAnalyticsData,
            });
        }
    }

    async backfillAnalytics(days: number = 30): Promise<void> {
        this.logger.log(`Starting backfill of analytics for last ${days} days`);

        for (let i = days; i >= 1; i--) {
            const date = subDays(new Date(), i);
            await this.calculateAnalyticsForDate(date);
        }

        await this.updateOverallAnalytics();
        this.logger.log('Analytics backfill completed');
    }


    async getTotalChatsPerAgent(
        start?: Date,
        end?: Date,
        all = false
    ): Promise<AgentChatStat[]> {
        const useTimeWindow = !all && start && end;

        const rows = useTimeWindow
            ? await this.prisma.$queryRaw<
                { userId: number | null; agentName: string | null; totalChats: bigint; totalMessages: bigint }[]
            >(Prisma.sql`
        SELECT
          m."userId" AS "userId",
          (u."firstName" || ' ' || u."lastName") AS "agentName",
          COUNT(DISTINCT m."caseId") AS "totalChats",
          COUNT(*) AS "totalMessages"
        FROM "Message" m
        JOIN "User" u ON u."id" = m."userId"
        WHERE
          m."senderType" = 'USER'::"SenderType"
          AND m."userId" IS NOT NULL
          AND m."timestamp" >= ${start!}
          AND m."timestamp" <= ${end!}
        GROUP BY m."userId", u."firstName", u."lastName"
        ORDER BY COUNT(DISTINCT m."caseId") DESC, COUNT(*) DESC;
      `)
            : await this.prisma.$queryRaw<
                { userId: number | null; agentName: string | null; totalChats: bigint; totalMessages: bigint }[]
            >(Prisma.sql`
        SELECT
          m."userId" AS "userId",
          (u."firstName" || ' ' || u."lastName") AS "agentName",
          COUNT(DISTINCT m."caseId") AS "totalChats",
          COUNT(*) AS "totalMessages"
        FROM "Message" m
        JOIN "User" u ON u."id" = m."userId"
        WHERE
          m."senderType" = 'USER'::"SenderType"
          AND m."userId" IS NOT NULL
        GROUP BY m."userId", u."firstName", u."lastName"
        ORDER BY COUNT(DISTINCT m."caseId") DESC, COUNT(*) DESC;
      `);

        return rows.map(r => ({
            agentId: r.userId,
            agentName: r.agentName,
            totalChats: Number(r.totalChats ?? 0),
            totalMessages: Number(r.totalMessages ?? 0),
        }));
    }

    /** Convenience: today only */
    async getTotalChatsPerAgentToday(): Promise<AgentChatStat[]> {
        const start = startOfDay(new Date());
        const end = new Date();
        return this.getTotalChatsPerAgent(start, end);
    }

    /** Convenience: last N days (default 7) */
    async getTotalChatsPerAgentLastNDays(days = 7): Promise<AgentChatStat[]> {
        const start = subDays(new Date(), days);
        const end = new Date();
        return this.getTotalChatsPerAgent(start, end);
    }






}