import { MessageType, ReplyType, SenderType, SystemMessageStatus, Prisma } from "@prisma/client";


export class CreateMessageDto {
    // Required fields from Message model

    senderType: SenderType;
    recipient: string;
    waMessageId?: string;
    caseId: number;
    type: MessageType;




    // Optional fields
    text?: string;
    messageType?: MessageType;
    replyType?: ReplyType;
    parentMessageId?: number;
    systemStatus?: SystemMessageStatus;

    // Relationships
    userId?: number;
    botId?: number;
    whatsAppCustomerId?: number;
    mediaId?: number;
    issueEventId?: number


    //issueEvent


    // Attachments
    media?: {
        url: string;
        mimeType: string;
        caption?: string;
        fileName?: string;
        size?: number;
        duration?: number;
        height?: number;
        width?: number;
    };

    location?: {
        latitude: number;
        longitude: number;
        name?: string;
        address?: string;
        url?: string;
        accuracy?: number;
    };

    interactive?: {
        type: string;
        header?: Prisma.JsonValue;
        body?: Prisma.JsonValue;
        footer?: Prisma.JsonValue;
        action: Prisma.JsonValue;
        parameters?: Prisma.JsonValue;
    };

    contacts?: Array<{
        name?: Prisma.JsonValue;
        phones: Prisma.JsonValue;
        emails?: Prisma.JsonValue;
        addresses?: Prisma.JsonValue;
        org?: Prisma.JsonValue;
        birthday?: Date;
        urls?: Prisma.JsonValue;
    }>;
}