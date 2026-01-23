import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as newrelic from 'newrelic';
import { PrismaService } from 'src/prisma/prisma.service';
import { CustomerService } from 'src/customer/customer.service';
import { ChatService } from 'src/chat/chat.service';

import { ProductDto } from 'src/customer/gg-backend/dto/products.dto';

// IST = UTC + 5:30 (no DST)
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

@Injectable()
export class CronService {
    private readonly logger = new Logger(CronService.name)
    constructor(
        private readonly prisma: PrismaService,
        private readonly cusService: CustomerService,
        @Inject(forwardRef(() => ChatService))
        private readonly chatService: ChatService,
    ) { }

    @Cron(CronExpression.EVERY_HOUR)
    async handleProductCron() {
        const products: ProductDto[] = await this.cusService.getProducts();
        await this.handleProductsUpdate(products);
    }

    @Cron(CronExpression.EVERY_2ND_HOUR)
    async handleMachineCron() {
        await this.cusService.syncMachine()
    }

    // @Cron(CronExpression.EVERY_10_SECONDS)
    @Cron(CronExpression.EVERY_5_MINUTES)
    async traceUnreadCases() {
        try {
            this.logger.log('🔍 Starting scheduled unread cases tracing...');

            // Call getChatList with UNREAD filter
            // The traceUnreadCases method inside getChatList will automatically send data to New Relic
            const result = await this.chatService.getChatList({
                status: 'UNREAD',
                page: 1,
                limit: 1, // We only need the count, not the actual cases
                userId: 0, // System cron job
            });

            this.logger.log(
                `✅ Unread cases traced: ${result.unreadCaseCount} cases with ${result.totalCount} total unread messages`
            );

            // Additional metric for cron job execution tracking
            newrelic.recordCustomEvent('UnreadCasesCronExecution', {
                unreadCaseCount: result.unreadCaseCount,
                totalCount: result.totalCount,
                executionTime: new Date().toISOString(),
                status: 'success',
            });

        } catch (error) {
            this.logger.error('❌ Failed to trace unread cases in cron job', error);

            // Record failure in New Relic
            newrelic.recordCustomEvent('UnreadCasesCronExecution', {
                executionTime: new Date().toISOString(),
                status: 'failed',
                error: error.message,
            });
        }
    }






    @Cron(CronExpression.EVERY_HOUR)
    async handleDailyUserSummaries() {

        const { startUtc, endUtc, dateKeyUtc, startIST, endIST } = this.getIST4amWindow();

        this.logger.log(
            `⏳ DailyUserMessageSummary window IST: ${startIST.toISOString()} → ${endIST.toISOString()} | UTC: ${startUtc.toISOString()} → ${endUtc.toISOString()}`
        );

        const users = [{ id: 3 }, { id: 6 }, { id: 8 }, { id: 1 }];

        for (const { id: userId } of users) {
            const messages = await this.prisma.message.findMany({
                where: {
                    userId,
                    timestamp: { gte: startUtc, lte: endUtc }, // 4AM IST → 4AM IST window (in UTC)
                },
                orderBy: { timestamp: 'asc' },
                select: { id: true, text: true, timestamp: true },
            });

            if (!messages.length) continue;

            const firstMessage = messages[0];
            const lastMessage = messages[messages.length - 1];

            const activeDuration =
                Math.round((lastMessage.timestamp.getTime() - firstMessage.timestamp.getTime()) / 60000);

            const dump = await this.prisma.dailyUserMessageSummary.upsert({
                where: { userId_date: { userId, date: dateKeyUtc } }, // unique on (userId, date)
                update: {
                    firstMessageId: firstMessage.id,
                    lastMessageId: lastMessage.id,
                    firstTimestamp: firstMessage.timestamp,
                    lastTimestamp: lastMessage.timestamp,
                    totalMessages: messages.length,
                    activeDuration,
                    firstText: firstMessage.text?.slice(0, 250) ?? null,
                    lastText: lastMessage.text?.slice(0, 250) ?? null,
                },
                create: {
                    userId,
                    date: dateKeyUtc, // the 4AM-IST anchor in UTC
                    firstMessageId: firstMessage.id,
                    lastMessageId: lastMessage.id,
                    firstTimestamp: firstMessage.timestamp,
                    lastTimestamp: lastMessage.timestamp,
                    totalMessages: messages.length,
                    activeDuration,
                    firstText: firstMessage.text?.slice(0, 250) ?? null,
                    lastText: lastMessage.text?.slice(0, 250) ?? null,
                },
            });

            this.logger.log(
                `✅ userId=${userId} summarized for business day starting (IST) ${startIST.toDateString()} | upsertId=${dump?.id ?? '—'}`
            );
        }

        this.logger.log(`✅ DailyUserMessageSummary complete for business day starting (IST) ${startIST.toDateString()}`);
    }


