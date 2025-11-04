import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as os from 'os';
import * as newrelic from 'newrelic';
import { PrismaService } from 'src/prisma/prisma.service';
import { CustomerService } from 'src/customer/customer.service';
import { ChatService } from 'src/chat/chat.service';

import { ProductDto } from 'src/customer/gg-backend/dto/products.dto';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30

// Convert between UTC <-> IST using fixed offset (IST has no DST)
const toIST = (d: Date) => new Date(d.getTime() + IST_OFFSET_MS);
const fromIST = (d: Date) => new Date(d.getTime() - IST_OFFSET_MS);

@Injectable()
export class CronService {
    private readonly logger = new Logger(CronService.name)
    constructor(
        private readonly prisma: PrismaService,
        private readonly cusService: CustomerService,
        private readonly chatService: ChatService

    ) { }

    @Cron(CronExpression.EVERY_WEEK)
    async handleProductCron() {
        const products: ProductDto[] = await this.cusService.getProducts();
        await this.handleProductsUpdate(products);
    }

    @Cron(CronExpression.EVERY_6_HOURS)
    async handleMachineCron() {
        await this.cusService.syncMachine()
    }






    @Cron(CronExpression.EVERY_HOUR) // runs 4x/day; window logic decides which "business day" to summarize
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




    @Cron(CronExpression.EVERY_MINUTE)
    handleCron() {
        this.logger.log(`new relic collection started at ${new Date()}`)
        this.recordSystemMetrics();
        this.logger.log(`new relic collection ended at ${new Date()}`)
    }



    getIST4amWindow() {
        const nowIST = toIST(new Date());



        this.logger.log(`checking for date : ${nowIST.getDate()}`);

        // Start at 04:00 IST
        const startIST = new Date(nowIST.setHours(0));
        startIST.setHours(4, 0, 0, 0);

        // End = next day 03:59:59.999 IST
        const endIST = new Date(startIST);
        endIST.setDate(endIST.getDate() + 1);
        endIST.setMilliseconds(endIST.getMilliseconds() - 1);

        // Convert to UTC but shift ahead by +9h 30m
        const offsetMs = 9.5 * 60 * 60 * 1000; // +9 hours 30 minutes
        const startUtc = new Date(fromIST(startIST).getTime() + offsetMs);
        const endUtc = new Date(fromIST(endIST).getTime() + offsetMs);

        const titleDateIST = new Date(startIST);
        titleDateIST.setDate(titleDateIST.getDate() + 1);

        return {
            startUtc,
            endUtc,
            dateKeyUtc: startUtc,
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
            category: product.category,
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
