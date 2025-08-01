import { Logger, Module } from '@nestjs/common';
import { UserService } from './user.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { UserController } from './user.controller';

@Module({
    providers: [UserService, PrismaService, Logger],
    controllers: [UserController]
})
export class UserModule { }
