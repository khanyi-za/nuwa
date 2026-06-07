-- CreateEnum
CREATE TYPE "ShipmentEventType" AS ENUM ('TRACKING_EVENT', 'SHIPMENT_NOTE', 'ADDRESS_CHANGE', 'DIMENSION_CHANGE');

-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "suburb" VARCHAR(100);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT,
    "waybillNumber" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "eventType" "ShipmentEventType" NOT NULL,
    "rawStatus" TEXT,
    "payload" JSONB NOT NULL,
    "sourceIp" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processError" TEXT,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shipment_events_payloadHash_key" ON "shipment_events"("payloadHash");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_receivedAt_idx" ON "shipment_events"("shipmentId", "receivedAt");

-- CreateIndex
CREATE INDEX "shipment_events_waybillNumber_idx" ON "shipment_events"("waybillNumber");

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
