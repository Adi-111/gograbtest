import { ApiProperty } from "@nestjs/swagger";


export class SendMessagesDto {

    @ApiProperty()
    sender: string;

    @ApiProperty()
    message: string;
}