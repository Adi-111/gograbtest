import { Body, Controller, Get, Post } from '@nestjs/common';
import { BotService } from './bot.service';
import { BotReplies } from '@prisma/client';

@Controller('bot')
export class BotController {
  constructor(private readonly botService: BotService) { }
  @Get('all')
  async getAllBotReplies() {
    return await this.botService.getAllBotReplies();
  }

  @Post('upsert-reply')
  async upsertBotNodes(@Body() botReplies: BotReplies[]) {
    if (!Array.isArray(botReplies)) {
      throw new Error('Invalid payload: expected an array of bot replies');
    }
    return await this.botService.upsertBotReplies(botReplies);
  }
}
