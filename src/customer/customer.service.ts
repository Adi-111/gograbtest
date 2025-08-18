import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { CaseHandler, Status, MessageType, SenderType, ReplyType, Prisma } from '@prisma/client';
import { ChatService } from 'src/chat/chat.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { BotService } from 'src/bot/bot.service';
import { CloudService } from 'src/cloud/cloud.service';
import { GGBackendService } from './gg-backend/gg-backend.service';
import { TransactionInfoDto } from './gg-backend/dto/transaction-info.dto';
import { FailedMessageDto } from 'src/chat/dto/failed-message.dto';
import { MergedProductDetail } from './types';



interface WhatsAppMessagePayload {
    messaging_product: string;
    recipient_type: string;
    to: string;
    type: string;
    [key: string]: any;
}
const greetings = [
    "hi", "hii", "hiii", "hey", "heyy", "heyyy",
    "hlo", "order", "refund", "some",
    "hello", "helloo", "hellooo",
    "hola", "holaa",
    "yo", "yoo", "yooo",
    "sup", "wassup", "wazzup",
    "greetings",
    "good morning", "goodmorning", "good mrng",
    "good afternoon", "goodafternoon",
    "good evening", "goodevening",
    "gm", "gud morning", "gd mrng",
    "ga", "gud afternoon",
    "ge", "gud evening",
    "namaste", "namaskar", "namaskaram",
    "salaam", "salam", "asalamualaikum", "assalamualaikum",
    "bonjour",
    "ciao",
    "aloha",
    "hey there",
    "hi there",
    "hello there"
];
interface WhatsappCustomerMessagePayload {
    type: ReplyType;
    // For text messages
    text?: string;
    // For interactive messages
    header?: string;
    body?: string;
    footer?: string;
    // For interactive list
    buttonText?: string;
    sections?: any[];
    // For interactive buttons
    buttons?: any[];
}

@Injectable()
export class CustomerService {
    private readonly logger = new Logger(CustomerService.name);
    private readonly facebookApiVersion = 'v21.0';
    private readonly phoneNumberId = process.env.WHATSAPP_PHONE_NO;
    private readonly apiUrl = `https://graph.facebook.com/${this.facebookApiVersion}/${this.phoneNumberId}/messages`;
    private readonly accessToken = process.env.WHATSAPP_ACCESS_TOKEN;


    constructor(
        @Inject(forwardRef(() => ChatService))
        private readonly chatService: ChatService,
        @Inject(forwardRef(() => BotService))
        private readonly botService: BotService,
        private readonly prisma: PrismaService,
        private readonly cloudService: CloudService,
        private readonly gg_backend_service: GGBackendService
    ) { }


    async getProducts() {
        return await this.gg_backend_service.getProductsFromGoGrab();
    }

    // Customer CRUD operations
    async getAllCustomers() {
        try {
            return await this.prisma.whatsAppCustomer.findMany({
                include: { message: true, cases: true },
            });
        } catch (error) {
            this.logger.error('Failed to fetch customers', error.stack);
            throw new Error('Failed to retrieve customers');
        }
    }

    async getCustomer(id: number) {
        try {
            return await this.prisma.whatsAppCustomer.findUnique({
                where: { id },
            });
        } catch (error) {
            this.logger.error(`Failed to find customer ${id}`, error.stack);
            throw new Error('Customer not found');
        }
    }

    async removeCustomer(id: number) {
        try {
            return await this.prisma.whatsAppCustomer.delete({
                where: { id },
            });
        } catch (error) {
            this.logger.error(`Failed to delete customer ${id}`, error.stack);
            throw new Error('Failed to delete customer');
        }
    }

