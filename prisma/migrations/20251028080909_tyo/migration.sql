/*
  Warnings:

  - You are about to drop the column `isOnline` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `lastActiveAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `role` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "isOnline",
DROP COLUMN "lastActiveAt",
DROP COLUMN "role";

-- DropEnum
DROP TYPE "public"."UserRole";
