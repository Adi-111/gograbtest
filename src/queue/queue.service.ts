import { Injectable, Inject, Logger, OnModuleDestroy } from '@nestjs/common';
import { PgBoss, Job, JobWithMetadata } from 'pg-boss';
import * as newrelic from 'newrelic';
import { PG_BOSS, DEAD_LETTER_QUEUE } from './pg-boss.provider';
import {
    QueueName,
    JobOptions,
    WhatsAppMessageJob,
    WhatsAppTextJob,
    WhatsAppButtonsJob,
    WhatsAppListJob,
    WhatsAppImageJob,
    WhatsAppDocumentJob,
    BotMessageJob,
    SendTemplateJob,
    ProcessRefundJob,
    NotificationJob,
    IncomingMessageJob,
} from './queue.types';

// WhatsApp API rate limit: ~80 messages/second, we'll be conservative
const WHATSAPP_RATE_LIMIT_PER_SECOND = 50;
const RATE_LIMIT_WINDOW_MS = 1000;

// Error classification for retry decisions
export enum ErrorType {
    RETRYABLE = 'RETRYABLE',
    NON_RETRYABLE = 'NON_RETRYABLE',
    RATE_LIMITED = 'RATE_LIMITED',
}

export interface QueueHealthStatus {
    healthy: boolean;
    queues: Record<string, {
        created: number;
        active: number;
        completed: number;
        failed: number;
    }>;
    lastCheck: Date;
}

@Injectable()
export class QueueService implements OnModuleDestroy {
    private readonly logger = new Logger(QueueService.name);
    private messageCount = 0;
    private lastRateLimitReset = Date.now();
    private healthStatus: QueueHealthStatus = {
        healthy: true,
        queues: {},
        lastCheck: new Date(),
    };

    constructor(@Inject(PG_BOSS) private readonly boss: PgBoss) {
        // Subscribe to monitor events for health status
        (this.boss as any).on('monitor-states', (states: any) => {
            this.healthStatus = {
                healthy: true,
                queues: states.queues || {},
                lastCheck: new Date(),
            };
        });

        (this.boss as any).on('error', () => {
            this.healthStatus.healthy = false;
        });
    }