    /**
     * Daily cron job to track all fallback messages by type
     * Sends both current day and historical data to New Relic
     * Runs every hour and reports on the current business day (4AM IST → 4AM IST)
     */
    @Cron(CronExpression.EVERY_HOUR)
    async trackErrorMessages() {
        try {
            this.logger.log('🔍 Starting fallback message tracking (all types)...');

            const { startUtc, endUtc, startIST, endIST } = this.getIST4amWindow();

            this.logger.log(
                `⏳ Fallback tracking window IST: ${startIST.toISOString()} → ${endIST.toISOString()}`
            );

            // Define fallback message types
            const fallbackTypes = {
                manual_reply: 'Please use the buttons provided to respond. Typing your answer manually is not supported at this step.',
                unexpected_image: 'Images are not expected at this step. Please use the buttons provided to respond.',
                system_error: 'Sorry, we encountered a technical issue. Please try again or contact support if the problem persists.',
                default_error: 'Oops! Something went wrong.',
            };

            // Track metrics for each fallback type
            const fallbackMetrics: Record<string, any> = {};
            let totalCurrentDayFallbacks = 0;
            let totalHistoricalFallbacks = 0;
            let totalAllTimeFallbacks = 0;
            const allAffectedCases = new Set<number>();
            const allAffectedCustomers = new Set<string>();

            // Process each fallback type
            for (const [type, messageText] of Object.entries(fallbackTypes)) {
                // Get current day fallbacks
                const currentDayFallbacks = await this.prisma.message.findMany({
                    where: {
                        text: { contains: messageText, mode: 'insensitive' },
                        timestamp: { gte: startUtc, lte: endUtc },
                    },
                    select: {
                        id: true,
                        timestamp: true,
                        caseId: true,
                        recipient: true,
                        senderType: true,
                    },
                    orderBy: { timestamp: 'asc' },
                });

                // Get historical count
                const historicalCount = await this.prisma.message.count({
                    where: {
                        text: { contains: messageText, mode: 'insensitive' },
                        timestamp: { lt: startUtc },
                    },
                });

                // Get total count
                const totalCount = await this.prisma.message.count({
                    where: {
                        text: { contains: messageText, mode: 'insensitive' },
                    },
                });

                // Collect affected cases and customers
                currentDayFallbacks.forEach((msg) => {
                    if (msg.caseId) allAffectedCases.add(msg.caseId);
                    if (msg.recipient) allAffectedCustomers.add(msg.recipient);
                });

                // Group by hour
                const fallbacksByHour: Record<number, number> = {};
                currentDayFallbacks.forEach((msg) => {
                    const istTime = new Date(msg.timestamp.getTime() + IST_OFFSET_MS);
                    const hour = istTime.getUTCHours();
                    fallbacksByHour[hour] = (fallbacksByHour[hour] || 0) + 1;
                });

                // Store metrics
                fallbackMetrics[type] = {
                    currentDay: currentDayFallbacks.length,
                    historical: historicalCount,
                    total: totalCount,
                    byHour: fallbacksByHour,
                };

                // Update totals
                totalCurrentDayFallbacks += currentDayFallbacks.length;
                totalHistoricalFallbacks += historicalCount;
                totalAllTimeFallbacks += totalCount;

                // Send type-specific event to New Relic
                newrelic.recordCustomEvent('FallbackMessageByType', {
                    fallbackType: type,
                    currentDayCount: currentDayFallbacks.length,
                    historicalCount,
                    totalCount,
                    date: startIST.toISOString().split('T')[0],
                    windowStartIST: startIST.toISOString(),
                    windowEndIST: endIST.toISOString(),
                    timestamp: new Date().toISOString(),
                });

                // Send hourly distribution for this type
                if (currentDayFallbacks.length > 0) {
                    Object.entries(fallbacksByHour).forEach(([hour, count]) => {
                        newrelic.recordCustomEvent('FallbackMessageHourlyByType', {
                            fallbackType: type,
                            date: startIST.toISOString().split('T')[0],
                            hourIST: parseInt(hour),
                            count,
                            timestamp: new Date().toISOString(),
                        });
                    });
                }

                // Record metrics for dashboard
                newrelic.recordMetric(`Custom/FallbackMessages/${type}/CurrentDay`, currentDayFallbacks.length);
                newrelic.recordMetric(`Custom/FallbackMessages/${type}/Historical`, historicalCount);
                newrelic.recordMetric(`Custom/FallbackMessages/${type}/Total`, totalCount);
            }

            // Send comprehensive summary event
            newrelic.recordCustomEvent('DailyFallbackMessageSummary', {
                // Aggregate metrics
                totalCurrentDayFallbacks,
                totalHistoricalFallbacks,
                totalAllTimeFallbacks,

                // By type breakdown
                manualReplyCurrentDay: fallbackMetrics.manual_reply.currentDay,
                unexpectedImageCurrentDay: fallbackMetrics.unexpected_image.currentDay,
                systemErrorCurrentDay: fallbackMetrics.system_error.currentDay,
                defaultErrorCurrentDay: fallbackMetrics.default_error.currentDay,

                // Impact metrics
                uniqueCasesAffectedToday: allAffectedCases.size,
                uniqueCustomersAffectedToday: allAffectedCustomers.size,

                // Metadata
                currentDayDate: startIST.toISOString().split('T')[0],
                windowStartIST: startIST.toISOString(),
                windowEndIST: endIST.toISOString(),
                executionTime: new Date().toISOString(),
                status: 'success',
            });

            // Record aggregate metrics
            newrelic.recordMetric('Custom/FallbackMessages/Total/CurrentDay', totalCurrentDayFallbacks);
            newrelic.recordMetric('Custom/FallbackMessages/Total/Historical', totalHistoricalFallbacks);
            newrelic.recordMetric('Custom/FallbackMessages/Total/AllTime', totalAllTimeFallbacks);
            newrelic.recordMetric('Custom/FallbackMessages/CasesAffectedToday', allAffectedCases.size);
            newrelic.recordMetric('Custom/FallbackMessages/CustomersAffectedToday', allAffectedCustomers.size);

            this.logger.log(
                `✅ Fallback message tracking complete:
                - Total current day: ${totalCurrentDayFallbacks} fallbacks
                  • Manual reply: ${fallbackMetrics.manual_reply.currentDay}
                  • Unexpected image: ${fallbackMetrics.unexpected_image.currentDay}
                  • System error: ${fallbackMetrics.system_error.currentDay}
                  • Default error: ${fallbackMetrics.default_error.currentDay}
                - Total historical: ${totalHistoricalFallbacks} fallbacks
                - Total all-time: ${totalAllTimeFallbacks} fallbacks
                - Cases affected today: ${allAffectedCases.size}
                - Customers affected today: ${allAffectedCustomers.size}`
            );

            // Log warning if total fallback count is unusually high
            if (totalCurrentDayFallbacks > 50) {
                this.logger.warn(
                    `⚠️ High fallback message count detected today: ${totalCurrentDayFallbacks} fallbacks`
                );

                newrelic.recordCustomEvent('HighFallbackMessageAlert', {
                    date: startIST.toISOString().split('T')[0],
                    totalFallbackCount: totalCurrentDayFallbacks,
                    manualReply: fallbackMetrics.manual_reply.currentDay,
                    unexpectedImage: fallbackMetrics.unexpected_image.currentDay,
                    systemError: fallbackMetrics.system_error.currentDay,
                    defaultError: fallbackMetrics.default_error.currentDay,
                    threshold: 50,
                    timestamp: new Date().toISOString(),
                });
            }

            // Log specific warnings for concerning patterns
            if (fallbackMetrics.system_error.currentDay > 10) {
                this.logger.warn(
                    `⚠️ High system error count: ${fallbackMetrics.system_error.currentDay} - investigate technical issues`
                );
            }

            if (fallbackMetrics.manual_reply.currentDay > 20) {
                this.logger.warn(
                    `⚠️ High manual reply fallback count: ${fallbackMetrics.manual_reply.currentDay} - users may not understand button interface`
                );
            }

        } catch (error) {
            this.logger.error('❌ Failed to track fallback messages', error);

            // Record failure in New Relic
            newrelic.recordCustomEvent('DailyFallbackMessageSummary', {
                executionTime: new Date().toISOString(),
                status: 'failed',
                error: error.message,
            });
        }
    }




