/*
  Warnings:

  - Added the required column `profileImageUrl` to the `WhatsAppCustomer` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "WhatsAppCustomer" ADD COLUMN     "profileImageUrl" TEXT NOT NULL;
