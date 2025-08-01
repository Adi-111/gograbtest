import { Controller, Get, HttpCode, HttpStatus, NotImplementedException, Post } from "@nestjs/common";
import { AuthService } from "./auth.service";


@Controller('auth-v2')
export class PassportAuthController {
    constructor(private readonly authService: AuthService) { }


    @HttpCode(HttpStatus.OK)
    @Post('login')
    login() {
        throw new NotImplementedException();
    }

    @Get('me')
    getUserInfo() {
        throw new NotImplementedException();
    }
}