import { ApiProperty } from "@nestjs/swagger";
import { Status } from "@prisma/client";
import { IsEnum, IsNumber } from "class-validator"


export class UpdateCaseDto {
    constructor(
        partial: Partial<UpdateCaseDto>
    ) {
        Object.assign(this, partial)
    }

    @ApiProperty()
    @IsNumber()
    id: number;

    @ApiProperty()
    @IsEnum({ type: Status })
    status: Status;
}