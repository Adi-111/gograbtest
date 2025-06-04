import { ApiProperty } from "@nestjs/swagger";
import { Status, WhatsAppCustomer } from "@prisma/client";
import { IsEnum, IsInt, IsString } from "class-validator";
import { CustomerEntity } from "src/customer/entity/customer.entity";

export class CreateCaseDto {
    constructor(partial: Partial<CreateCaseDto>) { Object.assign(this, partial) };

    @IsInt()
    @ApiProperty()
    customerId: number;

    @IsEnum(Status)
    @ApiProperty()
    status: Status = Status.INITIATED;



}