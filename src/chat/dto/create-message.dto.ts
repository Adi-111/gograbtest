import { MessageType, ReplyType, SenderType, SystemMessageStatus } from "@prisma/client";
import { JsonValue } from "@prisma/client/runtime/library";

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
        header?: JsonValue;
        body?: JsonValue;
        footer?: JsonValue;
        action: JsonValue;
        parameters?: JsonValue;
    };

    contacts?: Array<{
        name?: JsonValue;
        phones: JsonValue;
        emails?: JsonValue;
        addresses?: JsonValue;
        org?: JsonValue;
        birthday?: Date;
        urls?: JsonValue;
    }>;
}