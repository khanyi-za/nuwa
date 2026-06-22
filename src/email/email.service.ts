import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { verificationEmailTemplate } from './templates/verification-email';
import { passwordResetEmailTemplate } from './templates/password-reset-email';
import { storeApprovalEmailTemplate } from './templates/store-approval-email';
import { storeRejectionEmailTemplate } from './templates/store-rejection-email';
import { storeLiveEmailTemplate } from './templates/store-live-email';
import { goLiveRejectionEmailTemplate } from './templates/go-live-rejection-email';
import { storeInviteEmailTemplate } from './templates/store-invite-email';

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

@Injectable()
export class EmailService {
  private readonly resend: Resend;
  private readonly from: string;
  private readonly frontendUrl: string;
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService) {
    this.resend = new Resend(configService.getOrThrow<string>('RESEND_API_KEY'));
    this.from = configService.getOrThrow<string>('EMAIL_FROM');
    this.frontendUrl = configService.getOrThrow<string>('FRONTEND_URL');
  }

  async sendVerificationEmail(
    to: string,
    firstName: string,
    token: string,
  ): Promise<EmailResult> {
    const verificationUrl = `${this.frontendUrl}/auth/verify-email?token=${token}`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Verify your YIIVA account',
        html: verificationEmailTemplate(firstName, verificationUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send verification email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending verification email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  async sendStoreApprovalEmail(
    to: string,
    firstName: string,
    storeName: string,
  ): Promise<EmailResult> {
    const dashboardUrl = `${this.frontendUrl}/dashboard`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Your store has been approved! Time to add your products',
        html: storeApprovalEmailTemplate(firstName, storeName, dashboardUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send store approval email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending store approval email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  async sendStoreRejectionEmail(
    to: string,
    firstName: string,
    storeName: string,
    reason: string,
  ): Promise<EmailResult> {
    const storeSetupUrl = `${this.frontendUrl}/store/setup`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Your store application needs changes',
        html: storeRejectionEmailTemplate(firstName, storeName, reason, storeSetupUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send store rejection email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending store rejection email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  async sendStoreLiveEmail(
    to: string,
    firstName: string,
    storeName: string,
    storeSlug: string,
  ): Promise<EmailResult> {
    const storeUrl = `${this.frontendUrl}/store/${storeSlug}`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Your store is now live on YIIVA!',
        html: storeLiveEmailTemplate(firstName, storeName, storeUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send store live email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending store live email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  async sendGoLiveRejectionEmail(
    to: string,
    firstName: string,
    storeName: string,
    reason: string,
  ): Promise<EmailResult> {
    const dashboardUrl = `${this.frontendUrl}/dashboard`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Your store needs a few more touches before going live',
        html: goLiveRejectionEmailTemplate(firstName, storeName, reason, dashboardUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send go-live rejection email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending go-live rejection email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  async sendStoreInviteEmail(
    to: string,
    storeName: string,
    rawToken: string,
  ): Promise<EmailResult> {
    const inviteUrl = `${this.frontendUrl}/invites/accept?token=${rawToken}`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: `You've been invited to manage ${storeName} on YIIVA`,
        html: storeInviteEmailTemplate(storeName, inviteUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send store invite email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending store invite email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  async sendPasswordResetEmail(
    to: string,
    firstName: string,
    token: string,
  ): Promise<EmailResult> {
    const resetUrl = `${this.frontendUrl}/auth/reset-password?token=${token}`;

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject: 'Reset your YIIVA password',
        html: passwordResetEmailTemplate(firstName, resetUrl),
      });

      if (error) {
        this.logger.error(
          `Failed to send password reset email to ${to}: ${error.message}`,
        );
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Unexpected error sending password reset email to ${to}: ${message}`,
      );
      return { success: false, error: message };
    }
  }

  /**
   * Generic transactional send. The caller owns the subject + rendered HTML
   * (e.g. the order email templates) so we don't grow a near-identical method
   * per notification type. Never throws — returns the EmailResult like the
   * dedicated senders above.
   */
  async send({
    to,
    subject,
    html,
  }: {
    to: string;
    subject: string;
    html: string;
  }): Promise<EmailResult> {
    try {
      const { data, error } = await this.resend.emails.send({
        from: this.from,
        to,
        subject,
        html,
      });

      if (error) {
        this.logger.error(`Failed to send "${subject}" to ${to}: ${error.message}`);
        return { success: false, error: error.message };
      }

      return { success: true, messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Unexpected error sending "${subject}" to ${to}: ${message}`);
      return { success: false, error: message };
    }
  }
}
