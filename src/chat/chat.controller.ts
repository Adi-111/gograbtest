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

    @Get('join/:caseId')
    async joinCase(
        @Param('caseId', ParseIntPipe) caseId: number,
        @Query('page') page?: number,
        @Query('limit') limit?: number,
    ) {
        return await this.chatService.joinCase(caseId, page, limit);
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