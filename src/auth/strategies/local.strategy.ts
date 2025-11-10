// src/auth/strategies/local.strategy.ts
import { Strategy } from 'passport-local';
import { PassportStrategy } from '@nestjs/passport';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
    constructor(private authService: AuthService) {
        // 👇 very important: define field names
        super({ usernameField: 'email', passwordField: 'password' });
    }

    async validate(email: string, password: string) {
        const user = await this.authService.validateUser(email, password);
        if (!user) throw new UnauthorizedException('Invalid credentials');
        return user; // attaches to req.user
    }
}
