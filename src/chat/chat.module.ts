import { forwardRef, Logger, Module } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ChatController } from './chat.controller';
import { CustomerModule } from 'src/customer/customer.module';
import { CloudModule } from 'src/cloud/cloud.module';


@Module({
  imports: [PrismaModule, CloudModule,
    forwardRef(() => CustomerModule)],
  providers: [ChatService, ChatGateway, Logger],
  exports: [ChatService],
  controllers: [ChatController]
})
export class ChatModule { }
