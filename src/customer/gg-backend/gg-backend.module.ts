import { Logger, Module } from "@nestjs/common";
import { GGBackendService } from "./gg-backend.service";
import { PrismaModule } from "src/prisma/prisma.module";
import { BotModule } from "src/bot/bot.module";

@Module({
    imports: [PrismaModule, BotModule],
    controllers: [],
    providers: [GGBackendService, Logger],
    exports: [GGBackendService],
})
export class GGBackendModule { }