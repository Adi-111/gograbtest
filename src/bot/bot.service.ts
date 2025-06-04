import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { CustomerService } from '../customer/customer.service';
import { PrismaService } from '../prisma/prisma.service';
import { BotReplies, MessageType, ReplyType, SenderType, Status, SystemMessageStatus } from '@prisma/client';
import { ChatService } from 'src/chat/chat.service';
import { RefundDetailDto } from 'src/customer/dto/refund-details.dto';
import { MergedProductDetail } from 'src/customer/types';
//main_message-ILtoz

@Injectable()
export class BotService {
    private readonly logger = new Logger(BotService.name);

    constructor(
        @Inject(forwardRef(() => ChatService))
        private readonly chatService: ChatService,
        @Inject(forwardRef(() => CustomerService))
        private readonly customerService: CustomerService,
        private readonly prisma: PrismaService
    ) { }

    async getAllBotReplies() {
        return await this.prisma.botReplies.findMany();
    }

    public async processNode(phoneNumber: string, node: BotReplies, caseId: number): Promise<void> {
        this.logger.log(node)
        if (!node) {
            this.logger.error(`Node not found`);
            this.sendFallbackMessage(phoneNumber, caseId);
            return;
        }

        try {
            // Track last node for open-ended question type
            if (node.flowNodeType === 'Message' || node.flowNodeType === null) {
                await this.prisma.case.update({
                    where: { id: caseId },
                    data: { lastBotNodeId: node.nodeId },
                });
            }

            switch (node.flowNodeType) {
                case 'Message':
                    await this.handleMessageNode(phoneNumber, node, caseId);
                    break;
                case 'InteractiveButtons':
                    await this.handleInteractiveButtons(phoneNumber, node, caseId);
                    break;
                case 'InteractiveList':
                    await this.handleInteractiveList(phoneNumber, node, caseId);
                    break;
                default:
                    throw new Error(`Unsupported node type: ${node.flowNodeType}`);
            }
        } catch (error) {
            this.logger.error(`Failed to process node`, error.stack);
            await this.sendFallbackMessage(phoneNumber, caseId);
        }
    }

