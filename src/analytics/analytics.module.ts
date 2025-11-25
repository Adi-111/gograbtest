import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';


@Module({
  imports: [],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule { }
