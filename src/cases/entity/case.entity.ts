import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
// Import Prisma namespace to access JsonValue reliably
import { Tag, $Enums, Case, CaseHandler, Message, Note, WhatsAppCustomer, Prisma } from "@prisma/client";
import { IsNumber } from "class-validator";
import { RoomEntity } from "src/chat/entity/room.entity";
import { CustomerEntity } from "src/customer/entity/customer.entity";

export class CaseEntity implements Case {
    constructor(
        partial: Partial<RoomEntity>
    ) {
        Object.assign(this, partial);
    }
    
    currentIssueId: number | null;

    @IsNumber()
    id: number;

    unread: number;
    timer: Date;
    status: $Enums.Status;
    assignedTo: $Enums.CaseHandler;
    createdAt: Date;
    updatedAt: Date;
    customerId: number;

    @ApiPropertyOptional({ type: () => CustomerEntity })
    customer?: CustomerEntity;

    userId: number;
    botId: number;
    tags: Tag[];
    notes: Note;
    lastBotNodeId: string;
    
    // Use Prisma.JsonValue here
    meta: Prisma.JsonValue;
    
    isNewCase: boolean;
    lastMessageAt: Date;
}