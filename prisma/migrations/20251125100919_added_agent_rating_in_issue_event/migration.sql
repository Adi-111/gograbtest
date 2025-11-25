-- AlterTable
ALTER TABLE "IssueEvent" ADD COLUMN     "agentRating" INTEGER;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'Unknown';
