import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Prisma, ProductStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PAYMENT_SERVICE,
  PaymentInitRequest,
} from '../contracts/payment-contract';
import type { IPaymentService } from '../contracts/payment-contract';
import { SHIPPING_SERVICE } from '../contracts/shipping-contract';
import type { IShippingService } from '../contracts/shipping-contract';
import { CheckoutQuoteDto } from '../dto/checkout-quote.dto';
import { CheckoutCommitDto } from '../dto/checkout-commit.dto';
import { CheckoutItemDto } from '../dto/checkout-item.dto';
import { GuestInfoDto } from '../dto/guest-info.dto';
import { normalizePhone } from '../utils/phone';
import { generateOrderNumber } from '../utils/order-number';
import { reserveStock, releaseStock } from '../cart/stock';
import {
  computeCheckoutTotals,
  CheckoutLineItem,
  CheckoutTotals,
} from './totals';

const MAX_ORDER_NUMBER_RETRIES = 3;

// ─── Response types ─────────────────────────────────────────────────────────

export interface CheckoutQuoteView extends CheckoutTotals {
  shippingQuoteId: string;
}

/**
 * Returned to the frontend after a successful checkout commit. The frontend
 * renders `payfast.fields` as hidden inputs in a form with `action=payfast.actionUrl`
 * and auto-submits, redirecting the buyer to PayFast's hosted checkout page.
 */
export interface CheckoutCommitResult {
  orderNumbers: string[];
  paymentGroupId: string;
  mPaymentId: string;
  payfast: {
    actionUrl: string;
    fields: Record<string, string>;
  };
}

// ─── Resolved item used internally ──────────────────────────────────────────

interface ResolvedItem extends CheckoutLineItem {
  cartItemId: string | null; // null for guest items
  variantId: string | null;
  totalStock: number;
  reservedStock: number;
}

// ─── Service ────────────────────────────────────────────────────────────────

