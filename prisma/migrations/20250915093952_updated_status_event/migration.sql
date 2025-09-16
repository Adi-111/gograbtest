-- DropForeignKey
ALTER TABLE "public"."StatusEvent" DROP CONSTRAINT "StatusEvent_userId_fkey";

-- AlterTable
ALTER TABLE "public"."StatusEvent" ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "public"."StatusEvent" ADD CONSTRAINT "StatusEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
