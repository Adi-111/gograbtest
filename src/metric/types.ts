// types
export type AgentFRTSummary = {
    agentId: number;
    agentName: string;
    totalChats: number;
    manualRefunds: number;
    avgFRTMinutes: number;
};

export type AgentFRTQuery = {
    from: Date;
    to: Date;
    mode?: 'issueOpened' | 'firstReply';
};
