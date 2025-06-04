import { FailedMsgEvent, User } from "@prisma/client";

export class FailedMessageDto implements FailedMsgEvent {
    id: number;
    caseId: number;
    userId: number;
    timestamp: Date;
    text: string;
    messageId: number;
    tries: number;
    user: User
}