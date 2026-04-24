import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ClaimService } from './claim.service';
import { PrismaService } from '../../prisma/prisma.service';

// ─── Mocks ─────────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};

// ─── Suite ─────────────────────────────────────────────────────────────────

describe('ClaimService', () => {
  let service: ClaimService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ClaimService>(ClaimService);
    jest.clearAllMocks();
  });

  it('claims a guest account successfully', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'guest-1',
      isGuestAccount: true,
    });
    mockPrisma.user.update.mockResolvedValue({});

    const result = await service.claimAccount({
      email: 'Guest@Example.com',
      password: 'securepassword123',
    });

    expect(result.message).toContain('claimed successfully');
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'guest@example.com' },
      select: { id: true, isGuestAccount: true },
    });
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'guest-1' },
        data: expect.objectContaining({
          isGuestAccount: false,
          emailVerified: true,
        }),
      }),
    );
  });

  it('throws 404 when no account exists for the email', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      service.claimAccount({
        email: 'nobody@example.com',
        password: 'securepassword123',
      }),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws 409 when the account is not a guest account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      isGuestAccount: false,
    });

    await expect(
      service.claimAccount({
        email: 'real@example.com',
        password: 'securepassword123',
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('normalizes email to lowercase', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'guest-1',
      isGuestAccount: true,
    });
    mockPrisma.user.update.mockResolvedValue({});

    await service.claimAccount({
      email: 'UPPER@CASE.COM',
      password: 'securepassword123',
    });

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'upper@case.com' },
      select: { id: true, isGuestAccount: true },
    });
  });

  it('hashes the password before storing', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'guest-1',
      isGuestAccount: true,
    });
    mockPrisma.user.update.mockResolvedValue({});

    await service.claimAccount({
      email: 'guest@example.com',
      password: 'securepassword123',
    });

    const updateCall = mockPrisma.user.update.mock.calls[0][0];
    // Password should be hashed, not stored as plaintext.
    expect(updateCall.data.passwordHash).not.toBe('securepassword123');
    expect(updateCall.data.passwordHash.startsWith('$2')).toBe(true);
  });

  // ─── Phase 10 gap tests ────────────────────────────────────────────────

  it('succeeds when guest account already has emailVerified: true', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'guest-1',
      isGuestAccount: true,
      emailVerified: true, // already verified
    });
    mockPrisma.user.update.mockResolvedValue({});

    const result = await service.claimAccount({
      email: 'guest@example.com',
      password: 'securepassword123',
    });

    expect(result.message).toContain('claimed successfully');
    // Sets emailVerified to true again (idempotent).
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          emailVerified: true,
        }),
      }),
    );
  });

  it('propagates error when bcrypt.hash fails', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'guest-1',
      isGuestAccount: true,
    });

    // Mock bcrypt to throw.
    const bcrypt = require('bcrypt');
    const originalHash = bcrypt.hash;
    bcrypt.hash = jest.fn().mockRejectedValueOnce(new Error('bcrypt OOM'));

    await expect(
      service.claimAccount({
        email: 'guest@example.com',
        password: 'securepassword123',
      }),
    ).rejects.toThrow('bcrypt OOM');

    // user.update should NOT have been called.
    expect(mockPrisma.user.update).not.toHaveBeenCalled();

    // Restore original.
    bcrypt.hash = originalHash;
  });
});
