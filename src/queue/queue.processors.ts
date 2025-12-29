import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import * as newrelic from 'newrelic';
import { QueueService } from './queue.service';
import {
    QueueName,
    WhatsAppTextJob,
    WhatsAppButtonsJob,
    WhatsAppListJob,
    WhatsAppImageJob,
    WhatsAppDocumentJob,
    SendTemplateJob,
    ProcessRefundJob,
    NotificationJob,
    IncomingMessageJob,
} from './queue.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { SystemMessageStatus } from '@prisma/client';

// Timeout wrapper for job processing
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, jobName: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(`Job ${jobName} timed out after ${timeoutMs}ms`)), timeoutMs)
        ),
    ]);
};

// Production timeouts (in ms)
const WHATSAPP_API_TIMEOUT = 30000; // 30 seconds
const INCOMING_MESSAGE_TIMEOUT = 60000; // 60 seconds
const REFUND_TIMEOUT = 120000; // 2 minutes

@Injectable()
export class QueueProcessors implements OnModuleInit {
    private readonly logger = new Logger(QueueProcessors.name);
    private readonly isProduction = process.env.NODE_ENV === 'production';
    private customerService: any; // Lazy loaded to avoid circular dependency

    constructor(
        private readonly queueService: QueueService,
        private readonly prisma: PrismaService,
        private readonly moduleRef: ModuleRef,
    ) { }

    async onModuleInit() {
        // Lazy load CustomerService to break circular dependency
        // CustomerModule -> ChatModule -> CustomerModule -> QueueModule
        const { CustomerService } = await import('../customer/customer.service');
        this.customerService = this.moduleRef.get(CustomerService, { strict: false });
    }

    // Helper to safely update message status
    private async updateMessageStatus(messageId: number | undefined, status: SystemMessageStatus): Promise<void> {
        if (!messageId) return;

        try {
            await this.prisma.message.update({
                where: { id: messageId },
                data: { systemStatus: status },
            });
        } catch (error) {
            // Don't fail the job if status update fails
            this.logger.warn(`Failed to update message ${messageId} status to ${status}:`, error);
        }
    }

    // Helper to validate phone number
    private validatePhoneNo(phoneNo: string): boolean {
        if (!phoneNo || typeof phoneNo !== 'string') return false;
        // Basic validation - should be digits only, 10-15 characters
        const cleaned = phoneNo.replace(/\D/g, '');
        return cleaned.length >= 10 && cleaned.length <= 15;
    }

    async registerAllHandlers() {
        // Create all queues first (pg-boss requires queues to exist before workers)
        await this.createAllQueues();

        // Register handlers for each queue
        await this.registerWhatsAppTextHandler();
        await this.registerWhatsAppButtonsHandler();
        await this.registerWhatsAppListHandler();
        await this.registerWhatsAppImageHandler();
        await this.registerWhatsAppDocumentHandler();
        await this.registerTemplateHandler();
        await this.registerRefundHandler();
        await this.registerNotificationHandler();
        await this.registerIncomingMessageHandler();
    }

    private async createAllQueues() {
        const boss = this.queueService.getBoss();
        const queues = Object.values(QueueName);

        for (const queueName of queues) {
            try {
                await boss.createQueue(queueName);
                this.logger.log(`✅ Created queue: ${queueName}`);
            } catch (err: any) {
                // Queue might already exist, that's okay
                if (!err.message?.includes('already exists')) {
                    this.logger.warn(`Could not create queue ${queueName}: ${err.message}`);
                }
            }
        }
    }

