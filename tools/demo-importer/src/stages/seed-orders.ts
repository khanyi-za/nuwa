import { PrismaClient, OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

import { log } from '../logger';

/*
 * Demo ORDER-HISTORY seeder (2026-07-06) — makes the merchant dashboard's
 * money/ops surfaces (Earnings, Orders, Returns, Analytics) look alive for
 * in-person sales demos. Real screens, real queries, synthetic history.
 *
 * What it writes per ACTIVE demo brand (owner `<slug>@demo.yiiva.co.za`):
 *   ~14–22 orders over the past 8 weeks, each with a PaymentGroup + Payment
 *   carrying the REAL money math (5.5% commission, ~3.2% PayFast fee), full
 *   address/item snapshots, and lifecycle timestamps consistent with status.
 *   Plus a handful of ReturnRequests over recent DELIVERED orders.
 *
 * Recognisable + reversible:
 *   - Buyers are dedicated demo accounts (`*.demo@demo.yiiva.co.za`) — never
 *     the real test buyer (khanyi@yiiva.co.za), so their history is untouched.
 *   - Every seeded orderNumber matches `YV-%-D####` (D-prefixed random part).
 *   - Re-running WIPES previous seeded orders (identified by the demo buyers)
 *     and re-inserts, so it stays idempotent-ish and never duplicates.
 *   - Product stock is NOT mutated — this is historical data only.
 *
 * Deterministic: seeded RNG, so re-runs produce the same shape of history.
 */

const DEMO_PASSWORD = 'DemoPass1';

const DEMO_BUYERS = [
  { email: 'naledi.demo@demo.yiiva.co.za', firstName: 'Naledi', lastName: 'Dlamini', city: 'Johannesburg', province: 'Gauteng', postalCode: '2196', line1: '12 Tyrwhitt Ave, Rosebank' },
  { email: 'sipho.demo@demo.yiiva.co.za', firstName: 'Sipho', lastName: 'Ndlovu', city: 'Cape Town', province: 'Western Cape', postalCode: '8001', line1: '87 Kloof Street, Gardens' },
  { email: 'lerato.demo@demo.yiiva.co.za', firstName: 'Lerato', lastName: 'Mokoena', city: 'Pretoria', province: 'Gauteng', postalCode: '0181', line1: '451 Lynnwood Rd, Menlo Park' },
  { email: 'thandi.demo@demo.yiiva.co.za', firstName: 'Thandi', lastName: 'Khumalo', city: 'Durban', province: 'KwaZulu-Natal', postalCode: '4319', line1: '23 Florida Rd, Morningside' },
] as const;

const COMMISSION_RATE = 0.055;
const PAYFAST_FEE_RATE = 0.032;
const HISTORY_DAYS = 56;
const ORDER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// mulberry32 — tiny deterministic PRNG so demo history is stable across runs.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makePrisma(): PrismaClient {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set. Point it at the LOCAL demo Postgres.');
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export async function runSeedOrders(): Promise<void> {
  const prisma = makePrisma();
  const rand = mulberry32(20260706);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
  const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

  try {
    log.step('Seed demo order history');

    // 1. Demo buyers (+ one address each), created if missing.
    const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);
    const buyers: { id: string; addressId: string; name: string; phone: string; row: (typeof DEMO_BUYERS)[number] }[] = [];
    for (const [i, b] of DEMO_BUYERS.entries()) {
      const user = await prisma.user.upsert({
        where: { email: b.email },
        update: {},
        create: {
          email: b.email,
          passwordHash,
          firstName: b.firstName,
          lastName: b.lastName,
          role: 'BUYER',
          emailVerified: true,
          accountStatus: 'ACTIVE', // login gates on accountStatus, not emailVerified
          phone: `+2782${String(1000000 + i).slice(-7)}`,
        },
        select: { id: true, phone: true },
      });
      let address = await prisma.address.findFirst({
        where: { userId: user.id, deletedAt: null },
        select: { id: true },
      });
      if (!address) {
        address = await prisma.address.create({
          data: {
            userId: user.id,
            recipientName: `${b.firstName} ${b.lastName}`,
            phone: user.phone ?? '+27821000000',
            addressLine1: b.line1,
            city: b.city,
            province: b.province,
            postalCode: b.postalCode,
            country: 'South Africa',
            isDefault: true,
          },
          select: { id: true },
        });
      }
      buyers.push({
        id: user.id,
        addressId: address.id,
        name: `${b.firstName} ${b.lastName}`,
        phone: user.phone ?? '+27821000000',
        row: b,
      });
    }
    log.ok(`demo buyers ready: ${buyers.length}`);

    // 2. Wipe previous seeded history (demo buyers' orders cascade to items/
    //    payments; groups + returns cleaned explicitly).
    const buyerIds = buyers.map((b) => b.id);
    const oldOrders = await prisma.order.findMany({
      where: { userId: { in: buyerIds } },
      select: { id: true, payment: { select: { paymentGroupId: true } } },
    });
    if (oldOrders.length > 0) {
      const groupIds = [...new Set(oldOrders.map((o) => o.payment?.paymentGroupId).filter(Boolean))] as string[];
      await prisma.returnRequest.deleteMany({ where: { buyerId: { in: buyerIds } } });
      await prisma.order.deleteMany({ where: { id: { in: oldOrders.map((o) => o.id) } } });
      await prisma.paymentGroup.deleteMany({ where: { id: { in: groupIds } } });
      log.info(`wiped previous seeded history: ${oldOrders.length} orders, ${groupIds.length} payment groups`);
    }

    // 3. Demo stores + their sellable products.
    const stores = await prisma.store.findMany({
      where: { status: 'ACTIVE', owner: { email: { endsWith: '@demo.yiiva.co.za' } } },
      select: {
        id: true,
        slug: true,
        displayName: true,
        products: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            title: true,
            priceInCents: true,
            images: { where: { isPrimary: true }, take: 1, select: { url: true } },
            variants: { select: { id: true, name: true, priceInCents: true } },
          },
        },
      },
    });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let totalOrders = 0;
    const deliveredRecent: { orderId: string; storeId: string; buyerId: string }[] = [];

    for (const store of stores) {
      if (store.products.length === 0) {
        log.warn(`no ACTIVE products, skipping: ${store.slug}`);
        continue;
      }
      const orderCount = randInt(14, 22);

      for (let i = 0; i < orderCount; i++) {
        const buyer = pick(buyers);
        const placedAt = new Date(now - rand() * HISTORY_DAYS * DAY);
        const ageDays = (now - placedAt.getTime()) / DAY;

        // Status by age: older orders overwhelmingly DELIVERED; fresh ones in flight.
        const roll = rand();
        let status: OrderStatus;
        if (roll < 0.08) status = OrderStatus.CANCELLED;
        else if (ageDays > 10) status = roll < 0.93 ? OrderStatus.DELIVERED : OrderStatus.IN_TRANSIT;
        else if (ageDays > 4) status = pick([OrderStatus.DELIVERED, OrderStatus.IN_TRANSIT, OrderStatus.DISPATCHED] as const);
        else status = pick([OrderStatus.CONFIRMED, OrderStatus.PROCESSING, OrderStatus.DISPATCHED] as const);

        const cancelled = status === OrderStatus.CANCELLED;
        const confirmedAt = new Date(placedAt.getTime() + randInt(2, 30) * 60 * 1000);
        const dispatchedAt = new Date(confirmedAt.getTime() + randInt(1, 2) * DAY);
        const deliveredAt = new Date(dispatchedAt.getTime() + randInt(1, 4) * DAY);

        // 1–3 items from this store's catalogue.
        const itemCount = randInt(1, 3);
        const items: {
          productId: string;
          variantId: string | null;
          variantName: string | null;
          title: string;
          imageUrl: string | null;
          unitPriceInCents: number;
          quantity: number;
        }[] = [];
        for (let j = 0; j < itemCount; j++) {
          const product = pick(store.products);
          const variant = product.variants.length > 0 ? pick(product.variants) : null;
          items.push({
            productId: product.id,
            variantId: variant?.id ?? null,
            variantName: variant?.name ?? null,
            title: product.title,
            imageUrl: product.images[0]?.url ?? null,
            unitPriceInCents: variant?.priceInCents ?? product.priceInCents,
            quantity: rand() < 0.85 ? 1 : 2,
          });
        }

        const subtotal = items.reduce((sum, it) => sum + it.unitPriceInCents * it.quantity, 0);
        const shipping = pick([9500, 11000, 12500] as const);
        const total = subtotal + shipping;
        const commission = Math.round(subtotal * COMMISSION_RATE);
        const fee = Math.round(total * PAYFAST_FEE_RATE);

        // D-prefixed random segment marks seeded orders (YV-2026-Dxxxx).
        let orderNumber = '';
        for (let attempt = 0; attempt < 10; attempt++) {
          let seg = 'D';
          for (let k = 0; k < 4; k++) seg += ORDER_ALPHABET[Math.floor(rand() * ORDER_ALPHABET.length)];
          orderNumber = `YV-${placedAt.getUTCFullYear()}-${seg}`;
          const clash = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
          if (!clash) break;
        }

        const order = await prisma.order.create({
          data: {
            orderNumber,
            userId: buyer.id,
            storeId: store.id,
            addressId: buyer.addressId,
            status,
            subtotalInCents: subtotal,
            shippingInCents: shipping,
            discountInCents: 0,
            totalInCents: total,
            shippingName: buyer.name,
            shippingPhone: buyer.phone,
            shippingAddress1: buyer.row.line1,
            shippingCity: buyer.row.city,
            shippingProvince: buyer.row.province,
            shippingPostalCode: buyer.row.postalCode,
            shippingCountry: 'South Africa',
            placedAt,
            confirmedAt: cancelled ? null : confirmedAt,
            dispatchedAt:
              !cancelled &&
              ([OrderStatus.DISPATCHED, OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED] as OrderStatus[]).includes(status)
                ? dispatchedAt
                : null,
            deliveredAt: status === OrderStatus.DELIVERED ? deliveredAt : null,
            cancelledAt: cancelled ? confirmedAt : null,
            cancelReason: cancelled ? 'SYSTEM:PAYMENT_CANCELLED' : null,
            items: {
              create: items.map((it) => ({
                productId: it.productId,
                variantId: it.variantId,
                quantity: it.quantity,
                unitPriceInCents: it.unitPriceInCents,
                totalInCents: it.unitPriceInCents * it.quantity,
                productTitle: it.title,
                variantName: it.variantName,
                productImageUrl: it.imageUrl,
              })),
            },
          },
          select: { id: true },
        });

        await prisma.paymentGroup.create({
          data: {
            mPaymentId: `m-demo-${store.slug}-${i}-${placedAt.getTime()}`,
            pfPaymentId: cancelled ? null : String(3000000 + Math.floor(rand() * 900000)),
            status: cancelled ? PaymentStatus.CANCELLED : PaymentStatus.COMPLETED,
            amountGrossInCents: total,
            amountFeeInCents: cancelled ? 0 : fee,
            amountNetInCents: cancelled ? total : total - fee,
            shippingInCents: shipping,
            method: cancelled ? null : 'CREDIT_CARD',
            paidAt: cancelled ? null : confirmedAt,
            payments: {
              create: {
                orderId: order.id,
                status: cancelled ? PaymentStatus.CANCELLED : PaymentStatus.COMPLETED,
                amountGrossInCents: subtotal,
                amountFeeInCents: cancelled ? 0 : fee,
                amountNetInCents: cancelled ? subtotal : subtotal - fee,
                platformCommissionInCents: commission,
                merchantPayoutInCents: subtotal - commission,
              },
            },
          },
        });

        totalOrders++;
        if (status === OrderStatus.DELIVERED && now - deliveredAt.getTime() < 25 * DAY) {
          deliveredRecent.push({ orderId: order.id, storeId: store.id, buyerId: buyer.id });
        }
      }
      log.ok(`${store.slug}: ${orderCount} orders seeded`);
    }

    // 4. Return requests over recent DELIVERED orders — one queue-worth
    //    spread across statuses so the Returns screen shows a real lifecycle.
    const returnPlans: { status: 'REQUESTED' | 'APPROVED' | 'RECEIVED' | 'REJECTED'; reason: string; details: string | null }[] = [
      { status: 'REQUESTED', reason: 'WRONG_SIZE', details: 'Ordered M, fits like an S — swapping for L if possible.' },
      { status: 'REQUESTED', reason: 'CHANGED_MIND', details: null },
      { status: 'APPROVED', reason: 'NOT_AS_DESCRIBED', details: 'Colour is much darker than the photos.' },
      { status: 'RECEIVED', reason: 'DAMAGED', details: 'Stitching came loose on the left seam.' },
      { status: 'REJECTED', reason: 'OTHER', details: 'Bought at a sale price, found it cheaper elsewhere.' },
    ];
    let returnsSeeded = 0;
    for (const [i, plan] of returnPlans.entries()) {
      const target = deliveredRecent[Math.floor(rand() * deliveredRecent.length)];
      if (!target) break;
      deliveredRecent.splice(deliveredRecent.indexOf(target), 1);
      await prisma.returnRequest.create({
        data: {
          orderId: target.orderId,
          storeId: target.storeId,
          buyerId: target.buyerId,
          reason: plan.reason,
          details: plan.details,
          status: plan.status,
          merchantNotes: plan.status === 'REJECTED' ? 'Item was purchased on final sale.' : null,
          resolvedAt: plan.status === 'REJECTED' ? new Date(now - i * DAY) : null,
          createdAt: new Date(now - randInt(1, 12) * DAY),
        },
      });
      returnsSeeded++;
    }

    log.step('Summary');
    log.ok(`${totalOrders} orders across ${stores.length} stores; ${returnsSeeded} return requests`);
    log.info(`demo buyer logins: ${DEMO_BUYERS.map((b) => b.email).join(', ')} / ${DEMO_PASSWORD}`);
    log.info('re-run any time — previous seeded history is wiped first; real buyer data untouched');
  } finally {
    await prisma.$disconnect();
  }
}
