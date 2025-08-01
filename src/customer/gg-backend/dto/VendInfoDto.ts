export class VendInfoDto {
    order_id: string;
    total_price: string;
    order_date: string; // Consider using Date type if you will parse it
    machine_id: string;
    order_status: string;
    order_details: string[];
    refund_id: string | null;

    constructor(data: {
        order_id: string;
        total_price: string;
        order_date: string;
        machine_id: string;
        order_status: string;
        order_details: string[];
        refund_id: string | null;
    }) {
        this.order_id = data.order_id;
        this.total_price = data.total_price;
        this.order_date = data.order_date;
        this.machine_id = data.machine_id;
        this.order_status = data.order_status;
        this.order_details = data.order_details;
        this.refund_id = data.refund_id;
    }
}
