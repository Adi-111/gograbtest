/*
  Warnings:

  - Added the required column `messageId` to the `FailedMsgEvent` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "FailedMsgEvent" ADD COLUMN     "messageId" INTEGER NOT NULL;
