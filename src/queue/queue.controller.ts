import { Controller, Get, Logger, Param } from '@nestjs/common';
import { QueueService, QueueHealthStatus } from './queue.service';
import { Public } from 'src/auth/decorators/public.decorator';

@Controller('queue')
export class QueueController {
    private readonly logger = new Logger(QueueController.name);

    constructor(private readonly queueService: QueueService) { }

    /**
     * Health check endpoint for queue monitoring
     * Can be used by load balancers and monitoring systems
     */
    @Public()
    @Get('health')
    async getHealth(): Promise<{
        status: 'healthy' | 'unhealthy';
        timestamp: string;
        details: QueueHealthStatus;
    }> {
        const health = this.queueService.getHealthStatus();

        return {
            status: health.healthy ? 'healthy' : 'unhealthy',
            timestamp: new Date().toISOString(),
            details: health,
        };
    }

    /**
     * Detailed health check with per-queue statistics
     * Useful for debugging and detailed monitoring
     */
    @Public()
    @Get('health/detailed')
    async getDetailedHealth() {
        try {
            const health = await this.queueService.getDetailedHealthStatus();

            // Calculate summary stats
            const totalQueued = health.allQueuesStats.reduce((sum, q) => sum + (q.created || 0), 0);
            const totalActive = health.allQueuesStats.reduce((sum, q) => sum + (q.active || 0), 0);
            const totalFailed = health.allQueuesStats.reduce((sum, q) => sum + (q.failed || 0), 0);

            return {
                status: health.healthy ? 'healthy' : 'unhealthy',
                timestamp: new Date().toISOString(),
                summary: {
                    totalQueued,
                    totalActive,
                    totalFailed,
                },
                queues: health.allQueuesStats,
                lastCheck: health.lastCheck,
            };
        } catch (error) {
            this.logger.error('Failed to get detailed health status', error);
            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: 'Failed to fetch queue statistics',
            };
        }
    }

    /**
     * Get statistics for a specific queue
     */
    @Get('stats/:queueName')
    async getQueueStats(@Param('queueName') queueName: string) {
        try {
            const stats = await this.queueService.getQueueStats(queueName);
            return {
                queueName,
                timestamp: new Date().toISOString(),
                stats,
            };
        } catch (error) {
            this.logger.error(`Failed to get stats for queue ${queueName}`, error);
            return {
                queueName,
                timestamp: new Date().toISOString(),
                error: 'Failed to fetch queue statistics',
            };
        }
    }
}

