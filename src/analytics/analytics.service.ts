import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Status, CaseHandler, SenderType } from '@prisma/client';
import { format, startOfDay, endOfDay, subDays } from 'date-fns';
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

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly prisma: PrismaService) { }

    // Run every day at midnight to calculate previous day's analytics
    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async calculateDailyAnalytics() {
        const yesterday = subDays(new Date(), 1);
        await this.calculateAnalyticsForDate(yesterday);
    }

    // Calculate analytics for a specific date
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

    // Update overall analytics (run this periodically or on-demand)
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

        // Calculate open cases
        const casesOpen = await this.prisma.case.count({
            where: {
                status: {
                    in: [Status.BOT_HANDLING, Status.INITIATED],
                },
            },
        });

        // Calculate expired cases
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

    // API Methods (these replace your existing methods)
    async getOverviewAnalytics(): Promise<OverviewAnalytics[]> {
        // Update overall analytics if needed
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
        const tagAnalytics = await this.prisma.tagAnalytics.groupBy({
            by: ['tagText'],
            _sum: {
                count: true,
            },
            orderBy: {
                _sum: {
                    count: 'desc',
                },
            },
        });

        return tagAnalytics.map(item => ({
            tag: item.tagText,
            count: item._sum.count || 0,
        }));
    }

    async getTicketDurationVsCountData(): Promise<{ date: string; duration: number; count: number; }[]> {
        const analytics = await this.prisma.dailyAnalytics.findMany({
            orderBy: { date: 'asc' },
            take: 30, // Last 30 days
        });

        return analytics.map(item => ({
            date: format(item.date, 'dd MMM'),
            duration: Math.round(item.avgCaseDuration || 0),
            count: item.casesSolved,
        }));
    }

    async getTicketStatusBarData(): Promise<{ status: string; count: number; }[]> {
        const analytics = await this.prisma.overallAnalytics.findFirst({
            where: { id: 1 },
        });

        if (!analytics) {
            return [];
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
        const analytics = await this.prisma.dailyAnalytics.findMany({
            orderBy: { date: 'asc' },
            take: 30, // Last 30 days
        });

        return analytics.map(item => ({
            date: format(item.date, 'dd MMM'),
            Opened: item.casesOpened,
            Pending: item.casesPending,
            Solved: item.casesSolved,
            'Solved by operator': item.casesSolvedByOperator,
            'Solved by bot': item.casesSolvedByBot,
            Expired: item.casesExpired,
            'Missed chats': item.missedChats,
        }));
    }

    // Utility method to backfill analytics for existing data
    async backfillAnalytics(days: number = 30): Promise<void> {
        this.logger.log(`Starting backfill of analytics for last ${days} days`);

        for (let i = days; i >= 1; i--) {
            const date = subDays(new Date(), i);
            await this.calculateAnalyticsForDate(date);
        }

        await this.updateOverallAnalytics();
        this.logger.log('Analytics backfill completed');
    }
}