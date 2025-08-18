import { forwardRef, Logger, Module } from '@nestjs/common';

// Modules
import { PrismaModule } from 'src/prisma/prisma.module';
import { CasesModule } from 'src/cases/cases.module';
import { ChatModule } from 'src/chat/chat.module';

// Services
import { CustomerService } from './customer.service';

// Controllers
import { CustomerController } from './customer.controller';
import { BotModule } from 'src/bot/bot.module';
import { CloudModule } from 'src/cloud/cloud.module';
import { GGBackendModule } from './gg-backend/gg-backend.module';
import { EpisodeManager } from './episode-manager';

@Module({
  imports: [
    PrismaModule,
    CloudModule,
    GGBackendModule,
    forwardRef(() => BotModule),
    forwardRef(() => CasesModule),
    forwardRef(() => ChatModule),
  ],
  controllers: [CustomerController],
  providers: [CustomerService, Logger, EpisodeManager],
  exports: [CustomerService],
})
export class CustomerModule { }
