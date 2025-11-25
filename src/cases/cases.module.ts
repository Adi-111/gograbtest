import { Logger, Module } from '@nestjs/common';
import { CasesService } from './cases.service';
import { CasesController } from './cases.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ChatModule } from 'src/chat/chat.module';

@Module({
  imports: [ChatModule],
  controllers: [CasesController],
  providers: [CasesService, Logger],
  exports: [CasesService]
})
export class CasesModule { }