    @Cron(CronExpression.EVERY_MINUTE)
    handleCron() {
        this.logger.log(`new relic collection started at ${new Date()}`)
        this.recordSystemMetrics();
        this.logger.log(`new relic collection ended at ${new Date()}`)
    }



    /**
     * Returns the 4AM IST → 4AM IST (next day) business day window.
     * Uses UTC methods throughout to work consistently on ANY server timezone.
     * 
     * Business day: 4:00 AM IST → 3:59:59.999 AM IST (next day)
     * Since IST = UTC + 5:30:
     *   - 4:00 AM IST = 22:30 UTC (previous calendar day)
     *   - 3:59:59.999 AM IST = 22:29:59.999 UTC
     */
    getIST4amWindow() {
        // Get current UTC time (works identically on any server)
        const nowUtc = new Date();
        // For testing: 
        // const nowUtc = new Date('2025-12-09');

        // Convert UTC to IST by adding offset
        // We use UTC methods to read these values, treating the result as "IST representation"
        const nowIst = new Date(nowUtc.getTime() + IST_OFFSET_MS);

        // Determine business day date in IST (midnight IST)
        const businessDayIst = new Date(Date.UTC(
            nowIst.getUTCFullYear(),
            nowIst.getUTCMonth(),
            nowIst.getUTCDate(),
            0, 0, 0, 0
        ));

        // If before 4AM IST, we're still in previous day's business day
        if (nowIst.getUTCHours() < 4) {
            businessDayIst.setUTCDate(businessDayIst.getUTCDate() - 1);
        }

        this.logger.log(`Business day (IST): ${businessDayIst.toISOString().split('T')[0]}`);

        // Start: 4:00 AM IST on business day (stored as UTC-shifted representation)
        const startIST = new Date(businessDayIst);
        startIST.setUTCHours(4, 0, 0, 0);

        // End: 3:59:59.999 AM IST next day
        const endIST = new Date(startIST);
        endIST.setUTCDate(endIST.getUTCDate() + 1);
        endIST.setUTCMilliseconds(endIST.getUTCMilliseconds() - 1);

        // Convert IST representation back to actual UTC for database queries
        const startUtc = new Date(startIST.getTime() - IST_OFFSET_MS);
        const endUtc = new Date(endIST.getTime() - IST_OFFSET_MS);

        // Title date (next calendar day in IST)
        const titleDateIST = new Date(startIST);
        titleDateIST.setUTCDate(titleDateIST.getUTCDate() + 1);

        return {
            startUtc,
            endUtc,
            dateKeyUtc: startIST,
            startIST,
            endIST,
            titleDateIST
        };
    }




