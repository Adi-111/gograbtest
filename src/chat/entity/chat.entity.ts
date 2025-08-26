import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Message, SenderType, MessageType, SystemMessageStatus, ReplyType, Media, Interactive, User, WhatsAppCustomer, Case, Location } from "@prisma/client";
import { CaseEntity } from "src/cases/entity/case.entity";
import { CustomerEntity } from "src/customer/entity/customer.entity";
import { UserEntity } from "src/user/entity/user.entity";


export class ChatEntity implements Message {
    constructor(partial: Partial<ChatEntity>) {
        Object.assign(this, partial);
    }


    @ApiProperty()
    id: number;

    @ApiProperty({ enum: MessageType })
    type: MessageType;

    @ApiPropertyOptional({ enum: ReplyType })
    replyType: ReplyType;

    @ApiProperty({ enum: SenderType })
    senderType: SenderType;

    @ApiProperty()
    text: string;

    @ApiProperty()
    recipient: string;

    @ApiProperty()
    timestamp: Date;

    @ApiProperty()
    waMessageId: string;

    @ApiPropertyOptional()
    context: any;

    @ApiProperty({ enum: SystemMessageStatus, default: SystemMessageStatus.SENT })
    systemStatus: SystemMessageStatus;

    @ApiPropertyOptional()
    error: any;

    @ApiProperty()
    caseId: number;

    location?: Location;
    interactive?: Interactive;
    media?: Media;
    mediaId?: number;

    @ApiPropertyOptional()
    userId: number | null;

    @ApiPropertyOptional()
    botId: number | null;

    @ApiPropertyOptional()
    whatsAppCustomerId: number | null;

    WhatsAppCustomer: WhatsAppCustomer;

    @ApiPropertyOptional()
    parentMessageId: number | null;

    // Relationships
    @ApiPropertyOptional({ type: () => UserEntity })
    user?: User;

    @ApiPropertyOptional({ type: () => CustomerEntity })
    customer?: WhatsAppCustomer;

    @ApiPropertyOptional({ type: () => CaseEntity })
    case?: Case;


    @ApiPropertyOptional({ type: () => ChatEntity })
    parentMessage?: Message;

    @ApiPropertyOptional({ type: () => [ChatEntity] })
    replies?: Message[];

    // Status tracking
    @ApiProperty({ default: false })
    isRead?: boolean;

    @ApiPropertyOptional()
    readAt?: Date;

}