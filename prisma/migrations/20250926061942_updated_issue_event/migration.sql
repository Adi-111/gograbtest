-- AlterTable
ALTER TABLE "public"."IssueEvent" ADD COLUMN     "falsePositive" BOOLEAN,
ADD COLUMN     "machine_id" TEXT,
ADD COLUMN     "utr" TEXT;
