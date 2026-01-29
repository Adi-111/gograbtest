import { Controller, Get, NotFoundException, Param, ParseIntPipe, Query } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatEntity } from "./entity/chat.entity";
import { ApiCreatedResponse, ApiResponseProperty } from "@nestjs/swagger";
import { MachineDetailsDto } from "./dto/MachineDetails.dto";
import { Status } from "@prisma/client";

@Controller('chat')
export class ChatController {
    constructor(
        private chatService: ChatService,

    ) { }


    @Get('list')
    async getChatList(
        @Query('page') page?: number,
        @Query('limit') limit?: number,
        @Query('search') search?: string,
        @Query('status') status?: Status | 'EXPIRED' | 'UNREAD' | '',
        @Query('handler') handler?: string,
        @Query('tag') tag?: string,
        @Query('viewMode') viewMode?: 'ACTIVE' | 'ALL',
        @Query('byUserId') byUserId?: number,
        @Query('userId') userId?: number, // optional if you pass logged-in userId
    ) {
        return await this.chatService.getChatList({
            page,
            limit,
            search,
            status,
            handler,
            tag,
            viewMode,
            byUserId,
            userId,
        });
    }

    @Get('one/:id')
    async getCaseMessages(@Param('id', ParseIntPipe) id: number) {
        return await this.chatService.getMessagesByCaseId(id);
    }

    //  *
    //  * @deprecated Use joinCase() for messages and getCaseEvents() for events separately
    //  * Original combined function  for reference
    //  */
    @Get('join/:caseId')
    async joinCase(
        @Param('caseId', ParseIntPipe) caseId: number,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return await this.chatService.joinCase(caseId, page, limit);
    }

    /**
     * Join a case and retrieve paginated messages
     * Frontend should call /events/:caseId after successfully receiving this data
     */
    @Get('join/:caseId')
    async CaseJoin(
        @Param('caseId', ParseIntPipe) caseId: number,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return await this.chatService.JoinCase(caseId, page, limit);
    }

    /**
     * Get case events (issue events and status events) for a case
     * Call this after /join/:caseId to load events for the timeline/context panel
     */
    @Get('events/:caseId')
    async getCaseEvents(
        @Param('caseId', ParseIntPipe) caseId: number,
        @Query('since') since?: string,
    ) {
        const sinceDate = since ? new Date(since) : undefined;
        return await this.chatService.getCaseEvents(caseId, sinceDate);
    }


    @Get('all')
    @ApiCreatedResponse({ type: [ChatEntity] })
    async getAllMessages() {
        return await this.chatService.getAllMessages();
    }

    @Get('all-quick-msg')
    async getAllQuickMsg() {
        return await this.chatService.fetchQuickReplies();
    }

    @Get('utr/:caseId')
    async getAllUtr(@Param('caseId', ParseIntPipe) caseId: number) {
        return await this.chatService.utr(caseId)
    }

    @Get('machineDetails')
    async getMachineDetails() {
        const data: MachineDetailsDto[] = await this.chatService.getMachineDetails();
        return data
    }

    @Get(':caseId/info')
    async getChatInfo(@Param('caseId', ParseIntPipe) caseId: number) {
        const chatInfo = await this.chatService.getChatInfo(caseId);
        if (!chatInfo) {
            throw new NotFoundException('Case not found');
        }
        return chatInfo;
    }
}