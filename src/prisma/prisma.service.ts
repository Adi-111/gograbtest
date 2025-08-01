import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { writeFileSync } from "fs";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PrismaService.name);



    async onModuleInit() {

        await this.$connect();


        this.logger.log(`Connected to Database`)

    }
    async onModuleDestroy() {
        await this.$disconnect();
        this.logger.log("Disconnected from Database");
    }
}