import { Injectable, Logger } from '@nestjs/common';
import { MessageType, SenderType, SystemMessageStatus, ReplyType, Case, Status, CaseHandler, QuickReplies } from '@prisma/client';
import { ChatGateway } from './chat.gateway';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { CustomerService } from 'src/customer/customer.service';
import { ChatEntity } from './entity/chat.entity';
import { CaseEntity } from 'src/cases/entity/case.entity';
import { QuickMessage } from './dto/quick-message.dto';
import { FailedMessageDto } from './dto/failed-message.dto';
import * as newrelic from 'newrelic';
import { AxiosError } from 'axios';


@Injectable()
export class ChatService {
    private readonly logger = new Logger(ChatService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly chatGateway: ChatGateway,
        private readonly customerService: CustomerService,

    ) { }

    async createRoom(room: CaseEntity) {
        this.chatGateway.broadcastNewCase(room);
    }


    async getAllMessages() {
        try {
            return await this.prisma.message.findMany({
                include: {
                    user: true,
                    bot: true,
                    WhatsAppCustomer: true,
                    case: true,
                    media: true,
                    location: true,
                    interactive: true,
                },
            });
        } catch (error) {
            this.logger.error('Failed to fetch messages', error.stack);
            throw error;
        }
    }


    async handleWhatsappMessage(storedMessage: ChatEntity) {

        return this.chatGateway.handleWhatsappMessage(storedMessage);
    };

    async triggerFailedMessage(failedMessageDto: FailedMessageDto) {
        const dummyClient: any = {
            emit: () => { },
        }
        await this.chatGateway.handleFailedMessage(failedMessageDto, dummyClient);
    }

    async triggerStatusUpdate(caseId: number, status: Status, userId: number, assignedTo?: CaseHandler) {
        // Create a dummy socket object with minimal structure
        const dummyClient: any = {
            emit: () => { }, // No actual socket needed
        };

        await this.chatGateway.updateContactStatus(dummyClient, {
            caseId,
            status,
            userId,
            assignedTo
        });
    }

    private maskPhone(n?: string | null) {
        if (!n) return '';
        // keep last 4 digits, mask the rest
        return n.replace(/.(?=.{4}$)/g, '•');
    }

    // Updated createMessage method
    async createMessage(createMessageDto: CreateMessageDto) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                // Validate required fields
                if (!createMessageDto.recipient) {
                    throw new Error('Missing required message fields');
                }
                const caseRecord = await tx.case.findUnique({ where: { id: createMessageDto.caseId }, include: { customer: true } })

                // Create base message data without parentMessageId
                const baseData = {
                    type: createMessageDto.type,
                    replyType: createMessageDto.replyType || null,
                    senderType: createMessageDto.senderType,
                    text: createMessageDto.text,
                    recipient: createMessageDto.recipient,
                    waMessageId: createMessageDto.waMessageId,
                    systemStatus: createMessageDto.systemStatus || SystemMessageStatus.SENT,
                    timestamp: new Date(),
                };

                // Create message with nested connections
                const message: ChatEntity = await tx.message.create({
                    data: {
                        ...baseData,
                        case: { connect: { id: createMessageDto.caseId } },
                        ...(createMessageDto.userId && { user: { connect: { id: createMessageDto.userId } } }),
                        ...(createMessageDto.botId && { bot: { connect: { id: createMessageDto.botId } } }),
                        ...(createMessageDto.whatsAppCustomerId && {
                            WhatsAppCustomer: { connect: { id: createMessageDto.whatsAppCustomerId } }
                        }),
                        ...(createMessageDto.mediaId && { media: { connect: { id: createMessageDto.mediaId } } }),

                        // Connect the parent message if provided
                        ...(createMessageDto.parentMessageId && {
                            parentMessage: { connect: { id: createMessageDto.parentMessageId } }
                        }),
                        // Handle attachments without manually setting messageId

                        ...(createMessageDto.location && {
                            location: {
                                create: {
                                    ...createMessageDto.location
                                }
                            }
                        }),
                        ...(createMessageDto.interactive && {
                            interactive: {
                                create: {
                                    ...createMessageDto.interactive
                                }
                            }
                        }),
                    },

                    include: this.fullMessageIncludes()
                });

                // Handle contacts creation separately
                if (createMessageDto.contacts?.length) {
                    await tx.contact.createMany({
                        data: createMessageDto.contacts.map(contact => ({
                            ...contact,
                            messageId: message.id
                        }))
                    });
                }

