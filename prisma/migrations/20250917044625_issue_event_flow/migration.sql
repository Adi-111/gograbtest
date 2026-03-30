-- CreateEnum
CREATE TYPE "public"."IssueEventStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "public"."IssueType" AS ENUM ('REFUND', 'MACHINE_OFFLINE', 'MACHINE_NOT_WORKING', 'FEEDBACK', 'MACHINE_NOT_REFILLED', 'OTHER');

-- CreateEnum
CREATE TYPE "public"."RefundMode" AS ENUM ('AUTO', 'MANUAL');

-- DropForeignKey
ALTER TABLE "public"."StatusEvent" DROP CONSTRAINT "StatusEvent_userId_fkey";

-- AlterTable
ALTER TABLE "public"."Case" ADD COLUMN     "currentIssueId" INTEGER;

-- AlterTable
ALTER TABLE "public"."Message" ADD COLUMN     "issueEventId" INTEGER;

-- AlterTable
ALTER TABLE "public"."StatusEvent" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."Machine" (
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
CREATE TABLE "public"."IssueEvent" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "customerId" INTEGER NOT NULL,
    "userId" INTEGER,
    "status" "public"."IssueEventStatus" NOT NULL DEFAULT 'OPEN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "machineName" TEXT,
    "issueType" "public"."IssueType" NOT NULL DEFAULT 'OTHER',
    "refundMode" "public"."RefundMode",
    "refundAmountMinor" INTEGER,
    "resolutionNotes" TEXT,
    "agentCalledAt" TIMESTAMP(3),
    "agentLinkedAt" TIMESTAMP(3),
    "endTimeAt" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IssueEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueEvent_caseId_idx" ON "public"."IssueEvent"("caseId");

-- CreateIndex
CREATE INDEX "IssueEvent_status_isActive_idx" ON "public"."IssueEvent"("status", "isActive");

-- CreateIndex
CREATE INDEX "IssueEvent_issueType_idx" ON "public"."IssueEvent"("issueType");

-- AddForeignKey
ALTER TABLE "public"."IssueEvent" ADD CONSTRAINT "IssueEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StatusEvent" ADD CONSTRAINT "StatusEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_issueEventId_fkey" FOREIGN KEY ("issueEventId") REFERENCES "public"."IssueEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
