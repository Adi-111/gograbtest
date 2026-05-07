import {
    BadRequestException,
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthEntity } from './entity/auth.entity';
import { SignupDto } from './dto/sign-up.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { MailService } from 'src/mail/mail.service';

@Injectable()
export class AuthService {
    private readonly logger = new Logger(AuthService.name);

    constructor(
        private prisma: PrismaService,
        private jwtService: JwtService,
        private mailService: MailService,
    ) { }

    /**
     * Validate a user's credentials.
     * @param email - The user's email.
     * @param password - The user's password.
     * @returns The user object without the password.
     * @throws NotFoundException if the user is not found.
     * @throws UnauthorizedException if the password is invalid.
     */
    async validateUser(email: string, password: string) {
        const user = await this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                password: true,  // Ensure password is selected
                createdAt: true,
                updatedAt: true,
                role: true
            },
        });

        if (!user) {
            throw new NotFoundException(`User with email "${email}" not found.`);
        }

        if (!user.password) {
            console.error(`User found but password is missing for email: ${email}`);
            throw new UnauthorizedException('Password not set for this user.');
        }

        console.log(`Comparing passwords:`, {
            inputPassword: password,
            storedPassword: user.password
        });

        const isPasswordValid = await bcrypt.compare(String(password), user.password);
        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid credentials');
        }

        const { password: _, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    /**
     * Hash a password using bcrypt.
     * @param password - The plaintext password.
     * @returns The hashed password.
     */
    private async hashPassword(password: string): Promise<string> {
        return bcrypt.hash(password, 10);
    }

    /**
     * Generate a JWT token for a user.
     * @param userId - The user's ID.
     * @returns The JWT token.
     */
    private generateToken(userId: number): string {
        return this.jwtService.sign({ userId });
    }

    /**
     * Register a new user.
     * @param signUpDto - The user's registration data.
     * @returns The access token.
     * @throws ConflictException if the email is already registered.
     */
    async signUp(signUpDto: SignupDto): Promise<AuthEntity> {
        const { firstName, lastName, email, password } = signUpDto;

        // Check if the email already exists
        const existingUser = await this.prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            throw new ConflictException('Email is already registered');
        }

        // Hash the password
        const hashedPassword = await this.hashPassword(password);

        // Create the user
        const user = await this.prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                password: hashedPassword,
            },
        });

        this.logger.log(`New user registered: ${user.email}`);

        // Generate JWT token
        const accessToken = this.generateToken(user.id);

        return { accessToken, userId: user.id, role: user.role };
    }

    /**
     * Authenticate a user and create a session.
     * @param signInDto - The user's login data.
     * @returns The access token and session details.
     * @throws NotFoundException if the user is not found.
     * @throws UnauthorizedException if the password is invalid.
     */
    async signIn(signInDto: LoginDto): Promise<AuthEntity> {
        const { email, password } = signInDto;
        this.logger.log(`Sign-in attempt for email: ${email} ${JSON.stringify(password)}`);

        // Validate the user
        const user = await this.validateUser(email, password);

        // Generate JWT token
        const accessToken = this.generateToken(user.id);

        // Create a session in the database
        await this.prisma.session.create({
            data: {
                userId: user.id,
                token: accessToken,
                expiresAt: new Date(Date.now() + 3600 * 1000), // 1 hour from now
            },
        });

        this.logger.log(`User signed in: ${user.email}`);


        return {
            accessToken,
            userId: user.id,
            role: user.role,
        };
    }

    /**
     * Log out a user by deleting their session.
     * @param sessionId - The session ID.
     * @throws NotFoundException if the session is not found.
     */
    async signOut(token: string): Promise<void> {
        const session = await this.prisma.session.findFirst({
            where: {
                token
            }
        })
        await this.prisma.session.delete({
            where: { id: session.id },
        });

        this.logger.log(`User signed out and session destroyed: ${session.id}`);
    }

    /**
     * Validate a session.
     * @param sessionId - The session ID.
     * @param accessToken - The access token.
     * @returns True if the session is valid, false otherwise.
     */
    private generateOtp(): string {
        return Math.floor(100000 + Math.random() * 900000).toString();
    }

    async forgotPassword({ email }: ForgotPasswordDto): Promise<{ message: string }> {
        const user = await this.prisma.user.findUnique({ where: { email } });

        // Always return generic message to prevent user enumeration
        if (!user) {
            return { message: 'If that email is registered, an OTP has been sent.' };
        }

        const otp = this.generateOtp();
        const hashedOtp = await bcrypt.hash(otp, 10);
        const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        await this.prisma.user.update({
            where: { email },
            data: { passwordResetOtp: hashedOtp, passwordResetExpiry: expiry },
        });

        await this.mailService.sendPasswordResetOtp(email, otp);

        this.logger.log(`Password reset OTP issued for: ${email}`);
        return { message: 'If that email is registered, an OTP has been sent.' };
    }

    async resetPassword({ email, otp, newPassword }: ResetPasswordDto): Promise<{ message: string }> {
        const user = await this.prisma.user.findUnique({ where: { email } });

        if (!user || !user.passwordResetOtp || !user.passwordResetExpiry) {
            throw new BadRequestException('Invalid or expired OTP.');
        }

        if (user.passwordResetExpiry < new Date()) {
            throw new BadRequestException('OTP has expired. Please request a new one.');
        }

        const isOtpValid = await bcrypt.compare(otp, user.passwordResetOtp);
        if (!isOtpValid) {
            throw new BadRequestException('Invalid OTP.');
        }

        const hashed = await this.hashPassword(newPassword);

        await this.prisma.user.update({
            where: { id: user.id },
            data: {
                password: hashed,
                passwordResetOtp: null,
                passwordResetExpiry: null,
            },
        });

        this.logger.log(`Password reset successful for: ${user.email}`);
        return { message: 'Password reset successful. You can now log in.' };
    }

    async validateSession(token: string): Promise<boolean> {
        this.logger.log(token)
        const session = await this.prisma.session.findFirst({
            where: {
                token
            },
            include: {
                user: true
            }
        })


        this.logger.log(`session validated for userId: ${session.userId}, `);

        if (!session || !session.token || session.expiresAt < new Date() || session.user.role === 'Unknown') {
            return false;
        }


        return true// Session is valid
    }
}