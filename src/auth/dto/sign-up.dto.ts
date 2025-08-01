// src/auth/dto/signup.dto.ts
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class SignupDto {

    @IsString()
    @IsNotEmpty()
    firstName: string;

    @IsString()
    @IsNotEmpty()
    lastName: string;

    @IsEmail()
    @IsNotEmpty()
    email: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(8)
    password: string;
}