import { Injectable, Logger } from '@nestjs/common';
import { CreateCaseDto } from './dto/create-case.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CaseEntity } from './entity/case.entity';
import { UpdateCaseDto } from './dto/update-case.dto';
import { ChatService } from 'src/chat/chat.service';

@Injectable()
export class CasesService {
    private readonly logger = new Logger(CasesService.name);

    constructor(
        private prisma: PrismaService,
        private chatService: ChatService
    ) { }

    // Create a new case and create a corresponding room in the socket gateway.
    async createCase(createCaseDto: CreateCaseDto) {
        // Create the case in the database. We're explicitly setting default values for new fields.
        const createdCase = await this.prisma.case.create({
            data: {
                status: createCaseDto.status,
                // Connect the case with an existing customer by ID.
                customer: {
                    connect: {
                        id: createCaseDto.customerId,
                    },
                },

            },
        });

        // Convert the raw case data to a CaseEntity instance.
        const caseEntity = new CaseEntity(createdCase);

        this.logger.log(`New Case Created: ${JSON.stringify(createdCase)}`);

        // Notify the chat service to create a room for this new case.
        // The ChatService should handle socket gateway integration.
        this.chatService.createRoom(caseEntity);

        return createdCase;
    }

    // Retrieve all cases from the database.
    async getAllCase() {
        return await this.prisma.case.findMany({
            include: {
                customer: true,
                messages: {
                    orderBy: {
                        timestamp: 'desc',
                    },
                    take: 2,
                },
            },
        });
    }


    async updateTags(caseId: number, tagIds: number[]) {
        return await this.prisma.case.update({
            where: { id: caseId },
            data: {
                tags: {
                    set: tagIds.map((id) => ({ id })),
                },
            },
            include: {
                tags: true, // ✅ so that (await caseService.updateTags()).tags works
            },
        });
    }

    async getTagById(caseId: number) {
        return await this.prisma.case.findUnique({
            where: { id: caseId },
            include: { tags: true }, // ✅ include the tags
        });
    }


    // Update the status of a case.
    async updateCaseStatus(updateCaseDto: UpdateCaseDto) {
        return await this.prisma.case.update({
            where: {
                id: updateCaseDto.id,
            },
            data: {
                status: updateCaseDto.status,
            },
        });
    }
}