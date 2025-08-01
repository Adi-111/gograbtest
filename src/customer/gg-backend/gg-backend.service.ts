import { Injectable, Logger } from "@nestjs/common";
import axios from "axios";
import { TransactionInfoDto } from "./dto/transaction-info.dto";
import { RefundInfoDto } from "./dto/refund-info.dto";
import { VendInfoDto } from "./dto/VendInfoDto";
import { VendItemDto } from "./dto/vendItemDto";
import { ProductDto } from "./dto/products.dto";
import { PrismaService } from "src/prisma/prisma.service";
import { MergedProductDetail, ProductDetailProp } from "../types";
import { JwtPayload, decode } from 'jsonwebtoken';






@Injectable()
export class GGBackendService {
    private readonly logger = new Logger(GGBackendService.name);
    private readonly ggApi = process.env.GG_BACKEND;
    private bearerToken: string | null = null;
    private userToken: string | null = null;


    constructor(
        private readonly prisma: PrismaService
    ) { }




    private isTokenExpired(token: string | null): boolean {
        if (!token) {
            return true;
        }
        try {
            const decoded: JwtPayload = decode(token) as JwtPayload;
            if (!decoded || !decoded.exp) {
                this.logger.warn('Token malformed or missing exp claim, forcing re-login.');
                return true;
            }
            const currentTime = Date.now() / 1000;
            const isExpired = decoded.exp < currentTime;
            if (isExpired) {
                this.logger.warn(`Token expired at ${new Date(decoded.exp * 1000).toLocaleString()}. Current time: ${new Date(currentTime * 1000).toLocaleString()}`);
            }
            return isExpired;
        } catch (error) {
            this.logger.error(`Error decoding token: ${error.message}. Assuming expired/invalid.`);
            return true;
        }
    }


    private async loginVerify(): Promise<void> {
        try {
            const res = await axios.post(`${this.ggApi}/login-verify`, {
                id: "GG1001",
                password: "Machine123"
            });
            this.bearerToken = res.data?.token;
            this.logger.log(this.bearerToken);
            return;
        } catch (error) {
            this.logger.error(`error while login-verify ${error}`);
        }
    }

    private async userVerify(): Promise<void> {
        try {
            const res = await axios.post(`${this.ggApi}/user-login`, {
                id: 'chandradityasingh102@gmail.com',
                password: "for_Now_this"
            });
            this.userToken = res.data?.token;
            this.logger.log(this.userToken);
            return;
        } catch (error) {
            this.logger.error(`error while gg-user-login`);

        }
    }

    async bankTxn(utrId: string): Promise<TransactionInfoDto> {
        if (!this.bearerToken || this.bearerToken === null || this.isTokenExpired(this.bearerToken)) {
            await this.loginVerify();
        }
        try {
            const res = await axios.get(`${this.ggApi}/payments/bank_txn_id`, {
                params: {
                    bank_txn_id: utrId
                },
                headers: {
                    Authorization: `Bearer ${this.bearerToken}`
                }
            });

            let txnInfo: TransactionInfoDto = res.data;
            const getMID = txnInfo.order_id.split("-");
            txnInfo.machine_id = getMID.length >= 2 ? getMID[1] : "";
            this.logger.log(`txn-info:${JSON.stringify(txnInfo)}`);
            await this.getVendDetails(txnInfo.order_id);

            return txnInfo;

        } catch (err) {
            this.logger.error(`error while working with ${this.ggApi}/payments/bank_txn_id error = ${err}`)
            return null;

        }

    }

    async refundStatus(order_id: string, refId: string, machine_id: string) {
        if (!this.bearerToken || this.bearerToken === null || this.isTokenExpired(this.bearerToken)) {
            await this.loginVerify();
        }
        try {
            const res = await axios.get(`${this.ggApi}/payments/refund-status?orderId=${order_id}&refId=${refId}&machine_id=${machine_id}`, {

                headers: {
                    Authorization: `Bearer ${this.bearerToken}`
                }
            });
            const refInfo: RefundInfoDto = res.data;
            this.logger.log(refInfo);
            return refInfo;

        } catch (error) {
            this.logger.debug(`error:${error}`)
        }
    }


