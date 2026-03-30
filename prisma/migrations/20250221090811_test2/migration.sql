/*
  Warnings:

  - The primary key for the `Bot` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Bot` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `BotReplies` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `BotReplies` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Case` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Case` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `userId` column on the `Case` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `botId` column on the `Case` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Contact` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Contact` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `messageId` column on the `Contact` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Interactive` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Interactive` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `messageId` column on the `Interactive` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Location` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Location` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `messageId` column on the `Location` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Media` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Media` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `messageId` column on the `Media` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Message` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `customerId` on the `Message` table. All the data in the column will be lost.
  - The `id` column on the `Message` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `userId` column on the `Message` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `botId` column on the `Message` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `parentMessageId` column on the `Message` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `caseId` column on the `Message` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `Session` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `Session` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `User` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `User` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The primary key for the `WhatsAppCustomer` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - The `id` column on the `WhatsAppCustomer` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `customerId` on the `Case` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Changed the type of `userId` on the `Session` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Added the required column `name` to the `WhatsAppCustomer` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Case" DROP CONSTRAINT "Case_botId_fkey";

-- DropForeignKey
ALTER TABLE "Case" DROP CONSTRAINT "Case_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Case" DROP CONSTRAINT "Case_userId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_messageId_fkey";

-- DropForeignKey
ALTER TABLE "Interactive" DROP CONSTRAINT "Interactive_messageId_fkey";

-- DropForeignKey
ALTER TABLE "Location" DROP CONSTRAINT "Location_messageId_fkey";

-- DropForeignKey
ALTER TABLE "Media" DROP CONSTRAINT "Media_messageId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_botId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_caseId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_customerId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_parentMessageId_fkey";

-- DropForeignKey
ALTER TABLE "Message" DROP CONSTRAINT "Message_userId_fkey";

-- DropForeignKey
ALTER TABLE "Session" DROP CONSTRAINT "Session_userId_fkey";

-- DropIndex
DROP INDEX "Session_token_idx";

-- AlterTable
ALTER TABLE "Bot" DROP CONSTRAINT "Bot_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "Bot_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "BotReplies" DROP CONSTRAINT "BotReplies_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "BotReplies_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Case" DROP CONSTRAINT "Case_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "customerId",
ADD COLUMN     "customerId" INTEGER NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" INTEGER,
DROP COLUMN "botId",
ADD COLUMN     "botId" INTEGER,
ADD CONSTRAINT "Case_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "messageId",
ADD COLUMN     "messageId" INTEGER,
ADD CONSTRAINT "Contact_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Interactive" DROP CONSTRAINT "Interactive_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "messageId",
ADD COLUMN     "messageId" INTEGER,
ADD CONSTRAINT "Interactive_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Location" DROP CONSTRAINT "Location_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "messageId",
ADD COLUMN     "messageId" INTEGER,
ADD CONSTRAINT "Location_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Media" DROP CONSTRAINT "Media_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "messageId",
ADD COLUMN     "messageId" INTEGER,
ADD CONSTRAINT "Media_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Message" DROP CONSTRAINT "Message_pkey",
DROP COLUMN "customerId",
ADD COLUMN     "whatsAppCustomerId" INTEGER,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" INTEGER,
DROP COLUMN "botId",
ADD COLUMN     "botId" INTEGER,
DROP COLUMN "parentMessageId",
ADD COLUMN     "parentMessageId" INTEGER,
DROP COLUMN "caseId",
ADD COLUMN     "caseId" INTEGER,
ADD CONSTRAINT "Message_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Session" DROP CONSTRAINT "Session_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" INTEGER NOT NULL,
ADD CONSTRAINT "Session_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "WhatsAppCustomer" DROP CONSTRAINT "WhatsAppCustomer_pkey",
ADD COLUMN     "name" TEXT NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" SERIAL NOT NULL,
ADD CONSTRAINT "WhatsAppCustomer_pkey" PRIMARY KEY ("id");

-- CreateIndex
CREATE INDEX "Case_customerId_idx" ON "Case"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "Interactive_messageId_key" ON "Interactive"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Location_messageId_key" ON "Location"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "Media_messageId_key" ON "Media"("messageId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "WhatsAppCustomer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Case" ADD CONSTRAINT "Case_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_parentMessageId_fkey" FOREIGN KEY ("parentMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "Case"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_whatsAppCustomerId_fkey" FOREIGN KEY ("whatsAppCustomerId") REFERENCES "WhatsAppCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Media" ADD CONSTRAINT "Media_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Interactive" ADD CONSTRAINT "Interactive_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
