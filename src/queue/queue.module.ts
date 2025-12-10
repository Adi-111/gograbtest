import { Module, Global, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { QueueService } from './queue.service';
import { PgBossProvider, PG_BOSS } from './pg-boss.provider';
import { QueueProcessors } from './queue.processors';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CustomerModule } from 'src/customer/customer.module';

@Global() // Make QueueService available everywhere without importing
@Module({
  imports: [PrismaModule, forwardRef(() => CustomerModule)],
  providers: [PgBossProvider, QueueService, QueueProcessors],
  exports: [QueueService, PG_BOSS],
})
export class QueueModule implements OnModuleInit {
  private readonly logger = new Logger(QueueModule.name);

  constructor(private readonly processors: QueueProcessors) { }

  async onModuleInit() {
    // Register all job handlers when module initializes
    await this.processors.registerAllHandlers();
    this.logger.log('✅ Queue handlers registered');
  }
}
