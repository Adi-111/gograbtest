import { ApiProperty } from "@nestjs/swagger";
import { Status, CaseHandler } from "@prisma/client";
import { IsEnum, IsNumber, IsOptional, IsString, IsArray } from "class-validator"

// Supporting types for nested objects
class WhatsAppCustomerDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    name: string;

    @ApiProperty()
    phoneNo: string;

    @ApiProperty()
    profileImageUrl: string;

    @ApiProperty()
    createdAt: Date;
}

class UserDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    firstName: string;

    @ApiProperty()
    lastName: string;

    @ApiProperty()
    email: string;
}

class TagDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    text: string;

    @ApiProperty()
    userId: number;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;
}

class MessageDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    type: string;

    @ApiProperty()
    senderType: string;

    @ApiProperty({ required: false })
    text?: string;

    @ApiProperty()
    timestamp: Date;

    @ApiProperty({ required: false })
    waMessageId?: string;
}

class NoteDto {
    @ApiProperty()
    id: number;

    @ApiProperty()
    userId: number;

    @ApiProperty()
    caseId: number;

    @ApiProperty()
    text: string;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    updatedAt: Date;

    @ApiProperty({ type: UserDto })
    user: UserDto;
}

export class UpdatedCaseDto {
    constructor(
        partial: Partial<UpdatedCaseDto>
    ) {
        Object.assign(this, partial)
    }

    @ApiProperty()
    @IsNumber()
    id: number;

    @ApiProperty({ enum: Status })
    @IsEnum(Status)
    status: Status;

    @ApiProperty({ enum: CaseHandler })
    @IsEnum(CaseHandler)
    assignedTo: CaseHandler;

    @ApiProperty({ type: [TagDto] })
    @IsArray()
    tags: TagDto[];

    @ApiProperty({ type: WhatsAppCustomerDto })
    customer: WhatsAppCustomerDto;

    @ApiProperty({ type: UserDto, required: false })
    @IsOptional()
    user?: UserDto | null;

    @ApiProperty({ type: [MessageDto] })
    @IsArray()
    messages: MessageDto[];

    @ApiProperty({ required: false })
    @IsOptional()
    @IsNumber()
    unread?: number | null;

    @ApiProperty({ type: [NoteDto] })
    @IsArray()
    notes: NoteDto[];
}