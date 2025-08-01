import { ApiProperty } from '@nestjs/swagger';
import { Session, User } from '@prisma/client';
import { Type } from 'class-transformer';

export class AuthEntity {
    constructor(partial: Partial<AuthEntity>) {
        Object.assign(this, partial);
    }

    @ApiProperty({
        description: 'JWT access token for authenticated requests',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    })
    accessToken: string;

    userId: number;
}