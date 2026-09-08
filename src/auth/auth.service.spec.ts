import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, UserRole } from '@prisma/client';
import { createHash } from 'crypto';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import type { RegisterDto } from './dto/register.dto';
import type { LoginDto } from './dto/login.dto';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

// A known OTP + its stored hash, used across verify/reset suites
const OTP_CODE = '123456';
const OTP_HASH = sha256(OTP_CODE);
const FUTURE = () => new Date(Date.now() + 5 * 60 * 1000);

// ─── Shared test data ─────────────────────────────────────────────────────────

const mockAuthUser = {
  id: 'user-cuid-123',
  email: 'test@yiiva.co.za',
  firstName: 'Test',
  lastName: 'User',
  role: UserRole.BUYER,
  avatarUrl: null,
};

const mockDbUser = {
  ...mockAuthUser,
  passwordHash: 'hashed-password',
  accountStatus: AccountStatus.ACTIVE,
};

const mockTokenRecord = {
  id: 'token-cuid-456',
  token: 'hashed-refresh-token',
  userId: mockAuthUser.id,
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  revoked: false,
  user: { ...mockAuthUser, accountStatus: AccountStatus.ACTIVE },
};

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma: any = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  refreshToken: {
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    deleteMany: jest.fn(),
  },
  // deleteAccount cascade surface
  order: { count: jest.fn() },
  cart: { findUnique: jest.fn(), delete: jest.fn() },
  cartItem: { deleteMany: jest.fn() },
  pushToken: { deleteMany: jest.fn() },
  wishlistItem: { deleteMany: jest.fn() },
  notification: { deleteMany: jest.fn() },
  storeFollower: { deleteMany: jest.fn() },
  storeEmployee: { updateMany: jest.fn() },
  address: { updateMany: jest.fn() },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};

const mockJwtService = {
  sign: jest.fn().mockReturnValue('mock.access.token'),
};

const mockConfigService = {
  get: jest.fn().mockReturnValue(7),
  getOrThrow: jest.fn().mockReturnValue('test-secret'),
};

