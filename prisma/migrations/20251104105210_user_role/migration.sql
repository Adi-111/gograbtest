-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('Admin', 'Agent');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" DEFAULT 'Agent';
