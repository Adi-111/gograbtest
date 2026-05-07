import { Provider, Logger } from '@nestjs/common';
import { PgBoss, Job } from 'pg-boss';
import * as newrelic from 'newrelic';

export const PG_BOSS = 'PG_BOSS';

// Dead Letter Queue name for failed jobs
export const DEAD_LETTER_QUEUE = 'dead-letter-queue';

export const PgBossProvider: Provider = {
  provide: PG_BOSS,
  useFactory: async (): Promise<PgBoss> => {
    const logger = new Logger('PgBoss');
    const isProduction = process.env.NODE_ENV === 'production';

    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      schema: 'pgboss',
      // SSL configuration for managed databases (Supabase, Neon, etc.)
      ssl: {
        rejectUnauthorized: false, // Required for most managed PostgreSQL services
      },
      // Archive and delete settings
      archiveCompletedAfterSeconds: isProduction ? 60 * 60 * 24 * 3 : 60 * 60 * 24,
      deleteAfterDays: isProduction ? 14 : 7,
      // Monitor interval
      monitorStateIntervalSeconds: isProduction ? 15 : 30,
      // Maintenance
      maintenanceIntervalSeconds: 120,
    } as any);

    await boss.start();
    logger.log('✅ PgBoss started successfully');

    // Create dead letter queue first, then register handler
    try {
      await boss.createQueue(DEAD_LETTER_QUEUE);
      logger.log(`✅ Created queue: ${DEAD_LETTER_QUEUE}`);
    } catch (err: any) {
      // Queue might already exist, that's okay
      if (!err.message?.includes('already exists')) {
        logger.warn(`Could not create DLQ: ${err.message}`);
      }
    }

    // Register dead letter queue handler
    await boss.work(DEAD_LETTER_QUEUE, async (jobs: Job<any>[]) => {
      for (const job of jobs) {
        logger.error(`Dead letter job received: ${job.id}`, {
          originalQueue: (job.data as any)?.originalQueue,
          error: (job.data as any)?.error,
          attempts: (job.data as any)?.attempts,
        });

        // Record to New Relic for alerting
        newrelic.recordCustomEvent('DeadLetterJob', {
          jobId: job.id,
          originalQueue: (job.data as any)?.originalQueue,
          error: (job.data as any)?.error?.message,
          attempts: (job.data as any)?.attempts,
        });
      }
    });

    return boss;
  },
};
