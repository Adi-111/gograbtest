import type { Job } from 'pg-boss';

// Re-export for convenience
export type { Job };

// Define your job types here
export enum QueueName {
  WHATSAPP_TEXT = 'whatsapp-text',
  WHATSAPP_BUTTONS = 'whatsapp-buttons',
  WHATSAPP_LIST = 'whatsapp-list',
  WHATSAPP_IMAGE = 'whatsapp-image',
  SEND_TEMPLATE = 'send-template',
  PROCESS_REFUND = 'process-refund',
  SYNC_ANALYTICS = 'sync-analytics',
  NOTIFICATION = 'notification',
  BOT_MESSAGE = 'bot-message',
}

// Job payload types
export interface WhatsAppTextJob {
  phoneNo: string;
  text: string;
  caseId: number;
  messageId: number;
}

export interface WhatsAppButtonsJob {
  phoneNo: string;
  header?: string;
  body: string;
  footer?: string;
  buttons: Array<{ id: string; title: string }>;
  caseId: number;
  messageId: number;
}

export interface WhatsAppListJob {
  phoneNo: string;
  body: string;
  buttonText: string;
  footer?: string;
  sections: any[];
  caseId: number;
  messageId: number;
}

export interface WhatsAppImageJob {
  phoneNo: string;
  imageUrl: string;
  caption?: string;
  caseId: number;
  messageId?: number;
}

export interface BotMessageJob {
  nodeId: string;
  phoneNo: string;
  caseId: number;
}

// Legacy - kept for backwards compatibility
export interface WhatsAppMessageJob {
  phoneNo: string;
  message: string;
  caseId: number;
  userId?: number;
}

export interface SendTemplateJob {
  templateName: string;
  caseId: number;
  userId: number;
  params?: Record<string, string>;
}

export interface ProcessRefundJob {
  issueEventId: number;
  amount: number;
  utr?: string;
}

export interface NotificationJob {
  type: 'email' | 'push' | 'sms';
  recipient: string;
  subject?: string;
  body: string;
  metadata?: Record<string, unknown>;
}

// Job options
export interface JobOptions {
  priority?: number; // Higher = more urgent (default: 0)
  retryLimit?: number;
  retryDelay?: number; // seconds
  startAfter?: Date | string | number; // Delayed job
  expireInSeconds?: number;
  singletonKey?: string; // Prevent duplicate jobs
  onComplete?: boolean; // Trigger completion handler
}

