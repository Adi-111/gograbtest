import { Module, Global, OnModuleInit, Logger } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { PgBossProvider, PG_BOSS } from './pg-boss.provider';
import { QueueProcessors } from './queue.processors';
import { PrismaModule } from 'src/prisma/prisma.module';

@Global() // Make QueueService available everywhere without importing
@Module({
  imports: [PrismaModule],
  controllers: [QueueController],
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
