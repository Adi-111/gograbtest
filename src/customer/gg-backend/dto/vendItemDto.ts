export class VendItemDto {
    vend_id: string;
    product_id: string;
    vend_status: string;
    vend_time: string; // or Date if parsed
    coil_id: string;

    constructor(data: {
        vend_id: string;
        product_id: string;
        vend_status: string;
        vend_time: string;
        coil_id: string;
    }) {
        this.vend_id = data.vend_id;
        this.product_id = data.product_id;
        this.vend_status = data.vend_status;
        this.vend_time = data.vend_time;
        this.coil_id = data.coil_id;
    }
}
