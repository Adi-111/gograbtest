import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from "@nestjs/common";
import { CasesService } from "./cases.service";
import { CreateCaseDto } from "./dto/create-case.dto";
import { CaseEntity } from "./entity/case.entity";
import { ApiCreatedResponse, ApiTags } from "@nestjs/swagger";
import { UpdateCaseDto } from "./dto/update-case.dto";
import { UpdateTagsDto } from './dto/update-tag.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Controller('cases')
@ApiTags('cases')
export class CasesController {
  constructor(
    private readonly caseService: CasesService,
    private readonly prisma: PrismaService // inject Prisma
  ) { }

  @Post('create')
  @ApiCreatedResponse({ type: CaseEntity })
  async create(@Body() createCaseDto: CreateCaseDto) {
    return new CaseEntity(await this.caseService.createCase(createCaseDto));
  }

  @Get('get-all-cases')
  @ApiCreatedResponse({ type: [CaseEntity] })
  async getAllCase() {
    return await this.caseService.getAllCase();
  }

  @Patch('update-case-status')
  @ApiCreatedResponse({ type: [CaseEntity] })
  async updateCaseStatus(@Body() updateCaseDto: UpdateCaseDto) {
    return await this.caseService.updateCaseStatus(updateCaseDto);
  }

  @Patch('update-tags')
  async updateTags(@Body() updateTagsDto: UpdateTagsDto) {
    const { caseId, tags } = updateTagsDto;
    return (await this.caseService.updateTags(caseId, tags)).tags;
  }

  @Get('get-tags/:id')
  async getTags(@Param('id', ParseIntPipe) caseId: number) {
    return (await this.caseService.getTagById(caseId)).tags;
  }

  @Get('suggest-tags')
  async suggestTags(@Query('q') query: string) {
    return await this.prisma.tag.findMany({
      where: {
        text: {
          contains: query,
          mode: 'insensitive',
        },
      },
      take: 10,
    });
  }
}