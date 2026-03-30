import { Injectable, Logger } from '@nestjs/common';
import { CreateCaseDto } from './dto/create-case.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { CaseEntity } from './entity/case.entity';
import { UpdateCaseDto } from './dto/update-case.dto';
import { ChatService } from 'src/chat/chat.service';
import { Status, UserRole } from '@prisma/client';

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
    async getCaseById(caseId: number, callerRole?: UserRole) {
        const result = await this.prisma.case.findUnique({
            where: { id: caseId },
            include: {
                user: true,
                customer: true,
            },
        });

        if (result?.customer && callerRole !== UserRole.Admin) {
            result.customer.phoneNo = result.customer.phoneNo
                ? result.customer.phoneNo.slice(0, -4).replace(/\d/g, '*') + result.customer.phoneNo.slice(-4)
                : result.customer.phoneNo;
        }

        return result;
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

    async getExpiredCases() {
        const cases = await this.prisma.case.findMany({
            where: {
                timer: {
                    lt: new Date()
                },
                status: {
                    in: [
                        Status.ASSIGNED,
                        Status.BOT_HANDLING,
                        Status.INITIATED,
                        Status.PROCESSING,
                    ]
                }
            }
        });
        return cases;
    }

    async getIssuesWithMostMessages(issuesCount: number) {
        if (issuesCount <= 0) {
            this.logger.warn(`getIssuesWithMostMessages called with invalid count: ${issuesCount}`);
            return [];
        }

        const issues = await this.prisma.issueEvent.findMany({
            take: issuesCount,
            orderBy: {
                messages: {
                    _count: 'desc',
                },
            },
            include: {
                _count: {
                    select: { messages: true },
                },
                case: {
                    include: { customer: true },
                },
            },
        });

        this.logger.log(`Fetched top ${issues.length} issues by message count`);
        return issues;
    }

}