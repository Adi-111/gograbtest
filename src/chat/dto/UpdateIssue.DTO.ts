import { IssueType, RefundMode, Status } from "@prisma/client";

export class updateIssueDto {
    caseId: number;
    status: Status;
    userId: number;
    machineDetails: {
        machine: {
            machine_id: string;
            machine_name: string;
            location: string
        }
    };
    issueType: IssueType;
    refundMode: RefundMode;
    refundAmount: number;
    notes: string
}