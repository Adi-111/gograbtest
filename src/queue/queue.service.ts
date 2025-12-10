import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { PgBoss, Job, JobWithMetadata } from 'pg-boss';
import { PG_BOSS } from './pg-boss.provider';
import {
    QueueName,
    JobOptions,
    WhatsAppMessageJob,
    WhatsAppTextJob,
    WhatsAppButtonsJob,
    WhatsAppListJob,
    WhatsAppImageJob,
    BotMessageJob,
    SendTemplateJob,
    ProcessRefundJob,
    NotificationJob,
} from './queue.types';

@Injectable()
export class QueueService implements OnModuleDestroy {
    private readonly logger = new Logger(QueueService.name);

    constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) { }

    async onModuleDestroy() {
        this.logger.log('Stopping PgBoss...');
        await this.boss.stop({ graceful: true, timeout: 30000 });
        this.logger.log('PgBoss stopped');
    }

    // ─────────────────────────────────────────────────────────────
    // Generic job scheduling
    // ─────────────────────────────────────────────────────────────

    async addJob<T extends object>(
        queueName: QueueName | string,
        data: T,
        options?: JobOptions,
    ): Promise<string | null> {
        try {
            const jobId = await this.boss.send(queueName, data, {
                priority: options?.priority ?? 0,
                retryLimit: options?.retryLimit ?? 3,
                retryDelay: options?.retryDelay ?? 30,
                startAfter: options?.startAfter,
                expireInSeconds: options?.expireInSeconds ?? 60 * 60, // 1 hour default
                singletonKey: options?.singletonKey,
            });

            this.logger.log(`Job queued: ${queueName} [${jobId}]`);
            return jobId;
        } catch (error) {
            this.logger.error(`Failed to queue job ${queueName}:`, error);
            throw error;
        }
    }

    async addBulkJobs<T extends object>(
        queueName: QueueName | string,
        jobs: { data: T; options?: JobOptions }[],
    ): Promise<string[] | null> {
        const jobInserts = jobs.map((job) => ({
            data: job.data,
            priority: job.options?.priority ?? 0,
            retryLimit: job.options?.retryLimit ?? 3,
            startAfter: job.options?.startAfter,
        }));

        const jobIds = await this.boss.insert(queueName, jobInserts);
        this.logger.log(`Bulk queued ${jobIds?.length ?? 0} jobs to ${queueName}`);
        return jobIds;
    }

    // ─────────────────────────────────────────────────────────────
    // Job handlers (processors)
    // ─────────────────────────────────────────────────────────────

    async registerHandler<T extends object>(
        queueName: QueueName | string,
        handler: (jobs: Job<T>[]) => Promise<void>,
        options?: { batchSize?: number; pollingIntervalSeconds?: number },
    ): Promise<string> {
        return this.boss.work<T>(
            queueName,
            {
                batchSize: options?.batchSize ?? 1,
                pollingIntervalSeconds: options?.pollingIntervalSeconds ?? 2,
            },
            async (jobs) => {
                for (const job of jobs) {
                    this.logger.log(`Processing job: ${queueName} [${job.id}]`);
                    try {
                        await handler([job]);
                        this.logger.log(`Completed job: ${queueName} [${job.id}]`);
                    } catch (error) {
                        this.logger.error(`Failed job: ${queueName} [${job.id}]`, error);
                        throw error; // pg-boss will handle retry
                    }
                }
            },
        );
    }

    // ─────────────────────────────────────────────────────────────
    // Convenience methods for specific job types
    // ─────────────────────────────────────────────────────────────

    // ─────────────────────────────────────────────────────────────
    // WhatsApp message queuing methods
    // ─────────────────────────────────────────────────────────────

    async queueWhatsAppText(
        data: WhatsAppTextJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.WHATSAPP_TEXT, data, {
            ...options,
            singletonKey: `wa-text-${data.caseId}-${data.messageId}`,
        });
    }

    async queueWhatsAppButtons(
        data: WhatsAppButtonsJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.WHATSAPP_BUTTONS, data, {
            ...options,
            singletonKey: `wa-btn-${data.caseId}-${data.messageId}`,
        });
    }

    async queueWhatsAppList(
        data: WhatsAppListJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.WHATSAPP_LIST, data, {
            ...options,
            singletonKey: `wa-list-${data.caseId}-${data.messageId}`,
        });
    }

    async queueWhatsAppImage(
        data: WhatsAppImageJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.WHATSAPP_IMAGE, data, {
            ...options,
            singletonKey: data.messageId
                ? `wa-img-${data.caseId}-${data.messageId}`
                : undefined,
        });
    }

    async queueBotMessage(
        data: BotMessageJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.BOT_MESSAGE, data, {
            ...options,
            singletonKey: `bot-${data.caseId}-${data.nodeId}-${Date.now().toString().slice(0, -3)}`,
        });
    }

    // Legacy method - kept for backwards compatibility
    async queueWhatsAppMessage(
        data: WhatsAppMessageJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.WHATSAPP_TEXT, {
            phoneNo: data.phoneNo,
            text: data.message,
            caseId: data.caseId,
            messageId: 0, // Legacy doesn't have messageId
        }, {
            ...options,
            singletonKey: `wa-${data.phoneNo}-${Date.now().toString().slice(0, -4)}`,
        });
    }

    async queueTemplate(
        data: SendTemplateJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.SEND_TEMPLATE, data, options);
    }

    async queueRefund(
        data: ProcessRefundJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.PROCESS_REFUND, data, {
            ...options,
            priority: 10, // High priority for refunds
            singletonKey: `refund-${data.issueEventId}`, // Prevent duplicate refunds
        });
    }

    async queueNotification(
        data: NotificationJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.NOTIFICATION, data, options);
    }

    // ─────────────────────────────────────────────────────────────
    // Scheduled/Delayed jobs
    // ─────────────────────────────────────────────────────────────

    async scheduleJob<T extends object>(
        queueName: QueueName | string,
        data: T,
        runAt: Date,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(queueName, data, {
            ...options,
            startAfter: runAt,
        });
    }

    async scheduleRecurring<T extends object>(
        queueName: string,
        data: T,
        cronExpression: string,
        options?: { tz?: string },
    ): Promise<void> {
        await this.boss.schedule(queueName, cronExpression, data, {
            tz: options?.tz ?? 'Asia/Kolkata', // IST by default
        });
        this.logger.log(`Scheduled recurring job: ${queueName} [${cronExpression}]`);
    }

    // ─────────────────────────────────────────────────────────────
    // Job management
    // ─────────────────────────────────────────────────────────────

    async cancelJob(queueName: QueueName | string, jobId: string): Promise<boolean> {
        const result = await this.boss.cancel(queueName, jobId);
        this.logger.log(`Cancelled job: ${jobId}`);
        return true;
    }

    async getJob<T extends object>(
        queueName: QueueName | string,
        jobId: string,
    ): Promise<JobWithMetadata<T> | null> {
        return this.boss.getJobById<T>(queueName, jobId);
    }

    async getQueueStats(queueName: QueueName | string) {
        const stats = await this.boss.getQueueStats(queueName);
        return stats;
    }

    async deleteQueuedJobs(queueName: QueueName | string): Promise<void> {
        await this.boss.deleteQueuedJobs(queueName);
        this.logger.warn(`Deleted queued jobs from: ${queueName}`);
    }

    async deleteAllJobs(queueName?: string): Promise<void> {
        await this.boss.deleteAllJobs(queueName);
        this.logger.warn(`Deleted all jobs${queueName ? ` from ${queueName}` : ''}`);
    }

    // Get the raw pg-boss instance for advanced usage
    getBoss(): PgBoss {
        return this.boss;
    }
}