const mockEmailService = {
  sendVerificationEmail: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwtService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: EmailService, useValue: mockEmailService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    jest.clearAllMocks();

    // Defaults that most tests rely on
    mockJwtService.sign.mockReturnValue('mock.access.token');
    mockConfigService.get.mockReturnValue(7);
    mockPrisma.refreshToken.create.mockResolvedValue({ id: 'token-id' });
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    mockEmailService.sendVerificationEmail.mockResolvedValue({ success: true });
    mockEmailService.sendPasswordResetEmail.mockResolvedValue({ success: true });
    mockPrisma.$transaction.mockImplementation((fn: any) => fn(mockPrisma));
  });

  // ─── register ───────────────────────────────────────────────────────────────

  describe('register', () => {
    const dto: RegisterDto = {
      email: 'new@yiiva.co.za',
      password: 'Password123',
      firstName: 'New',
      lastName: 'User',
    };

    it('should return success message when registration succeeds', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: dto.email,
        firstName: dto.firstName,
      });

      const result = await service.register(dto);

      expect(result).toEqual({
        message:
          'Account created. Enter the 6-digit code we emailed you to verify your account.',
      });
    });

    it('should hash the password with 12 salt rounds before storing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: dto.email,
        firstName: dto.firstName,
      });

      await service.register(dto);

      expect(bcrypt.hash).toHaveBeenCalledWith(dto.password, 12);
      expect(mockPrisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ passwordHash: 'hashed-password' }),
        }),
      );
    });

    it('should email a 6-digit code and store only its SHA-256 hash', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: dto.email,
        firstName: dto.firstName,
      });

      await service.register(dto);

      const createCall = mockPrisma.user.create.mock.calls[0][0];
      const storedToken: string = createCall.data.verificationToken;
      const emailedCode: string =
        mockEmailService.sendVerificationEmail.mock.calls[0][2];

      // The email carries the raw 6-digit code; the DB carries its hash
      expect(emailedCode).toMatch(/^\d{6}$/);
      expect(storedToken).toBe(sha256(emailedCode));
      // Expiry + resend-cooldown anchor set at creation
      expect(createCall.data.verificationExpiry).toBeInstanceOf(Date);
      expect(createCall.data.verificationLastSentAt).toBeInstanceOf(Date);
    });

    it('should send the verification email after creating the user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: dto.email,
        firstName: dto.firstName,
      });

      await service.register(dto);

      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalledWith(
        dto.email,
        dto.firstName,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should still return success when the verification email fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'new-id',
        email: dto.email,
        firstName: dto.firstName,
      });
      mockEmailService.sendVerificationEmail.mockResolvedValue({
        success: false,
        error: 'Resend outage',
      });

      const result = await service.register(dto);

      expect(result.message).toBeDefined();
    });

    it('should throw ConflictException when the email is already registered', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException on Prisma P2002 unique constraint violation', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockRejectedValue({ code: 'P2002' });

      await expect(service.register(dto)).rejects.toThrow(ConflictException);
    });
  });

  // ─── verifyEmail ────────────────────────────────────────────────────────────

  describe('verifyEmail', () => {
    const pendingUser = {
      ...mockAuthUser,
      emailVerified: false,
      verificationToken: OTP_HASH,
      verificationExpiry: FUTURE(),
      verificationAttempts: 0,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...pendingUser });
      mockPrisma.user.update.mockResolvedValue(mockAuthUser);
    });

    it('should activate the account and return auth tokens on the correct code', async () => {
      const result = await service.verifyEmail(mockAuthUser.email, OTP_CODE);

      expect(result).toMatchObject({
        accessToken: 'mock.access.token',
        refreshToken: expect.any(String),
        user: expect.objectContaining({ id: mockAuthUser.id }),
      });
    });

    it('should set emailVerified and accountStatus and clear OTP state in the update', async () => {
      await service.verifyEmail(mockAuthUser.email, OTP_CODE);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            emailVerified: true,
            accountStatus: AccountStatus.ACTIVE,
            verificationToken: null,
            verificationExpiry: null,
            verificationAttempts: 0,
          }),
        }),
      );
    });

    it('should throw BadRequestException and count the attempt on a wrong code', async () => {
      await expect(
        service.verifyEmail(mockAuthUser.email, '999999'),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired verification code'),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { verificationAttempts: 1 },
        }),
      );
    });

    it('should self-destruct the code when the wrong guess hits the attempt cap', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        verificationAttempts: 4,
      });

      await expect(
        service.verifyEmail(mockAuthUser.email, '999999'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            verificationAttempts: 5,
            verificationToken: null,
            verificationExpiry: null,
          },
        }),
      );
    });

    it('should reject even the correct code once attempts are exhausted', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        verificationAttempts: 5,
      });

      await expect(
        service.verifyEmail(mockAuthUser.email, OTP_CODE),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException for an expired code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        verificationExpiry: new Date(Date.now() - 1000),
      });

      await expect(
        service.verifyEmail(mockAuthUser.email, OTP_CODE),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException for an unknown email — same message as wrong code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyEmail('nobody@yiiva.co.za', OTP_CODE),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired verification code'),
      );
    });

    it('should throw BadRequestException when the account is already verified', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        emailVerified: true,
      });

      await expect(
        service.verifyEmail(mockAuthUser.email, OTP_CODE),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── resendVerification ─────────────────────────────────────────────────────

  describe('resendVerification', () => {
    const genericResponse = {
      message:
        'If an account with that email exists and is unverified, a new code has been sent.',
    };
    const pendingUser = {
      id: mockAuthUser.id,
      email: mockAuthUser.email,
      firstName: mockAuthUser.firstName,
      emailVerified: false,
      accountStatus: AccountStatus.PENDING_VERIFICATION,
      verificationLastSentAt: new Date(Date.now() - 5 * 60 * 1000), // outside cooldown
    };

    it('should issue a fresh code, reset attempts, and email it', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(pendingUser);
      mockPrisma.user.update.mockResolvedValue(pendingUser);

      const result = await service.resendVerification(mockAuthUser.email);

      expect(result).toEqual(genericResponse);
      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const emailedCode: string =
        mockEmailService.sendVerificationEmail.mock.calls[0][2];
      expect(emailedCode).toMatch(/^\d{6}$/);
      expect(updateCall.data.verificationToken).toBe(sha256(emailedCode));
      expect(updateCall.data.verificationAttempts).toBe(0);
      expect(updateCall.data.verificationLastSentAt).toBeInstanceOf(Date);
    });

    it('should silently no-op inside the resend cooldown window', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        verificationLastSentAt: new Date(Date.now() - 10 * 1000), // 10s ago
      });

      const result = await service.resendVerification(mockAuthUser.email);

      expect(result).toEqual(genericResponse);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should return the generic message for an unknown email (enumeration prevention)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.resendVerification('nobody@yiiva.co.za');

      expect(result).toEqual(genericResponse);
      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });

    it('should return the generic message for an already-verified account', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...pendingUser,
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      });

      const result = await service.resendVerification(mockAuthUser.email);

      expect(result).toEqual(genericResponse);
      expect(mockEmailService.sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  // ─── login ──────────────────────────────────────────────────────────────────

  describe('login', () => {
    const dto: LoginDto = {
      email: 'test@yiiva.co.za',
      password: 'Password123',
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      mockPrisma.user.update.mockResolvedValue(mockDbUser);
    });

    it('should return auth tokens and user on valid credentials', async () => {
      const result = await service.login(dto);

      expect(result).toMatchObject({
        accessToken: 'mock.access.token',
        refreshToken: expect.any(String),
        user: expect.objectContaining({
          id: mockAuthUser.id,
          email: mockAuthUser.email,
        }),
      });
    });

    it('should not include passwordHash or accountStatus in the response', async () => {
      const result = await service.login(dto);

      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.user).not.toHaveProperty('accountStatus');
    });

    it('should update lastLoginAt on successful login', async () => {
      await service.login(dto);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastLoginAt: expect.any(Date) }),
        }),
      );
    });

    it('should throw UnauthorizedException when email is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.login(dto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should throw UnauthorizedException when password is wrong — same message as wrong email', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.login(dto)).rejects.toThrow(
        new UnauthorizedException('Invalid credentials'),
      );
    });

    it('should throw ForbiddenException for PENDING_VERIFICATION accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        accountStatus: AccountStatus.PENDING_VERIFICATION,
      });

      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for SUSPENDED accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        accountStatus: AccountStatus.SUSPENDED,
      });

      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });

    it('should throw ForbiddenException for DEACTIVATED accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        accountStatus: AccountStatus.DEACTIVATED,
      });

      await expect(service.login(dto)).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── refreshTokens ──────────────────────────────────────────────────────────

  describe('refreshTokens', () => {
    const rawToken = 'b'.repeat(64);

    beforeEach(() => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(mockTokenRecord);
      mockPrisma.refreshToken.update.mockResolvedValue({ ...mockTokenRecord, revoked: true });
    });

    it('should return a new token pair on a valid refresh token', async () => {
      const result = await service.refreshTokens(rawToken);

      expect(result).toMatchObject({
        accessToken: 'mock.access.token',
        refreshToken: expect.any(String),
        user: expect.objectContaining({ id: mockAuthUser.id }),
      });
    });

    it('should revoke the old token before issuing a new pair (rotation)', async () => {
      await service.refreshTokens(rawToken);

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockTokenRecord.id },
          data: { revoked: true },
        }),
      );
    });

    it('should throw UnauthorizedException when token record is not found', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refreshTokens(rawToken)).rejects.toThrow(
        new UnauthorizedException('Invalid or expired refresh token'),
      );
    });

    it('should throw UnauthorizedException when token is already revoked', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...mockTokenRecord,
        revoked: true,
      });

      await expect(service.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException when token is expired', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...mockTokenRecord,
        expiresAt: new Date(Date.now() - 1000), // in the past
      });

      await expect(service.refreshTokens(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw ForbiddenException and revoke the token when user is not ACTIVE', async () => {
      mockPrisma.refreshToken.findUnique.mockResolvedValue({
        ...mockTokenRecord,
        user: { ...mockTokenRecord.user, accountStatus: AccountStatus.SUSPENDED },
      });

      await expect(service.refreshTokens(rawToken)).rejects.toThrow(
        ForbiddenException,
      );

      expect(mockPrisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { revoked: true } }),
      );
    });
  });

  // ─── logout ─────────────────────────────────────────────────────────────────

  describe('logout', () => {
    it('should revoke the token and return success message', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.logout(mockAuthUser.id, 'c'.repeat(64));

      expect(result).toEqual({ message: 'Logged out successfully' });
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: mockAuthUser.id,
            revoked: false,
          }),
          data: { revoked: true },
        }),
      );
    });

    it('should return success even when the token is not found (idempotent)', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.logout(mockAuthUser.id, 'c'.repeat(64));

      expect(result).toEqual({ message: 'Logged out successfully' });
    });
  });

  // ─── logoutEverywhere ───────────────────────────────────────────────────────

  describe('logoutEverywhere', () => {
    it('should revoke all user tokens and return success message', async () => {
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      const result = await service.logoutEverywhere(mockAuthUser.id);

      expect(result).toEqual({ message: 'Logged out of all devices' });
      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockAuthUser.id, revoked: false },
        data: { revoked: true },
      });
    });
  });

  // ─── forgotPassword ─────────────────────────────────────────────────────────

  describe('forgotPassword', () => {
    const genericResponse = {
      message:
        "If an account with that email exists, we've sent a password reset code.",
    };

    it('should always return the generic message for a valid ACTIVE user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      mockPrisma.user.update.mockResolvedValue(mockDbUser);

      const result = await service.forgotPassword(mockDbUser.email);

      expect(result).toEqual(genericResponse);
    });

    it('should return the generic message when email does not exist (enumeration prevention)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await service.forgotPassword('nobody@yiiva.co.za');

      expect(result).toEqual(genericResponse);
    });

    it('should return the generic message for a SUSPENDED account (enumeration prevention)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        accountStatus: AccountStatus.SUSPENDED,
      });

      const result = await service.forgotPassword(mockDbUser.email);

      expect(result).toEqual(genericResponse);
    });

    it('should return the generic message for a PENDING_VERIFICATION account (enumeration prevention)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        accountStatus: AccountStatus.PENDING_VERIFICATION,
      });

      const result = await service.forgotPassword(mockDbUser.email);

      expect(result).toEqual(genericResponse);
    });

    it('should email a 6-digit code and store only its SHA-256 hash with expiry + cooldown anchor', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      mockPrisma.user.update.mockResolvedValue(mockDbUser);

      await service.forgotPassword(mockDbUser.email);

      const updateCall = mockPrisma.user.update.mock.calls[0][0];
      const emailedCode: string =
        mockEmailService.sendPasswordResetEmail.mock.calls[0][2];
      expect(emailedCode).toMatch(/^\d{6}$/);
      expect(updateCall.data.resetToken).toBe(sha256(emailedCode));
      expect(updateCall.data.resetExpiry).toBeInstanceOf(Date);
      expect(updateCall.data.resetAttempts).toBe(0);
      expect(updateCall.data.resetLastSentAt).toBeInstanceOf(Date);
    });

    it('should silently no-op inside the resend cooldown window', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockDbUser,
        resetLastSentAt: new Date(Date.now() - 10 * 1000), // 10s ago
      });

      const result = await service.forgotPassword(mockDbUser.email);

      expect(result).toEqual(genericResponse);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });

    it('should send the password reset email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      mockPrisma.user.update.mockResolvedValue(mockDbUser);

      await service.forgotPassword(mockDbUser.email);

      expect(mockEmailService.sendPasswordResetEmail).toHaveBeenCalledWith(
        mockDbUser.email,
        mockDbUser.firstName,
        expect.stringMatching(/^\d{6}$/),
      );
    });

    it('should return the generic message even when the email send fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockDbUser);
      mockPrisma.user.update.mockResolvedValue(mockDbUser);
      mockEmailService.sendPasswordResetEmail.mockResolvedValue({
        success: false,
        error: 'Resend outage',
      });

      const result = await service.forgotPassword(mockDbUser.email);

      expect(result).toEqual(genericResponse);
    });

    it('should not send an email when the account does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await service.forgotPassword('nobody@yiiva.co.za');

      expect(mockEmailService.sendPasswordResetEmail).not.toHaveBeenCalled();
    });
  });

  // ─── resetPassword ──────────────────────────────────────────────────────────

  describe('resetPassword', () => {
    const newPassword = 'NewPassword123';
    const resetUser = {
      id: mockAuthUser.id,
      resetToken: OTP_HASH,
      resetExpiry: FUTURE(),
      resetAttempts: 0,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...resetUser });
      mockPrisma.user.update.mockResolvedValue(mockDbUser);
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });
    });

    it('should return success message on the correct code', async () => {
      const result = await service.resetPassword(
        mockAuthUser.email,
        OTP_CODE,
        newPassword,
      );

      expect(result).toEqual({
        message: 'Password reset successful. Please log in with your new password.',
      });
    });

    it('should hash the new password with 12 salt rounds', async () => {
      await service.resetPassword(mockAuthUser.email, OTP_CODE, newPassword);

      expect(bcrypt.hash).toHaveBeenCalledWith(newPassword, 12);
    });

    it('should update the password and clear the reset OTP state in one call', async () => {
      await service.resetPassword(mockAuthUser.email, OTP_CODE, newPassword);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            passwordHash: 'hashed-password',
            resetToken: null,
            resetExpiry: null,
            resetAttempts: 0,
          }),
        }),
      );
    });

    it('should revoke all refresh tokens after password reset', async () => {
      await service.resetPassword(mockAuthUser.email, OTP_CODE, newPassword);

      expect(mockPrisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { userId: mockAuthUser.id, revoked: false },
        data: { revoked: true },
      });
    });

    it('should throw BadRequestException and count the attempt on a wrong code', async () => {
      await expect(
        service.resetPassword(mockAuthUser.email, '999999', newPassword),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset code'),
      );

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { resetAttempts: 1 } }),
      );
      expect(bcrypt.hash).not.toHaveBeenCalled();
    });

    it('should self-destruct the code when the wrong guess hits the attempt cap', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...resetUser,
        resetAttempts: 4,
      });

      await expect(
        service.resetPassword(mockAuthUser.email, '999999', newPassword),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { resetAttempts: 5, resetToken: null, resetExpiry: null },
        }),
      );
    });

    it('should throw BadRequestException for an unknown email or missing code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword('nobody@yiiva.co.za', OTP_CODE, newPassword),
      ).rejects.toThrow(
        new BadRequestException('Invalid or expired reset code'),
      );
    });

    it('should throw BadRequestException for an expired code', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...resetUser,
        resetExpiry: new Date(Date.now() - 1000),
      });

      await expect(
        service.resetPassword(mockAuthUser.email, OTP_CODE, newPassword),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── me ─────────────────────────────────────────────────────────────────────

  describe('me', () => {
    const fullProfile = {
      id: mockAuthUser.id,
      email: mockAuthUser.email,
      firstName: mockAuthUser.firstName,
      lastName: mockAuthUser.lastName,
      role: UserRole.BUYER,
      avatarUrl: null,
      phone: null,
      emailVerified: true,
      phoneVerified: false,
      accountStatus: AccountStatus.ACTIVE,
      createdAt: new Date('2026-01-01'),
    };

    it('should return the full user profile', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(fullProfile);

      const result = await service.me(mockAuthUser.id);

      expect(result).toEqual(fullProfile);
    });

    it('should select all required profile fields', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(fullProfile);

      await service.me(mockAuthUser.id);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            phone: true,
            emailVerified: true,
            phoneVerified: true,
            accountStatus: true,
            createdAt: true,
          }),
        }),
      );
    });

    it('should throw UnauthorizedException when the user is not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(service.me('non-existent-id')).rejects.toThrow(
        new UnauthorizedException('User not found'),
      );
    });
  });

  // ─── deleteAccount ──────────────────────────────────────────────────────────

  describe('deleteAccount', () => {
    const deletableUser = {
      id: mockAuthUser.id,
      passwordHash: 'hashed-password',
      accountStatus: AccountStatus.ACTIVE,
      store: null,
    };

    beforeEach(() => {
      mockPrisma.user.findUnique.mockResolvedValue(deletableUser);
      mockPrisma.order.count.mockResolvedValue(0);
      mockPrisma.cart.findUnique.mockResolvedValue(null);
      mockPrisma.user.update.mockResolvedValue({});
    });

    it('anonymizes the user and clears auth artifacts on the happy path', async () => {
      const result = await service.deleteAccount(mockAuthUser.id, {
        password: 'correct-password',
      });

      expect(result).toEqual({ deleted: true });
      expect(mockPrisma.refreshToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockAuthUser.id },
      });
      expect(mockPrisma.pushToken.deleteMany).toHaveBeenCalledWith({
        where: { userId: mockAuthUser.id },
      });
      expect(mockPrisma.address.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ recipientName: 'Deleted' }),
        }),
      );
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockAuthUser.id },
          data: expect.objectContaining({
            email: `deleted-${mockAuthUser.id}@deleted.yiiva.co.za`,
            firstName: 'Deleted',
            lastName: 'User',
            accountStatus: AccountStatus.DEACTIVATED,
          }),
        }),
      );
    });

    it('releases cart stock reservations before deleting the cart', async () => {
      mockPrisma.cart.findUnique.mockResolvedValue({
        id: 'cart-1',
        items: [{ productId: 'prod-1', variantId: null, quantity: 2 }],
      });
      mockPrisma.$executeRaw = jest.fn().mockResolvedValue(1);

      await service.deleteAccount(mockAuthUser.id, { password: 'pw' });

      expect(mockPrisma.$executeRaw).toHaveBeenCalled();
      expect(mockPrisma.cartItem.deleteMany).toHaveBeenCalledWith({
        where: { cartId: 'cart-1' },
      });
      expect(mockPrisma.cart.delete).toHaveBeenCalledWith({ where: { id: 'cart-1' } });
    });

    it('throws UnauthorizedException on a wrong password', async () => {
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.deleteAccount(mockAuthUser.id, { password: 'wrong' }),
      ).rejects.toThrow(new UnauthorizedException('Incorrect password'));
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException when the user owns a store', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...deletableUser,
        store: { id: 'store-1' },
      });

      await expect(
        service.deleteAccount(mockAuthUser.id, { password: 'pw' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException while orders are in flight', async () => {
      mockPrisma.order.count.mockResolvedValue(2);

      await expect(
        service.deleteAccount(mockAuthUser.id, { password: 'pw' }),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
