import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Shipment, ShipmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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
  ShipLogicCreateShipmentRequest,
  ShipLogicCreateShipmentResponse,
} from './shiplogic/shiplogic-types';

/**
 * Books real ShipLogic shipments for paid orders. Invoked from the payments
 * notify pipeline once the Order transitions PENDING → CONFIRMED (see
 * payments-notify.service). Runs OUTSIDE the ITN DB transaction — CLAUDE.md
 * "Never put HTTP calls inside a DB transaction" — so a ShipLogic failure
 * after Order.CONFIRMED leaves the Order paid-but-unbooked, flagged for ops.
 *
 * Idempotent: if a Shipment row already exists for the orderId, returns it
 * unchanged. Re-invocations are safe (PayFast retries, ops manual replay).
 *
 * Failure policy (per shipping-module-foundation §16):
 *   - HTTP 4xx (bad request — usually bad address) → throw BadRequestException
 *     so the caller can log + alert ops. Order stays CONFIRMED; no Shipment row.
 *   - HTTP 5xx / network → throw the underlying error so the caller can decide
 *     (retry path, ops queue, etc.). Don't degrade silently here.
 *   - Order in non-shippable state (CANCELLED, etc.) → throw BadRequestException.
 */
@Injectable()
export class ShipmentCreationService {
  private readonly logger = new Logger(ShipmentCreationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ShipLogicConfig,
    private readonly client: ShipLogicClient,
  ) {}

  async createShipmentForOrder(orderId: string): Promise<Shipment> {
    const existing = await this.prisma.shipment.findUnique({
      where: { orderId },
    });
    if (existing) {
      this.logger.log(
        `Shipment already exists for order ${orderId} (waybill=${existing.waybillNumber}); skipping.`,
      );
      return existing;
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        dispatchAddress: true,
        items: true,
        user: { select: { email: true, firstName: true, lastName: true } },
      },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (!order.dispatchAddress) {
      throw new BadRequestException(
        `Order ${orderId} has no dispatch address — shipment cannot be booked`,
      );
    }
    if (order.status === 'CANCELLED' || order.status === 'REFUNDED') {
      throw new BadRequestException(
        `Order ${orderId} is ${order.status} — refusing to book shipment`,
      );
    }

    const totalWeightGrams = await this.computeTotalWeight(order.items);
    const declaredValueRand = order.subtotalInCents / 100;

    const req: ShipLogicCreateShipmentRequest = {
      collection_address: toShipLogicCollectionAddress(order.dispatchAddress),
      collection_contact: {
        name: order.dispatchAddress.contactName,
        mobile_number: order.dispatchAddress.contactPhone,
      },
      delivery_address: toShipLogicDeliveryAddress({
        streetAddress: this.joinAddressLines(
          order.shippingAddress1,
          order.shippingAddress2,
        ),
        // suburb is not stored on Order's address snapshot today; ShipLogic
        // will geocode from the rest of the fields. Future enhancement: add
        // shippingSuburb to Order's snapshot fields.
        suburb: null,
        city: order.shippingCity,
        province: order.shippingProvince,
        postalCode: order.shippingPostalCode,
        country: order.shippingCountry,
      }),
      delivery_contact: {
        name: order.shippingName,
        mobile_number: order.shippingPhone,
        email: order.user?.email,
      },
      parcels: [
        {
          parcel_description: `YIIVA Order ${order.orderNumber}`,
          submitted_length_cm: this.config.defaultLengthCm,
          submitted_width_cm: this.config.defaultWidthCm,
          submitted_height_cm: this.config.defaultHeightCm,
          submitted_weight_kg: Math.max(0.1, totalWeightGrams / 1000),
        },
      ],
      service_level_code:
        order.shippingServiceTier ?? this.config.defaultServiceLevel,
      declared_value: declaredValueRand,
      special_instructions_delivery: order.notes ?? undefined,
    };

    let response: ShipLogicCreateShipmentResponse;
    try {
      response = await this.client.postJson<ShipLogicCreateShipmentResponse>(
        '/shipments',
        req,
      );
    } catch (err) {
      if (
        err instanceof ShipLogicApiError &&
        err.status >= 400 &&
        err.status < 500
      ) {
        this.logger.error(
          `ShipLogic rejected /shipments for order ${orderId}: ${err.status} ${err.responseBody.slice(0, 300)}`,
        );
        throw new BadRequestException(
          `ShipLogic refused to book this shipment (${err.status}): ${err.responseBody.slice(0, 200)}`,
        );
      }
      // Network / 5xx — surface to caller for retry/queue handling.
      this.logger.error(
        `ShipLogic /shipments failed for order ${orderId}: ${(err as Error).message}`,
      );
      throw err;
    }

    return this.prisma.shipment.create({
      data: {
        orderId: order.id,
        status: ShipmentStatus.PENDING,
        shiplogicShipmentId: String(response.id),
        waybillNumber: response.short_tracking_reference,
        trackingUrl: this.buildTrackingUrl(response.short_tracking_reference),
        serviceType: response.service_level_code ?? order.shippingServiceTier,
        shiplogicStatus: response.status ?? null,
        quoteId: order.shippingQuoteId,
        rateInCents: response.rate
          ? Math.round(response.rate * 100)
          : order.shippingInCents,
        rateExVatInCents: response.rate ? Math.round(response.rate * 100) : null,
        parcelCount: response.parcels?.length ?? 1,
        totalWeightInGrams: totalWeightGrams,
        parcelDescription: `YIIVA Order ${order.orderNumber}`,
        collectionDate: parseIso(response.estimated_collection),
        estimatedDelivery: parseIso(response.estimated_delivery_to),
        deliveryOtp: response.proof_of_delivery_pin ?? null,
        shiplogicPayload: response as unknown as Prisma.InputJsonValue,
      },
    });
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private async computeTotalWeight(
    items: Array<{ productId: string; variantId: string | null; quantity: number }>,
  ): Promise<number> {
    if (items.length === 0) return this.config.defaultWeightGrams;

    const productIds = Array.from(new Set(items.map((i) => i.productId)));
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, weightInGrams: true },
    });
    const byId = new Map(products.map((p) => [p.id, p.weightInGrams]));

    let total = 0;
    for (const item of items) {
      const weight = byId.get(item.productId) ?? this.config.defaultWeightGrams;
      total += weight * item.quantity;
    }
    return total > 0 ? total : this.config.defaultWeightGrams;
  }

  private joinAddressLines(line1: string, line2: string | null): string {
    if (!line2 || line2.trim() === '') return line1.trim();
    return `${line1.trim()}, ${line2.trim()}`;
  }

  private buildTrackingUrl(shortRef: string | undefined): string | null {
    if (!shortRef) return null;
    // TCG's public tracking page format. If a different format ships later we
    // re-derive on read; for now this matches what their portal exposes.
    return `https://tracking.shiplogic.com/tracking/${shortRef}`;
  }
}

function parseIso(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