    async getVendDetails(order_id: string): Promise<MergedProductDetail> {
        if (!this.bearerToken || this.bearerToken === null || this.isTokenExpired(this.bearerToken)) {
            await this.loginVerify();
        }
        try {
            const res = await axios.get(`${this.ggApi}/orders/${order_id}`, {
                headers: {
                    Authorization: `Bearer ${this.bearerToken}`
                }
            });
            const vendInfo: VendInfoDto = res.data;
            const vendIds: string[] = vendInfo.order_details;
            const vendItems: VendItemDto[] = await Promise.all(
                vendIds.map(id => this.getVendItem(id))
            );
            const productItems: ProductDetailProp[] = await Promise.all(
                vendItems.map(el => this.ProductById(el.product_id))
            );
            const machine_id = vendInfo.machine_id;
            return { vendItems, productItems, machine_id };
        } catch (error) {
            this.logger.warn(`Error while fetching vending information: ${error}`);
            return { vendItems: [], productItems: [], machine_id: '' };
        }
    }


    async getVendItem(vend_id: string) {
        if (!this.userToken || this.userToken === null || this.isTokenExpired(this.userToken)) {
            await this.userVerify();
        }
        try {
            const res = await axios.get(`${this.ggApi}/vendItems/${vend_id}`, {
                headers: {
                    Authorization: `Bearer ${this.userToken}`
                }
            })
            const VendItem: VendItemDto = res.data;
            this.logger.log(VendItem);
            return VendItem;
        } catch (error) {
            this.logger.warn(`error fetching Vend Item Details:${error}`)
            return null;
        }
    }

    async ProductById(product_id: string): Promise<ProductDetailProp> {
        this.logger.log(product_id);

        try {
            const productRecord = await this.prisma.product.findUnique({
                where: { product_id: product_id.trim() }
            });

            if (!productRecord) {
                this.logger.warn(`Product not found for ID: ${product_id}`);
                return null; // ❗ Correct: return null, not {}
            }
            return {
                product_id: productRecord.product_id,
                product_name: productRecord.product_name,
                image: productRecord.image,
                product_price: productRecord.product_price,
                brand_name: productRecord.brand_name,
            };
        } catch (error) {
            this.logger.error(`Error fetching product with ID ${product_id}: ${error}`);
            return null; // ❗ Also return null on error
        }
    }




    async getProductsFromGoGrab() {
        if (!this.bearerToken || this.bearerToken === null) {
            await this.loginVerify();
        }

        try {
            const res = await axios.get(`${this.ggApi}/products`, {
                headers: {
                    Authorization: `Bearer ${this.bearerToken}`
                }
            });
            const products: ProductDto[] = res.data;
            return products;
        } catch (error) {
            this.logger.warn('error fetching products from go-grab')
        }
    }


    async createCustomerDetails(vendInfo: MergedProductDetail, customerId: number) {
        const { vendItems, productItems } = vendInfo;
        const coils: string[] = await Promise.all(
            vendItems.map(el => el.coil_id)
        )
        const product_ids: string[] = await Promise.all(
            productItems.map(el => el.product_id)
        )
        const dispenseStatuses = await Promise.all(
            vendItems.map(el => el.vend_status)
        )
        const machine_id = vendInfo.machine_id
        this.logger.log(coils, product_ids);
        const customerData = await this.prisma.customerOrderDetails.create({
            data: {
                customerId,
                productIds: product_ids,
                dispenseStatuses,
                orderTime: vendItems[vendItems.length - 1].vend_time,
                coils,
                machine_id
            }
        });

        this.logger.log(customerData);

    }

    async getCustomerData() {
        return await this.prisma.customerOrderDetails.findMany();
    }


    async getCustomerDataByPost(startTime: string, endTime: string, machine_id: string) {
        const customerData = await this.prisma.customerOrderDetails.findMany({
            where: {
                machine_id,
                orderTime: {
                    gte: startTime,  // orderTime ≥ startTime
                    lte: endTime,    // orderTime ≤ endTime
                },
            }
        });
        this.logger.log(`retrieved Cus Data = ${customerData}`)
        return customerData
    }

    async updateCustomerDataVerdict(id: number, verdict: string) {
        const customerData = await this.prisma.customerOrderDetails.update({
            where: {
                id
            },
            data: {
                verdict
            }
        });
        return customerData;
    }








}