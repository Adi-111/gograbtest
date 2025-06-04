-- DropIndex
DROP INDEX "Message_waMessageId_key";

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "waMessageId" DROP NOT NULL;
