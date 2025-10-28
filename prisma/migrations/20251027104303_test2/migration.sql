-- CreateEnum
CREATE TYPE "ReplyType" AS ENUM ('InteractiveList', 'InteractiveButtons', 'Question', 'Message', 'Media');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'AGENT');

-- CreateEnum
CREATE TYPE "IssueEventStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "IssueType" AS ENUM ('REFUND', 'MACHINE_OFFLINE', 'MACHINE_NOT_WORKING', 'FEEDBACK', 'MACHINE_NOT_REFILLED', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundMode" AS ENUM ('AUTO', 'MANUAL');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'AUDIO', 'DOCUMENT', 'STICKER', 'CONTACT', 'LOCATION', 'INTERACTIVE', 'SYSTEM', 'LIST_REPLY', 'BUTTON_REPLY');

-- CreateEnum
CREATE TYPE "SenderType" AS ENUM ('USER', 'CUSTOMER', 'BOT');

-- CreateEnum
CREATE TYPE "SystemMessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED', 'UPDATED', 'DISABLED');

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('INITIATED', 'BOT_HANDLING', 'ASSIGNED', 'PROCESSING', 'SOLVED', 'UNSOLVED');

-- CreateEnum
CREATE TYPE "CaseHandler" AS ENUM ('USER', 'BOT');

-- CreateTable
CREATE TABLE "Machine" (
    "machine_id" TEXT NOT NULL,
    "machine_name" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "machine_status" BOOLEAN NOT NULL,
    "machine_type" TEXT NOT NULL,
    "machine_capacity" INTEGER NOT NULL,
    "total_coils" INTEGER NOT NULL,
    "password" TEXT NOT NULL,
    "date_created" TIMESTAMP(3) NOT NULL,
    "left_units" INTEGER NOT NULL,
    "last_refill_time" TIMESTAMP(3),
    "last_refill_by" TEXT,
    "last_refill_availability" TEXT,
    "availability" TEXT,
    "last_transaction" TIMESTAMP(3),
    "accumulated_downtime" TEXT,
    "time_difference_from_last_transaction" TEXT,
    "last_report_time" TIMESTAMP(3),
    "refill_report_time_difference" TEXT,
    "variety_score" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("machine_id")
);

