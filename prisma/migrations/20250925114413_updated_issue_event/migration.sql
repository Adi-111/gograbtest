-- AlterTable
ALTER TABLE "public"."IssueEvent" ADD COLUMN     "falsePositive" BOOLEAN DEFAULT false,
ADD COLUMN     "machine_id" TEXT,
ADD COLUMN     "utr" INTEGER;
