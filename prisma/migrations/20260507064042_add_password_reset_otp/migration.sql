-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('very_positive', 'positive', 'neutral', 'negative', 'very_negative');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "passwordResetExpiry" TIMESTAMP(3),
ADD COLUMN     "passwordResetOtp" TEXT;

-- CreateTable
CREATE TABLE "IssueEventSentiment" (
    "id" SERIAL NOT NULL,
    "issueEventId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "customerPhoneNumbers" TEXT[],
    "totalMessages" INTEGER NOT NULL,
    "firstMessageAt" TIMESTAMP(3) NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL,
    "overallSentiment" "Sentiment" NOT NULL,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueEventSentiment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IssueEventSentiment_issueEventId_key" ON "IssueEventSentiment"("issueEventId");

-- CreateIndex
CREATE INDEX "IssueEventSentiment_userId_idx" ON "IssueEventSentiment"("userId");

-- CreateIndex
CREATE INDEX "IssueEventSentiment_overallSentiment_idx" ON "IssueEventSentiment"("overallSentiment");

-- CreateIndex
CREATE INDEX "IssueEventSentiment_firstMessageAt_idx" ON "IssueEventSentiment"("firstMessageAt");

-- AddForeignKey
ALTER TABLE "IssueEventSentiment" ADD CONSTRAINT "IssueEventSentiment_issueEventId_fkey" FOREIGN KEY ("issueEventId") REFERENCES "IssueEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueEventSentiment" ADD CONSTRAINT "IssueEventSentiment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
