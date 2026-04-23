import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.service';
import { ClaimAccountDto } from '../dto/claim-account.dto';

/**
 * Guest account claim — lets a guest who checked out upgrade to a full account.
 *
 * Phase 6 scaffold: sets password + flips `isGuestAccount: false`.
 * Email verification is stubbed — will be enforced when the Notifications
 * module ships (OTP/link sent to guest email before password-set is allowed).
 */
@Injectable()
export class ClaimService {
  constructor(private readonly prisma: PrismaService) {}

  async claimAccount(
    dto: ClaimAccountDto,
  ): Promise<{ message: string }> {
    const email = dto.email.toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, isGuestAccount: true },
    });

    if (!user) {
      throw new NotFoundException(
        'No account found with this email address.',
      );
    }

    if (!user.isGuestAccount) {
      throw new ConflictException(
        'This email already belongs to a registered account. Please log in.',
      );
    }

    // TODO: When Notifications module lands, verify email ownership here
    // (OTP or magic link) before allowing password set. For now, we trust
    // that the caller owns the email since they received the checkout
    // confirmation email at this address.

    const passwordHash = await bcrypt.hash(dto.password, 12);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        isGuestAccount: false,
        emailVerified: true, // stubbed — will require real verification later
      },
    });

    return {
      message:
        'Account claimed successfully. You can now log in with your email and password.',
    };
  }
}
