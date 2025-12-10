import { Provider, Logger } from '@nestjs/common';
import { PgBoss } from 'pg-boss';

export const PG_BOSS = 'PG_BOSS';

export const PgBossProvider: Provider = {
  provide: PG_BOSS,
  useFactory: async (): Promise<PgBoss> => {
    const logger = new Logger('PgBoss');

    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL,
      // Schema for pg-boss tables (separate from your app tables)
      schema: 'pgboss',
      // Retry failed jobs up to 3 times
      retryLimit: 3,
      retryDelay: 30, // seconds
      retryBackoff: true,
      // Archive completed jobs (for debugging/auditing)
      archiveCompletedAfterSeconds: 60 * 60 * 24, // 24 hours
      // Delete archived jobs after 7 days
      deleteAfterDays: 7,
      // Monitor interval
      monitorStateIntervalSeconds: 30,
    });

    boss.on('error', (error) => {
      logger.error('PgBoss error:', error);
    });

    boss.on('monitor-states', (states) => {
      logger.debug(`Queue states: ${JSON.stringify(states)}`);
    });

    await boss.start();
    logger.log('✅ PgBoss started successfully');

    return boss;
  },
};

