// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private authService: AuthService) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: "b283b7c5a5388357b0bd6690f8ced1bb", // Use the same secret as in JwtModule
        });
    }

    async validate(payload: any) {
        // Validate the session (optional)
        const isValidSession = await this.authService.validateSession(
            payload.sessionId,
        );

        if (!isValidSession) {
            throw new UnauthorizedException('Invalid or expired session');
        }

        return { userId: payload.sub, email: payload.email };
    }
}