import { Module } from '@nestjs/common';
import { CaseInstanceService } from './case-instance.service';
import { CaseInstanceController } from './case-instance.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CustomerModule } from 'src/customer/customer.module';

@Module({
  imports: [PrismaModule, CustomerModule],
  controllers: [CaseInstanceController],
  providers: [CaseInstanceService],
})
export class CaseInstanceModule { }
