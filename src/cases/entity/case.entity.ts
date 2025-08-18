import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Tag, $Enums, Case, CaseHandler, Message, Note, WhatsAppCustomer } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { IsNumber } from "class-validator";
import { RoomEntity } from "src/chat/entity/room.entity";
import { CustomerEntity } from "src/customer/entity/customer.entity";


export class CaseEntity implements Case {
    constructor(
        partial: Partial<RoomEntity>
    ) {
        Object.assign(this, partial);
    }
    currentInstanceId: number;
    reopenCount: number;
    firstOpenedAt: Date;
    lastClosedAt: Date;

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
    meta: JsonValue;
    isNewCase: boolean;
}