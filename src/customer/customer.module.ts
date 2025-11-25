import { forwardRef, Logger, Module } from '@nestjs/common';

// Modules

import { CasesModule } from 'src/cases/cases.module';
import { ChatModule } from 'src/chat/chat.module';

// Services
import { CustomerService } from './customer.service';

// Controllers
import { CustomerController } from './customer.controller';
import { BotModule } from 'src/bot/bot.module';
import { CloudModule } from 'src/cloud/cloud.module';
import { GGBackendModule } from './gg-backend/gg-backend.module';

@Module({
  imports: [
    CloudModule,
    GGBackendModule,
    forwardRef(() => BotModule),
    forwardRef(() => CasesModule),
    forwardRef(() => ChatModule),
  ],
  controllers: [CustomerController],
  providers: [CustomerService, Logger],
  exports: [CustomerService],
})
export class CustomerModule { }
