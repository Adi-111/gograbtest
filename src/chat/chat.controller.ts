import { Controller, Get, Param, ParseIntPipe } from "@nestjs/common";
import { ChatService } from "./chat.service";
import { ChatEntity } from "./entity/chat.entity";
import { ApiCreatedResponse, ApiResponseProperty } from "@nestjs/swagger";
import { MachineDetailsDto } from "./dto/MachineDetails.dto";

@Controller('chat')
export class ChatController {
    constructor(
        private chatService: ChatService,

    ) { }

    @Get('one/:id')
    async getCaseMessages(@Param('id', ParseIntPipe) id: number) {
        return await this.chatService.getMessagesByCaseId(id);
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
}