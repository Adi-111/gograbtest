import { Logger, Module } from "@nestjs/common";
import { GGBackendService } from "./gg-backend.service";
import { PrismaModule } from "src/prisma/prisma.module";

@Module({
    imports: [PrismaModule],
    controllers: [],
    providers: [GGBackendService, Logger],
    exports: [GGBackendService],
})
export class GGBackendModule { }