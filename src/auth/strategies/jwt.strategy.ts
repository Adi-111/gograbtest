// src/auth/strategies/jwt.strategy.ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthService } from '../auth.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
    constructor(private authService: AuthService,
        private prisma: PrismaService
    ) {
        super({
            jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
            ignoreExpiration: false,
            secretOrKey: "b283b7c5a5388357b0bd6690f8ced1bb", // Use the same secret as in JwtModule
        });
    }

    /**
  * Validate JWT payload
  * @param payload - The decoded JWT payload ({ userId })
  */
    async validate(payload: { userId: number }) {
        const user = await this.prisma.user.findUnique({
            where: { id: payload.userId },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
            },
        });

        if (!user) {
            throw new UnauthorizedException('Invalid token: user not found');
        }

        return user; // attaches to req.user
    }
}