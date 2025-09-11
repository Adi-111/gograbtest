/*
  Warnings:

  - Added the required column `caseId` to the `IssueEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "public"."IssueEvent" ADD COLUMN     "caseId" INTEGER NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."IssueEvent" ADD CONSTRAINT "IssueEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "public"."Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
