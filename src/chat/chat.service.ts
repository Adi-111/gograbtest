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
import { MachineDetailsDto } from './dto/MachineDetails.dto';


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

    // /**
    //  * @deprecated Use joinCase() for messages and getCaseEvents() for events separately
    //  * Original combined function - commented out for reference
    //  */
    // async joinCaseOriginal(caseId: number, page: number = 1, limit: number = 20) {
    //     try {
    //         if (!caseId || typeof caseId !== 'number') {
    //             throw new Error('Invalid case ID provided');
    //         }

    //         const pageNum = Math.max(1, page);
    //         const limitNum = Math.min(Math.max(1, limit), 100); // Cap at 100
    //         const skip = (pageNum - 1) * limitNum;

    //         const caseExists = await this.prisma.case.findUnique({
    //             where: { id: caseId },
    //             include: { customer: true, user: true },
    //         });

    //         if (!caseExists) {
    //             throw new Error(`Case ${caseId} not found`);
    //         }

    //         // Get total message count for pagination
    //         const totalMessages = await this.prisma.message.count({
    //             where: { caseId },
    //         });

    //         // Fetch paginated messages first
    //         const messages = await this.prisma.message.findMany({
    //             where: { caseId },
    //             include: {
    //                 user: true,
    //                 bot: true,
    //                 WhatsAppCustomer: true,
    //                 media: true,
    //                 location: true,
    //                 interactive: true,
    //                 case: true,
    //             },
    //             orderBy: { timestamp: 'desc' },
    //             skip,
    //             take: limitNum,
    //         });

    //         // Get the timestamp range from the fetched messages for filtering events
    //         let issueEventsRaw = [];
    //         let statusEvents = [];

    //         if (messages.length > 0) {
    //             const timestamps = messages.map(m => m.timestamp);
    //             const minTimestamp = new Date(Math.min(...timestamps.map(t => t.getTime())));
    //             // Use current time as upper bound to include events after the last message
    //             const maxTimestamp = new Date();

    //             // Fetch issue events and status events from minTimestamp onwards (including events after last message)
    //             [issueEventsRaw, statusEvents] = await Promise.all([
    //                 this.prisma.issueEvent.findMany({
    //                     where: {
    //                         caseId,
    //                         status: 'CLOSED',
    //                         closedAt: {
    //                             gte: minTimestamp,
    //                             lte: maxTimestamp,
    //                         },
    //                     },
    //                     orderBy: { closedAt: 'asc' },
    //                 }),
    //                 this.prisma.statusEvent.findMany({
    //                     where: {
    //                         caseId,
    //                         timestamp: {
    //                             gte: minTimestamp,
    //                             lte: maxTimestamp,
    //                         },
    //                     },
    //                     include: { user: true },
    //                     orderBy: { timestamp: 'asc' },
    //                 }),
    //             ]);
    //         }

    //         // Map issue events to include timestamp from closedAt
    //         const issueEvents = issueEventsRaw.map(el => ({
    //             ...el,
    //             timestamp: el.closedAt,
    //         }));

    //         const totalPages = Math.ceil(totalMessages / limitNum);

    //         return {
    //             caseExists,
    //             messages: messages.reverse(),
    //             issueEvents,
    //             statusEvents,
    //             pagination: {
    //                 page: pageNum,
    //                 limit: limitNum,
    //                 totalMessages,
    //                 totalPages,
    //                 hasNextPage: pageNum < totalPages,
    //                 hasPrevPage: pageNum > 1,
    //             },
    //         };
    //     } catch (error) {
    //         const err = error as AxiosError<any>;

    //         const meta = {
    //             caseId,
    //             page,
    //             limit,
    //             env: process.env.NODE_ENV,
    //             appVersion: process.env.APP_VERSION,
    //         };

    //         // Report detailed error to New Relic
    //         newrelic.noticeError(err, meta);

    //         // Custom event for analytics
    //         newrelic.recordCustomEvent("ChatJoinCaseFailure", {
    //             type: "JoinCase",
    //             error: err?.message,
    //             stack: err?.stack,
    //             ...meta,
    //         });

    //         // Increment metric counter
    //         newrelic.incrementMetric("Custom/ChatJoinCase/Failures", 1);

    //         // Log server-side
    //         this.logger.error(`Error joining case ${caseId}: ${error.message}`);
    //         throw error;
    //     }
    // }

    /**
     * Join a case and retrieve paginated messages
     * Frontend should call getCaseEvents() after successfully receiving this data
     */
    async joinCase(caseId: number, page: number = 1, limit: number = 20) {
        try {
            if (!caseId || typeof caseId !== 'number') {
                throw new Error('Invalid case ID provided');
            }

            const pageNum = Math.max(1, page);
            const limitNum = Math.min(Math.max(1, limit), 100); // Cap at 100
            const skip = (pageNum - 1) * limitNum;

            const caseExists = await this.prisma.case.findUnique({
                where: { id: caseId },
                include: { customer: true, user: true },
            });

            if (!caseExists) {
                throw new Error(`Case ${caseId} not found`);
            }

            // Get total message count for pagination
            const totalMessages = await this.prisma.message.count({
                where: { caseId },
            });

            // Fetch paginated messages
            const messages = await this.prisma.message.findMany({
                where: { caseId },
                include: {
                    user: true,
                    bot: true,
                    WhatsAppCustomer: true,
                    media: true,
                    location: true,
                    interactive: true,
                    case: true,
                },
                orderBy: { timestamp: 'desc' },
                skip,
                take: limitNum,
            });

            const totalPages = Math.ceil(totalMessages / limitNum);

            return {
                caseExists,
                messages: messages.reverse(),
                pagination: {
                    page: pageNum,
                    limit: limitNum,
                    totalMessages,
                    totalPages,
                    hasNextPage: pageNum < totalPages,
                    hasPrevPage: pageNum > 1,
                },
            };
        } catch (error) {
            const err = error as AxiosError<any>;

            const meta = {
                caseId,
                page,
                limit,
                env: process.env.NODE_ENV,
                appVersion: process.env.APP_VERSION,
            };

            // Report detailed error to New Relic
            newrelic.noticeError(err, meta);

            // Custom event for analytics
            newrelic.recordCustomEvent("ChatJoinCaseFailure", {
                type: "JoinCase",
                error: err?.message,
                stack: err?.stack,
                ...meta,
            });

            // Increment metric counter
            newrelic.incrementMetric("Custom/ChatJoinCase/Failures", 1);

            // Log server-side
            this.logger.error(`Error joining case ${caseId}: ${error.message}`);
            throw error;
        }
    }

    /**
     * Get case events (issue events and status events) for a case
     * Call this after joinCase() to load events for the timeline/context panel
     * @param caseId - The case ID
     * @param since - Optional: Filter events from this timestamp onwards
     */
    async getCaseEvents(caseId: number, since?: Date) {
        try {
            if (!caseId || typeof caseId !== 'number') {
                throw new Error('Invalid case ID provided');
            }

            // Verify case exists
            const caseExists = await this.prisma.case.findUnique({
                where: { id: caseId },
            });

            if (!caseExists) {
                throw new Error(`Case ${caseId} not found`);
            }

            const whereCondition = since ? {
                gte: since,
                lte: new Date(),
            } : undefined;

            // Fetch issue events and status events in parallel
            const [issueEventsRaw, statusEvents] = await Promise.all([
                this.prisma.issueEvent.findMany({
                    where: {
                        caseId,
                        status: 'CLOSED',
                        ...(whereCondition && { closedAt: whereCondition }),
                    },
                    orderBy: { closedAt: 'asc' },
                }),
                this.prisma.statusEvent.findMany({
                    where: {
                        caseId,
                        ...(whereCondition && { timestamp: whereCondition }),
                    },
                    include: { user: true },
                    orderBy: { timestamp: 'asc' },
                }),
            ]);

            // Map issue events to include timestamp from closedAt
            const issueEvents = issueEventsRaw.map(el => ({
                ...el,
                timestamp: el.closedAt,
            }));

            return {
                issueEvents,
                statusEvents,
            };
        } catch (error) {
            const err = error as AxiosError<any>;

            const meta = {
                caseId,
                since: since?.toISOString(),
                env: process.env.NODE_ENV,
                appVersion: process.env.APP_VERSION,
            };

            // Report detailed error to New Relic
            newrelic.noticeError(err, meta);

            // Custom event for analytics
            newrelic.recordCustomEvent("ChatGetCaseEventsFailure", {
                type: "GetCaseEvents",
                error: err?.message,
                stack: err?.stack,
                ...meta,
            });

            // Increment metric counter
            newrelic.incrementMetric("Custom/ChatGetCaseEvents/Failures", 1);

            // Log server-side
            this.logger.error(`Error getting case events for case ${caseId}: ${error.message}`);
            throw error;
        }
    }
    

    async getChatList(
        payload?: {
            page?: number;
            limit?: number;
            search?: string;
            status?: Status | 'EXPIRED' | 'UNREAD' | '';
            handler?: string;
            tag?: string;
            viewMode?: 'ACTIVE' | 'ALL';
            byUserId?: number; // 👈 added
            userId: number
        }
    ) {
        try {
            const page = payload?.page && Number(payload.page) > 0 ? Number(payload.page) : 1;
            const limit = payload?.limit ? Number(payload.limit) : 50;
            const skip = (page - 1) * limit;

            this.logger.log(`Received chatList request: payload=${JSON.stringify(payload)}`);

            // Build base filters
            const baseWhere: any = {};




            // Search (customer name or phone)
            if (payload?.search) {
                baseWhere.OR = [
                    { customer: { name: { contains: payload.search, mode: 'insensitive' } } },
                    { customer: { phoneNo: { contains: payload.search } } },
                ];
            }

            // Status or EXPIRED
            if (payload?.status === 'EXPIRED') {
                baseWhere.AND = [
                    { timer: { lt: new Date() } },
                    { status: { not: Status.SOLVED } },
                ];
            } else if (payload?.status === 'UNREAD') {
                baseWhere.AND = [
                    { unread: { gt: 0 } },
                    { status: { not: Status.SOLVED } },
                ];
            } else if (payload?.status) {
                baseWhere.status = payload.status;
            } else if (payload?.viewMode === 'ACTIVE') {
                baseWhere.status = {
                    in: [
                        Status.INITIATED,
                        Status.PROCESSING,
                        Status.ASSIGNED,
                        Status.BOT_HANDLING,
                    ],
                };
            }

            // Handler
            if (payload?.handler === 'MY_CHATS' && payload.userId) {
                baseWhere.AND = baseWhere.AND || [];
                baseWhere.AND.push({
                    assignedTo: 'USER',
                    userId: Number(payload.userId),
                });
            } else if (payload?.handler && payload.handler !== 'MY_CHATS') {
                baseWhere.assignedTo = payload.handler;
            }

            if (payload?.byUserId) {
                baseWhere.AND = baseWhere.AND || [];
                baseWhere.AND.push({ userId: Number(payload.byUserId) });
            }

            // Tags
            if (payload?.tag) {
                baseWhere.tags = {
                    some: {
                        text: { contains: payload.tag, mode: 'insensitive' },
                    },
                };
            }


            // -------- counts (no heavy fetch) --------
            const [filteredCount, unreadCaseCount, unreadAgg] = await this.prisma.$transaction([
                this.prisma.case.count({ where: baseWhere }),
                this.prisma.case.count({ where: { ...baseWhere, unread: { gt: 0 } } }),
                this.prisma.case.aggregate({
                    where: baseWhere,
                    _sum: { unread: true },
                }),
            ]);

            // Fetch paginated cases
            const paginatedCases = await this.prisma.case.findMany({
                where: baseWhere,
                skip,
                take: limit,
                include: {
                    tags: true,
                    customer: true,
                    user: true,
                    messages: {
                        orderBy: { timestamp: 'desc' },
                        take: 2,
                    },
                    issueEvents: {
                        select: { closedAt: true },
                        orderBy: { closedAt: 'desc' },
                        take: 1,
                    },
                },
                orderBy: {
                    lastMessageAt: 'desc'
                }
            });


            // If status is EXPIRED, apply additional filtering for last message sender
            let finalCases = paginatedCases;
            let adjustedFilteredCount = filteredCount;

            if (payload?.status === 'EXPIRED') {
                finalCases = paginatedCases.filter((c) => {
                    const validStatus = [
                        Status.ASSIGNED,
                        Status.BOT_HANDLING,
                        Status.INITIATED,
                        Status.PROCESSING,
                        Status.SOLVED,
                        Status.UNSOLVED
                    ].includes(c.status);
                    return validStatus;
                });
                const cases = await this.prisma.case.findMany({
                    where: {
                        ...baseWhere
                    },
                    select: {
                        id: true,
                        status: true,
                        timer: true,
                        updatedAt: true,
                        assignedTo: true,
                        userId: true,
                        unread: true,
                        customerId: true,
                        messages: {
                            orderBy: { timestamp: "desc" },
                            take: 1,
                            select: {
                                id: true,
                                senderType: true,
                                timestamp: true,
                            },
                        },

                    },
                    orderBy: { lastMessageAt: "desc" },
                });

                adjustedFilteredCount = cases.length
            }
            return {
                cases: finalCases,
                currentPage: page,
                totalPages: Math.ceil(adjustedFilteredCount / limit),
                totalCount: adjustedFilteredCount,
                unreadCaseCount: unreadCaseCount,
            };
        } catch (error) {
            const err = error as AxiosError<any>;

            const meta = {
                page: payload?.page,
                limit: payload?.limit,
                search: payload?.search,
                status: payload?.status,
                handler: payload?.handler,
                tag: payload?.tag,
                viewMode: payload?.viewMode,
                byUserId: payload?.byUserId,
                userId: payload?.userId,
                env: process.env.NODE_ENV,
                appVersion: process.env.APP_VERSION,
            };

            // Report detailed error to New Relic
            newrelic.noticeError(err, meta);

            // Custom event for analytics
            newrelic.recordCustomEvent("ChatListFailure", {
                type: "GetChatList",
                error: err?.message,
                stack: err?.stack,
                ...meta,
            });

            // Increment metric counter
            newrelic.incrementMetric("Custom/ChatList/Failures", 1);

            // Log server-side
            this.logger.error('chatList error:', error);
            throw error;
        }
    }

    async getChatInfo(caseId: number) {
        try {
            const caseRecord = await this.prisma.case.findUnique({
                where: { id: caseId },
                select: {
                    customer: { select: { name: true } },
                    unread: true,
                    status: true,
                    assignedTo: true,
                    currentIssueId: true,
                    user: { select: { firstName: true } },
                },
            });

            if (!caseRecord) {
                return null;
            }
            const customer_name = caseRecord.customer.name

            // Determine handler - fetch issue only if needed
            let handler: string;
            if (caseRecord.currentIssueId) {
                const issue = await this.prisma.issueEvent.findUnique({
                    where: { id: caseRecord.currentIssueId },
                    select: { agentCalledAt: true, userId: true },
                });
                if (issue?.agentCalledAt && issue.userId === null) {
                    handler = 'Not Assigned';
                } else if (caseRecord.user) {
                    handler = caseRecord.user.firstName;
                } else {
                    handler = caseRecord.assignedTo;
                }
            } else if (caseRecord.assignedTo === 'BOT') {
                handler = caseRecord.assignedTo;
            } else if (caseRecord.user) {
                handler = caseRecord.user.firstName;
            } else {
                handler = caseRecord.assignedTo;
            }

            return {
                customer_name,
                unread: caseRecord.unread,
                handler,
                status: caseRecord.status
            };
        } catch (error) {
            const err = error as AxiosError<any>;

            const meta = {
                caseId,
                env: process.env.NODE_ENV,
                appVersion: process.env.APP_VERSION,
            };

            newrelic.noticeError(err, meta);
            newrelic.recordCustomEvent("ChatInfoFailure", {
                type: "GetChatInfo",
                error: err?.message,
                stack: err?.stack,
                ...meta,
            });
            newrelic.incrementMetric("Custom/ChatInfo/Failures", 1);

            this.logger.error(`getChatInfo error for case ${caseId}:`, error);
            throw error;
        }
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

    async triggerStatusUpdateBot(caseId: number, status: Status, assignedTo?: CaseHandler) {
        const dummyClient: any = {
            emit: () => { }, // No actual socket needed
        };

        await this.chatGateway.updateContactStatus(dummyClient, {
            caseId,
            status,
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
            if (!createMessageDto.recipient) {
                throw new Error('Missing required message fields');
            }
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
            //transaction query
            const { caseId, messageId } = await this.prisma.$transaction(async (tx) => {
                const caseRec = await tx.case.findUnique({
                    where: {
                        id: createMessageDto.caseId
                    },
                    select: { id: true, customerId: true, currentIssueId: true }
                })
                if (!caseRec) throw new Error("Case not found");
                let issueId = caseRec.currentIssueId;
                // --- Create issueEvent if needed ---
                if (!issueId) {
                    const newIssue = await tx.issueEvent.create({
                        data: {
                            caseId: caseRec.id,
                            customerId: caseRec.customerId,
                        },
                        select: { id: true }
                    });
                    issueId = newIssue.id;
                    await tx.case.update({
                        where: { id: caseRec.id },
                        data: { currentIssueId: issueId }
                    });
                }
                const message = await tx.message.create({
                    data: {
                        ...baseData,
                        case: { connect: { id: createMessageDto.caseId } },
                        ...(createMessageDto.userId && { user: { connect: { id: createMessageDto.userId } } }),
                        ...(createMessageDto.botId && { bot: { connect: { id: createMessageDto.botId } } }),
                        ...(createMessageDto.whatsAppCustomerId && {
                            WhatsAppCustomer: { connect: { id: createMessageDto.whatsAppCustomerId } }
                        }),
                        ...(createMessageDto.mediaId && { media: { connect: { id: createMessageDto.mediaId } } }),
                        ...(createMessageDto.parentMessageId && {
                            parentMessage: { connect: { id: createMessageDto.parentMessageId } }
                        }),
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
                    select: { id: true, caseId: true },
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

                return { messageId: message.id, caseId: message.caseId };
            })
            // ----------------------------
            // STEP 2: Fetch Full Message (Heavy Query)
            // ----------------------------
            const fullMessage: ChatEntity = await this.prisma.message.findUnique({
                where: { id: messageId },
                include: this.fullMessageIncludes()
            });
            if (!fullMessage) {
                throw new Error("Message fetch failed after transaction.");
            }
            await this.notifyClients(fullMessage);
            return fullMessage;


        } catch (error) {
            const err = error as AxiosError<any>;

            const meta = {
                caseId: createMessageDto.caseId,
                userId: createMessageDto.userId,
                botId: createMessageDto.botId,
                recipient: createMessageDto.recipient,
                waMessageId: createMessageDto.waMessageId,
                hasMedia: !!createMessageDto.mediaId,
                hasLocation: !!createMessageDto.location,
                hasInteractive: !!createMessageDto.interactive,
                env: process.env.NODE_ENV,
                appVersion: process.env.APP_VERSION,
            };

            // ----------------------------
            // 1️⃣ Report detailed error to New Relic
            // ----------------------------
            newrelic.noticeError(err, meta);

            // ----------------------------
            // 2️⃣ Custom event for analytics
            // ----------------------------
            newrelic.recordCustomEvent("ChatMessageFailure", {
                type: "CreateMessage",
                error: err?.message,
                stack: err?.stack,
                ...meta,
            });

            // ----------------------------
            // 3️⃣ Increment metric counter
            // ----------------------------
            newrelic.incrementMetric("Custom/ChatMessage/Failures", 1);

            // ----------------------------
            // 4️⃣ Log server-side
            // ----------------------------
            this.logger.error("Failed to create message", err);

            // Re-throw so API returns error
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
        const caseRecord = await this.prisma.case.update({
            where: {
                id: message.caseId
            },
            data: {
                lastMessageAt: new Date()
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
                    this.logger.log('Image Object:', media);

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
                else if (message.type === MessageType.DOCUMENT) {
                    const media = await this.prisma.media.findUnique({
                        where: {
                            id: message.media?.id
                        }
                    });
                    this.logger.log('Doc Object', media);
                    if (media && media.url) {
                        const sanitizedUrl = decodeURIComponent(media.url);
                        if (sanitizedUrl) {
                            this.customerService.sendDocumentToCustomer(phoneNo, sanitizedUrl, media.fileName);
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
                    await this.prisma.case.update({ where: { id: caseId }, data: { lastBotNodeId: 'agent-interactive' } })
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



    async utr(caseId: number) {
        const utrIds = await this.prisma.issueEvent.findMany({
            where: {
                caseId,
                utr: {
                    not: null
                }
            },
            select: {
                utr: true,
                caseId: true,
                id: true,
                orderTime: true
            }
        })

        return utrIds;
    }


    async getMachineDetails() {
        const data: MachineDetailsDto[] = await this.customerService.machineDetails();
        return data
    }


}