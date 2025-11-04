import { Tag, $Enums, Case } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";
import { IsNumber } from "class-validator";


export class RoomEntity implements Case {
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
    userId: number;
    botId: number;
    tags: Tag[];
    notes: string;
    lastBotNodeId: string;
    meta: JsonValue;
    isNewCase: boolean;
    lastMessageAt: Date
}