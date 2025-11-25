// types
export type AgentFRTSummary = {
    agentId: number;
    agentName: string;
    totalChats: number;
    manualRefunds: number;
    avgFRTMinutes: number;
};

export type AgentFRTQuery = {
    fromIST: Date;
    toIST: Date;
    mode?: 'issueOpened' | 'firstReply';
};