    // @Cron(CronExpression.EVERY_10_MINUTES) // Runs every 10 min.
    // async handleUnrepliedCases() {
    //     this.logger.log('Checking for cases that need to be marked as solved due to no reply.');

    //     // Get cases where lastBotNodeId is 'las' and customer hasn't replied in the last hour
    //     const casesToSolve = await this.prisma.case.findMany({
    //         where: {
    //             lastBotNodeId: 'las',
    //             status: { not: 'SOLVED' }, // Exclude already solved cases
    //             updatedAt: {
    //                 lt: new Date(Date.now() - 3600000), // 1 hour ago
    //             }
    //         },
    //         include: {
    //             messages: {
    //                 orderBy: {
    //                     timestamp: "desc",
    //                 },
    //                 take: 1
    //             },
    //         },
    //     });



    //     for (const chat of casesToSolve) {
    //         const lastMessage = chat.messages[chat.messages.length - 1];

    //         const istOffset = 5.5 * 60 * 60 * 1000;
    //         const istDate = new Date(lastMessage.timestamp.getTime() + istOffset);
    //         this.logger.log(`last message was sent at ${istDate}`)

    //         // Check if the last message with 'las' was sent and no customer reply
    //         const noCustomerReply = !chat.messages.some(
    //             (msg) => msg.senderType === 'CUSTOMER'
    //         );

