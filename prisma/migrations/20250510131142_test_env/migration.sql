-- CreateTable
CREATE TABLE "QuickReplies" (
    "id" SERIAL NOT NULL,
    "flowNodeType" "ReplyType" NOT NULL,
    "header" JSONB,
    "body" JSONB,
    "footer" JSONB,
    "action" JSONB,
    "replies" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReplies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuickReplies_id_key" ON "QuickReplies"("id");
