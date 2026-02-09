import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
     constructor(configService: ConfigService) {
    const connectionString = configService.getOrThrow<string>('DATABASE_URL');
    const adapter = new PrismaPg({ connectionString });
    super({
      adapter,
      log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }

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