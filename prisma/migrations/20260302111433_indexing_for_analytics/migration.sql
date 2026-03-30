-- CreateIndex
CREATE INDEX "IssueEvent_userId_status_closedAt_idx" ON "IssueEvent"("userId", "status", "closedAt");

-- CreateIndex
CREATE INDEX "Message_issueEventId_timestamp_idx" ON "Message"("issueEventId", "timestamp");
