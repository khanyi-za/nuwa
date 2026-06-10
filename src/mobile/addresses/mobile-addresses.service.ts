import { Injectable } from '@nestjs/common';
import { AddressService } from '../../order/address/address.service';
import { toAddress } from '../common/serializers';
import { CreateMobileAddressDto } from './dto/create-address.dto';
import { UpdateMobileAddressDto } from './dto/update-address.dto';

/**
 * Thin mobile wrapper over the web AddressService — reuses its rules (max 4,
 * one-default invariant, soft-delete, 404-on-cross-user) and maps to maya's
 * address shape. maya `line1`/`line2` ↔ nuwa `addressLine1`/`addressLine2`.
 */
@Injectable()
export class MobileAddressesService {
  constructor(private readonly addresses: AddressService) {}

  async list(userId: string) {
    const rows = await this.addresses.list(userId);
    return { addresses: rows.map(toAddress) };
  }

  async create(userId: string, dto: CreateMobileAddressDto) {
    const created = await this.addresses.create(userId, {
      label: dto.label,
      recipientName: dto.recipientName,
      phone: dto.phone,
      addressLine1: dto.line1,
      addressLine2: dto.line2,
      city: dto.city,
      province: dto.province,
      postalCode: dto.postalCode,
      isDefault: dto.isDefault,
    });
    return { address: toAddress(created) };
  }

  async update(userId: string, id: string, dto: UpdateMobileAddressDto) {
    const updated = await this.addresses.update(userId, id, {
      label: dto.label,
      recipientName: dto.recipientName,
      phone: dto.phone,
      addressLine1: dto.line1,
      addressLine2: dto.line2,
      city: dto.city,
      province: dto.province,
      postalCode: dto.postalCode,
      isDefault: dto.isDefault,
    });
    return { address: toAddress(updated) };
  }

  async remove(userId: string, id: string) {
    return this.addresses.delete(userId, id);
  }

  async setDefault(userId: string, id: string) {
    const updated = await this.addresses.update(userId, id, { isDefault: true });
    return { address: toAddress(updated) };
  }
}
