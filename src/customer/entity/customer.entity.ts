import { ApiProperty } from "@nestjs/swagger";
import { WhatsAppCustomer } from "@prisma/client";

export class CustomerEntity implements WhatsAppCustomer {
    constructor(partial: Partial<CustomerEntity>) {
        Object.assign(this, partial);
    }

    @ApiProperty()
    id: number;

    @ApiProperty()
    name: string;

    @ApiProperty()
    createdAt: Date;

    @ApiProperty()
    phoneNo: string;

    @ApiProperty({
        required: false,
        nullable: true,
        description: "Optional profile image URL for the customer",
    })
    profileImageUrl: string | "https://picsum.photos/200/300";
}
