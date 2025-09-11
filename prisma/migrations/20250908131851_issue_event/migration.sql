-- AlterTable
ALTER TABLE "public"."Message" ADD COLUMN     "issueEventId" INTEGER;

-- CreateTable
CREATE TABLE "public"."IssueEvent" (
    "id" SERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "customerId" INTEGER NOT NULL,
    "userId" INTEGER,
    "machineName" TEXT,
    "issueDetails" TEXT,
    "agentCalledAt" TIMESTAMP(3),
    "agentLinkedAt" TIMESTAMP(3),
    "endTimeAt" TIMESTAMP(3),
    "refund" BOOLEAN NOT NULL DEFAULT false,
    "manualRefund" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_issueEventId_fkey" FOREIGN KEY ("issueEventId") REFERENCES "public"."IssueEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
