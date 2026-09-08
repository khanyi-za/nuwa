import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, OrderStatus, StoreStatus, UserRole } from '@prisma/client';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { releaseStock } from '../order/cart/stock';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import type { JwtPayload } from '../common/types/jwt-payload.interface';

type AuthUser = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
};

type AuthResponse = { accessToken: string; refreshToken: string; user: AuthUser };

// OTP policy — applies to both email verification and password reset.
// 6 digits = 1M combinations; the attempt cap is what makes that space safe.
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_OTP_ATTEMPTS = 5; // code self-destructs after 5 wrong guesses
const RESEND_COOLDOWN_MS = 60 * 1000; // silent no-op inside the window

type UserProfile = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  avatarUrl: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  accountStatus: AccountStatus;
  createdAt: Date;
  store: {
    id: string;
    displayName: string;
    slug: string;
    status: StoreStatus;
    logoUrl: string | null;
    rejectionReason: string | null;
  } | null;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private emailService: EmailService,
  ) {}

  // ─── Registration ────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ message: string }> {
    // 1. Check for existing user
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    // 2. Hash password (12 salt rounds)
    const passwordHash = await bcrypt.hash(dto.password, 12);

    // 3. Generate verification OTP — raw code goes in the email, hash goes in the DB
    const code = this.generateOtp();
    const verificationExpiry = new Date(Date.now() + OTP_TTL_MS);

    // 4. Create user — role and accountStatus use schema defaults (BUYER, PENDING_VERIFICATION)
    let user: { id: string; email: string; firstName: string };
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone,
          verificationToken: this.hashOtp(code),
          verificationExpiry,
          verificationLastSentAt: new Date(),
        },
        select: { id: true, email: true, firstName: true },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException('Email already registered');
      }
      throw err;
    }

    // 5. Send verification email — failure is logged but never blocks account creation
    const emailResult = await this.emailService.sendVerificationEmail(
      user.email,
      user.firstName,
      code,
    );

    if (!emailResult.success) {
      this.logger.warn(
        `Verification email failed for user ${user.id}: ${emailResult.error}`,
      );
    }

    return {
      message:
        'Account created. Enter the 6-digit code we emailed you to verify your account.',
    };
  }

  // ─── Email Verification ───────────────────────────────────────────────────────

  async verifyEmail(email: string, code: string): Promise<AuthResponse> {
    // One error for every failure mode — never reveals whether the email exists,
    // whether the code expired, or whether attempts ran out
    const invalid = () =>
      new BadRequestException('Invalid or expired verification code');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        emailVerified: true,
        verificationToken: true,
        verificationExpiry: true,
        verificationAttempts: true,
      },
    });

    if (
      !user ||
      user.emailVerified ||
      !user.verificationToken ||
      !user.verificationExpiry ||
      user.verificationExpiry <= new Date() ||
      user.verificationAttempts >= MAX_OTP_ATTEMPTS
    ) {
      throw invalid();
    }

    if (!this.otpMatches(code, user.verificationToken)) {
      // Wrong guess — count it; at the cap the code self-destructs so the
      // remaining keyspace can't be brute-forced
      const attempts = user.verificationAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          attempts >= MAX_OTP_ATTEMPTS
            ? {
                verificationAttempts: attempts,
                verificationToken: null,
                verificationExpiry: null,
              }
            : { verificationAttempts: attempts },
      });
      throw invalid();
    }

    // Activate account and clear OTP state in one update
    const activatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        verificationToken: null,
        verificationExpiry: null,
        verificationAttempts: 0,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true },
    });

    // Auto-login — account is active, issue tokens immediately
    const tokens = await this.generateTokenPair(activatedUser);

    return { ...tokens, user: activatedUser };
  }

  async resendVerification(email: string): Promise<{ message: string }> {
    // Generic response on every path — enumeration-safe
    const genericResponse = {
      message:
        'If an account with that email exists and is unverified, a new code has been sent.',
    };

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        emailVerified: true,
        accountStatus: true,
        verificationLastSentAt: true,
      },
    });

    if (!user || user.emailVerified) return genericResponse;
    if (user.accountStatus !== AccountStatus.PENDING_VERIFICATION) {
      return genericResponse;
    }

    // Cooldown — silent no-op so the response can't be used as a timing oracle
    if (
      user.verificationLastSentAt &&
      Date.now() - user.verificationLastSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return genericResponse;
    }

    // Fresh code replaces the old one; attempts reset with it
    const code = this.generateOtp();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        verificationToken: this.hashOtp(code),
        verificationExpiry: new Date(Date.now() + OTP_TTL_MS),
        verificationAttempts: 0,
        verificationLastSentAt: new Date(),
      },
    });

    const emailResult = await this.emailService.sendVerificationEmail(
      user.email,
      user.firstName,
      code,
    );

    if (!emailResult.success) {
      this.logger.warn(
        `Verification resend failed for user ${user.id}: ${emailResult.error}`,
      );
    }

    return genericResponse;
  }

  // ─── Login ────────────────────────────────────────────────────────────────────

  async login(dto: LoginDto): Promise<AuthResponse> {
    // 1. Find user by email — fetch passwordHash and accountStatus for the checks below
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        passwordHash: true,
        accountStatus: true,
      },
    });

    // 2. Validate credentials — same error for wrong email and wrong password
    //    Prevents user enumeration: attacker learns nothing from the error message
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // 3. Check account status — each case gets an actionable message
    if (user.accountStatus === AccountStatus.PENDING_VERIFICATION) {
      throw new ForbiddenException(
        'Please verify your email before logging in',
      );
    }

    if (user.accountStatus === AccountStatus.SUSPENDED) {
      throw new ForbiddenException(
        'Your account has been suspended. Contact support.',
      );
    }

    if (user.accountStatus === AccountStatus.DEACTIVATED) {
      throw new ForbiddenException('This account has been deactivated.');
    }

    // 4. Issue tokens
    const tokens = await this.generateTokenPair(user);

    // 5. Record login timestamp
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 6. Return tokens + safe user shape (no passwordHash or accountStatus)
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    };
  }

  // ─── Token Refresh ────────────────────────────────────────────────────────────

  async refreshTokens(refreshToken: string): Promise<AuthResponse> {
    // 1. Hash the incoming raw token for DB lookup
    const hashedToken = createHash('sha256').update(refreshToken).digest('hex');

    // 2. Find the token record — include user since we need their data for the new pair
    //    findUnique uses the @unique index on token directly
    const tokenRecord = await this.prisma.refreshToken.findUnique({
      where: { token: hashedToken },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            avatarUrl: true,
            accountStatus: true,
          },
        },
      },
    });

    // 3. Validate — one error covers wrong token, already revoked, and expired
    if (!tokenRecord || tokenRecord.revoked || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // 4. Check current account status — user may have been suspended since last login
    //    If not ACTIVE, revoke the token and block the refresh
    if (tokenRecord.user.accountStatus !== AccountStatus.ACTIVE) {
      await this.prisma.refreshToken.update({
        where: { id: tokenRecord.id },
        data: { revoked: true },
      });
      throw new ForbiddenException('Account is not active. Please log in again.');
    }

    // 5. Rotate — revoke the old token (single-use enforcement)
    await this.prisma.refreshToken.update({
      where: { id: tokenRecord.id },
      data: { revoked: true },
    });

    // 6. Issue a fresh token pair
    const tokens = await this.generateTokenPair(tokenRecord.user);

    // 7. Return new pair + fresh user snapshot
    return {
      ...tokens,
      user: {
        id: tokenRecord.user.id,
        email: tokenRecord.user.email,
        firstName: tokenRecord.user.firstName,
        lastName: tokenRecord.user.lastName,
        role: tokenRecord.user.role,
        avatarUrl: tokenRecord.user.avatarUrl,
      },
    };
  }

  // ─── Logout ───────────────────────────────────────────────────────────────────

  async logout(userId: string, refreshToken: string): Promise<{ message: string }> {
    const hashedToken = createHash('sha256').update(refreshToken).digest('hex');

    // updateMany handles "token not found" and "already revoked" silently —
    // zero rows updated is not an error. userId scoped to prevent revoking other users' tokens.
    await this.prisma.refreshToken.updateMany({
      where: { token: hashedToken, userId, revoked: false },
      data: { revoked: true },
    });

    return { message: 'Logged out successfully' };
  }

  async logoutEverywhere(userId: string): Promise<{ message: string }> {
    await this.revokeAllUserTokens(userId);
    return { message: 'Logged out of all devices' };
  }

  // ─── Password Reset ───────────────────────────────────────────────────────────

  async forgotPassword(email: string): Promise<{ message: string }> {
    // Generic response used in every return path — never reveal whether the email exists
    const genericResponse = {
      message:
        "If an account with that email exists, we've sent a password reset code.",
    };

    // 1. Find user — if not found, return generic success immediately
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        firstName: true,
        accountStatus: true,
        resetLastSentAt: true,
      },
    });

    if (!user) return genericResponse;

    // 2. Only send resets for ACTIVE accounts — don't reveal other statuses
    if (user.accountStatus !== AccountStatus.ACTIVE) return genericResponse;

    // 3. Cooldown — silent no-op inside the window
    if (
      user.resetLastSentAt &&
      Date.now() - user.resetLastSentAt.getTime() < RESEND_COOLDOWN_MS
    ) {
      return genericResponse;
    }

    // 4. Generate reset OTP — raw code goes in the email, hash goes in the DB
    //    Overwrites any existing pending reset — only the latest request is valid
    const code = this.generateOtp();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetToken: this.hashOtp(code),
        resetExpiry: new Date(Date.now() + OTP_TTL_MS),
        resetAttempts: 0,
        resetLastSentAt: new Date(),
      },
    });

    // 5. Send reset email — failure is logged but still returns generic success
    const emailResult = await this.emailService.sendPasswordResetEmail(
      user.email,
      user.firstName,
      code,
    );

    if (!emailResult.success) {
      this.logger.warn(
        `Password reset email failed for user ${user.id}: ${emailResult.error}`,
      );
    }

    return genericResponse;
  }

  async resetPassword(
    email: string,
    code: string,
    password: string,
  ): Promise<{ message: string }> {
    // One error for every failure mode — same shape as verifyEmail
    const invalid = () =>
      new BadRequestException('Invalid or expired reset code');

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        resetToken: true,
        resetExpiry: true,
        resetAttempts: true,
      },
    });

    if (
      !user ||
      !user.resetToken ||
      !user.resetExpiry ||
      user.resetExpiry <= new Date() ||
      user.resetAttempts >= MAX_OTP_ATTEMPTS
    ) {
      throw invalid();
    }

    if (!this.otpMatches(code, user.resetToken)) {
      const attempts = user.resetAttempts + 1;
      await this.prisma.user.update({
        where: { id: user.id },
        data:
          attempts >= MAX_OTP_ATTEMPTS
            ? { resetAttempts: attempts, resetToken: null, resetExpiry: null }
            : { resetAttempts: attempts },
      });
      throw invalid();
    }

    // Hash new password, then update and clear OTP state in one update
    const passwordHash = await bcrypt.hash(password, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetExpiry: null,
        resetAttempts: 0,
      },
    });

    // Revoke all active refresh tokens — forces re-login on all devices
    await this.revokeAllUserTokens(user.id);

    return { message: 'Password reset successful. Please log in with your new password.' };
  }

  // ─── Profile ──────────────────────────────────────────────────────────────────

  async me(userId: string): Promise<UserProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        avatarUrl: true,
        phone: true,
        emailVerified: true,
        phoneVerified: true,
        accountStatus: true,
        createdAt: true,
        store: {
          select: {
            id: true,
            displayName: true,
            slug: true,
            status: true,
            logoUrl: true,
            rejectionReason: true,
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return user;
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  /** Cryptographically random 6-digit code, zero-padded ("004217" is valid). */
  private generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private hashOtp(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  /** Constant-time comparison of a submitted code against the stored hash. */
  private otpMatches(code: string, storedHash: string): boolean {
    const submitted = Buffer.from(this.hashOtp(code), 'hex');
    const stored = Buffer.from(storedHash, 'hex');
    return (
      submitted.length === stored.length && timingSafeEqual(submitted, stored)
    );
  }

  /**
   * Revokes all active refresh tokens for a user.
   * Called by logoutEverywhere() and internally after password reset.
   */
  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true },
    });
  }

  /**
   * Issues an access token + refresh token pair for a given user.
   * - Access token: signed JWT, never stored in DB
   * - Refresh token: raw value returned to client, sha256 hash stored in DB
   * Called by verifyEmail and login — single source of truth for token issuance.
   */
  private async generateTokenPair(user: {
    id: string;
    email: string;
    role: UserRole;
  }): Promise<{ accessToken: string; refreshToken: string }> {
    // Sign access token
    const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    // Generate refresh token — raw goes to client, hash goes to DB
    const rawRefreshToken = randomBytes(32).toString('hex');
    const hashedRefreshToken = createHash('sha256')
      .update(rawRefreshToken)
      .digest('hex');

    const days = this.configService.get<number>('REFRESH_TOKEN_EXPIRES_IN_DAYS', 7);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: {
        token: hashedRefreshToken,
        userId: user.id,
        expiresAt,
      },
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }

  /**
   * DELETE /auth/account — permanent account deletion (App Store requirement).
   *
   * Model: ANONYMIZE, not hard-delete. Orders/payments are financial records
   * that must survive (and carry their own delivery-address snapshots), so the
   * user row stays as an anonymized husk and every PII field is scrubbed.
   *
   * Refusals (409) rather than partial deletion:
   * - Store owners: a store is a business relationship with its own money
   *   flow — deletion goes through support, not a button.
   * - In-flight orders: money or parcels are still moving; the account must
   *   see them through (or cancel) first.
   *
   * Inside one transaction: release cart stock reservations, delete carts /
   * wishlist / notifications / push + refresh tokens / store follows,
   * deactivate employee memberships, soft-delete + scrub addresses (orders
   * hold an FK to them — display uses the order's own snapshot fields), and
   * anonymize the user row. Password becomes an unmatchable random hash and
   * accountStatus DEACTIVATED, which login refuses explicitly.
   */
  async deleteAccount(userId: string, dto: DeleteAccountDto): Promise<{ deleted: true }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        passwordHash: true,
        accountStatus: true,
        store: { select: { id: true } },
      },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect password');
    }

    if (user.store) {
      throw new ConflictException(
        'Your account owns a store. Contact support@yiiva.co.za to close the store and delete your account.',
      );
    }

    const inFlightOrders = await this.prisma.order.count({
      where: {
        userId,
        status: {
          notIn: [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REFUNDED],
        },
      },
    });
    if (inFlightOrders > 0) {
      throw new ConflictException(
        'You have orders that are still in progress. Once they are delivered or cancelled you can delete your account.',
      );
    }

    const anonEmail = `deleted-${userId}@deleted.yiiva.co.za`;
    const unmatchablePassword = await bcrypt.hash(randomBytes(32).toString('hex'), 12);

    await this.prisma.$transaction(async (tx) => {
      // Release any stock still reserved by the cart before removing it.
      const cart = await tx.cart.findUnique({
        where: { userId },
        select: { id: true, items: { select: { productId: true, variantId: true, quantity: true } } },
      });
      if (cart) {
        for (const item of cart.items) {
          await releaseStock(tx, item.productId, item.variantId, item.quantity);
        }
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.delete({ where: { id: cart.id } });
      }

      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.pushToken.deleteMany({ where: { userId } });
      await tx.wishlistItem.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.storeFollower.deleteMany({ where: { userId } });
      await tx.storeEmployee.updateMany({
        where: { userId },
        data: { isActive: false },
      });

      // Orders FK-reference addresses, so scrub PII in place + soft-delete.
      await tx.address.updateMany({
        where: { userId },
        data: {
          recipientName: 'Deleted',
          phone: '',
          addressLine1: 'Deleted',
          addressLine2: null,
          deletedAt: new Date(),
          isDefault: false,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonEmail,
          firstName: 'Deleted',
          lastName: 'User',
          phone: null,
          avatarUrl: null,
          passwordHash: unmatchablePassword,
          emailVerified: false,
          accountStatus: AccountStatus.DEACTIVATED,
          verificationToken: null,
          verificationExpiry: null,
          resetToken: null,
          resetExpiry: null,
        },
      });
    });

    this.logger.log(`Account deleted (anonymized): ${userId}`);
    return { deleted: true };
  }
}
