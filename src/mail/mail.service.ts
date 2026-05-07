import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
    private readonly logger = new Logger(MailService.name);
    private transporter: nodemailer.Transporter;

    constructor(private config: ConfigService) {
        this.transporter = nodemailer.createTransport({
            host: this.config.get<string>('mail.host'),
            port: this.config.get<number>('mail.port'),
            secure: this.config.get<boolean>('mail.secure'),
            auth: {
                user: this.config.get<string>('mail.user'),
                pass: this.config.get<string>('mail.pass'),
            },
        });
    }

    async sendPasswordResetOtp(to: string, otp: string): Promise<void> {
        const from = this.config.get<string>('mail.from');

        const html = `
            <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px;">
                <h2 style="color: #111827; margin-bottom: 8px;">Password Reset Request</h2>
                <p style="color: #6b7280; margin-bottom: 24px;">Use the OTP below to reset your password. It expires in <strong>10 minutes</strong>.</p>
                <div style="background: #f3f4f6; border-radius: 6px; padding: 20px; text-align: center; letter-spacing: 12px; font-size: 32px; font-weight: bold; color: #111827;">
                    ${otp}
                </div>
                <p style="color: #6b7280; margin-top: 24px; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
            </div>
        `;

        try {
            await this.transporter.sendMail({
                from: `"GoCare Support" <${from}>`,
                to,
                subject: 'Your Password Reset OTP',
                html,
            });
            this.logger.log(`Password reset OTP sent to ${to}`);
        } catch (error) {
            this.logger.error(`Failed to send OTP email to ${to}`, error);
            throw error;
        }
    }
}
