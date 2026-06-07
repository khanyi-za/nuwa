import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, StoreDispatchAddress } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StoreService } from '../../store/store.service';
import { normalizePhone } from '../../order/utils/phone';
import { CreateDispatchAddressDto } from './dto/create-dispatch-address.dto';
import { UpdateDispatchAddressDto } from './dto/update-dispatch-address.dto';

/**
 * Per-store dispatch-address CRUD for merchants.
 *
 * Authz: every method calls `StoreService.canManageStore` — owner OR active
 * accepted employee. Missing/foreign store → 403 (matches the bank-fields
 * authz pattern). Address not owned by the store → 404 (enumeration
 * prevention, mirrors buyer-Address semantics).
 *
 * Soft delete: rows are flagged `deletedAt` rather than removed because
 * historical `Order.shippingDispatchAddressId` FKs must stay valid for the
 * audit-trail rule documented in `order-module-foundation.md` Q12.
 */
@Injectable()
export class DispatchAddressService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
  ) {}

  // ─── Reads ──────────────────────────────────────────────────────────────────

  async list(
    userId: string,
    storeId: string,
  ): Promise<StoreDispatchAddress[]> {
    await this.assertCanManage(userId, storeId);
    return this.prisma.storeDispatchAddress.findMany({
      where: { storeId, deletedAt: null },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
  }

  async getById(
    userId: string,
    storeId: string,
    addressId: string,
  ): Promise<StoreDispatchAddress> {
    await this.assertCanManage(userId, storeId);
    return this.assertAddressInStore(addressId, storeId);
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  async create(
    userId: string,
    storeId: string,
    dto: CreateDispatchAddressDto,
  ): Promise<StoreDispatchAddress> {
    await this.assertCanManage(userId, storeId);
    const normalizedPhone = normalizePhone(dto.contactPhone);

    return this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.storeDispatchAddress.count({
        where: { storeId, deletedAt: null },
      });

      // First dispatch address auto-promotes to primary regardless of body.
      const shouldBePrimary = activeCount === 0 ? true : dto.isPrimary === true;

      if (shouldBePrimary) {
        await tx.storeDispatchAddress.updateMany({
          where: { storeId, isPrimary: true, deletedAt: null },
          data: { isPrimary: false },
        });
      }

      return tx.storeDispatchAddress.create({
        data: {
          storeId,
          label: dto.label?.trim() || null,
          contactName: dto.contactName.trim(),
          contactPhone: normalizedPhone,
          addressLine1: dto.addressLine1.trim(),
          addressLine2: dto.addressLine2?.trim() || null,
          suburb: dto.suburb?.trim() || null,
          city: dto.city.trim(),
          province: dto.province,
          postalCode: dto.postalCode,
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
          isPrimary: shouldBePrimary,
        },
      });
    });
  }

  async update(
    userId: string,
    storeId: string,
    addressId: string,
    dto: UpdateDispatchAddressDto,
  ): Promise<StoreDispatchAddress> {
    await this.assertCanManage(userId, storeId);

    const normalizedPhone =
      dto.contactPhone !== undefined
        ? normalizePhone(dto.contactPhone)
        : undefined;

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.assertAddressInStoreActive(
        tx,
        addressId,
        storeId,
      );

      const data: Prisma.StoreDispatchAddressUpdateInput = {};
      if (dto.label !== undefined) data.label = dto.label?.trim() || null;
      if (dto.contactName !== undefined)
        data.contactName = dto.contactName.trim();
      if (normalizedPhone !== undefined) data.contactPhone = normalizedPhone;
      if (dto.addressLine1 !== undefined)
        data.addressLine1 = dto.addressLine1.trim();
      if (dto.addressLine2 !== undefined)
        data.addressLine2 = dto.addressLine2?.trim() || null;
      if (dto.suburb !== undefined)
        data.suburb = dto.suburb?.trim() || null;
      if (dto.city !== undefined) data.city = dto.city.trim();
      if (dto.province !== undefined) data.province = dto.province;
      if (dto.postalCode !== undefined) data.postalCode = dto.postalCode;
      if (dto.latitude !== undefined) data.latitude = dto.latitude;
      if (dto.longitude !== undefined) data.longitude = dto.longitude;

      if (Object.keys(data).length === 0) {
        // No-op update — return existing row unchanged. Mirrors how empty
        // PATCH is handled in the buyer-address layer.
        return existing;
      }

      return tx.storeDispatchAddress.update({
        where: { id: addressId },
        data,
      });
    });
  }

  /**
   * Soft delete. Rejects if the address is the last remaining primary;
   * merchant must promote another address as primary first.
   */
  async delete(
    userId: string,
    storeId: string,
    addressId: string,
  ): Promise<{ success: true }> {
    await this.assertCanManage(userId, storeId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.assertAddressInStoreActive(
        tx,
        addressId,
        storeId,
      );

      if (existing.isPrimary) {
        // Can the merchant retire the primary? Only if there's no other
        // active address, in which case retiring it is fine — they're
        // closing out shipping entirely. Otherwise force a promotion first.
        const activeCount = await tx.storeDispatchAddress.count({
          where: { storeId, deletedAt: null, NOT: { id: addressId } },
        });
        if (activeCount > 0) {
          throw new ConflictException(
            'Cannot delete the primary dispatch address while others exist. Promote another as primary first.',
          );
        }
      }

      await tx.storeDispatchAddress.update({
        where: { id: addressId },
        data: { deletedAt: new Date(), isPrimary: false },
      });
      return { success: true as const };
    });
  }

  async setPrimary(
    userId: string,
    storeId: string,
    addressId: string,
  ): Promise<StoreDispatchAddress> {
    await this.assertCanManage(userId, storeId);

    return this.prisma.$transaction(async (tx) => {
      const existing = await this.assertAddressInStoreActive(
        tx,
        addressId,
        storeId,
      );

      if (existing.isPrimary) return existing; // already primary — no-op

      await tx.storeDispatchAddress.updateMany({
        where: {
          storeId,
          isPrimary: true,
          deletedAt: null,
          NOT: { id: addressId },
        },
        data: { isPrimary: false },
      });

      return tx.storeDispatchAddress.update({
        where: { id: addressId },
        data: { isPrimary: true },
      });
    });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private async assertCanManage(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const ok = await this.storeService.canManageStore(userId, storeId);
    if (!ok) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }
  }

  /**
   * Returns the row if it belongs to this store. 404 (not 403) on cross-store
   * to prevent ID-enumeration. Doesn't filter by deletedAt — used by the
   * read-by-id endpoint which can surface soft-deleted history.
   */
  private async assertAddressInStore(
    addressId: string,
    storeId: string,
  ): Promise<StoreDispatchAddress> {
    const row = await this.prisma.storeDispatchAddress.findUnique({
      where: { id: addressId },
    });
    if (!row || row.storeId !== storeId) {
      throw new NotFoundException('Dispatch address not found');
    }
    return row;
  }

  /** Same as above, but rejects rows that are already soft-deleted. */
  private async assertAddressInStoreActive(
    tx: Prisma.TransactionClient,
    addressId: string,
    storeId: string,
  ): Promise<StoreDispatchAddress> {
    const row = await tx.storeDispatchAddress.findUnique({
      where: { id: addressId },
    });
    if (!row || row.storeId !== storeId || row.deletedAt !== null) {
      throw new NotFoundException('Dispatch address not found');
    }
    return row;
  }
}