    private async handleRefundRetry(caseId: number, phoneNo: string, nodeId: string) {
        const maxTries = 3
        const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId } });
        let caseMeta = (caseRecord?.meta ?? {}) as Prisma.JsonObject;
        const tries = Number(caseMeta.refundScreenshotTries) || 0;
        const updatedTries = tries + 1;

        caseMeta = {
            ...caseMeta,
            refundScreenshotTries: updatedTries,
        };

        if (updatedTries >= maxTries) {

            await this.botService.botSendByNodeId('screenshot4', phoneNo, caseId);
            await this.prisma.case.update({
                where: { id: caseId },
                data: {
                    assignedTo: CaseHandler.BOT,
                    meta: { refundScreenshotTries: 0, refundScreenshotActive: false },
                    lastBotNodeId: null,
                },
            });
            this.logger.warn(`Refund Screenshot failed ${maxTries} times. Escalated to human agent. Screenshot flow reset.`);
        }
        else {
            await this.botService.botSendByNodeId(nodeId, phoneNo, caseId);
            if (nodeId === 'screenshot2') {
                await this.prisma.case.update({
                    where: { id: caseId },
                    data: {
                        assignedTo: 'USER',
                        meta: { refundScreenshotTries: 0, refundScreenshotActive: false },
                        lastBotNodeId: 'stop',
                    }
                })
            }
            else {
                await this.prisma.case.update({
                    where: { id: caseId },
                    data: {
                        meta: caseMeta,
                        lastBotNodeId: 'main_question-fXmet', // <=========================== important fix
                    },
                });
            }
            this.logger.warn(`Retry ${updatedTries}/${maxTries} for refund screenshot.`);
        }
    }



    // Send Message
    async sendMessageToWhatsappCustomer(
        to: string,
        payload: WhatsappCustomerMessagePayload
    ) {
        try {
            switch (payload.type) {
                case ReplyType.Message:
                    if (!payload.text) {
                        throw new Error('Text property is required for a text message.');
                    }
                    this.logger.log(`Sending text message to ${to}`);
                    return await this.sendTextMessage(to, payload.text);

                case ReplyType.InteractiveList:
                    if (!payload.body || !payload.buttonText || !payload.sections) {
                        throw new Error(
                            'body, buttonText, and sections are required for an interactive list message.'
                        );
                    }
                    this.logger.log(`Sending interactive list message to ${to}`);
                    return await this.sendInteractiveList(to, {
                        header: payload.header,
                        body: payload.body,
                        footer: payload.footer,
                        buttonText: payload.buttonText,
                        sections: payload.sections,
                    });

                case ReplyType.InteractiveButtons:
                    if (!payload.body || !payload.buttons) {
                        throw new Error(
                            'body and buttons are required for an interactive buttons message.'
                        );
                    }
                    this.logger.log(`Sending interactive buttons message to ${to}`);
                    return await this.sendButtons(to, {
                        header: payload.header,
                        body: payload.body,
                        footer: payload.footer,
                        buttons: payload.buttons,
                    });

                default:
                    throw new Error(`Unsupported message type: ${payload.type}`);
            }
        } catch (error) {
            this.logger.error(
                `Failed to send WhatsApp message to ${to}`,
                (error as Error).stack
            );
            throw error;
        }
    }

    // Message Processing (without transaction)
    async processIncomingMessage(body: any) {
        const entry = body?.entry?.[0];
        const changes = entry?.changes?.[0];
        const value = changes?.value;
        const message = value?.messages?.[0];







        if (value?.statuses) {
            if (value?.statuses[0]?.status === 'failed') {
                const phoneNo = value?.statuses[0]?.recipient_id
                const existingCustomer = await this.prisma.whatsAppCustomer.findFirst({
                    where: { phoneNo },
                });
                if (!existingCustomer) {
                    this.logger.warn(`No customer found with phone number ${phoneNo}`)
                    return null;
                }
                const activeCase = await this.prisma.case.findFirst({
                    where: {
                        customerId: existingCustomer.id
                    },
                    include: {
                        messages: {
                            take: 1,
                            orderBy: {
                                timestamp: 'desc'
                            }
                        }
                    }
                });
                if (!activeCase) return null;

                const event = await this.prisma.failedMsgEvent.create({
                    data: {
                        tries: 0,
                        text: value?.statuses?.[0]?.errors?.[0]?.message,
                        messageId: activeCase.messages[0].id,
                        user: { connect: { id: 5 } },
                        case: { connect: { id: activeCase.id } },
                    },

                    include: {
                        case: true,
                        user: true
                    }
                })

                await this.chatService.triggerFailedMessage(event);
            }
            this.logger.warn('Skipping WhatsApp status webhook (sent/delivered/read)');
            return null;
        }
        if (!message) {
            this.logger.warn('Invalid message structure, skipping...', body);
            return null;
        }
        const currentTime = Math.floor(Date.now() / 1000); // Current UNIX time in seconds
        const messageTimestamp = parseInt(message.timestamp); // WhatsApp timestamp is also in seconds

        if (currentTime - messageTimestamp > 15) {
            this.logger.warn(`Skipping old message. Message timestamp: ${messageTimestamp}, Current timestamp: ${currentTime}`);
            return null;
        }
        const phoneNo = String(message.from);
        const contact = value?.contacts?.[0];

        try {
            const customer = await this.handleCustomerProfile(phoneNo, contact);
            const caseRecord = await this.handleCaseManagement(customer.id);
            const storedMessage = await this.storeIncomingMessage(message, customer.id, caseRecord.id);
            await this.handleTimer(caseRecord.id);
            const lastBotNodeId = caseRecord.lastBotNodeId || '';
            const onButtons = lastBotNodeId.startsWith('main_buttons')
            this.logger.log("onButtons", onButtons);
            this.logger.log("lastBotNodeId", lastBotNodeId);

            if (lastBotNodeId === 'stop') {
                this.logger.warn(`Bot is stopped for case ${caseRecord.id}, ignoring message.`);
                return { customer, case: caseRecord };
            }



            // Bot handling: process interactive reply types if applicable.
            if (caseRecord.assignedTo === CaseHandler.BOT
                && !caseRecord.isNewCase
            ) {
                let botContent: string | undefined;

                if (message.type === 'interactive') {
                    if (message.interactive?.button_reply) {
                        botContent = message.interactive.button_reply.id;
                    } else if (message.interactive?.list_reply) {
                        botContent = message.interactive.list_reply.id;
                    }
                } else if (message.type === 'text' || message.type === 'image' || message.type === 'document') {

                    if (onButtons
                    ) {
                        if (!greetings.some(greet => message.text?.body.includes(greet)) && message.text?.body !== 'hi') {
                            this.logger.warn(`User replied manually instead of using interactive buttons. Sending fallback. lastNodeId: ${caseRecord.lastBotNodeId}`);
                            await this.botService.sendFallbackMessage(phoneNo, caseRecord.id);
                            return { customer, case: caseRecord };
                        }

                    }
                    // If it's text and there's a pending bot message (open-ended), use lastBotNodeId



                    if (
                        message.type === 'image' &&
                        caseRecord.lastBotNodeId !== 'main_question-fXmet'
                    ) {
                        this.logger.warn(`Image received when expecting interactive response. Sending fallback.`);
                        await this.botService.sendFallbackMessage(phoneNo, caseRecord.id)
                        return { customer, case: caseRecord }; // stop further processing
                    }

                    if (lastBotNodeId) {
                        // Store user reply related to last question
                        await this.prisma.message.update({
                            where: { id: storedMessage.id },
                            data: {
                                context: {
                                    type: 'reply-to',
                                    nodeId: lastBotNodeId,
                                    message: message.text?.body,
                                },
                            },
                        });

                        // Reset lastBotNodeId once reply is received
                        await this.prisma.case.update({
                            where: { id: caseRecord.id },
                            data: {
                                lastBotNodeId: null,
                            },
                        });

                        // 🔁 HARDCODED FLOW EXAMPLE

                        if (lastBotNodeId === 'main_question-FyKfq') {
                            await this.chatService.triggerStatusUpdate(caseRecord.id, Status.PROCESSING, 5, CaseHandler.USER);
                        }

                        if (lastBotNodeId === 'main_question-sZPbm') {
                            await this.botService.botSendByNodeId('main_message-eYTEm', phoneNo, caseRecord.id)
                            // await this.prisma.case.update({
                            //     where: { id: caseRecord.id },
                            //     data: { lastBotNodeId: nextNode.nodeId },
                            // });

                        }
                        if (lastBotNodeId === 'main_question-fXmet') {
                            this.logger.log(`Refund Screenshot request is ACTIVE...`);

                            const caseMeta = (caseRecord.meta ?? {}) as Prisma.JsonObject;

                            if (caseMeta.refundScreenshotActive !== true) {
                                caseMeta.refundScreenshotActive = true;
                                caseMeta.refundScreenshotTries = 0;
                                await this.prisma.case.update({
                                    where: { id: caseRecord.id },
                                    data: { meta: caseMeta }
                                });
                                this.logger.log(`Started Refund Screenshot Try Tracking.`);
                            }


                            if (message.type === 'image' && storedMessage?.media?.url) {
                                await this.prisma.case.update({
                                    where: { id: caseRecord.id },
                                    data: {
                                        lastBotNodeId: null,
                                    }
                                });
                                this.logger.log(`Received correct refund screenshot. Resetting counters.`);
                                await this.handleRefundScreenshot(storedMessage.media.url, phoneNo, caseRecord.id);

                            } else {
                                // 🛑 If user sends **text**, **button**, **list reply**, then IGNORE it.
                                if (['text', 'interactive'].includes(message.type)) {
                                    this.logger.warn(`User replied with text or button during refund screenshot request. Ignoring...`);
                                    await this.handleRefundRetry(caseRecord.id, phoneNo, 'screenshot1');
                                } else {

                                    // 🚨 Only retry when **media (wrong or blank)** came but not proper image
                                    this.logger.warn(`Wrong media type or invalid upload received. Retrying refund screenshot.`);
                                    await this.handleRefundRetry(caseRecord.id, phoneNo, 'screenshot1');
                                }
                            }

                            return { customer, case: caseRecord }; // VERY IMPORTANT - return here after refund block
                        }
                        else if (lastBotNodeId === 'main_message-done') {
                            await this.chatService.triggerStatusUpdate(caseRecord.id, Status.SOLVED, 5);
                        }


                        else if (lastBotNodeId === 'main_question-uEzow') {

                            await this.botService.botSendByNodeId('main_buttons-uXtwT', phoneNo, caseRecord.id)
                            // await this.prisma.case.update({
                            //     where: { id: caseRecord.id },
                            //     data: { lastBotNodeId: nextNode.nodeId },
                            // });

                        }
                        // else if (lastBotNodeId === 'main_question-nyJZr') {
                        //     await this.chatService.triggerStatusUpdate(caseRecord.id, Status.SOLVED, 5);
                        // }
                        else if (lastBotNodeId === 'main_question-BPjjT') {
                            await this.botService.botSendByNodeId('main_buttons-MYBpQ', phoneNo, caseRecord.id)
                        }
                        else if (lastBotNodeId === 'las') {
                            await this.chatService.triggerStatusUpdate(caseRecord.id, Status.SOLVED, 5);
                        }
                        else if (lastBotNodeId === 'main_question-FyKfq') {
                            await this.botService.botSendByNodeId('main_buttons-JYKle', phoneNo, caseRecord.id)
                        }


                        return { customer, case: caseRecord };
                    }
                    botContent = message.text?.body;
                }

                if (botContent && lastBotNodeId !== 'stop') {
                    this.logger.log(lastBotNodeId)
                    const node = await this.prisma.botReplies.findUnique({ where: { nodeId: botContent.trim() } })
                    this.logger.log(caseRecord.lastBotNodeId)
                    if (node) {
                        await this.botService.botSendByNodeId(botContent.trim(), phoneNo, caseRecord.id)
                        return { customer, case: caseRecord };
                    }

                    const cleanedContent = botContent.trim().toLowerCase();
                    if (greetings.some(greet => cleanedContent.includes(greet)) && botContent !== 'hi' && botContent !== 'main_message-ILtoz' && caseRecord.status !== Status.SOLVED) {
                        await this.botService.sendWelcomeMsg(phoneNo, caseRecord.id);
                    }


                    else this.logger.warn(`No botReply found for nodeId: ${botContent}`);
                } else {
                    this.logger.warn('No valid bot content found in the incoming message.');
                }
            }


            return { customer, case: caseRecord };
        } catch (error) {
            this.logger.error('Message processing failed', error.stack);
            throw error;
        }
    }

    async handleRefundScreenshot(url: string, phoneNo: string, caseId: number) {

        let vendDetails: MergedProductDetail;
        try {
            if (!caseId || !phoneNo) {
                this.logger.error('Missing caseId or phoneNo.');
                return;
            }

            const res = await this.cloudService.refundStatus(url);
            const utrId = res;

            if (!utrId) {
                this.logger.warn('No UTR ID extracted from screenshot. Retrying refund screenshot...');
                const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId } });
                const caseMeta = (caseRecord?.meta ?? {}) as Prisma.JsonObject;
                if (caseMeta?.refundScreenshotActive) {
                    await this.handleRefundRetry(caseId, phoneNo, 'screenshot1');
                }
                return;
            }
            this.logger.warn(`utrId is ${utrId}`)
            let txnInfo: TransactionInfoDto;

            txnInfo = await this.gg_backend_service.bankTxn(utrId);
            if (txnInfo === null) {
                await this.botService.botSendByNodeId('screenshot4', phoneNo, caseId);
                return;
            }





            if (txnInfo === null) {
                await this.botService.botSendByNodeId('screenshot2', phoneNo, caseId);
                return;
            }



            if (txnInfo && txnInfo.order_id) {
                vendDetails = await this.gg_backend_service.getVendDetails(txnInfo.order_id)
                if (!vendDetails.vendItems[0] || vendDetails.vendItems[0] === null) {
                    await this.botService.botSendByNodeId('screenshot2', phoneNo, caseId);
                    return
                }
                await this.gg_backend_service.createCustomerDetails(vendDetails, caseId)
            }

            if (txnInfo?.errorCode && txnInfo?.errorCode === 10002) {
                await this.botService.botSendByNodeId('screenshot-canceled', phoneNo, caseId);
                await this.prisma.case.update({ where: { id: caseId }, data: { lastBotNodeId: null, meta: { refundScreenshotActive: false, refundScreenshotTries: 0 } } })
                return;
            }



            if (!txnInfo || !txnInfo.order_id) {
                this.logger.warn('No txnInfo found for extracted UTR. Retrying refund screenshot...');
                const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId } });
                const caseMeta = (caseRecord?.meta ?? {}) as Prisma.JsonObject;
                const tries = Number(caseMeta.refundScreenshotTries || 0) + 1;
                if (caseMeta?.refundScreenshotActive) {
                    await this.handleRefundRetry(caseId, phoneNo, 'screenshot5');
                    await this.prisma.case.update({ where: { id: caseId }, data: { lastBotNodeId: 'main_question-fXmet', meta: { refundScreenshotActive: true, refundScreenshotTries: tries } } })
                }
                return;
            }

            const resInfo = await this.gg_backend_service.refundStatus(txnInfo.order_id, txnInfo.refund_id, txnInfo.machine_id);

            if (!resInfo?.status?.refundAmount || !resInfo?.status?.orderId || resInfo.status.refId === null) {
                this.logger.warn('No refund found for transaction. Retrying refund screenshot...');
                const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId } });
                const caseMeta = (caseRecord?.meta ?? {}) as Prisma.JsonObject;
                if (caseMeta?.refundScreenshotActive) {

                    if (txnInfo && txnInfo.order_id) {
                        this.logger.log(vendDetails);
                        await this.gg_backend_service.createCustomerDetails(vendDetails, caseId)
                        await this.botService.sendProductDetails(caseId, phoneNo, vendDetails);
                    }
                    await this.prisma.case.update({ where: { id: caseId }, data: { lastBotNodeId: "stop", meta: { refundScreenshotActive: false, refundScreenshotTries: 0 } } })
                }
                return;
            }


            // Refund successful
            await this.botService.sendRefundMessage(phoneNo, caseId, resInfo.status.refundDetailInfoList[0]);

            this.logger.log(`Refund processed successfully and refundScreenshot flow reset.`);

        } catch (error) {
            this.logger.error(`Error in handleRefundScreenshot: ${error}`);
            const caseRecord = await this.prisma.case.findUnique({ where: { id: caseId } });
            const caseMeta = (caseRecord?.meta ?? {}) as Prisma.JsonObject;
            const tries = Number(caseMeta.refundScreenshotTries || 0) + 1;
            await this.prisma.case.update({
                where: { id: caseId },
                data: {
                    meta: { ...caseMeta, refundScreenshotTries: tries },
                }
            });
            if (tries >= 3) {
                await this.handleRefundRetry(caseId, phoneNo, 'screenshot4');
            } else {
                await this.handleRefundRetry(caseId, phoneNo, 'screenshot5');
            }
        }
    }


    private async handleCustomerProfile(phoneNo: string, contact?: any) {
        const existingCustomer = await this.prisma.whatsAppCustomer.findUnique({
            where: { phoneNo },
        });

        if (!existingCustomer) {
            return await this.prisma.whatsAppCustomer.create({
                data: {
                    phoneNo,
                    name: contact?.profile?.name,
                    profileImageUrl: String(contact?.profile?.pictureUrl),
                },
            });
        }

        if (contact?.profile?.pictureUrl !== existingCustomer.profileImageUrl) {
            return await this.prisma.whatsAppCustomer.update({
                where: { id: existingCustomer.id },
                data: {
                    name: contact?.profile?.name,
                    profileImageUrl: contact?.profile?.pictureUrl,
                },
            });
        }

        return existingCustomer;
    }
    // private isCurrentTimeBetween(): boolean {
    //     const now = new Date();
    //     const currentMinutes = now.getHours() * 60 + now.getMinutes();

    //     const startMinutes = 2 * 60 + 30;  // 2:30 AM
    //     const endMinutes = 8 * 60 + 30;    // 8:30 AM

    //     return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
    // }
    private isCurrentTimeBetween(): boolean {
        const now = new Date();
        const istTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const hours = istTime.getHours();
        const minutes = istTime.getMinutes();

        // Only AM hours (0 to 11)
        if (hours >= 0 && hours < 12) {
            const currentMinutes = hours * 60 + minutes;

            const startMinutes = 2 * 60 + 30;  // 2:30 AM
            const endMinutes = 8 * 60 + 30;    // 8:30 AM

            return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
        }
        return false; // Not in AM
    }


    private async handleCaseManagement(customerId: number) {
        const activeCase = await this.prisma.case.findFirst({
            where: {
                customerId,
            },
            include: { customer: true, }
        });
        if (!activeCase) {
            const newCase = await this.prisma.case.create({
                data: {
                    status: Status.INITIATED,
                    customerId,
                    assignedTo: CaseHandler.BOT,
                    timer: new Date(Date.now() + 24 * 60 * 60 * 1000),
                },
                include: {
                    customer: true,
                    notes: true
                }
            });
            const customer = await this.prisma.whatsAppCustomer.findUnique({ where: { id: customerId } });
            this.logger.log(customer);
            if (customer && newCase) {
                this.logger.log("welcome1")
                await this.botService.sendWelcomeMsg(customer.phoneNo, newCase.id);
                await this.chatService.broadcastNewCase(newCase);
                if (this.isCurrentTimeBetween()) {
                    await this.botService.botSendByNodeId('off-time', customer.phoneNo, newCase.id);
                }
            }
            return newCase;
        }
        if (activeCase && activeCase.isNewCase) await this.prisma.case.update({ where: { id: activeCase.id }, data: { isNewCase: false } });

        const now: Date = new Date();
        const targetTime = () => {
            if (activeCase && activeCase.timer) {
                return new Date(activeCase.timer);
            }
            return null;
        };
        const condition1 = activeCase && activeCase.status === Status.SOLVED;
        const condition2 = targetTime() !== null && targetTime() < now;

        if (condition1 || condition2) {
            this.logger.log("welcome2")
            await this.chatService.triggerStatusUpdate(activeCase.id, Status.INITIATED, 5, 'BOT')
            await this.botService.sendWelcomeMsg(activeCase.customer.phoneNo, activeCase.id);
        }
        if (activeCase && activeCase.lastBotNodeId === 'main_message-ILtoz') {
            await this.prisma.case.update({ where: { id: activeCase.id }, data: { status: Status.SOLVED } })
        }

        if (activeCase) {
            const newCase = await this.prisma.case.findUnique({
                where: {
                    id: activeCase.id,
                },
                include: { customer: true, }
            });
            return newCase;
        }


    }

    async getApprovedTemplates() {
        const wabaId = process.env.WABA_ID
        const url = `https://graph.facebook.com/v22.0/${wabaId}/message_templates`;
        try {
            const response = await axios.get(url, {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                },
            });

            const templates = response.data.data.filter(
                (template: any) => template.status === 'APPROVED'
            );

            this.logger.log(`Fetched ${templates.length} approved templates.`);
            return templates;
        } catch (error) {
            const axiosError = error as AxiosError;
            this.logger.error('Error fetching WhatsApp templates', {
                error: axiosError.response?.data,
            });
            throw error;
        }
    }

    async sendTemplateMessage(
        to: string,
        templateName: string,
        languageCode = "en_US",
        parameters: { type: string; text: string }[] = []
    ) {
        this.logger.log(`sending template with template Name: ${templateName}, language code: ${languageCode} `);
        const payload = {
            messaging_product: 'whatsapp',
            to,
            type: 'template',
            template: {
                name: templateName.trim(),
                language: {
                    code: 'en'
                },
                components: [
                    {
                        type: 'body',
                        parameters,
                    }
                ]
            }
        };

        try {
            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json'
                }
            });
            this.logger.log(`Template message sent to ${to}`);
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            this.logger.error('WhatsApp Template API Error', {
                url: this.apiUrl,
                error: axiosError.response?.data,
                status: axiosError.response?.status
            });
            throw error;
        }
    }



    private async storeIncomingMessage(
        message: any,
        customerId: number,
        caseId: number
    ) {
        let media;

        if (message.type === 'image' || message.type === 'video') {
            const mediaData = message[message.type];
            if (mediaData.id) {
                const mediaId = mediaData.id;

                const existingMedia = await this.prisma.media.findFirst({
                    where: { waMediaId: mediaId },
                });
                if (existingMedia) {
                    this.logger.log(`Media already exists.`);
                    return;
                }
                else {
                    media = await this.handleMediaMessage(message);
                }
            }
        }

        let content: string;
        if (message.interactive?.button_reply) {
            content = message.interactive?.button_reply.title;
        } else if (message.interactive?.list_reply) {
            content = message.interactive.list_reply.title;
        } else if (message.type === 'text') {
            content = message.text?.body;
        }

        const messageData = {
            type: this.mapMessageType(message.type),
            senderType: SenderType.CUSTOMER,
            whatsAppCustomerId: customerId,
            caseId,
            recipient: this.phoneNumberId,
            timestamp: new Date(parseInt(message.timestamp) * 1000),
            waMessageId: message.id,
            text: content,
            media,
        };

        const savedM = await this.prisma.message.create({
            data: messageData,
            include: { media: true, location: true, whatsAppCustomer: true },
        });
        this.logger.log(savedM);

        await this.chatService.handleWhatsappMessage(savedM);
        return savedM;
    }

    private async handleMediaMessage(message: any) {
        const type = message.type;
        const media = message[type];
        const mediaId = media.id;



        try {
            const mediaUrl = await this.getMediaUrl(mediaId);
            const mediaFile = await this.downloadMedia(mediaUrl);
            this.logger.log(mediaFile);

            const cloudUrl = await this.cloudService.uploadFile(
                mediaFile,
                media.filename || `media-${Date.now()}`,
                media.mime_type
            );

            const mediaData = {
                create: {
                    url: cloudUrl,
                    mimeType: media.mime_type,
                    caption: media.caption,
                    fileName: media.filename,
                    size: media.file_size,
                    waMediaId: mediaId,

                    ...(type === 'image' || type === 'video' ? {
                        height: media.height,
                        width: media.width
                    } : {}),

                    ...(type === 'audio' ? {
                        duration: media.duration
                    } : {}),
                },
            };

            return mediaData;

        } catch (error) {
            this.logger.error('Failed to process media', error.stack);
            return { error: { message: 'Media processing failed' } };
        }
    }



    private mapMessageType(type: string): MessageType {
        const typeMap: Record<string, MessageType> = {
            text: MessageType.TEXT,
            image: MessageType.IMAGE,
            video: MessageType.VIDEO,
            audio: MessageType.AUDIO,
            document: MessageType.DOCUMENT,
            sticker: MessageType.STICKER,
            contacts: MessageType.CONTACT,
            location: MessageType.LOCATION,
            interactive: MessageType.INTERACTIVE,
            list_reply: MessageType.LIST_REPLY,
            button_reply: MessageType.BUTTON_REPLY,
        };

        return typeMap[type] || MessageType.TEXT;
    }

    async sendTextMessage(to: string, text: string) {
        return this.sendWhatsAppRequest({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: { body: text },
        });
    }

    async sendInteractiveList(to: string, config: {
        header?: string;
        body: string;
        footer?: string;
        buttonText: string;
        sections: any[];
    }) {
        const payload: WhatsAppMessagePayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'list',
                body: { text: config.body },
                action: {
                    button: config.buttonText,
                    sections: config.sections,
                },
                ...(config.header && { header: { type: 'text', text: config.header } }),
                ...(config.footer && { footer: { text: config.footer } }),
            },
        };

        return this.sendWhatsAppRequest(payload);
    }

    async sendButtons(to: string, config: {
        header?: string;
        body: string;
        footer?: string;
        buttons: any[];
    }) {
        const payload: WhatsAppMessagePayload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'interactive',
            interactive: {
                type: 'button',
                body: { text: config.body },
                action: { buttons: config.buttons },
                ...(config.header && { header: { type: 'text', text: config.header } }),
                ...(config.footer && { footer: { text: config.footer } }),
            },
        };

        return this.sendWhatsAppRequest(payload);
    }

    async sendImageToCustomer(
        to: string,
        imageUrl: string,
        caption?: string
    ): Promise<void> {
        try {
            if (!to || !imageUrl) {
                throw new Error('Recipient phone number and image URL are required');
            }
            const payload: WhatsAppMessagePayload = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to,
                type: 'image',
                image: {
                    link: `${imageUrl}`,
                    caption: caption,
                },
            };
            const response = await this.sendWhatsAppRequest(payload);
            this.logger.log(`Image payload response: ${response}`);
        } catch (error) {
            this.logger.error(`Failed to send image to ${to}: ${error.message}`, error.stack);
            throw new Error('Failed to send image message');
        }
    }

    private async getMediaUrl(mediaId: string) {
        this.logger.log(mediaId);
        const response = await axios.get(
            `https://graph.facebook.com/v22.0/${mediaId}`,
            { headers: { Authorization: `Bearer ${this.accessToken}` } }
        );
        return response.data.url;
    }

    private async downloadMedia(url: string): Promise<Buffer> {
        try {
            const response = await axios.get(url, {
                headers: { Authorization: `Bearer ${this.accessToken}` },
                responseType: 'arraybuffer',
            });
            this.logger.log(`Response received from ${url}`);
            return Buffer.from(response.data, 'binary');
        } catch (error) {
            this.logger.error(`Error downloading media from ${url}`, error.stack);
            throw new Error('Error downloading media');
        }
    }

    private async sendWhatsAppRequest(payload: WhatsAppMessagePayload) {
        try {
            const response = await axios.post(this.apiUrl, payload, {
                headers: {
                    Authorization: `Bearer ${this.accessToken}`,
                    'Content-Type': 'application/json',
                },
            });
            this.logger.log(`Message :${payload}`, response.data);
            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            this.logger.error('WhatsApp API Error', {
                url: this.apiUrl,
                error: axiosError.response?.data,
                status: axiosError.response?.status,
            });
        }
    }


    private async handleTimer(caseId: number) {
        try {
            // Retrieve the current timer field (if needed)
            const caseRecord = await this.prisma.case.findUnique({
                where: { id: caseId },
                select: { timer: true }
            });

            if (caseRecord && caseRecord.timer) {
                // Calculate 24 hours in the future
                const newTimer = new Date(Date.now() + 24 * 60 * 60 * 1000);

                await this.prisma.case.update({
                    where: { id: caseId },
                    data: {
                        timer: newTimer
                    }
                });
            }
        } catch (error) {
            console.error("Error updating agent deadline:", error);
        }
    }

}
