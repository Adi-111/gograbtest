/*
  Warnings:

  - The primary key for the `BotReplies` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `id` on the `BotReplies` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "BotReplies" DROP CONSTRAINT "BotReplies_pkey",
DROP COLUMN "id";

-- CreateTable
CREATE TABLE "FailedMsgEvent" (
    "id" SERIAL NOT NULL,
    "caseId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tries" INTEGER NOT NULL,

    CONSTRAINT "FailedMsgEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FailedMsgEvent_caseId_idx" ON "FailedMsgEvent"("caseId");

-- AddForeignKey
ALTER TABLE "FailedMsgEvent" ADD CONSTRAINT "FailedMsgEvent_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FailedMsgEvent" ADD CONSTRAINT "FailedMsgEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