    private async registerWhatsAppTextHandler() {
        await this.queueService.registerHandler<WhatsAppTextJob>(
            QueueName.WHATSAPP_TEXT,
            async (jobs) => {
                for (const job of jobs) {
                    const { phoneNo, text, caseId, messageId } = job.data;

                    // Validate input
                    if (!this.validatePhoneNo(phoneNo)) {
                        this.logger.error(`Invalid phone number: ${phoneNo}`);
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error(`Invalid phone number: ${phoneNo}`);
                    }

                    if (!text?.trim()) {
                        this.logger.error(`Empty text message for case ${caseId}`);
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error('Text message cannot be empty');
                    }

                    this.logger.log(`Sending WhatsApp text to ${phoneNo} for case ${caseId}`);

                    try {
                        await withTimeout(
                            this.customerService.sendTextMessage(phoneNo, text),
                            WHATSAPP_API_TIMEOUT,
                            `whatsapp-text-${job.id}`
                        );

                        await this.updateMessageStatus(messageId, SystemMessageStatus.DELIVERED);
                        this.logger.log(`WhatsApp text sent to ${phoneNo} for case ${caseId}`);

                    } catch (error: any) {
                        this.logger.error(`Failed to send WhatsApp text to ${phoneNo}`, {
                            error: error.message,
                            caseId,
                            messageId,
                        });

                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);

                        // Record error to New Relic
                        newrelic.noticeError(error, {
                            queueName: QueueName.WHATSAPP_TEXT,
                            phoneNo: phoneNo.slice(-4), // Last 4 digits only for privacy
                            caseId,
                        });

                        throw error;
                    }
                }
            },
            { batchSize: 5, pollingIntervalSeconds: 2 },
        );
    }

    private async registerWhatsAppButtonsHandler() {
        await this.queueService.registerHandler<WhatsAppButtonsJob>(
            QueueName.WHATSAPP_BUTTONS,
            async (jobs) => {
                for (const job of jobs) {
                    const { phoneNo, header, body, footer, buttons, caseId, messageId } = job.data;

                    if (!this.validatePhoneNo(phoneNo)) {
                        this.logger.error(`Invalid phone number: ${phoneNo}`);
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error(`Invalid phone number: ${phoneNo}`);
                    }

                    if (!body?.trim() || !buttons?.length) {
                        this.logger.error(`Invalid buttons message for case ${caseId}`);
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error('Buttons message requires body and buttons');
                    }

                    this.logger.log(`Sending WhatsApp buttons to ${phoneNo} for case ${caseId}`);

                    try {
                        await withTimeout(
                            this.customerService.sendButtons(phoneNo, { header, body, footer, buttons }),
                            WHATSAPP_API_TIMEOUT,
                            `whatsapp-buttons-${job.id}`
                        );

                        await this.updateMessageStatus(messageId, SystemMessageStatus.DELIVERED);
                        this.logger.log(`WhatsApp buttons sent to ${phoneNo} for case ${caseId}`);

                    } catch (error: any) {
                        this.logger.error(`Failed to send WhatsApp buttons to ${phoneNo}`, {
                            error: error.message,
                            caseId,
                        });
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        newrelic.noticeError(error, { queueName: QueueName.WHATSAPP_BUTTONS, caseId });
                        throw error;
                    }
                }
            },
            { batchSize: 3, pollingIntervalSeconds: 2 },
        );
    }

    private async registerWhatsAppListHandler() {
        await this.queueService.registerHandler<WhatsAppListJob>(
            QueueName.WHATSAPP_LIST,
            async (jobs) => {
                for (const job of jobs) {
                    const { phoneNo, body, buttonText, footer, sections, caseId, messageId } = job.data;

                    if (!this.validatePhoneNo(phoneNo)) {
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error(`Invalid phone number: ${phoneNo}`);
                    }

                    if (!body?.trim() || !buttonText || !sections?.length) {
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error('List message requires body, buttonText, and sections');
                    }

                    this.logger.log(`Sending WhatsApp list to ${phoneNo} for case ${caseId}`);

                    try {
                        await withTimeout(
                            this.customerService.sendInteractiveList(phoneNo, { body, buttonText, footer, sections }),
                            WHATSAPP_API_TIMEOUT,
                            `whatsapp-list-${job.id}`
                        );

                        await this.updateMessageStatus(messageId, SystemMessageStatus.DELIVERED);
                        this.logger.log(`WhatsApp list sent to ${phoneNo} for case ${caseId}`);

                    } catch (error: any) {
                        this.logger.error(`Failed to send WhatsApp list to ${phoneNo}`, { error: error.message, caseId });
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        newrelic.noticeError(error, { queueName: QueueName.WHATSAPP_LIST, caseId });
                        throw error;
                    }
                }
            },
            { batchSize: 3, pollingIntervalSeconds: 2 },
        );
    }

    private async registerWhatsAppImageHandler() {
        await this.queueService.registerHandler<WhatsAppImageJob>(
            QueueName.WHATSAPP_IMAGE,
            async (jobs) => {
                for (const job of jobs) {
                    const { phoneNo, imageUrl, caption, caseId, messageId } = job.data;

                    if (!this.validatePhoneNo(phoneNo)) {
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error(`Invalid phone number: ${phoneNo}`);
                    }

                    if (!imageUrl?.trim()) {
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error('Image URL is required');
                    }

                    this.logger.log(`Sending WhatsApp image to ${phoneNo} for case ${caseId}`);

                    try {
                        await withTimeout(
                            this.customerService.sendImageToCustomer(phoneNo, imageUrl, caption || 'image'),
                            WHATSAPP_API_TIMEOUT,
                            `whatsapp-image-${job.id}`
                        );

                        await this.updateMessageStatus(messageId, SystemMessageStatus.DELIVERED);
                        this.logger.log(`WhatsApp image sent to ${phoneNo} for case ${caseId}`);

                    } catch (error: any) {
                        this.logger.error(`Failed to send WhatsApp image to ${phoneNo}`, { error: error.message, caseId });
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        newrelic.noticeError(error, { queueName: QueueName.WHATSAPP_IMAGE, caseId });
                        throw error;
                    }
                }
            },
            { batchSize: 2, pollingIntervalSeconds: 3 },
        );
    }

    private async registerWhatsAppDocumentHandler() {
        await this.queueService.registerHandler<WhatsAppDocumentJob>(
            QueueName.WHATSAPP_DOCUMENT,
            async (jobs) => {
                for (const job of jobs) {
                    const { phoneNo, documentUrl, fileName, caption, caseId, messageId } = job.data;

                    if (!this.validatePhoneNo(phoneNo)) {
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error(`Invalid phone number: ${phoneNo}`);
                    }

                    if (!documentUrl?.trim() || !fileName?.trim()) {
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        throw new Error('Document URL and fileName are required');
                    }

                    this.logger.log(`Sending WhatsApp document to ${phoneNo} for case ${caseId}`);

                    try {
                        await withTimeout(
                            this.customerService.sendDocumentToCustomer(phoneNo, documentUrl, fileName, caption),
                            WHATSAPP_API_TIMEOUT,
                            `whatsapp-document-${job.id}`
                        );

                        await this.updateMessageStatus(messageId, SystemMessageStatus.DELIVERED);
                        this.logger.log(`WhatsApp document sent to ${phoneNo} for case ${caseId}`);

                    } catch (error: any) {
                        this.logger.error(`Failed to send WhatsApp document to ${phoneNo}`, { error: error.message, caseId });
                        await this.updateMessageStatus(messageId, SystemMessageStatus.FAILED);
                        newrelic.noticeError(error, { queueName: QueueName.WHATSAPP_DOCUMENT, caseId });
                        throw error;
                    }
                }
            },
            { batchSize: 2, pollingIntervalSeconds: 3 },
        );
    }

    private async registerIncomingMessageHandler() {
        await this.queueService.registerHandler<IncomingMessageJob>(
            QueueName.INCOMING_MESSAGE,
            async (jobs) => {
                for (const job of jobs) {
                    const { webhookBody, receivedAt } = job.data;
                    const messageId = webhookBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.id;
                    const phoneNo = webhookBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from;

                    // Calculate processing delay
                    const receivedTime = new Date(receivedAt).getTime();
                    const processingDelay = Date.now() - receivedTime;

                    this.logger.log(`Processing incoming message [${messageId}] from ${phoneNo?.slice(-4)} received at ${receivedAt} (delay: ${processingDelay}ms)`);

                    // Record processing delay metric
                    newrelic.recordMetric('Custom/Queue/IncomingMessage/ProcessingDelay', processingDelay);

                    // Validate webhook body
                    if (!webhookBody?.entry?.[0]) {
                        this.logger.error(`Invalid webhook body structure for job ${job.id}`);
                        throw new Error('Invalid webhook body structure');
                    }

                    try {
                        await withTimeout(
                            this.customerService.processIncomingMessageFromQueue(webhookBody),
                            INCOMING_MESSAGE_TIMEOUT,
                            `incoming-message-${job.id}`
                        );

                        this.logger.log(`Successfully processed incoming message [${messageId}] in ${Date.now() - receivedTime}ms total`);
                        newrelic.incrementMetric('Custom/Queue/IncomingMessage/Processed', 1);

                    } catch (error: any) {
                        this.logger.error(`Failed to process incoming message [${messageId}]`, {
                            error: error.message,
                            phoneNo: phoneNo?.slice(-4),
                            processingDelay,
                        });

                        newrelic.noticeError(error, {
                            queueName: QueueName.INCOMING_MESSAGE,
                            messageId,
                            processingDelay,
                        });
                        newrelic.incrementMetric('Custom/Queue/IncomingMessage/Failed', 1);

                        throw error;
                    }
                }
            },
            {
                batchSize: this.isProduction ? 10 : 5, // Higher batch in production
                pollingIntervalSeconds: 1, // Fast polling for incoming messages
            },
        );
    }

    private async registerTemplateHandler() {
        await this.queueService.registerHandler<SendTemplateJob>(
            QueueName.SEND_TEMPLATE,
            async (jobs) => {
                for (const job of jobs) {
                    const { templateName, caseId, userId, params } = job.data;
                    this.logger.log(`Sending template ${templateName} for case ${caseId}`);

                    // TODO: Implement template sending logic
                    // Example:
                    // await this.chatService.sendTemplateMessage(templateName, caseId, userId, ...);
                }
            },
            { batchSize: 3, pollingIntervalSeconds: 2 },
        );
    }

    private async registerRefundHandler() {
        await this.queueService.registerHandler<ProcessRefundJob>(
            QueueName.PROCESS_REFUND,
            async (jobs) => {
                for (const job of jobs) {
                    const { issueEventId, amount, utr } = job.data;

                    // Validate refund data
                    if (!issueEventId || issueEventId <= 0) {
                        throw new Error(`Invalid issueEventId: ${issueEventId}`);
                    }

                    if (!amount || amount <= 0) {
                        throw new Error(`Invalid refund amount: ${amount}`);
                    }

                    this.logger.log(`Processing refund for issue ${issueEventId}: ₹${amount / 100}`);

                    const startTime = Date.now();

                    try {
                        // Check if issue exists
                        const issueEvent = await this.prisma.issueEvent.findUnique({
                            where: { id: issueEventId },
                        });

                        if (!issueEvent) {
                            throw new Error(`Issue event ${issueEventId} not found`);
                        }

                        // Prevent duplicate refunds
                        if (issueEvent.refundAmountMinor && issueEvent.refundAmountMinor > 0) {
                            this.logger.warn(`Refund already processed for issue ${issueEventId}, skipping`);
                            return;
                        }

                        await withTimeout(
                            this.prisma.issueEvent.update({
                                where: { id: issueEventId },
                                data: {
                                    refundAmountMinor: amount,
                                    utr: utr,
                                    updatedAt: new Date(),
                                },
                            }),
                            REFUND_TIMEOUT,
                            `refund-${job.id}`
                        );

                        const duration = Date.now() - startTime;
                        this.logger.log(`Refund processed for issue ${issueEventId} in ${duration}ms`);

                        newrelic.recordCustomEvent('RefundProcessed', {
                            issueEventId,
                            amount,
                            utr,
                            duration,
                        });

                    } catch (error: any) {
                        this.logger.error(`Failed to process refund for issue ${issueEventId}`, {
                            error: error.message,
                            amount,
                        });

                        newrelic.noticeError(error, {
                            queueName: QueueName.PROCESS_REFUND,
                            issueEventId,
                            amount,
                        });

                        throw error;
                    }
                }
            },
            { batchSize: 1, pollingIntervalSeconds: 5 }, // Process refunds one at a time for safety
        );
    }

    private async registerNotificationHandler() {
        await this.queueService.registerHandler<NotificationJob>(
            QueueName.NOTIFICATION,
            async (jobs) => {
                for (const job of jobs) {
                    const { type, recipient, subject, body } = job.data;
                    this.logger.log(`Sending ${type} notification to ${recipient}`);

                    // TODO: Implement notification logic based on type
                    switch (type) {
                        case 'email':
                            // await this.emailService.send(recipient, subject, body);
                            break;
                        case 'push':
                            // await this.pushService.send(recipient, body);
                            break;
                        case 'sms':
                            // await this.smsService.send(recipient, body);
                            break;
                    }
                }
            },
            { batchSize: 10, pollingIntervalSeconds: 2 },
        );
    }
}
