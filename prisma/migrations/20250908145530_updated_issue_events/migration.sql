-- CreateEnum
CREATE TYPE "public"."IssueEventStatus" AS ENUM ('OPEN', 'CLOSED');

-- DropForeignKey
ALTER TABLE "public"."IssueEvent" DROP CONSTRAINT "IssueEvent_caseId_fkey";

-- AlterTable
ALTER TABLE "public"."IssueEvent" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "status" "public"."IssueEventStatus" NOT NULL DEFAULT 'OPEN';

-- CreateIndex
CREATE INDEX "IssueEvent_caseId_idx" ON "public"."IssueEvent"("caseId");

-- AddForeignKey
ALTER TABLE "public"."IssueEvent" ADD CONSTRAINT "IssueEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."Case"("id") ON DELETE CASCADE ON UPDATE CASCADE;
