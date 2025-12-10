import { Logger, Module } from '@nestjs/common';

// local imports
import { PrismaModule } from './prisma/prisma.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';
import { CasesModule } from './cases/cases.module';
import { CustomerModule } from './customer/customer.module';
import { ChatModule } from './chat/chat.module';
import { BotModule } from './bot/bot.module';
import { CloudModule } from './cloud/cloud.module';
import { CronService } from './cron/cron.service';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsModule } from './analytics/analytics.module';
import { CacheModule } from '@nestjs/cache-manager';
import { MetricModule } from './metric/metric.module';
import { JwtStrategy } from './auth/strategies/jwt.strategy';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { QueueModule } from './queue/queue.module';

@Module({
  imports: [PrismaModule, UserModule, AuthModule, CasesModule, CustomerModule, ChatModule, BotModule, CloudModule, ScheduleModule.forRoot(), AnalyticsModule, CacheModule.register({
    ttl: 60 * 9, // 9 minutes cache
    isGlobal: true,
  }), MetricModule,
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '7d' }, // token expiration
    }),
    QueueModule,
  ],
  providers: [Logger, CronService, JwtStrategy, {
    provide: 'APP_GUARD',
    useClass: JwtAuthGuard
  }],
  exports: [AuthModule]
})
export class AppModule {

}
