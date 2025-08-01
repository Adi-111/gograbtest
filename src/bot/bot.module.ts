import { forwardRef, Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotController } from './bot.controller';

import { CustomerModule } from 'src/customer/customer.module';
import { PrismaModule } from 'src/prisma/prisma.module';

import { ChatModule } from 'src/chat/chat.module';

@Module({
  imports: [PrismaModule, forwardRef(() => CustomerModule), forwardRef(() => ChatModule)],
  controllers: [BotController],
  providers: [BotService],
  exports: [BotService]
})
export class BotModule { }