    async onModuleDestroy() {
        this.logger.log('Stopping PgBoss gracefully...');
        try {
            await this.boss.stop({ graceful: true, timeout: 30000 });
            this.logger.log('PgBoss stopped successfully');
        } catch (error) {
            this.logger.error('Error stopping PgBoss:', error);
            // Force stop if graceful fails
            await this.boss.stop({ graceful: false });
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Health check methods
    // ─────────────────────────────────────────────────────────────

    getHealthStatus(): QueueHealthStatus {
        return this.healthStatus;
    }

    async getDetailedHealthStatus(): Promise<QueueHealthStatus & { allQueuesStats: any[] }> {
        const allQueuesStats = await Promise.all(
            Object.values(QueueName).map(async (queueName) => {
                try {
                    const stats = await this.boss.getQueueStats(queueName);
                    return { queueName, ...stats };
                } catch {
                    return { queueName, error: true };
                }
            })
        );

        return {
            ...this.healthStatus,
            allQueuesStats,
        };
    }

    // ─────────────────────────────────────────────────────────────
    // Rate limiting for WhatsApp API
    // ─────────────────────────────────────────────────────────────

    private async checkRateLimit(): Promise<boolean> {
        const now = Date.now();
        if (now - this.lastRateLimitReset >= RATE_LIMIT_WINDOW_MS) {
            this.messageCount = 0;
            this.lastRateLimitReset = now;
        }

        if (this.messageCount >= WHATSAPP_RATE_LIMIT_PER_SECOND) {
            const waitTime = RATE_LIMIT_WINDOW_MS - (now - this.lastRateLimitReset);
            if (waitTime > 0) {
                this.logger.warn(`Rate limit reached, waiting ${waitTime}ms`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                this.messageCount = 0;
                this.lastRateLimitReset = Date.now();
            }
        }

        this.messageCount++;
        return true;
    }

    // ─────────────────────────────────────────────────────────────
    // Error classification
    // ─────────────────────────────────────────────────────────────

    classifyError(error: any): ErrorType {
        const message = error?.message?.toLowerCase() || '';
        const statusCode = error?.response?.status || error?.status;

        // Rate limited errors
        if (statusCode === 429 || message.includes('rate limit') || message.includes('too many requests')) {
            return ErrorType.RATE_LIMITED;
        }

        // Non-retryable errors (bad data, invalid phone, etc.)
        if (
            statusCode === 400 ||
            statusCode === 404 ||
            message.includes('invalid phone') ||
            message.includes('not a valid whatsapp') ||
            message.includes('recipient not found') ||
            message.includes('invalid parameter')
        ) {
            return ErrorType.NON_RETRYABLE;
        }

        // Everything else is retryable (network errors, timeouts, 5xx)
        return ErrorType.RETRYABLE;
    }

    // ─────────────────────────────────────────────────────────────
    // Dead Letter Queue
    // ─────────────────────────────────────────────────────────────

    async sendToDeadLetterQueue(
        originalQueue: string,
        jobData: any,
        error: Error,
        attempts: number,
    ): Promise<string | null> {
        this.logger.error(`Sending job to DLQ from ${originalQueue}:`, {
            error: error.message,
            attempts,
        });

        newrelic.incrementMetric(`Custom/Queue/${originalQueue}/DLQ`, 1);

        return this.boss.send(DEAD_LETTER_QUEUE, {
            originalQueue,
            originalData: jobData,
            error: {
                message: error.message,
                stack: error.stack,
            },
            attempts,
            failedAt: new Date().toISOString(),
        });
    }

    // ─────────────────────────────────────────────────────────────
    // Generic job scheduling
    // ─────────────────────────────────────────────────────────────

    async addJob<T extends object>(
        queueName: QueueName | string,
        data: T,
        options?: JobOptions,
    ): Promise<string | null> {
        const startTime = Date.now();
        try {
            // Validate required data
            if (!data || typeof data !== 'object') {
                throw new Error('Job data must be a non-null object');
            }

            const jobId = await this.boss.send(queueName, data, {
                priority: options?.priority ?? 0,
                retryLimit: options?.retryLimit ?? 3,
                retryDelay: options?.retryDelay ?? 30,
                startAfter: options?.startAfter,
                expireInSeconds: options?.expireInSeconds ?? 60 * 60, // 1 hour default
                singletonKey: options?.singletonKey,
            });

            const duration = Date.now() - startTime;
            this.logger.log(`Job queued: ${queueName} [${jobId}] in ${duration}ms`);
            newrelic.incrementMetric(`Custom/Queue/${queueName}/Queued`, 1);

            return jobId;
        } catch (error: any) {
            const duration = Date.now() - startTime;
            this.logger.error(`Failed to queue job ${queueName} after ${duration}ms:`, error);

            newrelic.noticeError(error, {
                queueName,
                duration,
                component: 'QueueService',
            });
            newrelic.incrementMetric(`Custom/Queue/${queueName}/QueueFailed`, 1);

            throw error;
        }
    }

    async addBulkJobs<T extends object>(
        queueName: QueueName | string,
        jobs: { data: T; options?: JobOptions }[],
    ): Promise<string[] | null> {
        if (!jobs?.length) {
            this.logger.warn(`addBulkJobs called with empty jobs array for ${queueName}`);
            return [];
        }

        const startTime = Date.now();
        try {
            const jobInserts = jobs.map((job) => ({
                data: job.data,
                priority: job.options?.priority ?? 0,
                retryLimit: job.options?.retryLimit ?? 3,
                startAfter: job.options?.startAfter,
            }));

            const jobIds = await this.boss.insert(queueName, jobInserts);
            const duration = Date.now() - startTime;

            this.logger.log(`Bulk queued ${jobIds?.length ?? 0} jobs to ${queueName} in ${duration}ms`);
            newrelic.incrementMetric(`Custom/Queue/${queueName}/BulkQueued`, jobIds?.length ?? 0);

            return jobIds;
        } catch (error: any) {
            this.logger.error(`Failed to bulk queue jobs to ${queueName}:`, error);
            newrelic.noticeError(error, { queueName, jobCount: jobs.length });
            throw error;
        }
    }

    // ─────────────────────────────────────────────────────────────
    // Job handlers (processors) with enhanced error handling
    // ─────────────────────────────────────────────────────────────

    async registerHandler<T extends object>(
        queueName: QueueName | string,
        handler: (jobs: Job<T>[]) => Promise<void>,
        options?: {
            batchSize?: number;
            pollingIntervalSeconds?: number;
            includeMetadata?: boolean;
        },
    ): Promise<string> {
        this.logger.log(`Registering handler for queue: ${queueName}`);

        return this.boss.work<T>(
            queueName,
            {
                batchSize: options?.batchSize ?? 1,
                pollingIntervalSeconds: options?.pollingIntervalSeconds ?? 2,
                includeMetadata: options?.includeMetadata ?? true,
            },
            async (jobs) => {
                for (const job of jobs) {
                    const startTime = Date.now();
                    const jobMeta = (job as any).startedOn ? job : { ...job, startedOn: new Date() };

                    this.logger.log(`Processing job: ${queueName} [${job.id}] attempt ${(jobMeta as any).retrycount ?? 0 + 1}`);

                    try {
                        // Apply rate limiting for WhatsApp queues
                        if (queueName.toString().startsWith('whatsapp-')) {
                            await this.checkRateLimit();
                        }

                        await handler([job]);

                        const duration = Date.now() - startTime;
                        this.logger.log(`Completed job: ${queueName} [${job.id}] in ${duration}ms`);

                        // Record success metrics
                        newrelic.incrementMetric(`Custom/Queue/${queueName}/Completed`, 1);
                        newrelic.recordMetric(`Custom/Queue/${queueName}/Duration`, duration);

                    } catch (error: any) {
                        const duration = Date.now() - startTime;
                        const errorType = this.classifyError(error);
                        const retryCount = (jobMeta as any).retrycount ?? 0;
                        const maxRetries = (jobMeta as any).retrylimit ?? 3;

                        this.logger.error(
                            `Failed job: ${queueName} [${job.id}] after ${duration}ms - ${errorType}`,
                            { error: error.message, retryCount, maxRetries }
                        );

                        // Record failure metrics
                        newrelic.incrementMetric(`Custom/Queue/${queueName}/Failed`, 1);
                        newrelic.incrementMetric(`Custom/Queue/${queueName}/Failed/${errorType}`, 1);

                        // Handle based on error type
                        if (errorType === ErrorType.NON_RETRYABLE) {
                            // Send to DLQ immediately, don't retry
                            await this.sendToDeadLetterQueue(queueName.toString(), job.data, error, retryCount + 1);
                            // Complete the job (don't rethrow) to prevent retries
                            this.logger.warn(`Non-retryable error, sent to DLQ: ${job.id}`);
                            return;
                        }

                        if (errorType === ErrorType.RATE_LIMITED) {
                            // Delay retry for rate limited errors
                            this.logger.warn(`Rate limited, will retry with backoff: ${job.id}`);
                        }

                        // Check if we've exceeded retries
                        if (retryCount >= maxRetries - 1) {
                            await this.sendToDeadLetterQueue(queueName.toString(), job.data, error, retryCount + 1);
                            this.logger.error(`Max retries exceeded, sent to DLQ: ${job.id}`);
                        }

                        // Rethrow for pg-boss retry handling
                        throw error;
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

    async queueWhatsAppDocument(
        data: WhatsAppDocumentJob,
        options?: JobOptions,
    ): Promise<string | null> {
        return this.addJob(QueueName.WHATSAPP_DOCUMENT, data, {
            ...options,
            singletonKey: data.messageId
                ? `wa-doc-${data.caseId}-${data.messageId}`
                : undefined,
        });
    }

    async queueIncomingMessage(
        data: IncomingMessageJob,
        options?: JobOptions,
    ): Promise<string | null> {
        // Extract message ID for singleton key to prevent duplicate processing
        const messageId = data.webhookBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;

        if (!messageId) {
            this.logger.warn('Incoming message missing message ID, may result in duplicate processing');
        }

        return this.addJob(QueueName.INCOMING_MESSAGE, data, {
            ...options,
            priority: 10, // Highest priority for incoming messages
            retryLimit: 3,
            retryDelay: 5, // Quick retry for incoming messages
            expireInSeconds: 60 * 5, // 5 minute timeout for incoming messages
            singletonKey: messageId ? `incoming-${messageId}` : `incoming-${Date.now()}`,
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