    async botSendByNodeId(nodeId: string, phoneNo: string, caseId: number) {
        try {
            const node = await this.prisma.botReplies.findUnique({ where: { nodeId } })


            // Only if the message is an open-ended question
            if (node) {
                if (node.nodeId === 'screenshot1') {
                    // for refund flow screenshots, keep lastBotNodeId to 'main_question-fXmet'
                    await this.prisma.case.update({
                        where: { id: caseId },
                        data: { lastBotNodeId: 'main_question-fXmet' },
                    });
                }
                else if (node.nodeId === 'screenshot2') {
                    await this.prisma.case.update({
                        where: { id: caseId },
                        data: { lastBotNodeId: "stop" }
                    })
                }
                else if (node.nodeId === 'main_message-ILtoz') {
                    const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId } });
                    if (caseRecord.status !== 'SOLVED') {
                        await this.chatService.triggerStatusUpdate(caseId, 'SOLVED', 5);
                    }

                } else if (node.nodeId === 'main_message-null') {
                    // await this.chatService.triggerStatusUpdate(caseId, 'PROCESSING', 5);
                    await this.prisma.case.update({ where: { id: caseId }, data: { assignedTo: 'USER' } })
                }
                else if (node.nodeId === 'main_message-DqzXV') {
                    const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId }, include: { customer: true } });
                    await this.customerService.sendImageToCustomer(caseRecord.customer.phoneNo, 'https://i.ibb.co/Ld42zszm/qrcode.jpg', 'Qr Code')
                }
                else {
                    await this.prisma.case.update({
                        where: { id: caseId },
                        data: { lastBotNodeId: node.nodeId },
                    });
                }
                this.logger.log(node.nodeId);

                switch (node.flowNodeType) {
                    case ReplyType.Message:
                        await this.handleMessageNode(phoneNo, node, caseId);
                        break;
                    case ReplyType.InteractiveButtons:
                        await this.handleInteractiveButtons(phoneNo, node, caseId);
                        break;
                    case ReplyType.InteractiveList:
                        await this.handleInteractiveList(phoneNo, node, caseId);
                        break;
                    default:
                        throw new Error(`Unsupported node type: ${node.flowNodeType}`);
                }
                return node;
            }




        } catch (error) {
            this.logger.error(`Failed to process node`, error.stack);
            // await this.sendFallbackMessage(phoneNo, caseId);
        }
    }


    async sendRefundMessage(phoneNumber: string, caseId: number, refDetails: RefundDetailDto) {
        let framedMsg = `✅ Your refund has been successfully processed.\nPlease note: The amount is directly credited to your bank account and may not reflect in apps like PhonePe, GPay, etc.\nRefund Details:\n 1.Amount: ${refDetails.refundAmount}\n 2.UTR No.: ${refDetails.rrn}`;
        if (!refDetails.rrn) {
            framedMsg = `✅ Your refund has been successfully processed.\nPlease note: The amount is directly credited to your bank account and may not reflect in apps like PhonePe, GPay, etc.\nRefund Details:\n Amount: ${refDetails.refundAmount}`
        }

        const message = {
            text: framedMsg,
            type: MessageType.TEXT,
            senderType: SenderType.BOT,
            caseId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            recipient: phoneNumber
        }
        await this.chatService.createMessage(message);
        await this.customerService.sendTextMessage(phoneNumber, framedMsg);
        await this.botSendByNodeId('las', phoneNumber, caseId);
    }

    private async handleMessageNode(phoneNumber: string, node: BotReplies, caseId: number): Promise<void> {
        const body = node.body as { text?: string };
        if (!body?.text) {
            throw new Error('Message node missing text content');
        }

        const message = {
            text: body.text || JSON.stringify(node.action),
            type: MessageType.TEXT,
            senderType: SenderType.BOT,
            caseId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            recipient: phoneNumber,
        };

        const savedMessage = await this.chatService.createMessage(message);
        await this.customerService.sendTextMessage(phoneNumber, body.text);
        await this.prisma.message.update({
            where: { id: savedMessage.id },
            data: { systemStatus: SystemMessageStatus.DELIVERED },
        });
    }

    private async handleInteractiveButtons(phoneNumber: string, node: BotReplies, caseId: number): Promise<void> {
        const action = node.action as { buttons?: Array<{ id: string; title: string }> };
        if (!action?.buttons?.length) {
            throw new Error('InteractiveButtons node missing buttons');
        }

        const message = {
            text: JSON.stringify(node.body) || 'Please choose an option:',
            type: MessageType.INTERACTIVE,
            senderType: SenderType.BOT,
            caseId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            interactive: {
                type: 'button',
                header: node.header,
                body: node.body,
                footer: node.footer,
                action: node.action,
                parameters: node.replies,
            },
            recipient: phoneNumber,
        };

        const savedMessage = await this.chatService.createMessage(message);
        await this.customerService.sendButtons(phoneNumber, {
            header: (node.header as any)?.text,
            footer: (node.footer as any)?.text,
            body: (node.body as any)?.text || 'Please choose an option:',
            buttons: action.buttons,
        });
        await this.prisma.message.update({
            where: { id: savedMessage.id },
            data: { systemStatus: SystemMessageStatus.DELIVERED },
        });
    }

    private async handleInteractiveList(phoneNumber: string, node: BotReplies, caseId: number): Promise<void> {
        const action = node.action as { button?: string; sections?: any[] };
        if (!action?.sections?.length) {
            throw new Error('InteractiveList node missing sections');
        }

        const message = {
            text: (node.body as any)?.text || 'Please select from the list:',
            type: MessageType.INTERACTIVE,
            senderType: SenderType.BOT,
            caseId,
            systemStatus: SystemMessageStatus.SENT,
            timestamp: new Date(),
            interactive: {
                type: 'list',
                header: node.header ? JSON.stringify(node.header) : null,
                body: node.body ? JSON.stringify(node.body) : null,
                footer: node.footer ? JSON.stringify(node.footer) : null,
                action: JSON.stringify({ button: action.button, sections: action.sections }),
            },
            recipient: phoneNumber,
        };

        const savedMessage = await this.chatService.createMessage(message);
        await this.customerService.sendInteractiveList(phoneNumber, {
            body: (node.body as any)?.text || 'Please select from the list:',
            buttonText: action.button || 'Options',
            footer: (node.footer as any)?.text,
            sections: action.sections,
        });
        await this.prisma.message.update({
            where: { id: savedMessage.id },
            data: { systemStatus: SystemMessageStatus.DELIVERED },
        });
    }

    public async sendFallbackMessage(phoneNumber: string, caseId: number): Promise<void> {
        try {
            let botReply = await this.prisma.botReplies.findUnique({
                where: {
                    nodeId: "default"
                }
            });

            const message = {
                text: (botReply?.body as any)?.text || 'Oops! Something went wrong.',
                type: MessageType.TEXT,
                senderType: SenderType.BOT,
                caseId,
                systemStatus: SystemMessageStatus.SENT,
                timestamp: new Date(),
                recipient: phoneNumber,
            };

            const savedMessage = await this.chatService.createMessage(message);
            await this.customerService.sendTextMessage(phoneNumber, message.text);
            await this.prisma.message.update({
                where: { id: savedMessage.id },
                data: { systemStatus: SystemMessageStatus.DELIVERED },
            });

            // Optional: restart from default node
            botReply = await this.prisma.botReplies.findUnique({ where: { nodeId: 'hi' } });
            if (botReply) {
                await this.processNode(phoneNumber, botReply, caseId);
            }

        } catch (error) {
            this.logger.error('Failed to send fallback message', error.stack);
        }
    }

    async upsertBotReplies(nodes: BotReplies[]) {
        this.logger.log(`${nodes}`);
        for (const node of nodes) {
            const {
                nodeId,
                flowNodeType,
                header,
                body,
                footer,
                action,
                replies,
                botId,
                createdAt,
            } = node;

            this.logger.log(`upserting nodeId: ${nodeId}`)
            try {
                await this.prisma.botReplies.upsert({
                    where: { nodeId },
                    update: {
                        flowNodeType,
                        header,
                        body,
                        footer,
                        action,
                        replies,
                        botId,
                        createdAt: new Date(createdAt),
                    },
                    create: {
                        nodeId,
                        flowNodeType,
                        header,
                        body,
                        footer,
                        action,
                        replies,
                        botId,
                        createdAt: new Date(createdAt),
                    }
                });
            } catch (err) {
                console.error(`Failed to upsert node ${nodeId}`, err);
            }
        }

        console.log("All nodes processed.");
    }

    async sendProductDetails(phoneNo: string, productDetails: MergedProductDetail) {
        await this.customerService.sendTextMessage(phoneNo, JSON.stringify(productDetails));
    }



}
