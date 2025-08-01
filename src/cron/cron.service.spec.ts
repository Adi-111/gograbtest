import { Test, TestingModule } from '@nestjs/testing';
import { CronService } from './cron.service';

// Mock newrelic to avoid sending real metrics
jest.mock('newrelic', () => ({
  recordCustomEvent: jest.fn(),
}));

describe('CronService', () => {
  let service: CronService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CronService],
    }).compile();

    service = module.get<CronService>(CronService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('recordSystemMetrics', () => {
    let originalGetActiveHandles: any;

    beforeEach(() => {
      // Backup original function if it exists
      originalGetActiveHandles = (process as any)._getActiveHandles;

      // Mock _getActiveHandles to return fake handles
      (process as any)._getActiveHandles = () => [1, 2, 3];
    });

    afterEach(() => {
      // Restore original function
      (process as any)._getActiveHandles = originalGetActiveHandles;
    });

    it('should record system metrics without throwing errors', () => {
      expect(() => service.recordSystemMetrics()).not.toThrow();
    });
  });
});