-- CreateTable
CREATE TABLE "Bot" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'ChatBot',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuickReplies" (
    "id" SERIAL NOT NULL,
    "flowNodeType" "ReplyType" NOT NULL,
    "header" JSONB,
    "body" JSONB,
    "footer" JSONB,
    "action" JSONB,
    "replies" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotReplies" (
    "nodeId" TEXT NOT NULL,
    "flowNodeType" "ReplyType" NOT NULL,
    "header" JSONB,
    "body" JSONB,
    "footer" JSONB,
    "action" JSONB,
    "replies" JSONB,
    "botId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'AGENT',
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyUserMessageSummary" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "firstMessageId" INTEGER,
    "lastMessageId" INTEGER,
    "firstTimestamp" TIMESTAMP(3),
    "lastTimestamp" TIMESTAMP(3),
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "activeDuration" INTEGER,
    "firstText" TEXT,
    "lastText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyUserMessageSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppCustomer" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phoneNo" TEXT NOT NULL,
    "profileImageUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppCustomer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Case" (
    "id" SERIAL NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'INITIATED',
    "assignedTo" "CaseHandler" NOT NULL DEFAULT 'BOT',
    "unread" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "userId" INTEGER,
    "botId" INTEGER,
    "timer" TIMESTAMP(3),
    "lastBotNodeId" TEXT,
    "meta" JSONB,
    "currentIssueId" INTEGER,
    "isNewCase" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Case_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueEvent" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "userId" INTEGER,
    "status" "IssueEventStatus" NOT NULL DEFAULT 'OPEN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "machine_id" TEXT,
    "machineName" TEXT,
    "issueType" "IssueType" NOT NULL DEFAULT 'OTHER',
    "refundMode" "RefundMode",
    "utr" TEXT,
    "falsePositive" BOOLEAN,
    "coil" INTEGER,
    "orderTime" TEXT,
    "refundAmountMinor" INTEGER,
    "resolutionNotes" TEXT,
    "agentCalledAt" TIMESTAMP(3),
    "agentLinkedAt" TIMESTAMP(3),
    "endTimeAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusEvent" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" INTEGER,
    "previousStatus" "Status" NOT NULL,
    "newStatus" "Status" NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FailedMsgEvent" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tries" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,

    CONSTRAINT "FailedMsgEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Note" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "caseId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" SERIAL NOT NULL,
    "text" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" SERIAL NOT NULL,
    "type" "MessageType" NOT NULL,
    "replyType" "ReplyType",
    "senderType" "SenderType" NOT NULL,
    "text" TEXT,
    "recipient" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "waMessageId" TEXT,
    "context" JSONB,
    "systemStatus" "SystemMessageStatus",
    "error" JSONB,
    "userId" INTEGER,
    "botId" INTEGER,
    "parentMessageId" INTEGER,
    "caseId" INTEGER,
    "whatsAppCustomerId" INTEGER,
    "issueEventId" INTEGER,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Media" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER,
    "waMediaId" TEXT,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "caption" TEXT,
    "fileName" TEXT,
    "size" INTEGER,
    "duration" INTEGER,
    "height" INTEGER,
    "width" INTEGER,

    CONSTRAINT "Media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "name" TEXT,
    "address" TEXT,
    "url" TEXT,
    "accuracy" DOUBLE PRECISION,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "product_price" INTEGER NOT NULL,
    "brand_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hsn_code" TEXT,
    "bar_code" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "moq" INTEGER NOT NULL,
    "zoho_item_id" TEXT NOT NULL,
    "purchase_rate" DOUBLE PRECISION NOT NULL,
    "inter_state_tax_rate" DOUBLE PRECISION NOT NULL,
    "intra_state_tax_rate" DOUBLE PRECISION NOT NULL,
    "product_type" TEXT,
    "markdown_percentage" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER,
    "name" JSONB,
    "phones" JSONB NOT NULL,
    "emails" JSONB,
    "addresses" JSONB,
    "org" JSONB,
    "birthday" TIMESTAMP(3),
    "urls" JSONB,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Interactive" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER,
    "type" TEXT NOT NULL,
    "header" JSONB,
    "body" JSONB,
    "footer" JSONB,
    "action" JSONB NOT NULL,
    "parameters" JSONB,
    "userResponse" JSONB,

    CONSTRAINT "Interactive_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrderDetails" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "coils" TEXT[],
    "productIds" TEXT[],
    "dispenseStatuses" TEXT[],
    "machine_id" TEXT,
    "verdict" TEXT,
    "orderTime" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOrderDetails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyAnalytics" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "casesOpened" INTEGER NOT NULL DEFAULT 0,
    "casesPending" INTEGER NOT NULL DEFAULT 0,
    "casesSolved" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByOperator" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByBot" INTEGER NOT NULL DEFAULT 0,
    "casesExpired" INTEGER NOT NULL DEFAULT 0,
    "casesProcessing" INTEGER NOT NULL DEFAULT 0,
    "missedChats" INTEGER NOT NULL DEFAULT 0,
    "avgCaseDuration" DOUBLE PRECISION DEFAULT 0,
    "totalCaseDuration" DOUBLE PRECISION DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagAnalytics" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "tagText" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overall_analytics" (
    "id" SERIAL NOT NULL,
    "totalCases" INTEGER NOT NULL DEFAULT 0,
    "casesProcessing" INTEGER NOT NULL DEFAULT 0,
    "casesSolved" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByBot" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByOperator" INTEGER NOT NULL DEFAULT 0,
    "casesExpired" INTEGER NOT NULL DEFAULT 0,
    "casesOpen" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overall_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HourlyAnalytics" (
    "id" SERIAL NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "casesOpened" INTEGER NOT NULL DEFAULT 0,
    "casesPending" INTEGER NOT NULL DEFAULT 0,
    "casesSolved" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByOperator" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByBot" INTEGER NOT NULL DEFAULT 0,
    "casesExpired" INTEGER NOT NULL DEFAULT 0,
    "casesProcessing" INTEGER NOT NULL DEFAULT 0,
    "missedChats" INTEGER NOT NULL DEFAULT 0,
    "avgCaseDuration" DOUBLE PRECISION DEFAULT 0,
    "totalCaseDuration" DOUBLE PRECISION DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HourlyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_CaseTags" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_CaseTags_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReplies_id_key" ON "QuickReplies"("id");

-- CreateIndex
CREATE UNIQUE INDEX "BotReplies_nodeId_key" ON "BotReplies"("nodeId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "DailyUserMessageSummary_date_idx" ON "DailyUserMessageSummary"("date");

-- CreateIndex
CREATE INDEX "DailyUserMessageSummary_userId_idx" ON "DailyUserMessageSummary"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUserMessageSummary_userId_date_key" ON "DailyUserMessageSummary"("userId", "date");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppCustomer_phoneNo_key" ON "WhatsAppCustomer"("phoneNo");

-- CreateIndex
CREATE INDEX "Case_status_idx" ON "Case"("status");

-- CreateIndex
CREATE INDEX "Case_customerId_idx" ON "Case"("customerId");

-- CreateIndex
CREATE INDEX "IssueEvent_caseId_idx" ON "IssueEvent"("caseId");

-- CreateIndex
CREATE INDEX "IssueEvent_status_isActive_idx" ON "IssueEvent"("status", "isActive");

-- CreateIndex
CREATE INDEX "IssueEvent_issueType_idx" ON "IssueEvent"("issueType");

-- CreateIndex
CREATE INDEX "StatusEvent_caseId_idx" ON "StatusEvent"("caseId");

-- CreateIndex
CREATE INDEX "FailedMsgEvent_caseId_idx" ON "FailedMsgEvent"("caseId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_text_key" ON "Tag"("text");

-- CreateIndex
CREATE INDEX "Message_senderType_idx" ON "Message"("senderType");

-- CreateIndex
CREATE INDEX "Message_recipient_idx" ON "Message"("recipient");

-- CreateIndex
CREATE INDEX "Message_timestamp_idx" ON "Message"("timestamp");

-- CreateIndex
CREATE INDEX "Message_type_idx" ON "Message"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Media_messageId_key" ON "Media"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_messageId_key" ON "Location"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_product_id_key" ON "Product"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "Interactive_messageId_key" ON "Interactive"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnalytics_date_key" ON "DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "DailyAnalytics_date_idx" ON "DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "TagAnalytics_date_idx" ON "TagAnalytics"("date");

-- CreateIndex
CREATE INDEX "TagAnalytics_tagText_idx" ON "TagAnalytics"("tagText");

-- CreateIndex
CREATE UNIQUE INDEX "TagAnalytics_date_tagText_key" ON "TagAnalytics"("date", "tagText");

-- CreateIndex
CREATE UNIQUE INDEX "HourlyAnalytics_datetime_key" ON "HourlyAnalytics"("datetime");

-- CreateIndex
CREATE INDEX "HourlyAnalytics_datetime_idx" ON "HourlyAnalytics"("datetime");

-- CreateIndex
CREATE INDEX "_CaseTags_B_index" ON "_CaseTags"("B");

-- AddForeignKey
ALTER TABLE "DailyUserMessageSummary" ADD CONSTRAINT "DailyUserMessageSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUserMessageSummary" ADD CONSTRAINT "DailyUserMessageSummary_firstMessageId_fkey" FOREIGN KEY ("firstMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyUserMessageSummary" ADD CONSTRAINT "DailyUserMessageSummary_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WhatsAppCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEvent" ADD CONSTRAINT "IssueEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusEvent" ADD CONSTRAINT "StatusEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailedMsgEvent" ADD CONSTRAINT "FailedMsgEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailedMsgEvent" ADD CONSTRAINT "FailedMsgEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_whatsAppCustomerId_fkey" FOREIGN KEY ("whatsAppCustomerId") REFERENCES "WhatsAppCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_issueEventId_fkey" FOREIGN KEY ("issueEventId") REFERENCES "IssueEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interactive" ADD CONSTRAINT "Interactive_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CaseTags" ADD CONSTRAINT "_CaseTags_A_fkey" FOREIGN KEY ("A") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_CaseTags" ADD CONSTRAINT "_CaseTags_B_fkey" FOREIGN KEY ("B") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
