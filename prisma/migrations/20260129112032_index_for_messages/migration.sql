-- CreateIndex
CREATE INDEX "Message_caseId_idx" ON "Message"("caseId");

-- CreateIndex
CREATE INDEX "Message_caseId_timestamp_idx" ON "Message"("caseId", "timestamp" DESC);