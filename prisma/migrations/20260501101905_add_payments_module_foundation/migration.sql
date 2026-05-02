-- CreateEnum
CREATE TYPE "ItnTxType" AS ENUM ('PAYMENT', 'REFUND');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'RECONCILE_REQUIRED';

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "paymentGroupId" TEXT NOT NULL,
    "itnHash" TEXT NOT NULL,
    "pfPaymentId" TEXT,
    "status" "PaymentStatus" NOT NULL,
    "transactionType" "ItnTxType" NOT NULL,
    "payload" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "sourceIp" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processError" TEXT,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_itnHash_key" ON "payment_events"("itnHash");

-- CreateIndex
CREATE INDEX "payment_events_paymentGroupId_receivedAt_idx" ON "payment_events"("paymentGroupId", "receivedAt");

-- CreateIndex
CREATE INDEX "payment_events_pfPaymentId_idx" ON "payment_events"("pfPaymentId");

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentGroupId_fkey" FOREIGN KEY ("paymentGroupId") REFERENCES "payment_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
