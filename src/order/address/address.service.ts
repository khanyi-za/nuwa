import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Address, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAddressDto } from '../dto/create-address.dto';
import { UpdateAddressDto } from '../dto/update-address.dto';
import { normalizePhone } from '../utils/phone';

const MAX_ADDRESSES_PER_USER = 4;

/**
 * Buyer-facing address management.
 *
 * Rules (locked in Phase 2 decisions log):
 *   - Max 4 active addresses per user. Deleted addresses don't count.
 *   - First address on create auto-promotes to default.
 *   - `isDefault: true` in create/update transactionally flips all other
 *     defaults to false. No separate set-default endpoint.
 *   - Setting `isDefault: false` on the current default via PATCH is
 *     rejected with 409 — buyer must promote another address instead.
 *   - Delete is soft (`deletedAt`). If the deleted address was the default,
 *     the most-recently-updated surviving address is promoted. If it was
 *     the only one, the user ends up with no default.
 *   - Ownership is 404-not-403: attempts to read another buyer's address
 *     return "Address not found".
 *
 * Concurrency:
 *   - The "one default per user" invariant is also enforced at the DB layer
 *     by a partial unique index (migration 20260415132000). A racing
 *     auto-default on first-create will surface as a Prisma P2002.
 *   - `update` and `delete` perform ownership + soft-delete checks *inside*
 *     the transaction so a concurrent delete can't be resurrected by a
 *     raced patch.
 */
@Injectable()
export class AddressService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<Address[]> {
    return this.prisma.address.findMany({
      where: { userId, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async getById(userId: string, addressId: string): Promise<Address> {
    return this.assertAddressOwnedAndActive(this.prisma, userId, addressId);
  }

  async create(userId: string, dto: CreateAddressDto): Promise<Address> {
    const normalizedPhone = normalizePhone(dto.phone);

    return this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.address.count({
        where: { userId, deletedAt: null },
      });

      if (activeCount >= MAX_ADDRESSES_PER_USER) {
        throw new ConflictException(
          `You can have at most ${MAX_ADDRESSES_PER_USER} addresses. Delete one to add another.`,
        );
      }

      // First address auto-defaults regardless of request body.
      const shouldBeDefault = activeCount === 0 ? true : dto.isDefault === true;

      if (shouldBeDefault) {
        await tx.address.updateMany({
          where: { userId, isDefault: true, deletedAt: null },
          data: { isDefault: false },
        });
      }

      return tx.address.create({
        data: {
          userId,
          label: dto.label?.trim() || null,
          recipientName: dto.recipientName.trim(),
          phone: normalizedPhone,
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2?.trim() || null,
          city: dto.city.trim(),
          province: dto.province,
          postalCode: dto.postalCode,
          isDefault: shouldBeDefault,
        },
      });
    });
  }

  async update(
    userId: string,
    addressId: string,
    dto: UpdateAddressDto,
  ): Promise<Address> {
    const normalizedPhone =
      dto.phone !== undefined ? normalizePhone(dto.phone) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.assertAddressOwnedAndActive(
        tx,
        userId,
        addressId,
      );

      // Unset-default via PATCH is blocked — 409. Buyer must promote another
      // address (by PATCHing another with isDefault: true) instead.
      if (dto.isDefault === false && existing.isDefault) {
        throw new ConflictException(
          'Cannot unset the default address directly. Set another address as default instead.',
        );
      }

      const data: Prisma.AddressUpdateInput = {};
      if (dto.label !== undefined) data.label = dto.label?.trim() || null;
      if (dto.recipientName !== undefined)
        data.recipientName = dto.recipientName.trim();
      if (normalizedPhone !== undefined) data.phone = normalizedPhone;
      if (dto.addressLine1 !== undefined)
        data.addressLine1 = dto.addressLine1.trim();
      if (dto.addressLine2 !== undefined)
        data.addressLine2 = dto.addressLine2?.trim() || null;
      if (dto.city !== undefined) data.city = dto.city.trim();
      if (dto.province !== undefined) data.province = dto.province;
      if (dto.postalCode !== undefined) data.postalCode = dto.postalCode;

      const promoteToDefault = dto.isDefault === true && !existing.isDefault;
      if (promoteToDefault) {
        await tx.address.updateMany({
          where: {
            userId,
            isDefault: true,
            deletedAt: null,
            NOT: { id: addressId },
          },
          data: { isDefault: false },
        });
        data.isDefault = true;
      }

      return tx.address.update({ where: { id: addressId }, data });
    });
  }

  async delete(
    userId: string,
    addressId: string,
  ): Promise<{ success: true }> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await this.assertAddressOwnedAndActive(
        tx,
        userId,
        addressId,
      );

      await tx.address.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isDefault: false },
      });

      // Auto-promote another address if the deleted one was the default.
      if (existing.isDefault) {
        const nextDefault = await tx.address.findFirst({
          where: { userId, deletedAt: null, NOT: { id: addressId } },
          orderBy: { updatedAt: 'desc' },
        });
        if (nextDefault) {
          await tx.address.update({
            where: { id: nextDefault.id },
            data: { isDefault: true },
          });
        }
        // else: user has no addresses left — checkout handles the empty state.
      }
    });

    return { success: true };
  }

  /**
   * Private helper — fetch an address and verify it belongs to the caller
   * and hasn't been soft-deleted. Returns 404 on every miss path (ownership
   * leak, deleted, not-found) to prevent enumeration.
   *
   * Accepts either the root `PrismaService` or a transaction client so
   * callers can run the guard inside the same `$transaction` as their write
   * (prevents a concurrent delete from being resurrected by a raced patch).
   */
  private async assertAddressOwnedAndActive(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
    addressId: string,
  ): Promise<Address> {
    const address = await client.address.findUnique({
      where: { id: addressId },
    });

    if (!address || address.userId !== userId || address.deletedAt !== null) {
      throw new NotFoundException('Address not found');
    }

    return address;
  }
}
