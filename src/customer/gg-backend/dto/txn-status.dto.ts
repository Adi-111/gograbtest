import { RefundDetailDto } from "../../dto/refund-details.dto";
import { TxnAgentDto } from "./txn-agent.dto";
import { TxnResultDto } from "./txn-result.dto";

export class TxnStatus {
    agentInfo: TxnAgentDto;
    orderId: string;
    refundReason: string;
    userCreditInitiateStatus: string;
    mid: string;
    merchantRefundRequestTimestamp: Date;
    source: string;
    resultInfo: TxnResultDto;
    txnTimestamp: Date;
    acceptRefundTimestamp: Date;
    acceptRefundStatus: string;
    refundDetailInfoList: RefundDetailDto[];
    userCreditInitiateTimestamp: Date;
    totalRefundAmount: string;
    refId: string;
    txnAmount: string;
    refundId: string;
    txnId: string;
    refundAmount: string;
}
