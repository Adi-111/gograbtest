import {
  Controller,
  Post,
  Body,
  Request,
  UseGuards,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LocalAuthGuard } from './guards/local-auth.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { SignupDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import { ApiTags, ApiOperation, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(private readonly authService: AuthService) { }

  @Post('signup')
  @ApiOperation({ summary: 'Register a new user' })
  @ApiBody({ type: SignupDto })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  async signUp(@Body() signUpDto: SignupDto) {
    this.logger.log(`New signup attempt: ${signUpDto.email}`);
    return this.authService.signUp(signUpDto);
  }

  @UseGuards(LocalAuthGuard)
  @Post('login')
  @ApiOperation({ summary: 'Log in a user' })
  @ApiBody({ type: LoginDto })
  @ApiResponse({ status: 200, description: 'User logged in successfully' })
  async login(@Request() req, @Body() loginDto: LoginDto) {
    this.logger.log(`User login attempt: ${loginDto.email}`);
    return this.authService.signIn(req.user);
  }


  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  @ApiOperation({ summary: 'Log out a user' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'User logged out successfully' })
  async logout(@Request() req) {
    const accessToken = req.headers['access-token'];
    return await this.authService.signOut(accessToken);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('validate-session')
  @ApiOperation({ summary: 'Validate user session' })
  @ApiBearerAuth()
  @ApiResponse({ status: 200, description: 'Session is valid' })
  async validateSession(@Request() req) {
    const accessToken = req.headers['access-token']
    return await this.authService.validateSession(accessToken);
  }
}
