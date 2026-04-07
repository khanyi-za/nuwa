import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountStatus, UserRole } from '@prisma/client';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtPayload } from '../../common/types/jwt-payload.interface';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
  },
};

const mockConfigService = {
  getOrThrow: jest.fn().mockReturnValue('test-jwt-secret'),
};

// ─── Shared test data ─────────────────────────────────────────────────────────

const mockPayload: JwtPayload = {
  sub: 'user-cuid-123',
  email: 'test@yiiva.co.za',
  role: UserRole.BUYER,
};

const mockActiveUser = {
  id: 'user-cuid-123',
  email: 'test@yiiva.co.za',
  role: UserRole.BUYER,
  accountStatus: AccountStatus.ACTIVE,
};

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    jest.clearAllMocks();
  });

  // ─── validate ───────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('should return the user object for an ACTIVE user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser);

      const result = await strategy.validate(mockPayload);

      expect(result).toEqual(mockActiveUser);
    });

    it('should query the database by the sub (user ID) from the payload', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockActiveUser);

      await strategy.validate(mockPayload);

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockPayload.sub },
        }),
      );
    });

    it('should throw UnauthorizedException when the user does not exist', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a SUSPENDED user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser,
        accountStatus: AccountStatus.SUSPENDED,
      });

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a DEACTIVATED user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser,
        accountStatus: AccountStatus.DEACTIVATED,
      });

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException for a PENDING_VERIFICATION user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser,
        accountStatus: AccountStatus.PENDING_VERIFICATION,
      });

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException with a clear message for inactive accounts', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        ...mockActiveUser,
        accountStatus: AccountStatus.SUSPENDED,
      });

      await expect(strategy.validate(mockPayload)).rejects.toThrow(
        new UnauthorizedException('Account is inactive or does not exist'),
      );
    });
  });
});
