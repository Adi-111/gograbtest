import { ApiProperty } from "@nestjs/swagger";
import { IsPhoneNumber } from "class-validator";


export class CreateCustomerDto {

    @ApiProperty()
    @IsPhoneNumber('IN')
    phoneNo: string;
}