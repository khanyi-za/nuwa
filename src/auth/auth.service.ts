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
import { AccountStatus, StoreStatus, UserRole } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
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

    // 3. Generate verification token — raw goes in the email, hash goes in the DB
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const verificationExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

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
          verificationToken: hashedToken,
          verificationExpiry,
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
      rawToken,
    );

    if (!emailResult.success) {
      this.logger.warn(
        `Verification email failed for user ${user.id}: ${emailResult.error}`,
      );
    }

    return {
      message: 'Account created. Please check your email to verify your account.',
    };
  }

  // ─── Email Verification ───────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<AuthResponse> {
    // 1. Hash incoming token — DB stores the hash, never the raw value
    const hashedToken = createHash('sha256').update(token).digest('hex');

    // 2. Find user with matching token that hasn't expired
    //    Single query covers both "wrong token" and "expired token" cases
    const user = await this.prisma.user.findFirst({
      where: {
        verificationToken: hashedToken,
        verificationExpiry: { gt: new Date() },
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true },
    });

    // 3. No match — don't distinguish between invalid and expired (avoids info leak)
    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    // 4. Activate account and clear token fields in one update
    const activatedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
        verificationToken: null,
        verificationExpiry: null,
      },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, avatarUrl: true },
    });

    // 5. Auto-login — account is active, issue tokens immediately
    const tokens = await this.generateTokenPair(activatedUser);

    return { ...tokens, user: activatedUser };
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
      message: "If an account with that email exists, we've sent a password reset link.",
    };

    // 1. Find user — if not found, return generic success immediately
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, firstName: true, accountStatus: true },
    });

    if (!user) return genericResponse;

    // 2. Only send resets for ACTIVE accounts — don't reveal other statuses
    if (user.accountStatus !== AccountStatus.ACTIVE) return genericResponse;

    // 3. Generate reset token — raw goes in the email, hash goes in the DB
    //    Overwrites any existing pending reset — only the latest request is valid
    const rawToken = randomBytes(32).toString('hex');
    const hashedToken = createHash('sha256').update(rawToken).digest('hex');
    const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await this.prisma.user.update({
      where: { id: user.id },
      data: { resetToken: hashedToken, resetExpiry },
    });

    // 4. Send reset email — failure is logged but still returns generic success
    const emailResult = await this.emailService.sendPasswordResetEmail(
      user.email,
      user.firstName,
      rawToken,
    );

    if (!emailResult.success) {
      this.logger.warn(
        `Password reset email failed for user ${user.id}: ${emailResult.error}`,
      );
    }

    return genericResponse;
  }

  async resetPassword(
    token: string,
    password: string,
  ): Promise<{ message: string }> {
    // 1. Hash incoming token for DB lookup
    const hashedToken = createHash('sha256').update(token).digest('hex');

    // 2. Find user with matching token that hasn't expired
    const user = await this.prisma.user.findFirst({
      where: {
        resetToken: hashedToken,
        resetExpiry: { gt: new Date() },
      },
      select: { id: true },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // 3. Hash new password
    const passwordHash = await bcrypt.hash(password, 12);

    // 4. Update password and clear reset fields in one update
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        resetToken: null,
        resetExpiry: null,
      },
    });

    // 5. Revoke all active refresh tokens — forces re-login on all devices
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
}