    //         if (lastMessage && lastMessage.senderType === 'BOT' && noCustomerReply) {
    //             // Mark the case as 'SOLVED' if no reply was received within 1 hour
    //             await this.chatService.triggerStatusUpdate(chat.id, Status.SOLVED, 5);

    //             this.logger.log(`Case ${chat.id} marked as SOLVED due to no reply.`);
    //         }
    //     }
    // }
    /**
    * Records detailed system and process metrics to New Relic using a custom event.
    */

    recordSystemMetrics() {

        // Safely use internal method with `as any`
        let activeHandles = 0;
        let activeRequests = 0
        try {
            activeHandles = Object.keys((process as any)._getActiveHandles()).length;
            activeRequests = Object.keys((process as any)._getActiveRequests()).length;
        } catch (error) {
            console.warn('Could not retrieve active handles:', error);
        }
        const memoryUsage = process.memoryUsage();         // RSS, heapUsed, etc.
        const cpuLoad = os.loadavg();                      // 1, 5, 15 min CPU load
        const resourceUsage = process.resourceUsage();     // User/system CPU time, I/O, etc.
        const cpuUsage = process.cpuUsage();               // User/system microseconds

        newrelic.recordCustomEvent('SystemMetrics', {
            // Memory
            memoryRss: memoryUsage.rss,                         // Resident Set Size
            memoryHeapUsed: memoryUsage.heapUsed,
            memoryHeapTotal: memoryUsage.heapTotal,
            memoryExternal: memoryUsage.external,
            memoryArrayBuffers: memoryUsage.arrayBuffers,

            // CPU Load
            cpuLoad1Min: cpuLoad[0],
            cpuLoad5Min: cpuLoad[1],
            cpuLoad15Min: cpuLoad[2],

            // CPU Usage (process-level)
            cpuUserMicros: cpuUsage.user,
            cpuSystemMicros: cpuUsage.system,

            // System
            totalMemory: os.totalmem(),
            freeMemory: os.freemem(),
            uptimeSeconds: os.uptime(),
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),

            // Handles & Requests
            activeHandles,
            activeRequests,

            // Resource Usage
            ruUserCPU: resourceUsage.userCPUTime,
            ruSystemCPU: resourceUsage.systemCPUTime,
            ruVolCtxSwitches: resourceUsage.voluntaryContextSwitches,
            ruInvolCtxSwitches: resourceUsage.involuntaryContextSwitches,
            ruFSRead: resourceUsage.fsRead,
            ruFSWrite: resourceUsage.fsWrite,

            timestamp: new Date().toISOString()
        });
    };


    async handleProductsUpdate(products: ProductDto[]) {
        const transformedProducts = products.map((product) => ({
            product_id: product.product_id,
            product_name: product.product_name,
            description: product.description,
            image: String(product.image),
            category: product.category || 'Uncategorized',
            product_price: Number(product.product_price),
            brand_name: product.brand_name,
            created_at: new Date(product.created_at),
            hsn_code: product.hsn_code,
            bar_code: product.bar_code,
            is_active: Boolean(product.is_active),
            moq: Number(product.moq),
            zoho_item_id: String(product.zoho_item_id),
            purchase_rate: Number(product.purchase_rate),
            inter_state_tax_rate: Number(product.inter_state_tax_rate),
            intra_state_tax_rate: Number(product.intra_state_tax_rate),
            product_type: product.product_type,
            markdown_percentage: Number(product.markdown_percentage),
        }));

        try {
            await this.prisma.product.createMany({
                data: transformedProducts,
                skipDuplicates: true, // in case product_id already exists
            });
            this.logger.log('✅ Products uploaded successfully.');
        } catch (error) {
            this.logger.error('❌ Failed to upload products:', error);
        }
    }


}
