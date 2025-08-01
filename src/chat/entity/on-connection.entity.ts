import { Message } from "@prisma/client";

export class OnConnectionEntity {
    id: number;
    message: Message
}