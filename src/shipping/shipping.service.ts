import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  IShippingService,
  ShippingRateRequest,
  ShippingRateResponse,
} from '../order/contracts/shipping-contract';
import { ShipLogicConfig } from './shiplogic/shiplogic-config';
import {
  ShipLogicApiError,
  ShipLogicClient,
} from './shiplogic/shiplogic-client.service';
import {
  toShipLogicCollectionAddress,
  toShipLogicDeliveryAddress,
} from './shiplogic/shiplogic-address';
import {
  ShipLogicParcel,
  ShipLogicRateRequest,
  ShipLogicRateResponse,
} from './shiplogic/shiplogic-types';

/**
 * Real implementation of `IShippingService`. Replaces `ShippingStubService`
 * for `SHIPPING_SERVICE` consumers (currently only the checkout flow).
 *
 * Fallback policy (per shipping-module-foundation §16):
 *   - ShipLogic network error / 5xx → use `config.fallbackRateInCents`, log warning.
 *     Buyer never sees a quote failure.
 *   - ShipLogic 4xx → throw `BadRequestException` with the message.
 *     Caller surfaces to buyer (e.g. "we couldn't ship to that address").
 *   - Dispatch address not found → throw `BadRequestException` — merchant
 *     misconfiguration, not a transient failure.
 *   - No matching service tier in response → throw `InternalServerErrorException`
 *     (rate-card config issue at ShipLogic; needs ops attention).
 */
@Injectable()
export class ShippingService implements IShippingService {
  private readonly logger = new Logger(ShippingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShipLogicConfig,
    private readonly client: ShipLogicClient,
  ) {}

  async getRate(req: ShippingRateRequest): Promise<ShippingRateResponse> {
    if (!req.delivery) {
      throw new BadRequestException(
        'Shipping rate request is missing the delivery address',
      );
    }

    const dispatch = await this.prisma.storeDispatchAddress.findFirst({
      where: { id: req.dispatchAddressId, deletedAt: null },
    });
    if (!dispatch) {
      throw new BadRequestException(
        `Dispatch address ${req.dispatchAddressId} not found or has been deleted`,
      );
    }

    const parcel = this.buildParcel(req);
    const declaredValueRand =
      req.declaredValueInCents !== undefined
        ? Math.round(req.declaredValueInCents) / 100
        : undefined;

    const shipLogicReq: ShipLogicRateRequest = {
      collection_address: toShipLogicCollectionAddress(dispatch),
      delivery_address: toShipLogicDeliveryAddress(req.delivery),
      parcels: [parcel],
      declared_value: declaredValueRand,
    };

    let response: ShipLogicRateResponse;
    try {
      response = await this.client.postJson<ShipLogicRateResponse>(
        '/rates',
        shipLogicReq,
      );
    } catch (err) {
      // 4xx — bad input. Surface to caller. We don't fall back here because
      // falling back hides legitimate validation errors from buyers.
      if (err instanceof ShipLogicApiError && err.status >= 400 && err.status < 500) {
        this.logger.warn(
          `ShipLogic rejected /rates: ${err.status} ${err.responseBody.slice(0, 200)}`,
        );
        throw new BadRequestException(
          `Could not get a shipping quote for that address (ShipLogic ${err.status}).`,
        );
      }
      // 5xx or network — degrade gracefully to the fallback rate.
      this.logger.error(
        `ShipLogic /rates failed, using fallback R${
          this.config.fallbackRateInCents / 100
        }: ${(err as Error).message}`,
      );
      return this.fallback(req);
    }

    const tierCode = req.serviceTier ?? this.config.defaultServiceLevel;
    const match = response.rates?.find(
      (r) => r.service_level?.code === tierCode,
    );
    if (!match) {
      this.logger.error(
        `ShipLogic /rates returned no option matching tier ${tierCode}. ` +
          `Available: [${response.rates?.map((r) => r.service_level?.code).join(', ') ?? '<none>'}]`,
      );
      throw new InternalServerErrorException(
        `ShipLogic returned no rate for service tier ${tierCode}`,
      );
    }

    return {
      quoteId: randomUUID(),
      rateInCents: Math.round(match.rate * 100),
      rateExVatInCents: Math.round(match.rate_excluding_vat * 100),
      serviceTier: match.service_level.code,
      estimatedDeliveryDate: parseDeliveryDate(match.service_level.delivery_date_to),
    };
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private buildParcel(req: ShippingRateRequest): ShipLogicParcel {
    const weightGrams =
      req.totalWeightInGrams > 0
        ? req.totalWeightInGrams
        : this.config.defaultWeightGrams;
    return {
      submitted_length_cm: this.config.defaultLengthCm,
      submitted_width_cm: this.config.defaultWidthCm,
      submitted_height_cm: this.config.defaultHeightCm,
      submitted_weight_kg: Math.max(0.1, weightGrams / 1000),
    };
  }

  private fallback(req: ShippingRateRequest): ShippingRateResponse {
    return {
      quoteId: `fallback-${randomUUID()}`,
      rateInCents: this.config.fallbackRateInCents,
      rateExVatInCents: this.config.fallbackRateInCents, // no VAT split — flat ZAR
      serviceTier: req.serviceTier ?? this.config.defaultServiceLevel,
      estimatedDeliveryDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    };
  }
}

function parseDeliveryDate(iso?: string): Date {
  if (!iso) return new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    : d;
}