@Injectable()
export class CheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SHIPPING_SERVICE) private readonly shipping: IShippingService,
    @Inject(PAYMENT_SERVICE) private readonly payment: IPaymentService,
  ) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // QUOTE — no DB writes, no stock movement
  // ═══════════════════════════════════════════════════════════════════════════

  async quote(
    userId: string | null,
    dto: CheckoutQuoteDto,
  ): Promise<CheckoutQuoteView> {
    this.validateCheckoutInput(userId, dto);

    const resolvedItems = userId
      ? await this.resolveItemsFromCart(userId)
      : await this.resolveItemsFromDto(dto.items!);

    this.assertAllItemsAvailable(resolvedItems);

    const address = userId
      ? await this.resolveExistingAddress(userId, dto.addressId!)
      : dto.guest!.address;

    const shippingRate = await this.shipping.getRate({
      dispatchAddressId: '',
      destinationProvince: address.province,
      destinationPostalCode: address.postalCode,
      destinationCity: address.city,
      destinationCountry: 'South Africa',
      totalWeightInGrams: 0,
      parcelCount: 1,
      serviceTier: 'ECO',
    });

    const totals = computeCheckoutTotals(resolvedItems, shippingRate.rateInCents);

    return { ...totals, shippingQuoteId: shippingRate.quoteId };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMMIT — creates Orders + Payments, calls PayFast, clears cart
  // ═══════════════════════════════════════════════════════════════════════════

  async commit(
    userId: string | null,
    dto: CheckoutCommitDto,
  ): Promise<CheckoutCommitResult> {
    this.validateCheckoutInput(userId, dto);

    const resolvedItems = userId
      ? await this.resolveItemsFromCart(userId)
      : await this.resolveItemsFromDto(dto.items!);

    this.assertAllItemsAvailable(resolvedItems);

    const shippingRate = await this.shipping.getRate({
      dispatchAddressId: '',
      destinationProvince: '',
      destinationPostalCode: '',
      destinationCity: '',
      destinationCountry: 'South Africa',
      totalWeightInGrams: 0,
      parcelCount: 1,
      serviceTier: 'ECO',
    });

    const totals = computeCheckoutTotals(resolvedItems, shippingRate.rateInCents);

    // ─── TX 1: create Orders + Payments (+ guest User/Address) ───────────
    let orderIds: string[];
    let orderNumbers: string[];
    let paymentGroupId: string;
    let mPaymentId: string;
    let actualUserId: string;
    let actualAddressId: string;
    let guestReservedItems: ResolvedItem[] = [];

    try {
      const txResult = await this.prisma.$transaction(async (tx) => {
        // Guest materialization.
        let uid = userId;
        let addrId = dto.addressId;

        if (!uid && dto.guest) {
          const guest = await this.materializeGuest(tx, dto.guest);
          uid = guest.userId;
          addrId = guest.addressId;
        }

        if (!uid || !addrId) {
          addrId = dto.addressId;
          if (!addrId) throw new BadRequestException('Address is required');
          await this.resolveExistingAddress(uid!, addrId);
        }

        // Guest stock reservation (authenticated buyers already reserved at cart-add).
        if (!userId) {
          for (const item of resolvedItems) {
            await reserveStock(
              tx,
              item.productId,
              item.variantId,
              item.quantity,
            );
          }
          guestReservedItems = resolvedItems;
        }

        // Address snapshot for order rows.
        const address = await tx.address.findUnique({
          where: { id: addrId! },
        });
        if (!address)
          throw new NotFoundException('Address not found');

        // Create orders (one per store).
        const createdOrderIds: string[] = [];
        const createdOrderNumbers: string[] = [];

        for (const storeGroup of totals.stores) {
          const orderNumber = await this.generateUniqueOrderNumber(tx);
          const order = await tx.order.create({
            data: {
              orderNumber,
              userId: uid!,
              storeId: storeGroup.storeId,
              addressId: addrId!,
              status: 'PENDING',
              subtotalInCents: storeGroup.subtotalInCents,
              shippingInCents: 0, // shipping lives on PaymentGroup, not per-Order
              discountInCents: 0,
              totalInCents: storeGroup.subtotalInCents, // no shipping at order level
              shippingQuoteId: shippingRate.quoteId,
              shippingServiceTier: 'ECO',
              shippingName: address.recipientName,
              shippingPhone: address.phone,
              shippingAddress1: address.addressLine1,
              shippingAddress2: address.addressLine2,
              shippingCity: address.city,
              shippingProvince: address.province,
              shippingPostalCode: address.postalCode,
              shippingCountry: address.country,
              notes: dto.notes,
              items: {
                create: storeGroup.items.map((item) => ({
                  productId: item.productId,
                  variantId: item.variantId,
                  quantity: item.quantity,
                  unitPriceInCents: item.unitPriceInCents,
                  totalInCents: item.lineTotalInCents,
                  productTitle: item.productTitle,
                  variantName: item.variantName,
                  productImageUrl: item.productImageUrl,
                })),
              },
            },
          });
          createdOrderIds.push(order.id);
          createdOrderNumbers.push(order.orderNumber);
        }

        // Create PaymentGroup + per-order Payments.
        const mPaymentId = `m-${randomUUID()}`;
        const group = await tx.paymentGroup.create({
          data: {
            mPaymentId,
            status: 'PENDING',
            amountGrossInCents: totals.grandTotalInCents,
            amountNetInCents: totals.grandTotalInCents, // net = gross until ITN reports fee
            shippingInCents: totals.grandShippingInCents, // flat fee — YIIVA pays courier directly
          },
        });

        for (const storeGroup of totals.stores) {
          const matchingOrderId = createdOrderIds[
            totals.stores.indexOf(storeGroup)
          ];
          await tx.payment.create({
            data: {
              orderId: matchingOrderId,
              paymentGroupId: group.id,
              status: 'PENDING',
              amountGrossInCents: storeGroup.subtotalInCents, // no shipping — merchant's slice only
              amountNetInCents: storeGroup.subtotalInCents,
              platformCommissionInCents: storeGroup.commissionInCents,
              merchantPayoutInCents:
                storeGroup.subtotalInCents - storeGroup.commissionInCents,
            },
          });
        }

        return {
          orderIds: createdOrderIds,
          orderNumbers: createdOrderNumbers,
          paymentGroupId: group.id,
          mPaymentId,
          userId: uid!,
          addressId: addrId!,
        };
      });

      orderIds = txResult.orderIds;
      orderNumbers = txResult.orderNumbers;
      paymentGroupId = txResult.paymentGroupId;
      mPaymentId = txResult.mPaymentId;
      actualUserId = txResult.userId;
      actualAddressId = txResult.addressId;
    } catch (err) {
      // If TX 1 fails and we're a guest, stock was reserved inside the tx —
      // Prisma transaction rollback already undid the reserve (raw SQL in a
      // rolled-back tx is also rolled back). No manual release needed.
      throw err;
    }

    // ─── PayFast init (outside TX) ─────────────────────────────────────
    let paymentResponse;
    try {
      // Build buyer info for PayFast.
      const buyer = await this.prisma.user.findUnique({
        where: { id: actualUserId },
        select: { email: true, firstName: true, lastName: true },
      });

      const itemName =
        orderNumbers.length === 1
          ? `YIIVA Order ${orderNumbers[0]}`
          : `YIIVA Order (${orderNumbers.length} stores)`;

      const initReq: PaymentInitRequest = {
        orderIds,
        mPaymentId,
        totalAmountInCents: totals.grandTotalInCents,
        buyerEmail: buyer!.email,
        buyerFirstName: buyer!.firstName,
        buyerLastName: buyer!.lastName,
        itemName,
        returnUrl: dto.returnUrl,
        cancelUrl: dto.cancelUrl,
      };

      paymentResponse = await this.payment.initializePayment(initReq);
    } catch {
      // ─── TX 3: rollback Orders + Payments + PaymentGroup ─────────
      await this.rollbackOrders(orderIds, paymentGroupId, guestReservedItems);
      throw new InternalServerErrorException(
        'Payment provider unavailable. Please retry.',
      );
    }

    // ─── TX 2: clear cart (authenticated buyers only) ──────────────────
    if (userId) {
      await this.prisma.cartItem.deleteMany({
        where: { cart: { userId } },
      });
    }

    return {
      orderNumbers,
      paymentGroupId,
      mPaymentId,
      payfast: paymentResponse,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Validates the DTO shape: authenticated buyers need `addressId`;
   * guests need `guest` + `items`.
   */
  private validateCheckoutInput(
    userId: string | null,
    dto: CheckoutQuoteDto | CheckoutCommitDto,
  ): void {
    if (userId) {
      if (!dto.addressId)
        throw new BadRequestException('addressId is required for logged-in buyers');
      if (dto.guest)
        throw new BadRequestException('guest info not allowed with JWT');
    } else {
      if (!dto.guest)
        throw new BadRequestException('guest info is required when not logged in');
      if (!dto.items || dto.items.length === 0)
        throw new BadRequestException('items are required for guest checkout');
    }
  }

  /**
   * Load items from the authenticated buyer's server-side cart.
   */
  private async resolveItemsFromCart(
    userId: string,
  ): Promise<ResolvedItem[]> {
    const cart = await this.prisma.cart.findUnique({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              include: {
                store: true,
                images: { orderBy: { sortOrder: 'asc' as const }, take: 1 },
              },
            },
            variant: true,
          },
        },
      },
    });

    if (!cart || cart.items.length === 0) {
      throw new BadRequestException('Cart is empty');
    }

    return cart.items.map((item) => ({
      cartItemId: item.id,
      productId: item.productId,
      variantId: item.variantId,
      storeId: item.product.storeId,
      storeName: item.product.store.displayName,
      storeSlug: item.product.store.slug,
      productTitle: item.product.title,
      variantName: item.variant?.name ?? null,
      productImageUrl: item.product.images[0]?.url ?? null,
      unitPriceInCents:
        item.variant?.priceInCents ?? item.product.priceInCents,
      quantity: item.quantity,
      totalStock: item.variant
        ? item.variant.stock
        : item.product.totalStock,
      reservedStock: item.variant
        ? item.variant.reservedStock
        : item.product.reservedStock,
    }));
  }

  /**
   * Load items from the guest's DTO (their localStorage stash). Validates
   * each product exists and is ACTIVE, and that variants belong to their
   * products.
   */
  private async resolveItemsFromDto(
    dtoItems: CheckoutItemDto[],
  ): Promise<ResolvedItem[]> {
    const resolved: ResolvedItem[] = [];

    for (const dtoItem of dtoItems) {
      const product = await this.prisma.product.findUnique({
        where: { id: dtoItem.productId },
        include: {
          store: true,
          images: { orderBy: { sortOrder: 'asc' as const }, take: 1 },
        },
      });
      if (!product || product.status !== ProductStatus.ACTIVE) {
        throw new NotFoundException(
          `Product ${dtoItem.productId} not available`,
        );
      }

      let variantName: string | null = null;
      let variantPriceInCents: number | null = null;
      let variantStock: number | null = null;
      let variantReservedStock: number | null = null;

      if (dtoItem.variantId) {
        const variant = await this.prisma.productVariant.findUnique({
          where: { id: dtoItem.variantId },
        });
        if (!variant || variant.productId !== dtoItem.productId) {
          throw new BadRequestException(
            `Variant ${dtoItem.variantId} does not belong to product ${dtoItem.productId}`,
          );
        }
        variantName = variant.name;
        variantPriceInCents = variant.priceInCents;
        variantStock = variant.stock;
        variantReservedStock = variant.reservedStock;
      }

      resolved.push({
        cartItemId: null,
        productId: product.id,
        variantId: dtoItem.variantId ?? null,
        storeId: product.storeId,
        storeName: product.store.displayName,
        storeSlug: product.store.slug,
        productTitle: product.title,
        variantName,
        productImageUrl: product.images[0]?.url ?? null,
        unitPriceInCents: variantPriceInCents ?? product.priceInCents,
        quantity: dtoItem.quantity,
        totalStock: variantStock ?? product.totalStock,
        reservedStock: variantReservedStock ?? product.reservedStock,
      });
    }

    return resolved;
  }

  /**
   * Hard-reject if any item is unavailable or partial-stock.
   * For authenticated buyers, stock was reserved at cart-add, but admin
   * may have reduced totalStock since then.
   * For guests, stock hasn't been reserved yet — check availability.
   */
  private assertAllItemsAvailable(items: ResolvedItem[]): void {
    const problems: { productTitle: string; status: string }[] = [];

    for (const item of items) {
      const available = item.totalStock - item.reservedStock;
      if (item.unitPriceInCents === undefined) {
        problems.push({ productTitle: item.productTitle, status: 'unavailable' });
      } else if (available < item.quantity) {
        // For authed buyers: their own reservation is already in reservedStock,
        // so if available < quantity, stock was reduced externally.
        // For guests: no reservation yet, so this is a true availability check.
        problems.push({
          productTitle: item.productTitle,
          status: available <= 0 ? 'unavailable' : 'partial_stock',
        });
      }
    }

    if (problems.length > 0) {
      throw new ConflictException({
        message: 'Some items are no longer available. Please update your cart.',
        items: problems,
      });
    }
  }

  /**
   * Fetch and validate an existing buyer address.
   */
  private async resolveExistingAddress(userId: string, addressId: string) {
    const address = await this.prisma.address.findUnique({
      where: { id: addressId },
    });
    if (
      !address ||
      address.userId !== userId ||
      address.deletedAt !== null
    ) {
      throw new NotFoundException('Address not found');
    }
    return address;
  }

  /**
   * Create a guest User + Address inside the commit transaction.
   * Throws 409 if the email belongs to an existing non-guest account.
   */
  private async materializeGuest(
    tx: Prisma.TransactionClient,
    guest: GuestInfoDto,
  ): Promise<{ userId: string; addressId: string }> {
    // Check for email collision with a real account.
    const existing = await tx.user.findUnique({
      where: { email: guest.email.toLowerCase() },
      select: { id: true, isGuestAccount: true },
    });

    if (existing && !existing.isGuestAccount) {
      throw new ConflictException(
        'An account with this email exists. Please log in to continue.',
      );
    }

    // Reuse existing guest account if one exists for this email.
    let userId: string;
    if (existing) {
      userId = existing.id;
    } else {
      const passwordHash = await bcrypt.hash(randomUUID(), 12);
      const normalizedPhone = normalizePhone(guest.phone);
      const user = await tx.user.create({
        data: {
          email: guest.email.toLowerCase(),
          firstName: guest.firstName.trim(),
          lastName: guest.lastName.trim(),
          phone: normalizedPhone,
          passwordHash,
          role: 'BUYER',
          accountStatus: 'ACTIVE',
          isGuestAccount: true,
        },
      });
      userId = user.id;
    }

    // Create delivery address.
    const normalizedAddrPhone = normalizePhone(guest.address.phone);
    const address = await tx.address.create({
      data: {
        userId,
        recipientName: guest.address.recipientName.trim(),
        phone: normalizedAddrPhone,
        addressLine1: guest.address.addressLine1.trim(),
        addressLine2: guest.address.addressLine2?.trim() || null,
        city: guest.address.city.trim(),
        province: guest.address.province,
        postalCode: guest.address.postalCode,
        isDefault: true,
      },
    });

    return { userId, addressId: address.id };
  }

  /**
   * Generate a unique order number with P2002 retry.
   */
  private async generateUniqueOrderNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    for (let attempt = 0; attempt < MAX_ORDER_NUMBER_RETRIES; attempt++) {
      const candidate = generateOrderNumber();
      const collision = await tx.order.findUnique({
        where: { orderNumber: candidate },
        select: { id: true },
      });
      if (!collision) return candidate;
    }
    throw new InternalServerErrorException(
      'Failed to generate a unique order number after retries.',
    );
  }

  /**
   * TX 3 — compensating transaction when PayFast init fails.
   * Deletes Orders + Payments + PaymentGroup. For guests, also releases
   * the stock that was reserved inside the (now-committed) TX 1.
   */
  private async rollbackOrders(
    orderIds: string[],
    paymentGroupId: string,
    guestReservedItems: ResolvedItem[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Release guest stock reservations (authed buyers' stock stays reserved
      // in the cart — the cart is untouched on failure).
      for (const item of guestReservedItems) {
        await releaseStock(tx, item.productId, item.variantId, item.quantity);
      }

      // Delete in FK order: Payments → Orders → PaymentGroup.
      await tx.payment.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await tx.orderItem.deleteMany({
        where: { orderId: { in: orderIds } },
      });
      await tx.order.deleteMany({ where: { id: { in: orderIds } } });
      await tx.paymentGroup.delete({ where: { id: paymentGroupId } });
    });
  }
}