                await this.notifyClients(message);
                return message;
            });
        } catch (error) {
            this.logger.error('Failed to create message', error.stack);
            throw error;
        }
    }



    private async validateRelationships(tx: any, dto: CreateMessageDto) {
        const validations = [];

        if (dto.caseId) {
            validations.push(tx.case.findUnique({ where: { id: dto.caseId } }));
        }
        if (dto.userId) {
            validations.push(tx.user.findUnique({ where: { id: dto.userId } }));
        }
        if (dto.botId) {
            validations.push(tx.bot.findUnique({ where: { id: dto.botId } }));
        }
        if (dto.whatsAppCustomerId) {
            validations.push(tx.whatsAppCustomer.findUnique({ where: { id: dto.whatsAppCustomerId } }));
        }
        if (dto.parentMessageId) {
            validations.push(tx.message.findUnique({ where: { id: dto.parentMessageId } }));
        }

        const results = await Promise.all(validations);
        if (results.some(result => !result)) {
            throw new Error('One or more related entities not found');
        }
    }

    private async handleAttachments(tx: any, dto: CreateMessageDto) {
        const results = {
            media: null,
            location: null,
            interactive: null,
            contacts: []
        };

        if (dto.media) {
            results.media = await tx.media.create({
                data: { ...dto.media, messageId: undefined }
            });
        }

        if (dto.location) {
            results.location = await tx.location.create({
                data: { ...dto.location, messageId: undefined }
            });
        }

        if (dto.interactive) {
            results.interactive = await tx.interactive.create({
                data: { ...dto.interactive, messageId: undefined }
            });
        }

        if (dto.contacts?.length) {
            results.contacts = dto.contacts.map(c => ({
                ...c,
                messageId: undefined
            }));
        }

        return results;
    }

    private fullMessageIncludes() {
        return {
            user: true,
            bot: true,
            WhatsAppCustomer: true,
            media: true,
            location: true,
            interactive: true,
            contacts: true,
            parentMessage: {
                include: {
                    user: true,
                    bot: true,
                    WhatsAppCustomer: true
                }
            },
            replies: true,

            case: true,
        };
    }

    async getMessagesByCaseId(caseId: number) {
        try {
            return await this.prisma.message.findMany({
                where: { caseId },
                include: {
                    user: true,
                    bot: true,
                    WhatsAppCustomer: true,
                    media: true,
                    location: true,
                    interactive: true,
                },
                orderBy: { timestamp: 'asc' }
            });
        } catch (error) {
            this.logger.error(`Failed to get messages for case ${caseId}`, error.stack);
            throw error;
        }
    }

    async updateMessageStatus(messageId: number, status: SystemMessageStatus) {
        try {
            const updated = await this.prisma.message.update({
                where: { id: messageId },
                data: { systemStatus: status },
                include: {
                    user: true,
                    bot: true,
                    WhatsAppCustomer: true,
                }
            });

            this.chatGateway.handleMessageStatusUpdate(updated);
            return updated;
        } catch (error) {
            this.logger.error(`Failed to update status for message ${messageId}`, error.stack);
            throw error;
        }
    }

    private async notifyClients(message: ChatEntity) {
        this.logger.log(message.type);
        const caseRecord = await this.prisma.case.findUnique({
            where: {
                id: message.caseId
            },
            include: {
                customer: true
            }
        })

        const phoneNo = caseRecord.customer.phoneNo
        switch (message.senderType) {
            case SenderType.USER:
                if (message.type === MessageType.TEXT) {
                    this.customerService.sendTextMessage(phoneNo, message.text)
                }
                else if (message.type === MessageType.INTERACTIVE) {
                    if (message.interactive.type === 'list') {
                        this.customerService.sendInteractiveList(phoneNo, message.interactive as any)
                    }
                    else {
                        this.customerService.sendButtons(phoneNo, message.interactive as any)
                    }
                }
                else if (message.type === MessageType.IMAGE) {
                    const media = await this.prisma.media.findUnique({
                        where: {
                            id: message.media?.id
                        }
                    });

                    // Log the media object for debugging
                    this.logger.log('Media Object:', media);

                    if (media && media.url) {
                        // Check and sanitize the URL
                        const sanitizedUrl = decodeURIComponent(media.url);

                        // If the URL is valid, send it to the customer
                        if (sanitizedUrl) {
                            this.customerService.sendImageToCustomer(phoneNo, sanitizedUrl, 'image');
                        } else {
                            this.logger.error(`Invalid media URL: ${media.url}`);
                        }
                    } else {
                        this.logger.error("Media URL not found or invalid.");
                    }
                }
            case SenderType.CUSTOMER:
                this.chatGateway.handleWhatsappMessage(message);
                break;
            case SenderType.BOT:
                this.chatGateway.handleBotMessage(message);
                break;
            default:
                this.logger.warn('Unknown sender type for message notification');
        }
    }

    async createMediaAttachment(fileData: {
        url: string;
        mimeType: string;
        caption?: string;
        fileName?: string;
        size?: number;
        duration?: number;
        height?: number;
        width?: number;
    }) {
        try {
            return await this.prisma.media.create({
                data: fileData
            });
        } catch (error) {
            this.logger.error('Failed to create media attachment', error.stack);
            throw error;
        }
    }

    async createLocationAttachment(locationData: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
        url?: string;
        accuracy?: number;
    }) {
        try {
            return await this.prisma.location.create({
                data: locationData
            });
        } catch (error) {
            this.logger.error('Failed to create location attachment', error.stack);
            throw error;
        }
    }

    async broadcastNewCase(newCase: Case) {
        this.chatGateway.broadcastNewCase(newCase);
    }
    async fetchQuickReplies() {
        try {
            const ar = await this.prisma.quickReplies.findMany();
            return ar;
        } catch (error) {
            this.logger.log(`${error}`)
        }
    }
    async sendQuickMessage(quickMessageId: number, caseId: number, userId: number) {
        try {
            const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId }, select: { customer: true } })
            const node = await this.prisma.quickReplies.findUnique({ where: { id: quickMessageId } })
            switch (node.flowNodeType) {
                case ReplyType.Message:
                    await this.handleMessageNode(caseRecord.customer.phoneNo, node, caseId, userId);
                    break;
                case ReplyType.InteractiveButtons:
                    await this.handleInteractiveButtons(caseRecord.customer.phoneNo, node, caseId, userId);
                    break;
                case ReplyType.InteractiveList:
                    await this.handleInteractiveList(caseRecord.customer.phoneNo, node, caseId, userId);
                    break;
                default:
                    throw new Error(`Unsupported node type: ${node.flowNodeType}`);
            }
            return node;
        } catch (error) {
            this.logger.log(`error while sending quickMessage:${error}`)
        }
    }
    private async handleMessageNode(phoneNumber: string, node: QuickMessage, caseId: number, userId: number): Promise<void> {
        const body = node.body as { text?: string };
        if (!body?.text) {
            throw new Error('Message node missing text content');
        }

        const message = {
            text: body.text || JSON.stringify(node.action),
            type: MessageType.TEXT,
            senderType: SenderType.USER,
            caseId,
            userId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            recipient: phoneNumber,
        };

        const savedMessage = await this.createMessage(message);
        await this.customerService.sendTextMessage(phoneNumber, body.text);
        await this.prisma.message.update({
            where: { id: savedMessage.id },
            data: { systemStatus: SystemMessageStatus.DELIVERED },
        });
    }

    private async handleInteractiveButtons(phoneNumber: string, node: QuickReplies, caseId: number, userId: number): Promise<void> {
        const action = node.action as { buttons?: Array<{ id: string; title: string }> };
        if (!action?.buttons?.length) {
            throw new Error('InteractiveButtons node missing buttons');
        }

        const message = {
            text: JSON.stringify(node.body) || 'Please choose an option:',
            type: MessageType.INTERACTIVE,
            senderType: SenderType.USER,
            caseId,
            userId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            interactive: {
                type: 'button',
                header: node.header,
                body: node.body,
                footer: node.footer,
                action: node.action,
                parameters: node.replies,
            },
            recipient: phoneNumber,
        };

        const savedMessage = await this.createMessage(message);
        await this.customerService.sendButtons(phoneNumber, {
            header: (node.header as any)?.text,
            footer: (node.footer as any)?.text,
            body: (node.body as any)?.text || 'Please choose an option:',
            buttons: action.buttons,
        });
        await this.prisma.message.update({
            where: { id: savedMessage.id },
            data: { systemStatus: SystemMessageStatus.DELIVERED },
        });
    }

    private async handleInteractiveList(phoneNumber: string, node: QuickReplies, caseId: number, userId: number): Promise<void> {
        const action = node.action as { button?: string; sections?: any[] };
        if (!action?.sections?.length) {
            throw new Error('InteractiveList node missing sections');
        }

        const message = {
            text: (node.body as any)?.text || 'Please select from the list:',
            type: MessageType.INTERACTIVE,
            senderType: SenderType.USER,
            caseId,
            userId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            interactive: {
                type: 'list',
                header: node.header ? JSON.stringify(node.header) : null,
                body: node.body ? JSON.stringify(node.body) : null,
                footer: node.footer ? JSON.stringify(node.footer) : null,
                action: JSON.stringify({ button: action.button, sections: action.sections }),
            },
            recipient: phoneNumber,
        };

        const savedMessage = await this.createMessage(message);
        await this.customerService.sendInteractiveList(phoneNumber, {
            body: (node.body as any)?.text || 'Please select from the list:',
            buttonText: action.button || 'Options',
            footer: (node.footer as any)?.text,
            sections: action.sections,
        });
        await this.prisma.message.update({
            where: { id: savedMessage.id },
            data: { systemStatus: SystemMessageStatus.DELIVERED },
        });

    }
    async sendTemplateMessage(
        templateName: string,
        caseId: number,
        userId: number,
        text: string
    ) {
        // 1) Fetch case + customer
        const caseRecord = await this.prisma.case.findUnique({
            where: { id: caseId },
            select: { customer: { select: { name: true, phoneNo: true } } }
        });


        // Normalize recipient to digits only (Cloud API accepts E.164 digits without symbols)
        const to = caseRecord.customer.phoneNo
        const customerName = caseRecord.customer.name

        // 2) Save the outbound message first
        const savedMessage = await this.prisma.message.create({
            data: {
                text: `${text}`,
                type: MessageType.TEXT,
                senderType: SenderType.USER,
                caseId,
                userId,
                systemStatus: SystemMessageStatus.SENT,
                timestamp: new Date(),
                recipient: to,
            },
            include: {
                user: true,
                bot: true,
                WhatsAppCustomer: true,
                media: true,
                location: true,
                interactive: true,
                contacts: true,
                parentMessage: { include: { user: true, bot: true, WhatsAppCustomer: true } },
                replies: true,
                case: true,
            }
        });
        let languageCode: string | undefined;

        try {
            // 3) Determine the correct language code by looking up approved templates
            const templates = await this.customerService.getApprovedTemplates();
            const matches = (templates || []).filter((t: any) => t?.name === templateName);

            if (!matches.length) {
                throw new Error(`Template "${templateName}" not found among APPROVED templates`);
            }

            // Prefer "en", then "en_US", else first available language for that name
            const chosen =
                matches.find((t: any) => t.language === "en") ??
                matches.find((t: any) => t.language === "en_US") ??
                matches[0];

            languageCode = chosen.language;

            this.logger.log(`languageCode === ${languageCode}`)

            // 4) Send via your generalized sender
            await this.customerService.sendWhatsAppTemplate({
                to,
                template: {
                    name: templateName.trim(),
                    languageCode,
                    components: [
                        { type: "body", parameters: [{ type: "text", text: customerName, parameter_name: 'customer_name' }] }
                    ]
                }
            });

            // 5) Mark delivered and notify
            await this.prisma.message.update({
                where: { id: savedMessage.id },
                data: { systemStatus: SystemMessageStatus.DELIVERED },
            });

            if (savedMessage) await this.notifyClients({ ...savedMessage, systemStatus: SystemMessageStatus.DELIVERED });
        } catch (e) {
            // ————— error-only telemetry (New Relic) —————
            const err = e as AxiosError<any>;
            const status = err?.response?.status ?? 0;
            const reason =
                (err as any)?.code ||
                (err?.response?.data && (err.response.data.code || err.response.data.error)) ||
                err?.message ||
                'Unknown';

            // 1) Full error to APM (Error Inbox / traces)
            newrelic.noticeError(err, {
                op: 'sendTemplateMessage',
                type: 'WhatsAppTemplateSend',
                templateName,
                caseId,
                userId,
                status,
                toMasked: this.maskPhone(to),
                languageCode,
                appVersion: process.env.APP_VERSION,
                env: process.env.NODE_ENV,
                messageId: savedMessage?.id,
            });

            // 2) Custom event (useful for NRQL alerts)
            newrelic.recordCustomEvent('ApiFailure', {
                type: 'WhatsAppTemplateSend',
                templateName,
                caseId,
                userId,
                status,
                reason,
                toMasked: this.maskPhone(to),
            });

            // 3) Simple counter metric
            newrelic.incrementMetric('Custom/WhatsAppTemplate/Failures', 1);
            // ———————————————————————————————————————————————

            // Mark FAILED in DB
            await this.prisma.message.update({
                where: { id: savedMessage.id },
                data: { systemStatus: SystemMessageStatus.FAILED },
            });

            // ⛔️ removed as requested: no client broadcast on failure
            // if (savedMessage) await this.notifyClients({ ...savedMessage, systemStatus: SystemMessageStatus.FAILED });

            // App log for your eyes
            this.logger.error(
                `Template send failed: template="${templateName}" case=${caseId} user=${userId} status=${status} reason=${reason}`
            );

            // rethrow to upstream handler (global filter / controller)
            throw e;
        }
    }


}