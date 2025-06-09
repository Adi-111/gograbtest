import { VendItemDto } from "../gg-backend/dto/vendItemDto";

export type ProductDetailProp = {
    product_id: string,
    product_name: string,
    image: string,
    product_price: number,
    brand_name: string,
}

export type MergedProductDetail = {
    vendItems: VendItemDto[],
    productItems: ProductDetailProp[],
    machine_id: string
}