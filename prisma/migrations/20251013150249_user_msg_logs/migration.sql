-- CreateTable
CREATE TABLE "public"."DailyUserMessageSummary" (
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

-- CreateIndex
CREATE INDEX "DailyUserMessageSummary_date_idx" ON "public"."DailyUserMessageSummary"("date");

-- CreateIndex
CREATE INDEX "DailyUserMessageSummary_userId_idx" ON "public"."DailyUserMessageSummary"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUserMessageSummary_userId_date_key" ON "public"."DailyUserMessageSummary"("userId", "date");

-- AddForeignKey
ALTER TABLE "public"."DailyUserMessageSummary" ADD CONSTRAINT "DailyUserMessageSummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyUserMessageSummary" ADD CONSTRAINT "DailyUserMessageSummary_firstMessageId_fkey" FOREIGN KEY ("firstMessageId") REFERENCES "public"."Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DailyUserMessageSummary" ADD CONSTRAINT "DailyUserMessageSummary_lastMessageId_fkey" FOREIGN KEY ("lastMessageId") REFERENCES "public"."Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
