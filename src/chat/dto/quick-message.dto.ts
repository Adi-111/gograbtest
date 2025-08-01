import { ReplyType } from "@prisma/client";

export class QuickMessage {
    id: number;
    flowNodeType: ReplyType;
    header?: any;
    body?: any;
    footer?: any;
    action?: any;
    replies?: any;
    createdAt: Date;
    updatedAt: Date;
}