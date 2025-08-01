-- CreateTable
CREATE TABLE "public"."DailyAnalytics" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "casesOpened" INTEGER NOT NULL DEFAULT 0,
    "casesPending" INTEGER NOT NULL DEFAULT 0,
    "casesSolved" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByOperator" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByBot" INTEGER NOT NULL DEFAULT 0,
    "casesExpired" INTEGER NOT NULL DEFAULT 0,
    "casesProcessing" INTEGER NOT NULL DEFAULT 0,
    "missedChats" INTEGER NOT NULL DEFAULT 0,
    "avgCaseDuration" DOUBLE PRECISION DEFAULT 0,
    "totalCaseDuration" DOUBLE PRECISION DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TagAnalytics" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "tagText" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TagAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."overall_analytics" (
    "id" SERIAL NOT NULL,
    "totalCases" INTEGER NOT NULL DEFAULT 0,
    "casesProcessing" INTEGER NOT NULL DEFAULT 0,
    "casesSolved" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByBot" INTEGER NOT NULL DEFAULT 0,
    "casesSolvedByOperator" INTEGER NOT NULL DEFAULT 0,
    "casesExpired" INTEGER NOT NULL DEFAULT 0,
    "casesOpen" INTEGER NOT NULL DEFAULT 0,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "overall_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DailyAnalytics_date_key" ON "public"."DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "DailyAnalytics_date_idx" ON "public"."DailyAnalytics"("date");

-- CreateIndex
CREATE INDEX "TagAnalytics_date_idx" ON "public"."TagAnalytics"("date");

-- CreateIndex
CREATE INDEX "TagAnalytics_tagText_idx" ON "public"."TagAnalytics"("tagText");

-- CreateIndex
CREATE UNIQUE INDEX "TagAnalytics_date_tagText_key" ON "public"."TagAnalytics"("date", "tagText");
