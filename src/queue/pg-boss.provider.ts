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

    // Use type assertion to bypass strict type checking for pg-boss options
    // pg-boss runtime accepts these options even if TypeScript types don't include them
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

    // Error handling with New Relic integration
    boss.on('error', (error: Error) => {
      logger.error('PgBoss error:', error);
      newrelic.noticeError(error, {
        component: 'PgBoss',
        type: 'QueueError',
      });
      newrelic.incrementMetric('Custom/Queue/Errors', 1);
    });

    // Monitor queue states for observability
    (boss as any).on('monitor-states', (states: any) => {
      if (isProduction) {
        // Record queue metrics to New Relic
        Object.entries(states.queues || {}).forEach(([queueName, stats]: [string, any]) => {
          newrelic.recordMetric(`Custom/Queue/${queueName}/created`, stats.created || 0);
          newrelic.recordMetric(`Custom/Queue/${queueName}/active`, stats.active || 0);
          newrelic.recordMetric(`Custom/Queue/${queueName}/completed`, stats.completed || 0);
          newrelic.recordMetric(`Custom/Queue/${queueName}/failed`, stats.failed || 0);
        });
      }
      logger.debug(`Queue states: ${JSON.stringify(states)}`);
    });

    // Handle wip (work-in-progress) events
    (boss as any).on('wip', (data: any) => {
      logger.debug(`WIP jobs: ${JSON.stringify(data)}`);
    });

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
