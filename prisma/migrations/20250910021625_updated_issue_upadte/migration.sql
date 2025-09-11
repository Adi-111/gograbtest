/*
  Warnings:

  - You are about to drop the column `issueDetails` on the `IssueEvent` table. All the data in the column will be lost.
  - You are about to drop the column `manualRefund` on the `IssueEvent` table. All the data in the column will be lost.
  - You are about to drop the column `refund` on the `IssueEvent` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "public"."IssueType" AS ENUM ('REFUND', 'MACHINE_OFFLINE', 'MACHINE_NOT_WORKING', 'FEEDBACK', 'MACHINE_NOT_REFILLED', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RefundMode" AS ENUM ('AUTO', 'MANUAL');

-- AlterTable
ALTER TABLE "public"."IssueEvent" DROP COLUMN "issueDetails",
DROP COLUMN "manualRefund",
DROP COLUMN "refund",
ADD COLUMN     "issueType" "public"."IssueType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "refundAmountMinor" INTEGER,
ADD COLUMN     "refundMode" "public"."RefundMode",
ADD COLUMN     "resolutionNotes" TEXT;

-- CreateIndex
CREATE INDEX "IssueEvent_status_isActive_idx" ON "public"."IssueEvent"("status", "isActive");

-- CreateIndex
CREATE INDEX "IssueEvent_issueType_idx" ON "public"."IssueEvent"("issueType");
