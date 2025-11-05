import {
  forwardRef,
  Inject,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  Case,
  CaseHandler,
  IssueEvent,
  IssueEventStatus,
  Media,
  Message,
  MessageType,
  SenderType,
  Status,
  SystemMessageStatus,
} from '@prisma/client';
import { ChatService } from './chat.service';
import { ChatEntity } from './entity/chat.entity';
import { UiEntity } from './entity/ui.entity';
import { CloudService } from 'src/cloud/cloud.service';

import { FailedMessageDto } from './dto/failed-message.dto';

import { updateIssueDto } from './dto/UpdateIssue.DTO';

@WebSocketGateway({
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    pingInterval: 10000,
    pingTimeout: 5000,
  },
  transports: ['websocket', 'polling'],
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  private activeRooms = new Map<number, Set<string>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly cloudService: CloudService,
  ) {

  }

  onModuleInit(): void {
    this.logger.log('WebSocket Gateway initialized');
  }

  // Returns a standardized room name for a case.
  private getRoomName(caseId: number): string {
    return `case_${caseId}`;
  }

  // Track connections per case for efficient broadcasting.
  private trackConnection(client: Socket, caseId: number): void {
    if (!this.activeRooms.has(caseId)) {
      this.activeRooms.set(caseId, new Set());
    }
    this.activeRooms.get(caseId)?.add(client.id);
  }

  // Cleanup client connections.
  private cleanupConnection(client: Socket): void {
    this.activeRooms.forEach((clients, caseId) => {
      clients.delete(client.id);
      if (clients.size === 0) this.activeRooms.delete(caseId);
    });
  }

  // Standardized error emitter.
  private emitError(client: Socket, event: string, error: any): void {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    this.logger.error(`${event} error: ${errorMessage}`);
    client.emit('error', { event, message: errorMessage });
  }


  async handleConnection(client: Socket): Promise<void> {
    try {
      await client.join(UiEntity.ChatList);
      this.logger.log(`Client connected: ${client.id}`);
    } catch (error) {
      this.logger.error(`Connection error for client ${client.id}: ${error}`);
    }
  }


  async handleDisconnect(client: Socket): Promise<void> {
    try {
      this.logger.log(`Client disconnected: ${client.id}`);
      this.cleanupConnection(client);
    } catch (error) {
      this.logger.error(`Disconnect error for client ${client.id}: ${error}`);
    }
  }


  @SubscribeMessage('new-case')
  broadcastNewCase(newCase: Case): void {
    try {
      this.logger.log(`Broadcasting new case: ${newCase.id}`);
      // Emit the "new-case" event to all clients in the ChatList room.
      this.server.to(UiEntity.ChatList).emit('new-case', newCase);
    } catch (error) {
      this.logger.error(`Error broadcasting new case: ${error}`);
    }
  }

  private sendFilteredCount(client: Socket, totalCount: number, unreadCount: number) {
    client.emit('filteredCount', { totalCount, unreadCount });
  }


  @SubscribeMessage('chatList')
  async handleChatList(
    client: Socket,
    payload?: {
      page?: number;
      limit?: number;
      search?: string;
      status?: Status | 'EXPIRED' | 'UNREAD' | '';
      handler?: string;
      tag?: string;
      viewMode?: 'ACTIVE' | 'ALL';
      byUserId?: number; // 👈 added
    }
  ) {
    try {

      const page = payload?.page && payload.page > 0 ? payload.page : 1;
      const limit = payload?.limit ?? 50;
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
      if (payload?.handler === 'MY_CHATS' && client.data.userId) {
        baseWhere.AND = baseWhere.AND || [];
        baseWhere.AND.push({
          assignedTo: 'USER',
          userId: client.data.userId,
        });
      } else if (payload?.handler && payload.handler !== 'MY_CHATS') {
        baseWhere.assignedTo = payload.handler;
      }

      if (payload?.byUserId) {
        baseWhere.AND = baseWhere.AND || [];
        baseWhere.AND.push({ userId: payload.byUserId });
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
      paginatedCases.sort((a, b) => {
        // If both cases are solved, sort by closedAt descending
        if (a.status === 'SOLVED' && b.status === 'SOLVED') {
          const aClosed = a.issueEvents[0]?.closedAt ? new Date(a.issueEvents[0].closedAt).getTime() : 0;
          const bClosed = b.issueEvents[0]?.closedAt ? new Date(b.issueEvents[0].closedAt).getTime() : 0;
          return bClosed - aClosed;
        }

        // // If only one is solved, keep solved ones on top (optional)
        // if (a.status === 'SOLVED' && b.status !== 'SOLVED') return -1;
        // if (a.status !== 'SOLVED' && b.status === 'SOLVED') return 1;

        // For all other cases, keep original order
        return 0;
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




      this.sendFilteredCount(client, adjustedFilteredCount, unreadCaseCount);


      // Emit result
      client.emit(UiEntity.render, {
        cases: finalCases,
        currentPage: page,
        totalPages: Math.ceil(adjustedFilteredCount / limit),
      });
    } catch (error) {
      this.logger.error('chatList error:', error);
      client.emit('error', { message: 'Internal server error. Please try again.' });
    }
  }


  @SubscribeMessage('join-case')
  async handleJoinCase(client: Socket, payload: { caseId: number }): Promise<void> {
    const { caseId } = payload;
    try {
      if (!caseId || typeof caseId !== 'number') throw new Error('Invalid case ID provided');

      const caseExists = await this.prisma.case.findUnique({
        where: { id: caseId },
        include: { customer: true, user: true },
      });
      if (!caseExists) throw new Error(`Case ${caseId} not found`);

      const room = this.getRoomName(caseId);
      await client.join(room);
      this.trackConnection(client, caseId);
      this.logger.log(`Client ${client.id} joined case ${caseId}`);
      client.emit('join-success', { caseExists });


      // Emit the latest 50 messages as the initial page.
      const messages: Message[] = await this.prisma.message.findMany({
        where: { caseId },
        include: {
          user: true,
          bot: true,
          WhatsAppCustomer: true,
          media: true,
          location: true,
          interactive: true,
          case: true
        },
        orderBy: { timestamp: 'desc' },
        take: 100,
      });
      client.emit('message-history', messages.reverse());
    } catch (error) {
      this.emitError(client, 'join-case', error);
    }
  }


  @SubscribeMessage('new-message')
  async handleNewMessage(
    client: Socket,
    payload: {
      userId: number;
      caseId: number;
      text?: string;
      senderType: SenderType;
      messageType?: MessageType;
      attachments?: {
        url: string,
        type: string,
      };
    }
  ): Promise<void> {
    try {
      const { caseId, text, messageType, attachments } = payload;

      // Validate required fields.
      if (!caseId || !payload.userId) {
        throw new Error('Missing required caseId or userId');
      }
      if (
        !text &&
        (!attachments ||
          (!attachments.url &&
            !attachments.type))
      ) {
        throw new Error('Message must contain text or valid attachments');
      }

      // Validate case existence and customer association.
      const caseRecord = await this.prisma.case.findUnique({
        where: { id: caseId },
        include: { customer: true, user: true },
      });
      if (!caseRecord) {
        throw new Error('Invalid case ID');
      }
      if (!caseRecord.customer) {
        throw new Error('Case does not have an associated customer');
      }
      const newCase = await this.prisma.case.update({
        where: {
          id: caseId
        },
        data: {
          assignedTo: "USER",
          unread: 0,
          user: { connect: { id: payload.userId } }
        },
        select: {
          user: true,
          currentIssueId: true
        }
      })
      let currIssueId = newCase.currentIssueId;
      if (!newCase.currentIssueId) {
        const issueNew = await this.prisma.issueEvent.create({
          data: {
            caseId: caseId,
            customerId: caseRecord.customerId
          }
        })
        await this.prisma.case.update({
          where: {
            id: caseId
          },
          data: {
            currentIssueId: issueNew.id
          }
        })
        currIssueId = issueNew.id
      }
      await this.prisma.issueEvent.update({
        where: {
          id: currIssueId
        },
        data: {
          agentLinkedAt: new Date(),
          userId: payload.userId
        }
      })
      if (!newCase.user) {
        throw new Error('Case does not have an associated agent');
      }

      let mediaId: number;
      if (messageType === MessageType.IMAGE) {

        this.logger.log(`Cloud URL: ${attachments?.url}`);

        const media: Media = await this.prisma.media.create({
          data: {
            url: attachments?.url,
            mimeType: 'image/jpeg'
          }
        })
        this.logger.log(media);

        mediaId = media.id;
      }
      else if (messageType === MessageType.DOCUMENT) {
        this.logger.log(`Cloud URL: ${attachments?.url}`);
        const dest = this.cloudService.extractDestination(attachments?.url)
        const media: Media = await this.prisma.media.create({
          data: {
            url: attachments?.url,
            mimeType: 'application/pdf',
            fileName: dest
          }
        })
        this.logger.log(media);
        mediaId = media.id;
      }

      // Construct the message object.
      const messagePayload = {
        text,
        type: messageType,
        senderType: SenderType.USER, // Force USER type for now; adjust as needed.
        systemStatus: SystemMessageStatus.SENT,
        recipient: caseRecord.customer.phoneNo,
        caseId,
        userId: payload.userId,
        whatsAppCustomerId: caseRecord.customerId,
        whatsAppCustomer: caseRecord.customer,
        mediaId,
      };
      const newMessage = await this.chatService.createMessage(messagePayload);
      // Update case list for all connected clients.
      this.server.emit('case-update', {
        id: caseId,
        lastMessage: this.formatPreview(newMessage),
        updatedAt: new Date(),
      });
    } catch (error) {
      this.emitError(client, 'new-message', error);
    }
  }


  @SubscribeMessage('get-message-page')
  async handleGetMessagePage(
    client: Socket,
    payload: { caseId: number; page: number; pageSize: number },
  ): Promise<void> {
    try {
      const { caseId, page, pageSize } = payload;
      if (!caseId || page < 1 || pageSize < 1) throw new Error('Invalid pagination parameters');

      // Calculate skip count for pagination.
      const skip = (page - 1) * pageSize;

      const messages: Message[] = await this.prisma.message.findMany({
        where: { caseId },
        include: {
          user: true,
          bot: true,
          WhatsAppCustomer: true,
          media: true,
          location: true,
          interactive: true,
        },
        orderBy: { timestamp: 'desc' },
        skip,
        take: pageSize,
      });
      // Send messages in chronological order.
      client.emit('message-page', { messages: messages.reverse(), page, pageSize });
    } catch (error) {
      this.emitError(client, 'get-message-page', error);
    }
  }

  /* ========================================================
     Contact & Chat Info Handlers
  ======================================================== */

  @SubscribeMessage('get-contacts')
  async handleContacts(client: Socket, payload: { caseId: number }): Promise<void> {
    try {
      const { caseId } = payload;
      const contacts = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: { tags: true, customer: true, user: true, status: true, assignedTo: true, notes: true },
      });
      client.emit('contacts-list', contacts);
    } catch (error) {
      this.emitError(client, 'get-contacts', error);
    }
  }



  @SubscribeMessage('update-contact-note')
  async updateContactNote(
    client: Socket,
    payload: { noteId: number; caseId: number; text: string },
  ): Promise<void> {
    try {
      const { noteId, caseId, text } = payload;

      // Update the note text
      await this.prisma.note.update({
        where: { id: noteId },
        data: { text },
      });

      // Get updated case with all notes
      const updatedContact = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          tags: true,
          customer: true,
          user: true,
          status: true,
          assignedTo: true,
          notes: {
            include: {
              user: true,
              case: true

            },
          },
        },
      });

      this.server.to(`case-${caseId}`).emit('contact-updated', updatedContact);
    } catch (error) {
      this.emitError(client, 'update-contact-note', error);
    }
  }

  @SubscribeMessage("updateIssue")
  async handleEvent(client: Socket, payload: updateIssueDto) {
    const {
      caseId,
      userId,
      status,        // Case-level status
      machineDetails,
      issueType,
      refundMode,
      refundAmount,
      notes,
      falsePositive,
      coil
    } = payload;

    // 1) Get active issue for this case
    const kase = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { currentIssueId: true, status: true },
    });

    if (!kase) {
      throw new WsException("Active issue not found for this case.");
    }
    const issueId = kase.currentIssueId;

    // 2) Validate refund fields
    if (issueType === "REFUND") {
      if (!refundMode) {
        throw new WsException("refundMode is required for REFUND issues.");
      }
      if (refundMode === "MANUAL") {
        const amt = Number(refundAmount);
        if (!refundAmount || Number.isNaN(amt) || amt <= 0) {
          throw new WsException(
            "A valid positive refundAmount is required for MANUAL refunds."
          );
        }
      }
    }

    // Store amounts as minor units (e.g., paise)
    const refundAmountMinor =
      issueType === "REFUND" && refundMode === "MANUAL"
        ? Math.round(Number(refundAmount))
        : null;

    const coilNumber =
      issueType === "REFUND" && refundMode === "MANUAL"
        ? Number(coil)
        : null;

    // 3) Persist atomically
    const [updatedIssue, updatedCase] = await this.prisma.$transaction([
      this.prisma.issueEvent.update({
        where: { id: issueId },
        data: {
          status: IssueEventStatus.CLOSED, // close the issue
          isActive: false,
          closedAt: new Date(),
          endTimeAt: new Date(),
          userId,
          // domain fields
          machine_id: machineDetails.machine.machine_id ?? null,
          machineName: machineDetails?.machine?.machine_name ?? null,
          issueType,
          refundMode: issueType === "REFUND" ? refundMode : null,
          refundAmountMinor: refundAmountMinor,
          resolutionNotes: notes ?? null,
          falsePositive: refundMode === "MANUAL" ? falsePositive : null,
          coil: coilNumber,
        },

      }),

      // Update the parent Case status (if that's your desired flow)
      this.prisma.case.update({
        where: { id: caseId },
        data: {
          status, // expects Case.status to be the same `Status` enum you passed
          // Optionally unlink the currentIssueId since it's closed:
          // direct solving without messaging
          // user: {
          //   connect: {
          //     id: userId
          //   }
          // },
          currentIssueId: null,
          updatedAt: new Date(),
        },
        select: { id: true, status: true },
      }),
    ]);
    const dCase = await this.prisma.case.findUnique({
      where: {
        id: caseId
      },
      include: {
        customer: true,
        messages: true,
        notes: true,
        user: true
      }

    })
    await this.recordStatusChange(caseId, userId, kase.status, dCase.status);

    const updatedEvents = await this.prisma.statusEvent.findMany({
      where: { caseId },
      include: { user: true },
      orderBy: { timestamp: 'desc' },
    });
    const updatedIssueEvents = await this.prisma.issueEvent.findMany({
      where: {
        caseId,
        status: 'CLOSED',
      },
      orderBy: { closedAt: 'desc' }
    })


    client.emit('status-events', updatedEvents);
    client.emit('issue-events', updatedIssueEvents);

    const baseChatInfo = {
      id: dCase.id,
      customerName: dCase.customer.name,
      messages: dCase.messages,
      status: dCase.status,
      unread: dCase.unread,
      notes: dCase.notes,
    };
    let issue: IssueEvent
    if (dCase.currentIssueId) {
      issue = await this.prisma.issueEvent.findUnique({
        where: {
          id: dCase.currentIssueId
        }
      })
    }
    let handlerInfo = String(dCase.assignedTo);
    if (issue && issue.agentCalledAt && issue.userId === null) {
      handlerInfo = 'Not Assigned'
    }
    else if (dCase.user && dCase.assignedTo === 'USER') {
      handlerInfo = dCase.user.firstName;
    }
    else {
      handlerInfo = dCase.assignedTo;
    }

    const chatInfo =
    {
      ...baseChatInfo,
      handler: String(handlerInfo),
      img: dCase.customer.profileImageUrl,
    };

    client.emit('chat-info-response', chatInfo);
    this.logger.debug(
      `Sent chat-info-response (user path) ${{ caseId }}`,
    );

    // 4) Optionally notify room/subscribers
    // this.server.to(`case:${caseId}`).emit("issue-updated", {
    //   issue: updatedIssue,
    //   case: updatedCase,
    // });

    return { ok: true, issue: updatedIssue, case: updatedCase };
  }



  @SubscribeMessage('update-contact-status')
  async updateContactStatus(
    client: Socket,
    payload: { caseId: number; status: Status; userId?: number; assignedTo?: CaseHandler },
  ): Promise<void> {
    // ---- request-scoped tracing context
    const reqId = Math.random().toString(36).slice(2, 10);
    const startedAt = Date.now();

    const logCtx = (extra?: Record<string, unknown>) =>
      JSON.stringify({
        reqId,
        ...extra,
      });

    try {
      const { caseId, status, userId, assignedTo } = payload;
      this.logger.log(
        `update-contact-status: received ${logCtx({ payload: { caseId, status, userId, assignedTo } })}`,
      );

      // ---- fetch case
      const caseRecord = await this.prisma.case.findUnique({
        where: { id: payload.caseId },
        select: { status: true, currentIssueId: true, customerId: true, user: true, assignedTo: true },
      });

      if (!caseRecord) {
        this.logger.warn(
          `update-contact-status: case not found ${logCtx({ caseId })}`,
        );
        throw new Error('Case not found');
      }

      this.logger.debug(
        `Loaded case ${logCtx({
          caseId,
          customerId: caseRecord.customerId,
          prevStatus: caseRecord.status,
          currentIssueId: caseRecord.currentIssueId,
        })}`,
      );

      // =========================
      // BOT / NO-USER PATH
      // =========================
      if (!userId) {
        this.logger.debug(
          `No userId provided → treating as bot/automated transition ${logCtx({
            caseId,
            status,
            assignedTo,
          })}`,
        );

        if (assignedTo === 'USER') {
          if (caseRecord.currentIssueId == null) {
            this.logger.warn(
              `assignedTo=USER but currentIssueId is null; skipping agentCalledAt update ${logCtx(
                { caseId },
              )}`,
            );
          } else {
            await this.prisma.issueEvent.update({
              where: { id: caseRecord.currentIssueId },
              data: { agentCalledAt: new Date() },
            });
            this.logger.debug(
              `issueEvent.agentCalledAt set ${logCtx({
                issueId: caseRecord.currentIssueId,
              })}`,
            );
          }
        }

        // if case moved to active processing/init, ensure issue linkage
        if (status === 'PROCESSING' || status === 'INITIATED') {
          if (caseRecord.currentIssueId == null) {
            const issue = await this.prisma.issueEvent.create({
              data: {
                caseId,
                customerId: caseRecord.customerId,
                userId: null,
              },
            });
            this.logger.debug(
              `Created new issue for bot path ${logCtx({
                caseId,
                issueId: issue.id,
              })}`,
            );

            await this.prisma.case.update({
              where: { id: caseId },
              data: { currentIssueId: issue.id },
            });
            this.logger.debug(
              `Linked case.currentIssueId ${logCtx({
                caseId,
                issueId: issue.id,
              })}`,
            );
          } else {
            await this.prisma.issueEvent.update({
              where: { id: caseRecord.currentIssueId },
              data: {
                userId: null,
                agentLinkedAt: new Date(),
                isActive: true,
              },
            });
            this.logger.debug(
              `Updated existing issue (bot path) ${logCtx({
                issueId: caseRecord.currentIssueId,
              })}`,
            );
          }
        }

        const updatedCase = await this.prisma.case.update({
          where: { id: caseId },
          data: { status, lastBotNodeId: null, ...(assignedTo && { assignedTo }) },
          select: {
            id: true,
            assignedTo: true,
            tags: true,
            customer: true,
            user: true,
            status: true,
            messages: { orderBy: { timestamp: 'desc' }, take: 1 },
            unread: true,
            notes: { include: { user: true } },
          },
        });
        this.logger.debug(
          `Case updated (bot path) ${logCtx({
            caseId,
            newStatus: updatedCase.status,
            assignedTo: updatedCase.assignedTo,
          })}`,
        );

        await this.recordStatusChange(caseId, null, caseRecord.status, status);
        this.logger.debug(
          `recordStatusChange completed (bot path) ${logCtx({
            caseId,
            from: caseRecord.status,
            to: status,
          })}`,
        );

        const updatedEvents = await this.prisma.statusEvent.findMany({
          where: { caseId },
          include: { user: true },
          orderBy: { timestamp: 'asc' },
        });
        this.logger.debug(
          `Fetched status events (bot path) ${logCtx({
            caseId,
            events: updatedEvents.length,
          })}`,
        );

        client.emit('status-events', updatedEvents);
        this.server.to(`case-${caseId}`).emit('status-events', updatedEvents);
        this.server.to(`case-${caseId}`).emit('contact-updated', updatedCase);
        this.logger.log(
          `Emitted updates to room case-${caseId} (bot path) ${logCtx({
            caseId,
          })}`,
        );

        const baseChatInfo = {
          id: updatedCase.id,
          customerName: updatedCase.customer.name,
          messages: updatedCase.messages,
          status: updatedCase.status,
          unread: updatedCase.unread,
          notes: updatedCase.notes,
        };
        const issue = await this.prisma.issueEvent.findUnique({
          where: {
            id: caseRecord.currentIssueId
          }
        })
        let handlerInfo = String(caseRecord.assignedTo);
        if (issue && issue.agentCalledAt && issue.userId === null) {
          handlerInfo = 'Not Assigned'
        }
        else if (caseRecord.user && caseRecord.assignedTo === 'USER') {
          handlerInfo = caseRecord.user.firstName;
        }
        else {
          handlerInfo = caseRecord.assignedTo
        }
        const chatInfo =
        {
          ...baseChatInfo,
          handler: String(handlerInfo),
          img: updatedCase.customer.profileImageUrl,
        };

        client.emit('chat-info-response', chatInfo);
        this.logger.debug(
          `Sent chat-info-response (bot path) ${logCtx({ caseId })}`,
        );

        this.logger.log(
          `update-contact-status completed (bot path) ${logCtx({
            caseId,
            durationMs: Date.now() - startedAt,
          })}`,
        );
        return; // bot path ends here
      }

      // =========================
      // USER / AGENT PATH
      // =========================
      if (assignedTo === 'USER') {
        if (caseRecord.currentIssueId == null) {
          this.logger.warn(
            `assignedTo=USER but currentIssueId is null; skipping agentCalledAt update ${logCtx(
              { caseId },
            )}`,
          );
        } else {
          await this.prisma.issueEvent.update({
            where: { id: caseRecord.currentIssueId },
            data: { agentCalledAt: new Date() },
          });
          this.logger.debug(
            `issueEvent.agentCalledAt set ${logCtx({
              issueId: caseRecord.currentIssueId,
            })}`,
          );
        }
      }

      if (status === 'PROCESSING' || status === 'INITIATED') {
        if (caseRecord.currentIssueId == null) {
          const issue = await this.prisma.issueEvent.create({
            data: {
              caseId,
              customerId: caseRecord.customerId,
              userId: userId,
            },
          });
          this.logger.debug(
            `Created new issue (user path) ${logCtx({ caseId, issueId: issue.id })}`,
          );

          await this.prisma.case.update({
            where: { id: caseId },
            data: { currentIssueId: issue.id },
          });
          this.logger.debug(
            `Linked case.currentIssueId (user path) ${logCtx({
              caseId,
              issueId: issue.id,
            })}`,
          );
        } else {
          await this.prisma.issueEvent.update({
            where: { id: caseRecord.currentIssueId },
            data: {
              userId: userId,
              agentLinkedAt: new Date(),
              isActive: true,
            },
          });
          this.logger.debug(
            `Updated existing issue (user path) ${logCtx({
              issueId: caseRecord.currentIssueId,
            })}`,
          );
        }
      }






      const updatedCase = await this.prisma.case.update({
        where: { id: caseId },
        data: { status, lastBotNodeId: null, ...(assignedTo && { assignedTo }) },
        select: {
          id: true,
          assignedTo: true,
          tags: true,
          customer: true,
          user: true,
          status: true,
          messages: { orderBy: { timestamp: 'desc' }, take: 1 },
          unread: true,
          notes: { include: { user: true } },
        },
      });
      this.logger.debug(
        `Case updated (user path) ${logCtx({
          caseId,
          newStatus: updatedCase.status,
          assignedTo: updatedCase.assignedTo,
        })}`,
      );

      await this.recordStatusChange(caseId, userId, caseRecord.status, status);
      this.logger.debug(
        `recordStatusChange completed (user path) ${logCtx({
          caseId,
          from: caseRecord.status,
          to: status,
        })}`,
      );

      const updatedEvents = await this.prisma.statusEvent.findMany({
        where: { caseId },
        include: { user: true },
        orderBy: { timestamp: 'asc' },
      });
      this.logger.debug(
        `Fetched status events (user path) ${logCtx({
          caseId,
          events: updatedEvents.length,
        })}`,
      );

      client.emit('status-events', updatedEvents);
      this.server.to(`case-${caseId}`).emit('status-events', updatedEvents);
      this.server.to(`case-${caseId}`).emit('contact-updated', updatedCase);
      this.logger.log(
        `Emitted updates to room case-${caseId} (user path) ${logCtx({ caseId })}`,
      );

      const baseChatInfo = {
        id: updatedCase.id,
        customerName: updatedCase.customer.name,
        messages: updatedCase.messages,
        status: updatedCase.status,
        unread: updatedCase.unread,
        notes: updatedCase.notes,
      };
      // let handlerInfo = String(caseRecord.assignedTo);
      // if (issue && issue.agentCalledAt && issue.userId === null) {
      //   handlerInfo = 'Not Assigned'
      // }
      // else if (caseRecord.user && caseRecord.assignedTo === 'USER') {
      //   handlerInfo = caseRecord.user.firstName;
      // }
      // else {
      //   handlerInfo = caseRecord.assignedTo
      // }
      // const chatInfo =
      // {
      //   ...baseChatInfo,
      //   handler: String(handlerInfo),
      //   img: caseRecord.customer.profileImageUrl,
      // };
      let issue: IssueEvent;
      if (caseRecord.currentIssueId) { issue = await this.prisma.issueEvent.findUnique({ where: { id: caseRecord.currentIssueId } }) }
      let handlerInfo = String(CaseHandler);
      if (issue && issue.agentCalledAt && issue.userId === null) {
        handlerInfo = 'Not Assigned'
      }
      else if (caseRecord.user && caseRecord.assignedTo === 'USER') {
        handlerInfo = caseRecord.user.firstName;
      }
      else {
        handlerInfo = caseRecord.assignedTo;
      }
      const chatInfo =
        updatedCase.assignedTo === CaseHandler.USER
          ? { ...baseChatInfo, handler: `${updatedCase.user.firstName}` }
          : {
            ...baseChatInfo,
            handler: String(handlerInfo),
            img: updatedCase.customer.profileImageUrl,
          };
      client.emit('chat-info-response', chatInfo);
      this.logger.debug(
        `Sent chat-info-response (user path) ${logCtx({ caseId })}`,
      );

      this.logger.log(
        `update-contact-status completed (user path) ${logCtx({
          caseId,
          durationMs: Date.now() - startedAt,
        })}`,
      );
    } catch (error: any) {
      // ---- error logging with full context & stack
      this.logger.error(
        `update-contact-status failed ${JSON.stringify({
          reqId,
          message: error?.message,
        })}`,
        error?.stack,
      );

      try {
        this.emitError(client, 'update-contact-status', error);
      } catch (emitErr: any) {
        this.logger.error(
          `emitError failed ${JSON.stringify({
            reqId,
            message: emitErr?.message,
          })}`,
          emitErr?.stack,
        );
      }
    }
  }
  async handleUpdateContactStatus(
    caseId: number,
    status: Status,
    userId: number,
  ): Promise<any> {
    const caseRecord = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { status: true },
    });
    if (!caseRecord) throw new Error('Case not found');

    const updatedCase = await this.prisma.case.update({
      where: { id: caseId },
      data: { status, lastBotNodeId: null },
      select: {
        id: true,
        assignedTo: true,
        tags: true,
        customer: true,
        user: true,
        status: true,
        messages: { orderBy: { timestamp: 'desc' }, take: 1 },
        unread: true,
        notes: {
          include: { user: true }
        },
      },
    });

    await this.recordStatusChange(caseId, userId, caseRecord.status, status);
    const updatedEvents = await this.prisma.statusEvent.findMany({
      where: { caseId },
      include: { user: true },
      orderBy: { timestamp: 'asc' },
    });

    return { updatedCase, updatedEvents };
  }

  @SubscribeMessage('get-issue-events')
  async handleGetIssueEvents(client: Socket, payload: { caseId: number }) {
    try {
      const events = await this.prisma.issueEvent.findMany({
        where: {
          caseId: payload.caseId,
          status: "CLOSED",
        }
      })
      const editedEvents = events.map(el => ({
        ...el,
        timestamp: el.closedAt
      }));
      this.logger.log(JSON.stringify(editedEvents))
      client.emit('issue-events', editedEvents)
    } catch (error) {
      this.emitError(client, 'get-issue-events', error);
    }
  }


  @SubscribeMessage('get-status-events')
  async handleGetStatusEvents(client: Socket, payload: { caseId: number }) {
    try {
      const events = await this.prisma.statusEvent.findMany({
        where: { caseId: payload.caseId },
        include: { user: true },
        orderBy: { timestamp: 'asc' },
      });
      client.emit('status-events', events);
    } catch (error) {
      this.emitError(client, 'get-status-events', error);
    }
  }
  @SubscribeMessage('get-msg-status')
  async handleGetMsgStatusEvents(client: Socket, payload: { caseId: number }) {
    try {
      const events = await this.prisma.failedMsgEvent.findMany({
        where: { caseId: payload.caseId },
        include: { user: true },
        orderBy: { timestamp: 'desc' }
      });
      client.emit('failed-msg', events);
    } catch (error) {
      this.emitError(client, 'get-msg-status', error);
    }
  }




  @SubscribeMessage('update-contact-tags')
  async updateContactTags(
    client: Socket,
    payload: { caseId: number; userId: number; tags: string[] },
  ): Promise<void> {
    try {
      const { caseId, userId, tags } = payload;
      if (!caseId || !Array.isArray(tags)) throw new Error('Invalid payload');

      const normalized = tags
        .filter(t => typeof t === 'string')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean);

      // Get existing tags
      const existingTags = await this.prisma.tag.findMany({
        where: { text: { in: normalized } },
      });

      const existingTagMap = new Map(existingTags.map(t => [t.text, t.id]));

      // Tags that need to be created
      const toCreate = normalized.filter(text => !existingTagMap.has(text));

      const newTags = await Promise.all(
        toCreate.map(text =>
          this.prisma.tag.create({
            data: {
              text,
              user: { connect: { id: userId } }, // 🔁 Replace with real userId if needed
            },
          })
        )
      );

      const allTagIds = [
        ...existingTags.map(t => ({ id: t.id })),
        ...newTags.map(t => ({ id: t.id })),
      ];

      // Update case
      const updated = await this.prisma.case.update({
        where: { id: caseId },
        data: {
          tags: { set: allTagIds },
        },
        select: {
          id: true,
          tags: true,
          assignedTo: true,
          customer: true,
          user: true,
          status: true,
          notes: true,
        },
      });

      this.server.to(`case-${caseId}`).emit('contact-updated', updated);
    } catch (error) {
      this.emitError(client, 'update-contact-tags', error);
    }
  }

  @SubscribeMessage('update-contact-assigned')
  async updateContactAssignedTo(
    client: Socket,
    payload: { caseId: number; assignedTo: CaseHandler },
  ): Promise<void> {
    try {
      const { caseId, assignedTo } = payload;
      const updatedContact = await this.prisma.case.update({
        where: { id: caseId },
        data: { assignedTo },
        select: {
          id: true,
          tags: true,
          customer: true,
          user: true,
          status: true,
          assignedTo: true,
          notes: {
            include: {
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true
                }
              },
              case: true
            }
          },
        },
      });

      this.server.to(`case-${caseId}`).emit('contact-updated', updatedContact);
    } catch (error) {
      this.emitError(client, 'update-contact-assigned', error);
    }
  }

  @SubscribeMessage('add-contact-note')
  async addContactNote(
    client: Socket,
    payload: { caseId: number; text: string; userId: number },
  ): Promise<void> {
    try {
      const { caseId, text, userId } = payload;
      const newNote = await this.prisma.note.create({
        data: {
          caseId,
          userId,
          text,
        },
      });

      const updatedContact = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          tags: true,
          customer: true,
          user: true,
          status: true,
          assignedTo: true,
          notes: {
            include: {
              user: {
                select: { firstName: true, lastName: true, id: true, email: true },
              },
            },
          },
        },

      });

      this.server.to(`case-${caseId}`).emit('contact-updated', updatedContact);
    } catch (error) {
      this.emitError(client, 'add-contact-note', error);
    }
  }
  @SubscribeMessage('remove-contact-note')
  async removeContactNote(
    client: Socket,
    payload: { noteId: number; caseId: number },
  ): Promise<void> {
    try {
      const { noteId, caseId } = payload;

      // Delete the specific note
      await this.prisma.note.delete({
        where: { id: noteId },
      });

      // Fetch updated contact info with notes
      const updatedContact = await this.prisma.case.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          tags: true,
          customer: true,
          user: true,
          status: true,
          assignedTo: true,
          notes: {
            include: {
              user: {
                select: { firstName: true, lastName: true, id: true, email: true },
              },
            },
          },
        },
      });

      // Emit updated contact
      this.server.to(`case-${caseId}`).emit('contact-updated', updatedContact);
    } catch (error) {
      this.emitError(client, 'remove-contact-note', error);
    }
  }




  @SubscribeMessage('chat-info')
  async handleChatInfo(client: Socket, payload: { caseId: number }): Promise<void> {
    try {
      const caseRecord = await this.prisma.case.findUnique({
        where: { id: payload.caseId },
        include: {
          user: true,
          customer: true,
          messages: { orderBy: { timestamp: 'desc' }, take: 1 },
        },
      });
      if (!caseRecord) throw new Error('Case not found');
      const baseChatInfo = {
        id: caseRecord.id,
        customerName: caseRecord.customer.name,
        messages: caseRecord.messages,
        status: caseRecord.status,
        unread: caseRecord.unread,
      };
      let issue: IssueEvent
      if (caseRecord.currentIssueId) {
        issue = await this.prisma.issueEvent.findUnique({
          where: {
            id: caseRecord.currentIssueId
          }
        })
      }
      let handlerInfo = String(caseRecord.assignedTo);
      if (issue && issue.agentCalledAt && issue.userId === null) {
        handlerInfo = 'Not Assigned'
      }
      else if (caseRecord.assignedTo === 'BOT' && caseRecord.status === 'INITIATED') {
        handlerInfo = caseRecord.assignedTo
      }
      else if (caseRecord.user) {
        handlerInfo = caseRecord.user.firstName;
      }
      else {
        handlerInfo = caseRecord.assignedTo
      }
      const chatInfo =
      {
        ...baseChatInfo,
        handler: String(handlerInfo),
        img: caseRecord.customer.profileImageUrl,
      };
      client.emit('chat-info-response', chatInfo);
    } catch (error) {
      this.emitError(client, 'chat-info', error);
    }
  }


  private formatPreview(message: ChatEntity): { text: string; type: MessageType; sender: string; timestamp: Date } {
    const senderInfo = this.getSenderInfo(message);
    return {
      text: message.text,
      type: message.type,
      sender: senderInfo.name || 'Unknown',
      timestamp: message.timestamp,
    };
  }


  private getSenderInfo(message: ChatEntity): { type: string; id?: number; name?: string; phone?: string } {
    switch (message.senderType) {
      case SenderType.USER:
        return {
          type: 'user',
          id: message.user?.id,
          name: `${message.user?.firstName || ''} ${message.user?.lastName || ''}`.trim(),
        };
      case SenderType.BOT:
        return { type: 'bot', id: 1, name: 'Grabbit' };
      case SenderType.CUSTOMER:
        return {
          type: 'customer',
          id: message.WhatsAppCustomer?.id,
          name: message.WhatsAppCustomer?.name,
          phone: message.WhatsAppCustomer?.phoneNo,
        };
      default:
        return { type: 'unknown' };
    }
  }

  // Broadcast message status, WhatsApp, and bot messages to the relevant room.
  handleMessageStatusUpdate(message: ChatEntity): void {
    const room = this.getRoomName(message.caseId);
    this.server.to(room).emit('message-status-update', message);
  }
  @SubscribeMessage('quick-msg-gtw')
  async handleQuickMessage(client: Socket, payload: { userId: number, caseId: number, quickMessageId: number }): Promise<void> {
    try {
      const { quickMessageId, caseId, userId } = payload;
      this.trackConnection(client, caseId);
      await this.chatService.sendQuickMessage(quickMessageId, caseId, userId);
    } catch (error) {
      this.logger.log(`error while handling quick message:${error}`)
    }
  }

  @SubscribeMessage('send-t')
  async handleTemplateMessage(client: Socket, payload: { userId: number, caseId: number, templateName: string, text: string }) {
    try {
      const { userId, caseId, templateName, text } = payload;
      this.trackConnection(client, caseId);
      this.logger.log(templateName)
      await this.chatService.sendTemplateMessage(templateName, caseId, userId, text);
    } catch (error) {
      this.logger.log(`error while handling quick message:${error}`)
    }
  }

  handleWhatsappMessage(message: ChatEntity): void {
    const room = this.getRoomName(message.caseId);
    this.handleUnreadCount(message.caseId)
    this.server.to(room).emit('whatsapp-message', message);
    this.server.to(UiEntity.ChatList).emit('whatsapp-chat', message);
  }

  handleBotMessage(message: ChatEntity): void {
    const room = this.getRoomName(message.caseId);
    this.server.to(room).emit('bot-message', message);
    this.server.to(UiEntity.ChatList).emit('bot-chat', message);
  }

  async handleUnreadCount(caseId: number) {
    // Pull exactly what we need
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        assignedTo: true,
        unread: true,
        messages: {
          orderBy: { timestamp: 'desc' },
          take: 1,
          select: { senderType: true },
        },
      },
    });

    if (!c) throw new Error(`Case ${caseId} not found`);

    const lastSender = c.messages[0]?.senderType;

    // Agent replied -> reset to 0
    if (lastSender === SenderType.USER) {
      if ((c.unread ?? 0) !== 0) {
        const updated = await this.prisma.case.update({
          where: { id: caseId },
          data: { unread: 0 },
          select: { unread: true },
        });
        return updated.unread;
      }
      return 0;
    }


    if (lastSender === SenderType.CUSTOMER) {
      // unread can be null, so handle both cases atomically
      if (c.unread === null) {
        const updated = await this.prisma.case.update({
          where: { id: caseId },
          data: { unread: 1 },
          select: { unread: true },
        });
        return updated.unread;
      } else {
        const updated = await this.prisma.case.update({
          where: { id: caseId },
          data: { unread: { increment: 1 } },
          select: { unread: true },
        });
        return updated.unread;
      }
    }

    // No change scenarios (e.g., case assigned to BOT, or no messages yet)
    this.logger.log(`unread count update --> ${c.unread}`)
    return c.unread ?? 0;
  }
  // Log status change in StatusEvent table
  private async recordStatusChange(
    caseId: number,
    userId: number | null,          // <-- allow null for bot
    previousStatus: Status,
    newStatus: Status
  ): Promise<void> {
    try {
      if (newStatus === 'SOLVED') {
        await this.prisma.case.update({
          where: { id: caseId },
          data: {
            lastBotNodeId: null,
            meta: { refundScreenshotTries: 0, refundScreenshotActive: false },
            unread: 0,
          },
        });
      }

      // IMPORTANT:
      // - Use relation connect for Case (error was "Argument `case` is missing.")
      // - Only include userId if it's not null (avoid violating non-null schema)
      if (userId) {
        await this.prisma.statusEvent.create({
          data: {
            previousStatus,
            newStatus,
            user: { connect: { id: userId } },
            case: { connect: { id: caseId } },
          },
        });
      } else {
        await this.prisma.statusEvent.create({
          data: {
            previousStatus,
            newStatus,
            case: { connect: { id: caseId } },
          },
        });
      }


      this.logger.log(
        `Status change recorded for case ${caseId}: ${previousStatus} -> ${newStatus}` +
        (userId != null ? ` by user ${userId}` : ' (bot)')
      );
    } catch (error: any) {
      // include stack for easier debugging
      this.logger.error(
        `Failed to record status change for case ${caseId}: ${error?.message}`,
        error?.stack
      );
    }
  }


  async handleFailedMessage(failedMessageDto: FailedMessageDto, client: Socket): Promise<void> {
    this.logger.log(failedMessageDto);
    client.emit('failed-msg', failedMessageDto);
  }





}

