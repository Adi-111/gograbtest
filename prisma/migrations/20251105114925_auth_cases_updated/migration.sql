-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Admin', 'Agent', 'Unknown');

-- AlterTable
ALTER TABLE "Case" ADD COLUMN     "lastMessageAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" DEFAULT 'Agent';
