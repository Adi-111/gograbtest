import { Logger, Module } from '@nestjs/common';
import { MetricService } from './metric.service';
import { MetricController } from './metric.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [MetricController],
  providers: [MetricService, Logger],

})
export class MetricModule { }
