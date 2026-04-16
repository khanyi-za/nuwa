/*
  Warnings:

  - You are about to drop the column `customInt1` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `customStr1` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `customStr2` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `failedAt` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `itnPayload` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `mPaymentId` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `merchantId` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `method` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `paymentStatus` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `pfEmailAddress` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `pfNameFirst` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `pfNameLast` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `pfPaymentId` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `pfSignature` on the `payments` table. All the data in the column will be lost.
  - You are about to drop the column `pfToken` on the `payments` table. All the data in the column will be lost.
  - Added the required column `paymentGroupId` to the `payments` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "payments_mPaymentId_idx";

-- DropIndex
DROP INDEX "payments_mPaymentId_key";

-- DropIndex
DROP INDEX "payments_pfPaymentId_idx";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shippingDispatchAddressId" TEXT,
ADD COLUMN     "shippingQuoteId" TEXT,
ADD COLUMN     "shippingServiceTier" TEXT;

-- AlterTable
ALTER TABLE "payments" DROP COLUMN "customInt1",
DROP COLUMN "customStr1",
DROP COLUMN "customStr2",
DROP COLUMN "failedAt",
DROP COLUMN "itnPayload",
DROP COLUMN "mPaymentId",
DROP COLUMN "merchantId",
DROP COLUMN "method",
DROP COLUMN "paymentStatus",
DROP COLUMN "pfEmailAddress",
DROP COLUMN "pfNameFirst",
DROP COLUMN "pfNameLast",
DROP COLUMN "pfPaymentId",
DROP COLUMN "pfSignature",
DROP COLUMN "pfToken",
ADD COLUMN     "merchantPayoutInCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "paymentGroupId" TEXT NOT NULL,
ADD COLUMN     "platformCommissionInCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refundedAmountInCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "reservedStock" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "reservedStock" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "isGuestAccount" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "store_dispatch_addresses" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT,
    "contactName" TEXT NOT NULL,
    "contactPhone" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "suburb" TEXT,
    "city" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'South Africa',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_dispatch_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_groups" (
    "id" TEXT NOT NULL,
    "mPaymentId" TEXT NOT NULL,
    "pfPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "amountGrossInCents" INTEGER NOT NULL,
    "amountFeeInCents" INTEGER NOT NULL DEFAULT 0,
    "amountNetInCents" INTEGER NOT NULL,
    "method" "PaymentMethod",
    "pfSignature" TEXT,
    "itnPayload" JSONB,
    "pfToken" TEXT,
    "pfNameFirst" TEXT,
    "pfNameLast" TEXT,
    "pfEmailAddress" TEXT,
    "paidAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_dispatch_addresses_storeId_idx" ON "store_dispatch_addresses"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_groups_mPaymentId_key" ON "payment_groups"("mPaymentId");

-- CreateIndex
CREATE INDEX "payment_groups_mPaymentId_idx" ON "payment_groups"("mPaymentId");

-- CreateIndex
CREATE INDEX "payment_groups_status_idx" ON "payment_groups"("status");

-- CreateIndex
CREATE INDEX "payments_paymentGroupId_idx" ON "payments"("paymentGroupId");

-- AddForeignKey
ALTER TABLE "store_dispatch_addresses" ADD CONSTRAINT "store_dispatch_addresses_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_shippingDispatchAddressId_fkey" FOREIGN KEY ("shippingDispatchAddressId") REFERENCES "store_dispatch_addresses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_paymentGroupId_fkey" FOREIGN KEY ("paymentGroupId") REFERENCES "payment_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
