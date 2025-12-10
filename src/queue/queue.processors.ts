import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { QueueService } from './queue.service';
import {
    QueueName,
    WhatsAppTextJob,
    WhatsAppButtonsJob,
    WhatsAppListJob,
    WhatsAppImageJob,
    SendTemplateJob,
    ProcessRefundJob,
    NotificationJob,
} from './queue.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { CustomerService } from 'src/customer/customer.service';
import { SystemMessageStatus } from '@prisma/client';

@Injectable()
export class QueueProcessors {
    private readonly logger = new Logger(QueueProcessors.name);

    constructor(
        private readonly queueService: QueueService,
        private readonly prisma: PrismaService,
        @Inject(forwardRef(() => CustomerService))
        private readonly customerService: CustomerService,
    ) { }

    async registerAllHandlers() {
        // Register handlers for each queue
        await this.registerWhatsAppTextHandler();
        await this.registerWhatsAppButtonsHandler();
        await this.registerWhatsAppListHandler();
        await this.registerWhatsAppImageHandler();
        await this.registerTemplateHandler();
        await this.registerRefundHandler();
        await this.registerNotificationHandler();
    }

    private async registerWhatsAppTextHandler() {
        await this.queueService.registerHandler<WhatsAppTextJob>(
            QueueName.WHATSAPP_TEXT,
            async (jobs) => {
                for (const job of jobs) {
                    const { phoneNo, text, caseId, messageId } = job.data;
                    this.logger.log(`Sending WhatsApp text to ${phoneNo}`);

                    try {
                        await this.customerService.sendTextMessage(phoneNo, text);

                        // Update message status to DELIVERED
                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.DELIVERED },
                            });
                        }

                        this.logger.log(`WhatsApp text sent to ${phoneNo} for case ${caseId}`);
                    } catch (error) {
                        this.logger.error(`Failed to send WhatsApp text to ${phoneNo}`, error);

                        // Update message status to FAILED
                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.FAILED },
                            });
                        }

                        throw error; // Re-throw for pg-boss retry
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
                    this.logger.log(`Sending WhatsApp buttons to ${phoneNo}`);

                    try {
                        await this.customerService.sendButtons(phoneNo, {
                            header,
                            body,
                            footer,
                            buttons,
                        });

                        // Update message status to DELIVERED
                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.DELIVERED },
                            });
                        }

                        this.logger.log(`WhatsApp buttons sent to ${phoneNo} for case ${caseId}`);
                    } catch (error) {
                        this.logger.error(`Failed to send WhatsApp buttons to ${phoneNo}`, error);

                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.FAILED },
                            });
                        }

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
                    this.logger.log(`Sending WhatsApp list to ${phoneNo}`);

                    try {
                        await this.customerService.sendInteractiveList(phoneNo, {
                            body,
                            buttonText,
                            footer,
                            sections,
                        });

                        // Update message status to DELIVERED
                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.DELIVERED },
                            });
                        }

                        this.logger.log(`WhatsApp list sent to ${phoneNo} for case ${caseId}`);
                    } catch (error) {
                        this.logger.error(`Failed to send WhatsApp list to ${phoneNo}`, error);

                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.FAILED },
                            });
                        }

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
                    this.logger.log(`Sending WhatsApp image to ${phoneNo}`);

                    try {
                        await this.customerService.sendImageToCustomer(phoneNo, imageUrl, caption || 'image');

                        // Update message status to DELIVERED
                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.DELIVERED },
                            });
                        }

                        this.logger.log(`WhatsApp image sent to ${phoneNo} for case ${caseId}`);
                    } catch (error) {
                        this.logger.error(`Failed to send WhatsApp image to ${phoneNo}`, error);

                        if (messageId) {
                            await this.prisma.message.update({
                                where: { id: messageId },
                                data: { systemStatus: SystemMessageStatus.FAILED },
                            });
                        }

                        throw error;
                    }
                }
            },
            { batchSize: 2, pollingIntervalSeconds: 3 },
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
                    this.logger.log(`Processing refund for issue ${issueEventId}: ₹${amount / 100}`);

                    // TODO: Implement refund logic
                    // Example: Call your refund API, update DB, etc.

                    await this.prisma.issueEvent.update({
                        where: { id: issueEventId },
                        data: {
                            refundAmountMinor: amount,
                            utr: utr,
                            updatedAt: new Date(),
                        },
                    });

                    this.logger.log(`Refund processed for issue ${issueEventId}`);
                }
            },
            { batchSize: 1, pollingIntervalSeconds: 5 }, // Process refunds one at a time
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
