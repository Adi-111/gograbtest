import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class AuthEntity {
    constructor(partial: Partial<AuthEntity>) {
        Object.assign(this, partial);
    }

    @ApiProperty({
        description: 'JWT access token for authenticated requests',
        example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    })
    accessToken: string;
    role: UserRole;
    userId: number;
}