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
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  Case,
  CaseHandler,
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
import { UnreadHandlerEntity } from './entity/unread-handler.entity';
import { FailedMessageDto } from './dto/failed-message.dto';

@WebSocketGateway({
  cors: {
    origin: "*", // or "http://localhost:3000"
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
      status?: Status | 'EXPIRED' | '';
      handler?: string;
      tag?: string;
      viewMode?: 'ACTIVE' | 'ALL';
    }
  ) {
    try {
      const page = payload?.page && payload.page > 0 ? payload.page : 1;
      const limit = payload?.limit ?? 50;
      const skip = (page - 1) * limit;

      this.logger.log(`Received chatList request: payload=${JSON.stringify(payload)}`);

      // Build where clause for filtering
      const where: any = {};

      // Search filter (on customer name or phoneNo)
      if (payload?.search) {
        where.OR = [
          { customer: { name: { contains: payload.search, mode: 'insensitive' } } },
          { customer: { phoneNo: { contains: payload.search } } },
        ];
      }

      // Status filter
      if (payload?.status) {
        if (payload.status === 'EXPIRED') {
          where.AND = [
            { timer: { lt: new Date() } },
            { status: { not: Status.SOLVED } },
          ];
        } else {
          where.status = payload.status;
        }
      } else if (payload?.viewMode === 'ACTIVE') {
        // Active statuses only
        where.status = {
          in: [Status.INITIATED, Status.PROCESSING, Status.ASSIGNED, Status.BOT_HANDLING],
        };
      }

      // Handler filter
      if (payload?.handler) {
        if (payload.handler === 'MY_CHATS' && client.data.userId) {
          where.AND = where.AND || [];
          where.AND.push({ assignedTo: 'USER', userId: client.data.userId });
        } else if (payload.handler !== 'MY_CHATS') {
          where.assignedTo = payload.handler;
        }
      }

      // Tag filter
      if (payload?.tag) {
        where.tags = {
          some: {
            text: { contains: payload.tag, mode: 'insensitive' },
          },
        };
      }
      // Get all cases matching the filters (without pagination) to calculate the counts
      const allCases = await this.prisma.case.findMany({
        where,
        include: {
          tags: true,
          customer: true,
          user: true,
          messages: { orderBy: { timestamp: 'desc' }, take: 2 }, // Fetch latest message only
        },
        orderBy: {
          updatedAt: 'desc'
        }
      });
      // Filter out cases where the last message senderType is 'USER' if the status is 'EXPIRED'
      const filteredCases = allCases;

      // Calculate filtered count and unread count
      let filteredCount = filteredCases.length;
      if (payload.status === 'EXPIRED') {
        const expiredCount = filteredCases.filter((c) => new Date(String(c.timer)).getTime() < Date.now());
        filteredCount = expiredCount.filter((c) => {
          // Check if the case status matches any of the specified statuses
          if (
            c.status === Status.ASSIGNED ||
            c.status === Status.BOT_HANDLING ||
            c.status === Status.INITIATED ||
            c.status === Status.PROCESSING ||
            c.status === Status.UNSOLVED
          ) {
            // Find the last message in the case
            const lastMessage = c.messages && c.messages.length > 0 ? c.messages[c.messages.length - 1] : null;

            // Exclude the case if the last message is from the user
            if (lastMessage && lastMessage.senderType === 'USER') {
              return false; // Do not include this case
            }
            return true; // Include this case
          }

          return false; // Exclude this case if the status doesn't match
        }).length;
      }
      const unreadCount = filteredCases.filter(chat => (Number(chat.unread) - 1 || 0) > 1).length;

      // Send filtered count and unread count to the client
      this.sendFilteredCount(client, filteredCount, unreadCount);

      // Now apply pagination on filtered cases
      const paginatedCases = filteredCases.slice(skip, skip + limit);
      const totalPages = Math.ceil(filteredCount / limit);

      client.emit(UiEntity.render, {
        cases: paginatedCases,
        currentPage: page,
        totalPages,
      });
    } catch (error) {
      this.logger.error(error);
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
          user: true
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

  /* ========================================================
     Paginated Message Retrieval
  ======================================================== */

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



  @SubscribeMessage('update-contact-status')
  async updateContactStatus(
    client: Socket,
    payload: { caseId: number; status: Status; userId: number, assignedTo?: CaseHandler },
  ): Promise<void> {
    try {
      const { caseId, status, userId } = payload;

      const caseRecord = await this.prisma.case.findUnique({
        where: { id: payload.caseId },
        select: { status: true },
      });
      if (!caseRecord) throw new Error('Case not found');



      const updatedCase = await this.prisma.case.update({
        where: { id: caseId },
        data: { status, lastBotNodeId: null, ...(payload.assignedTo && { assignedTo: payload.assignedTo }) },
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
            include: {
              user: true
            }
          },
        },
      });


      await this.recordStatusChange(caseId, userId, caseRecord.status, status);
      const updatedEvents = await this.prisma.statusEvent.findMany({
        where: { caseId },
        include: { user: true },
        orderBy: { timestamp: 'asc' },
      });
      client.emit('status-events', updatedEvents); // send to sender
      this.server.to(`case-${caseId}`).emit('status-events', updatedEvents); // broadcast to room


      this.server.to(`case-${caseId}`).emit('contact-updated', updatedCase);

      const baseChatInfo = {
        id: updatedCase.id,
        customerName: updatedCase.customer.name,
        messages: updatedCase.messages,
        status: updatedCase.status,
        unread: updatedCase.unread,
        notes: updatedCase.notes,
      };

      const chatInfo =
        updatedCase.assignedTo === CaseHandler.USER
          ? { ...baseChatInfo, handler: `user: ${updatedCase.user.firstName}` }
          : {
            ...baseChatInfo,
            handler: String(updatedCase.assignedTo),
            img: updatedCase.customer.profileImageUrl,
          };

      client.emit('chat-info-response', chatInfo);

    } catch (error) {
      this.emitError(client, 'update-contact-status', error);
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
    payload: { caseId: number; tags: string[] },
  ): Promise<void> {
    try {
      const { caseId, tags } = payload;
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
              user: { connect: { id: 1 } }, // 🔁 Replace with real userId if needed
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
      let handlerInfo = 'Not Assigned'
      if (caseRecord.user) {
        handlerInfo = caseRecord.user.firstName;
      }
      const chatInfo =
        caseRecord.assignedTo === CaseHandler.USER
          ? { ...baseChatInfo, handler: `user: ${handlerInfo}` }
          : {
            ...baseChatInfo,
            handler: String(caseRecord.assignedTo),
            img: caseRecord.customer.profileImageUrl,
          };
      client.emit('chat-info-response', chatInfo);
    } catch (error) {
      this.emitError(client, 'chat-info', error);
    }
  }

  /* ========================================================
     Utility Methods
  ======================================================== */

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
      await this.chatService.sendTemplateMessage(templateName, caseId, userId, text);
    } catch (error) {
      this.logger.log(`error while handling quick message:${error}`)
    }
  }

  handleWhatsappMessage(message: ChatEntity): void {
    const room = this.getRoomName(message.caseId);
    const payload = {
      caseId: message.caseId,
      handle: UnreadHandlerEntity.NEWM
    }
    this.handleUnreadCount(payload)
    this.server.to(room).emit('whatsapp-message', message);
    this.server.to(UiEntity.ChatList).emit('whatsapp-chat', message);
  }

  handleBotMessage(message: ChatEntity): void {
    const room = this.getRoomName(message.caseId);
    this.server.to(room).emit('bot-message', message);
    this.server.to(UiEntity.ChatList).emit('bot-chat', message);
  }

  async handleUnreadCount(payload: { caseId: number, handle: UnreadHandlerEntity }) {
    let caseRecord: Case;
    if (payload.handle === UnreadHandlerEntity.SEEN) {
      caseRecord = await this.prisma.case.update({
        where: {
          id: payload.caseId
        },
        data: {
          unread: 0
        }
      })
    }
    else {
      let uc = (await this.prisma.case.findUnique({ where: { id: payload.caseId } })).unread;
      uc = uc + 1;
      caseRecord = await this.prisma.case.update({
        where: {
          id: payload.caseId
        },
        data: {
          unread: uc
        }
      })
    }
    return caseRecord.unread;
  }
  // Log status change in StatusEvent table
  private async recordStatusChange(caseId: number, userId: number, previousStatus: Status, newStatus: Status): Promise<void> {
    try {
      if (newStatus === 'SOLVED') await this.prisma.case.update({ where: { id: caseId }, data: { lastBotNodeId: null, meta: { refundScreenshotTries: 0, refundScreenshotActive: false }, unread: 0 } });
      await this.prisma.statusEvent.create({
        data: {
          caseId,
          userId,
          previousStatus,
          newStatus,
        },
      });
      this.logger.log(`Status change recorded for case ${caseId}: ${previousStatus} -> ${newStatus} by user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to record status change for case ${caseId}: ${error.message}`);
    }
  }

  async handleFailedMessage(failedMessageDto: FailedMessageDto, client: Socket): Promise<void> {
    this.logger.log(failedMessageDto);
    client.emit('failed-msg', failedMessageDto);
  }





}

