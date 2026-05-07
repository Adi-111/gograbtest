import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length, MinLength } from 'class-validator';

export class ResetPasswordDto {
    @ApiProperty({ example: 'user@example.com' })
    @IsEmail()
    @IsNotEmpty()
    email: string;

    @ApiProperty({ example: '482910', description: '6-digit OTP sent to email' })
    @IsString()
    @IsNotEmpty()
    @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
    otp: string;

    @ApiProperty({ example: 'NewPassword123' })
    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    newPassword: string;
}
