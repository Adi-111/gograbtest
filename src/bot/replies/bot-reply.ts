export const flow = {

    "flow": {
        "whatsappReplies": [
            {
                "nodeId": "hey",
                "flowNodeType": "InteractiveList",
                "header": {
                    "type": "text",
                    "text": "Hi {{1}}, Welcome to Go-Grab! 🎉"
                },
                "body": {
                    "text": "Our goal is to uplift your mood and fulfill your cravings.\nHow can we enhance your experience today?"
                },
                "footer": {
                    "text": "Choose an option below 👇"
                },
                "action": {
                    "button": "MAIN MENU",
                    "sections": [
                        {
                            "title": "Support Options",
                            "rows": [
                                {

                                    "title": "Order/Refund Issues",
                                    "id": "main_buttons-bCVmo"
                                },
                                {

                                    "title": "Machine Problems",
                                    "id": "main_buttons-hSJwk"
                                },
                                {

                                    "title": "Product Quality",
                                    "id": "main_question-sZPbm"
                                },
                                {

                                    "title": "RFID Recharge",
                                    "id": "main_message-DqzXV"
                                },
                                {

                                    "title": "Feedback/Suggestions",
                                    "id": "main_question-nyJZr"
                                }
                            ]
                        }
                    ]
                }
            },

            {
                "nodeId": "main_buttons-bCVmo",
                "flowNodeType": "InteractiveButtons",
                "body": {
                    "text": "⚠️ Refund Information:\nAutomatic refunds usually process within 15 mins. Check your bank account directly (not UPI apps).\n\nHave you received your refund?"
                },
                "action": {
                    "buttons": [
                        {
                            "type": "reply",
                            "reply": {

                                "title": "✅ Yes, Received",
                                "id": "main_buttons-nfdhg"
                            }
                        },
                        {
                            "type": "reply",
                            "reply": {

                                "title": "❌ Not Received",
                                "id": "main_question-fXmet"
                            }
                        }
                    ]
                }
            },

            {
                "nodeId": "main_question-fXmet",
                "flowNodeType": "Question",
                "replies": [
                    {
                        "replyType": "text",
                        "text": {
                            "body": "Please share:\n1. UPI transaction screenshot\n2. Machine location\n3. Time of transaction\n\nWe'll escalate immediately! 🚨"
                        }
                    }
                ]
            },
            {
                "nodeId": "main_question-nyJZr",
                "flowNodeType": "Question",
                "replies": [
                    {
                        "replyType": "Text",
                        "text": { "body": "Your feedback is crucial to us. Please share your thoughts or suggestions." }
                    }
                ]
            },
            {
                "nodeId": "main_message-DqzXV",
                "flowNodeType": "Message",
                "replies": [
                    {
                        "replyType": "text",
                        "text": {
                            "body": "🔋 RFID Recharge Steps:\n\n1. Scan PayTM QR code (Min. ₹100)\n2. Reply with:\n   - Student Name\n   - RFID No. (GG-IES-XXXXX)\n   - Payment Proof\n   - Card Photo\n\n⚠️ No refunds after recharge\n⏳ 6-8 hours processing"
                        }
                    }
                ]
            },
            {
                "nodeId": "main_buttons-hSJwk",
                "flowNodeType": "InteractiveButtons",
                "body": {
                    "text": "🛠️ Machine Issue Type:"
                },
                "action": {
                    "buttons": [
                        {
                            "type": "reply",
                            "reply": {

                                "title": "🚫 Offline Machine",
                                "id": "main_question-uEzow"
                            }
                        },
                        {
                            "type": "reply",
                            "reply": {

                                "title": "⚠️ Other Issue",
                                "id": "main_question-BPjjT"
                            }
                        }
                    ]
                }
            },
            {
                "nodeId": "main_question-uEzow",
                "flowNodeType": "Question",
                "replies": [
                    {
                        "replyType": "text",
                        "text": {
                            "body": "📍 Please send:\n1. Machine location\n2. Machine ID (if visible)\n3. Photo of error\n\nWe'll dispatch a technician! 🔧"
                        }
                    }
                ]
            },
            {
                "nodeId": "main_buttons-nfdhg",
                "flowNodeType": "InteractiveButtons",
                "body": {
                    "text": "🎉 Great news! Need help with anything else?"
                },
                "action": {
                    "buttons": [
                        {
                            "type": "reply",
                            "reply": {

                                "title": "Yes",
                                "id": "hey"
                            }
                        },
                        {
                            "type": "reply",
                            "reply": {

                                "title": "No, Exit",
                                "id": "main_message-ILtoz"
                            }
                        }
                    ]
                }
            },
            {
                "nodeId": "main_question-BPjjT",
                "flowNodeType": "Question",
                "replies": [
                    {
                        "replyType": "Text",
                        "text": { "body": "Please tell us what issues you are facing while using the machine. We are all ears." }
                    }
                ]
            },
            {
                "nodeId": "main_question-sZPbm",
                "flowNodeType": "Question",
                "replies": [
                    {
                        "replyType": "Text",
                        "text": { "body": "Please tell us the issue. We'll make sure that doesn't happen again!!" }
                    }
                ]
            },
            {
                "nodeId": "main_message-ILtoz",
                "flowNodeType": "Message",
                "replies": [
                    {
                        "replyType": "text",
                        "text": {
                            "body": "🍫 Happy Snacking!\nVisit again soon for more delicious treats!\n\n[Chat auto-closes in 2 minutes]"
                        }
                    }
                ]
            }
        ]
    }
}
export interface Flow {
    [nodeId: string]: FlowNode;
}

export interface FlowNode {
    nodeId?: string;
    flowNodeType: FlowNodeType;
    body?: { text: string };
    replies?: { replyType: string; text: { body: string } }[];
    items?: { buttonText: string; nodeResultId: string }[];
    sections?: { title: string; rows: { title: string; nodeResultId: string }[] }[];
    header?: { type: string; text: string };
    footer?: { text: string };
    action?: {
        button?: string;
        buttons?: { type: string; reply: { id: string; title: string; nodeResultId: string } }[];
        sections?: { title: string; rows: { id: string; title: string; nodeResultId: string }[] }[];
    };
}
export enum FlowNodeType {
    Message = 'Message',
    InteractiveButtons = 'InteractiveButtons',
    InteractiveList = 'InteractiveList',
    Question = 'Question',
}