import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Status, CaseHandler, SenderType } from '@prisma/client';
import {
    format,
    startOfDay,
    endOfDay,
    subDays,
    startOfHour,
    endOfHour,
    addHours,
    eachHourOfInterval,
    eachDayOfInterval,
} from 'date-fns';
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

    // ─────────────────────────────────────────────────────────────────────────────
    // CRONS
    // ─────────────────────────────────────────────────────────────────────────────

    @Cron(CronExpression.EVERY_HOUR)
    async calculateHourlyAnalytics() {
        const lastHour = addHours(new Date(), -1);
        await this.calculateAnalyticsForHour(lastHour);
    }

    @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
    async cleanupOldHourlyData() {
        const cutoffDate = subDays(new Date(), 7);

        await this.prisma.$transaction([
            this.prisma.hourlyAnalytics.deleteMany({
                where: { datetime: { lt: cutoffDate } },
            }),
            this.prisma.tagAnalytics.deleteMany({
                where: { date: { lt: cutoffDate } },
            }),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // HOURLY
    // ─────────────────────────────────────────────────────────────────────────────

    async calculateAnalyticsForHour(date: Date): Promise<void> {
        const startHour = startOfHour(date);
        const endHour = endOfHour(date);

        this.logger.log(`Calculating hourly analytics for ${format(date, 'yyyy-MM-dd HH:00')}`);

        try {
            const casesCreated = await this.prisma.case.findMany({
                where: { createdAt: { gte: startHour, lte: endHour } },
                select: {
                    id: true,
                    status: true,
                    timer: true,
                    assignedTo: true,
                    createdAt: true,
                    updatedAt: true,
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                        select: { id: true, senderType: true, type: true, replyType: true },
                    },
                    tags: { select: { text: true } },
                },
            });

            const casesUpdated = await this.prisma.case.findMany({
                where: {
                    updatedAt: { gte: startHour, lte: endHour },
                    status: Status.SOLVED,
                },
                select: {
                    id: true,
                    createdAt: true,
                    updatedAt: true,
                    assignedTo: true,
                    messages: { select: { id: true } }, // avoid heavy payloads
                },
            });

            const casesOpened = casesCreated.length;
            const casesSolved = casesUpdated.length;
            const casesSolvedByBot = casesUpdated.filter(c => c.assignedTo === CaseHandler.BOT).length;
            const casesSolvedByOperator = casesUpdated.filter(c => c.assignedTo === CaseHandler.USER).length;

            const casesProcessing = await this.prisma.case.count({
                where: {
                    status: Status.PROCESSING,
                    updatedAt: { gte: startHour, lte: endHour },
                },
            });

            // Pending = alive but not yet actively processing/solved; use status at the hour window (by creation time is misleading)
            const casesPending = await this.prisma.case.count({
                where: {
                    status: { in: [Status.ASSIGNED, Status.BOT_HANDLING, Status.INITIATED] },
                    updatedAt: { gte: startHour, lte: endHour },
                },
            });

            const casesExpired = casesCreated.filter(c => {
                if (!c.timer) return false;
                if (new Date(c.timer).getTime() >= Date.now()) return false;
                const activeStatuses = [
                    Status.ASSIGNED,
                    Status.BOT_HANDLING,
                    Status.INITIATED,
                    Status.PROCESSING,
                    Status.UNSOLVED,
                    Status.SOLVED,
                ];
                if (!activeStatuses.includes(c.status)) return false;
                const lastMessage = c.messages?.[0];
                return !lastMessage || lastMessage.senderType !== SenderType.USER;
            }).length;

            const MISSED_CHAT_CUSTOMER_MSG_THRESHOLD = 10; // lift to config if needed
            const missedChats = casesCreated.filter(c => {
                const customerMsgs =
                    c.messages?.filter(
                        (m: any) =>
                            m.senderType === SenderType.CUSTOMER &&
                            m.type === 'TEXT' &&
                            !m.replyType
                    ).length || 0;
                return customerMsgs > MISSED_CHAT_CUSTOMER_MSG_THRESHOLD;
            }).length;

            // Durations (mins)
            const solvedWithTimestamps = casesUpdated.filter(c => c.createdAt && c.updatedAt);
            let avgCaseDuration = 0;
            let totalCaseDuration = 0;
            if (solvedWithTimestamps.length > 0) {
                const totalMs = solvedWithTimestamps.reduce(
                    (sum, c) => sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()),
                    0
                );
                totalCaseDuration = totalMs / 1000 / 60;
                avgCaseDuration = totalCaseDuration / solvedWithTimestamps.length;
            }

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

            await this.calculateTagAnalyticsForHour(startHour, casesCreated);

            this.logger.log(`Hourly analytics calculated for ${format(date, 'yyyy-MM-dd HH:00')}`);
        } catch (error) {
            this.logger.error(
                `Failed hourly analytics for ${format(date, 'yyyy-MM-dd HH:00')}: ${String(error?.message || error)}`,
                error?.stack
            );
        }
    }

    private async calculateTagAnalyticsForHour(datetime: Date, cases: any[]): Promise<void> {
        const tagCountMap: Record<string, number> = {};

        for (const c of cases) {
            const tags = Array.isArray(c.tags) ? c.tags : [];
            for (const t of tags) {
                const txt = t?.text?.trim();
                if (txt) tagCountMap[txt] = (tagCountMap[txt] || 0) + 1;
            }
        }

        await this.prisma.tagAnalytics.deleteMany({ where: { date: datetime } });

        const rows = Object.entries(tagCountMap).map(([tagText, count]) => ({
            date: datetime,
            tagText,
            count,
        }));
        if (rows.length) {
            await this.prisma.tagAnalytics.createMany({ data: rows });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REAL-TIME (CURRENT DAY)
    // ─────────────────────────────────────────────────────────────────────────────

    private async getCurrentDayRealTimeData(): Promise<any> {
        const now = new Date();
        const currentHourStart = startOfHour(now);

        const currentHourCases = await this.prisma.case.findMany({
            where: { createdAt: { gte: currentHourStart, lte: now } },
            select: {
                id: true,
                tags: { select: { text: true } },
                messages: {
                    orderBy: { timestamp: 'desc' },
                    take: 1,
                    select: { id: true, senderType: true, type: true, replyType: true },
                },
            },
        });

        const currentHourSolved = await this.prisma.case.findMany({
            where: { updatedAt: { gte: currentHourStart, lte: now }, status: Status.SOLVED },
            select: { id: true, assignedTo: true },
        });

        return {
            casesOpened: currentHourCases.length,
            casesSolved: currentHourSolved.length,
            casesSolvedByBot: currentHourSolved.filter(c => c.assignedTo === CaseHandler.BOT).length,
            casesSolvedByOperator: currentHourSolved.filter(c => c.assignedTo === CaseHandler.USER).length,
            tags: currentHourCases.flatMap(c => c.tags || []),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // OVERALL
    // ─────────────────────────────────────────────────────────────────────────────

    async updateOverallAnalytics(): Promise<void> {
        const [
            totalCases,
            casesProcessing,
            casesSolved,
            casesSolvedByBot,
            casesSolvedByOperator,
            casesOpen,
            expiredCandidates,
        ] = await this.prisma.$transaction([
            this.prisma.case.count(),
            this.prisma.case.count({ where: { status: Status.PROCESSING } }),
            this.prisma.case.count({ where: { status: Status.SOLVED } }),
            this.prisma.case.count({ where: { status: Status.SOLVED, assignedTo: CaseHandler.BOT } }),
            this.prisma.case.count({ where: { status: Status.SOLVED, assignedTo: CaseHandler.USER } }),
            this.prisma.case.count({
                where: { status: { in: [Status.BOT_HANDLING, Status.INITIATED] } },
            }),
            this.prisma.case.findMany({
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
                select: {
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                        select: { id: true, senderType: true },
                    },
                },
            }),
        ]);

        const casesExpired = expiredCandidates.filter(c => {
            const last = c.messages?.[0];
            return !last || last.senderType !== SenderType.USER;
        }).length;

        await this.prisma.overallAnalytics.upsert({
            where: { id: 1 },
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

    // ─────────────────────────────────────────────────────────────────────────────
    // READ MODELS / CHART FEEDS
    // ─────────────────────────────────────────────────────────────────────────────

    async getOverviewAnalytics(): Promise<OverviewAnalytics[]> {
        await this.updateOverallAnalytics();
        const analytics = await this.prisma.overallAnalytics.findFirst({ where: { id: 1 } });
        if (!analytics) return [];

        return [
            { text: 'PROCESSING', count: analytics.casesProcessing },
            { text: Status.SOLVED, count: analytics.casesSolved },
            { text: 'SOLVED BY BOT', count: analytics.casesSolvedByBot },
            { text: 'SOLVED BY OPERATOR', count: analytics.casesSolvedByOperator },
            { text: 'Expired', count: analytics.casesExpired },
            { text: 'Open', count: analytics.casesOpen },
        ];
    }

    async getTagCountBarData(): Promise<{ tag: string; count: number }[]> {
        const sevenDaysAgo = subDays(new Date(), 7);

        const historical = await this.prisma.$queryRaw<
            { tagText: string; count: number }[]
        >`
      SELECT "tagText", CAST(SUM("count") AS INTEGER) as count
      FROM "TagAnalytics"
      WHERE "date" >= ${sevenDaysAgo}
      GROUP BY "tagText"
    `;

        const current = await this.getCurrentDayRealTimeData();
        const currentCounts: Record<string, number> = {};
        for (const t of current.tags) {
            const txt = t?.text?.trim();
            if (txt) currentCounts[txt] = (currentCounts[txt] || 0) + 1;
        }

        const combined: Record<string, number> = {};
        for (const h of historical) combined[h.tagText] = (combined[h.tagText] || 0) + h.count;
        for (const [txt, n] of Object.entries(currentCounts)) combined[txt] = (combined[txt] || 0) + n;

        return Object.entries(combined)
            .map(([tag, count]) => ({ tag, count }))
            .sort((a, b) => b.count - a.count);
    }

    async getTicketDurationVsCountData(): Promise<{ date: string; duration: number; count: number }[]> {
        const sevenDaysAgo = subDays(new Date(), 7);

        const hourly = await this.prisma.hourlyAnalytics.findMany({
            where: { datetime: { gte: sevenDaysAgo } },
            orderBy: { datetime: 'asc' },
        });

        const daily: Record<string, { totalDuration: number; totalCases: number; count: number }> = {};

        for (const h of hourly) {
            const key = format(h.datetime, 'dd MMM');
            daily[key] ??= { totalDuration: 0, totalCases: 0, count: 0 };
            daily[key].totalDuration += h.totalCaseDuration || 0;
            daily[key].totalCases += h.casesSolved;
            daily[key].count += h.casesSolved;
        }

        const today = format(new Date(), 'dd MMM');
        const rt = await this.getCurrentDayRealTimeData();
        daily[today] ??= { totalDuration: 0, totalCases: 0, count: 0 };
        daily[today].count += rt.casesSolved;

        return Object.entries(daily).map(([date, d]) => ({
            date,
            duration: d.totalCases > 0 ? Math.round(d.totalDuration / d.totalCases) : 0,
            count: d.count,
        }));
    }

    async getTicketStatusBarData(): Promise<{ status: string; count: number }[]> {
        let analytics = await this.prisma.overallAnalytics.findFirst({ where: { id: 1 } });
        if (!analytics) {
            await this.updateOverallAnalytics();
            analytics = await this.prisma.overallAnalytics.findFirst({ where: { id: 1 } });
        }
        // NOTE: 'Initiated' should NOT be totalCases — that’s misleading.
        const initiated = await this.prisma.case.count({ where: { status: Status.INITIATED } });

        return [
            { status: 'Initiated', count: initiated },
            { status: 'Processing', count: analytics!.casesProcessing },
            { status: 'Solved', count: analytics!.casesSolved },
            { status: 'Solved by operator', count: analytics!.casesSolvedByOperator },
            { status: 'Solved by bot', count: analytics!.casesSolvedByBot },
            { status: 'Expired', count: analytics!.casesExpired },
        ];
    }

    async getTicketStatusOverTimeData(): Promise<DailyTicketStats[]> {
        const since = subDays(new Date(), 30);

        const hourly = await this.prisma.hourlyAnalytics.findMany({
            where: { datetime: { gte: since } },
            orderBy: { datetime: 'asc' },
        });

        const daily: Record<string, DailyTicketStats> = {};
        for (const h of hourly) {
            const key = format(h.datetime, 'dd MMM');
            daily[key] ??= {
                date: key,
                Opened: 0,
                Pending: 0,
                Solved: 0,
                'Solved by operator': 0,
                'Solved by bot': 0,
                Expired: 0,
                'Missed chats': 0,
            };
            daily[key].Opened += h.casesOpened;
            daily[key].Pending += h.casesPending;
            daily[key].Solved += h.casesSolved;
            daily[key]['Solved by operator'] += h.casesSolvedByOperator;
            daily[key]['Solved by bot'] += h.casesSolvedByBot;
            daily[key].Expired += h.casesExpired;
            daily[key]['Missed chats'] += h.missedChats;
        }

        const todayKey = format(new Date(), 'dd MMM');
        const rt = await this.getCurrentDayRealTimeData();
        daily[todayKey] ??= {
            date: todayKey,
            Opened: 0,
            Pending: 0,
            Solved: 0,
            'Solved by operator': 0,
            'Solved by bot': 0,
            Expired: 0,
            'Missed chats': 0,
        };
        daily[todayKey].Opened += rt.casesOpened;
        daily[todayKey].Solved += rt.casesSolved;
        daily[todayKey]['Solved by operator'] += rt.casesSolvedByOperator;
        daily[todayKey]['Solved by bot'] += rt.casesSolvedByBot;

        return Object.values(daily);
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // DAILY (existing functions remain)
    // ─────────────────────────────────────────────────────────────────────────────

    async calculateAnalyticsForDate(date: Date): Promise<void> {
        const startDate = startOfDay(date);
        const endDate = endOfDay(date);

        this.logger.log(`Calculating analytics for ${format(date, 'yyyy-MM-dd')}`);

        try {
            const casesCreated = await this.prisma.case.findMany({
                where: { createdAt: { gte: startDate, lte: endDate } },
                select: {
                    id: true,
                    status: true,
                    timer: true,
                    assignedTo: true,
                    createdAt: true,
                    updatedAt: true,
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 1,
                        select: { id: true, senderType: true, type: true, replyType: true },
                    },
                    tags: { select: { text: true } },
                },
            });

            const casesUpdated = await this.prisma.case.findMany({
                where: { updatedAt: { gte: startDate, lte: endDate }, status: Status.SOLVED },
                select: { id: true, createdAt: true, updatedAt: true, assignedTo: true },
            });

            const casesOpened = casesCreated.length;
            const casesSolved = casesUpdated.length;
            const casesSolvedByBot = casesUpdated.filter(c => c.assignedTo === CaseHandler.BOT).length;
            const casesSolvedByOperator = casesUpdated.filter(c => c.assignedTo === CaseHandler.USER).length;

            // Processing measured by updates within day (consistent with hourly)
            const casesProcessing = await this.prisma.case.count({
                where: { status: Status.PROCESSING, updatedAt: { gte: startDate, lte: endDate } },
            });

            // Pending measured by updates within day (consistent with hourly)
            const casesPending = await this.prisma.case.count({
                where: {
                    status: { in: [Status.ASSIGNED, Status.BOT_HANDLING, Status.INITIATED] },
                    updatedAt: { gte: startDate, lte: endDate },
                },
            });

            const casesExpired = casesCreated.filter(c => {
                if (!c.timer) return false;
                if (new Date(c.timer).getTime() >= Date.now()) return false;
                const active = [
                    Status.ASSIGNED,
                    Status.BOT_HANDLING,
                    Status.INITIATED,
                    Status.PROCESSING,
                    Status.SOLVED,
                    Status.UNSOLVED,
                ];
                if (!active.includes(c.status)) return false;
                const last = c.messages?.[0];
                return !last || last.senderType !== SenderType.USER;
            }).length;

            const MISSED_CHAT_CUSTOMER_MSG_THRESHOLD = 10;
            const missedChats = casesCreated.filter(c => {
                const customerMessages =
                    c.messages?.filter(
                        (m: any) =>
                            m.senderType === SenderType.CUSTOMER &&
                            m.type === 'TEXT' &&
                            !m.replyType
                    ).length || 0;
                return customerMessages > MISSED_CHAT_CUSTOMER_MSG_THRESHOLD;
            }).length;

            const solvedWithTimestamps = casesUpdated.filter(c => c.createdAt && c.updatedAt);
            let avgCaseDuration = 0;
            let totalCaseDuration = 0;
            if (solvedWithTimestamps.length > 0) {
                const totalMs = solvedWithTimestamps.reduce(
                    (sum, c) => sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()),
                    0
                );
                totalCaseDuration = totalMs / 1000 / 60;
                avgCaseDuration = totalCaseDuration / solvedWithTimestamps.length;
            }

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

            await this.calculateTagAnalyticsForDate(date, casesCreated);

            this.logger.log(`Analytics calculated for ${format(date, 'yyyy-MM-dd')}`);
        } catch (error) {
            this.logger.error(
                `Failed daily analytics for ${format(date, 'yyyy-MM-dd')}: ${String(error?.message || error)}`,
                error?.stack
            );
        }
    }

    private async calculateTagAnalyticsForDate(date: Date, cases: any[]): Promise<void> {
        const startDate = startOfDay(date);
        const tagCountMap: Record<string, number> = {};

        for (const c of cases) {
            const tags = Array.isArray(c.tags) ? c.tags : [];
            for (const t of tags) {
                const txt = t?.text?.trim();
                if (txt) tagCountMap[txt] = (tagCountMap[txt] || 0) + 1;
            }
        }

        await this.prisma.tagAnalytics.deleteMany({ where: { date: startDate } });

        const rows = Object.entries(tagCountMap).map(([tagText, count]) => ({
            date: startDate,
            tagText,
            count,
        }));
        if (rows.length) {
            await this.prisma.tagAnalytics.createMany({ data: rows });
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

    // ─────────────────────────────────────────────────────────────────────────────
    // NEW: One true backfill that does everything in the right order
    // ─────────────────────────────────────────────────────────────────────────────

    /**
     * Backfill *all* analytics layers deterministically and idempotently.
     * 1) Hourly analytics for every hour in range
     * 2) Daily analytics for every date in range
     * 3) Overall analytics (single row)
     *
     * @param days how many days back (default 30)
     * @param includeHourly whether to recompute hourly layer
     * @param includeDaily whether to recompute daily layer
     * @param includeOverall whether to recompute overall row
     */
    async backfillAllAnalytics(options?: {
        days?: number;
        includeHourly?: boolean;
        includeDaily?: boolean;
        includeOverall?: boolean;
        // Future: concurrency?: number
    }): Promise<void> {
        const {
            days = 30,
            includeHourly = true,
            includeDaily = true,
            includeOverall = true,
        } = options || {};

        this.logger.log(
            `BackfillAll start → days=${days}, hourly=${includeHourly}, daily=${includeDaily}, overall=${includeOverall}`
        );

        const startDt = startOfDay(subDays(new Date(), days));
        const endDt = new Date();

        try {
            if (includeHourly) {
                const hours = eachHourOfInterval({ start: startDt, end: endDt });
                for (const h of hours) {
                    await this.calculateAnalyticsForHour(h);
                }
            }

            if (includeDaily) {
                const daysList = eachDayOfInterval({ start: startDt, end: endDt });
                for (const d of daysList) {
                    await this.calculateAnalyticsForDate(d);
                }
            }

            if (includeOverall) {
                await this.updateOverallAnalytics();
            }

            this.logger.log('BackfillAll completed successfully');
        } catch (err) {
            this.logger.error(`BackfillAll failed: ${String(err?.message || err)}`, err?.stack);
            throw err;
        }
    }
}
