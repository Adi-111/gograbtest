-- CreateTable
CREATE TABLE "ExpiredEvent" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "issueEventId" INTEGER,
    "customerId" INTEGER NOT NULL,
    "lastAssignedTo" "CaseHandler" NOT NULL,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "timerSetAt" TIMESTAMP(3) NOT NULL,
    "expiredAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "lastBotNodeId" TEXT,
    "wasAgentNotified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpiredEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpiredEvent_caseId_key" ON "ExpiredEvent"("caseId");

-- CreateIndex
CREATE INDEX "ExpiredEvent_caseId_idx" ON "ExpiredEvent"("caseId");

-- CreateIndex
CREATE INDEX "ExpiredEvent_issueEventId_idx" ON "ExpiredEvent"("issueEventId");

-- CreateIndex
CREATE INDEX "ExpiredEvent_createdAt_idx" ON "ExpiredEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ExpiredEvent_lastBotNodeId_idx" ON "ExpiredEvent"("lastBotNodeId");

-- AddForeignKey
ALTER TABLE "ExpiredEvent" ADD CONSTRAINT "ExpiredEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
