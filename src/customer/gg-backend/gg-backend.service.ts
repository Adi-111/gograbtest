import { Injectable, Logger } from "@nestjs/common";
import axios, { AxiosError } from "axios";
import { TransactionInfoDto } from "./dto/transaction-info.dto";
import { RefundInfoDto } from "./dto/refund-info.dto";
import { VendInfoDto } from "./dto/VendInfoDto";
import { VendItemDto } from "./dto/vendItemDto";
import { ProductDto } from "./dto/products.dto";
import { PrismaService } from "src/prisma/prisma.service";
import { MergedProductDetail, ProductDetailProp } from "../types";
import { JwtPayload, decode } from 'jsonwebtoken';
import * as newrelic from 'newrelic';
import { MachineDto } from "./dto/machine.dto";
import { IssueType } from "@prisma/client";

type IssueSummary = {
    machineName: string;
    total: number;
    active: number;
    byType: Record<IssueType, number>;
    latestIssue: { id: number; at: Date } | null;
};




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
            const res = await axios.post(`${this.ggApi}/user-login/v2`, {
                id: 'chandradityasingh102@gmail.com',
                password: "Aditya@123"
            });
            this.userToken = res.data?.token;
            this.logger.log(this.userToken);
            return;
        } catch (error) {
            this.logger.error(`error while gg-user-login`);

        }
    }

    async bankTxn(utrId: string): Promise<TransactionInfoDto> {
        const url = `${this.ggApi}/payments/bank_txn_id`;
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

        } catch (e) {
            const err = e as AxiosError<any>;
            const status = err.response?.status ?? 0;

            // ——— error-only telemetry ———
            newrelic.noticeError(err, {
                utrId,
                url,
                method: 'GET',
                status,
                env: process.env.NODE_ENV,
                appVersion: process.env.APP_VERSION,
            });

            newrelic.recordCustomEvent('ApiFailure', {
                type: 'BankTxnLookup',
                utrId,
                url,
                method: 'GET',
                status,
                reason: `error while working with ${url} error=${err?.message}; status=${status}; data=${JSON.stringify(err.response?.data ?? {})}`,
            });

            newrelic.incrementMetric('Custom/BankTxn/Failures', 1);
            // ————————————————

            this.logger.error(
                `error while working with ${url} error=${err?.message}; status=${status}; data=${JSON.stringify(err.response?.data ?? {})}`
            );
            const obj: TransactionInfoDto = {
                order_id: null,
                refund_id: null,
                message: 'F404',
                errorCode: Number(err?.code),
            }
            return obj;
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


    //machine details

    async getAllMachinesFromGG() {
        if (!this.userToken || this.userToken === null || this.isTokenExpired(this.userToken)) {
            await this.userVerify();
        }
        try {
            const res = await axios.get(`${this.ggApi}/machineDetails`, {
                headers: {
                    Authorization: `Bearer ${this.userToken}`
                }
            })
            const data: MachineDto[] = res.data;
            await this.upsertMachine(data)
            return data;
        } catch (error) {
            this.logger.warn(`error fetching Machine Details:${error}`)
            return null;
        }
    }

    async getAllMachines() {
        const data: MachineDto[] = await this.prisma.machine.findMany()
        return data;
    }
    async percentResolvedWithoutAgent() {
        // 1) Fetch all resolved issues (closedAt not null)
        const issues = await this.prisma.issueEvent.findMany({
            where: {
                closedAt: { not: null },
                machineName: { not: null }, // optional: only machine-related
            },
            select: {
                id: true,
                closedAt: true,
                agentCalledAt: true,
            },
        });

        // 2) Aggregate in JS
        const totalResolved = issues.length;
        if (totalResolved === 0) {
            return { totalResolved: 0, resolvedWithoutAgent: 0, percentage: 0 };
        }

        const resolvedWithoutAgent = issues.filter(
            (i) => i.agentCalledAt === null
        ).length;

        const percentage = (resolvedWithoutAgent / totalResolved) * 100;

        return {
            totalResolved,
            resolvedWithoutAgent,
            percentage: Math.round(percentage * 100) / 100, // 2 decimals
        };
    }




    async issueTaggedPerMachine(): Promise<IssueSummary[]> {
        // 1) Fetch raw rows (only constraint: machineName NOT NULL)
        const issues = await this.prisma.issueEvent.findMany({
            where: { machineName: { not: null } }, // add your other filters if needed
            select: {
                id: true,
                machineName: true,
                issueType: true,
                isActive: true,
                created_at: true, // or openedAt
                updatedAt: true,
            },
        });

        // 2) Group & aggregate in JS
        const map = new Map<string, IssueSummary>();

        for (const row of issues) {
            const name = row.machineName as string; // guaranteed by where clause
            let entry = map.get(name);

            if (!entry) {
                // initialize counts for all IssueType keys to 0
                const byType = Object.create(null) as Record<IssueType, number>;
                for (const t of Object.values(IssueType)) byType[t as IssueType] = 0;

                entry = {
                    machineName: name,
                    total: 0,
                    active: 0,
                    byType,
                    latestIssue: null,
                };
                map.set(name, entry);
            }

            entry.total += 1;
            if (row.isActive) entry.active += 1;
            entry.byType[row.issueType] = (entry.byType[row.issueType] ?? 0) + 1;

            const ts = row.updatedAt ?? row.created_at;
            if (!entry.latestIssue || ts > entry.latestIssue.at) {
                entry.latestIssue = { id: row.id, at: ts };
            }
        }

        // 3) Return sorted by total desc (do other sorts as you like)
        return Array.from(map.values()).sort((a, b) => b.total - a.total);
    }




    private async upsertMachine(list: MachineDto[], chunkSize = 100) {
        if (!Array.isArray(list)) throw new Error("Input must be an array");

        // ✅ deduplicate by machine_id
        const deduped = Array.from(
            new Map(list.map((x) => [x.machine_id, x])).values()
        );

        for (let i = 0; i < deduped.length; i += chunkSize) {
            const chunk = deduped.slice(i, i + chunkSize);

            await this.prisma.$transaction(
                chunk.map((item) =>
                    this.prisma.machine.upsert({
                        where: { machine_id: item.machine_id },
                        update: {
                            machine_name: item.machine_name,
                            location: item.location,
                            description: String(item.description),
                            rating: item.rating || "0",
                            machine_status: item.machine_status,
                            machine_type: item.machine_type,
                            machine_capacity: item.machine_capacity,
                            total_coils: item.total_coils,
                            password: item.password,
                            date_created: item.date_created ? new Date(item.date_created) : undefined,
                            left_units: item.left_units,
                            last_refill_time: item.last_refill_time ? new Date(item.last_refill_time) : undefined,
                            last_refill_by: item.last_refill_by,
                            last_refill_availability: item.last_refill_availability,
                            availability: item.availability,
                            last_transaction: item.last_transaction ? new Date(item.last_transaction) : undefined,
                            accumulated_downtime: item.accumulated_downtime,
                            time_difference_from_last_transaction: item.time_difference_from_last_transaction,
                            last_report_time: item.last_report_time ? new Date(item.last_report_time) : undefined,
                            refill_report_time_difference: item.refill_report_time_difference,
                            variety_score: item.variety_score,
                            latitude: item.latitude ?? undefined,
                            longitude: item.longitude ?? undefined,

                        },
                        create: {
                            machine_id: item.machine_id,
                            machine_name: item.machine_name,
                            location: item.location,
                            description: String(item.description),
                            rating: item.rating || "0",
                            machine_status: item.machine_status,
                            machine_type: item.machine_type,
                            machine_capacity: item.machine_capacity,
                            total_coils: item.total_coils,
                            password: item.password,
                            date_created: item.date_created ? new Date(item.date_created) : new Date(),
                            left_units: item.left_units,
                            last_refill_time: item.last_refill_time ? new Date(item.last_refill_time) : undefined,
                            last_refill_by: item.last_refill_by,
                            last_refill_availability: item.last_refill_availability,
                            availability: item.availability,
                            last_transaction: item.last_transaction ? new Date(item.last_transaction) : undefined,
                            accumulated_downtime: item.accumulated_downtime,
                            time_difference_from_last_transaction: item.time_difference_from_last_transaction,
                            last_report_time: item.last_report_time ? new Date(item.last_report_time) : undefined,
                            refill_report_time_difference: item.refill_report_time_difference,
                            variety_score: item.variety_score,
                            latitude: item.latitude ?? undefined,
                            longitude: item.longitude ?? undefined,
                            updatedAt: new Date()
                        },
                    })
                )
            );
        }
    }









}