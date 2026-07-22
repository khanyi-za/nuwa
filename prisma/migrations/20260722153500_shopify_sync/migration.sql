-- AlterTable
ALTER TABLE "shopify_connections" ADD COLUMN     "apiSecretEncrypted" TEXT,
ADD COLUMN     "primaryLocationId" TEXT,
ADD COLUMN     "webhookSecret" TEXT,
ADD COLUMN     "webhooksRegisteredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "shopify_product_links" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantId" TEXT,
    "shopifyProductId" TEXT NOT NULL,
    "shopifyVariantId" TEXT NOT NULL,
    "inventoryItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_product_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_webhook_events" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "topic" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "webhookId" TEXT,
    "payloadHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processError" TEXT,
    "sourceIp" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_product_links_variantId_key" ON "shopify_product_links"("variantId");

-- CreateIndex
CREATE INDEX "shopify_product_links_connectionId_shopifyProductId_idx" ON "shopify_product_links"("connectionId", "shopifyProductId");

-- CreateIndex
CREATE INDEX "shopify_product_links_connectionId_inventoryItemId_idx" ON "shopify_product_links"("connectionId", "inventoryItemId");

-- CreateIndex
CREATE INDEX "shopify_product_links_productId_idx" ON "shopify_product_links"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_product_links_connectionId_shopifyVariantId_key" ON "shopify_product_links"("connectionId", "shopifyVariantId");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_webhook_events_payloadHash_key" ON "shopify_webhook_events"("payloadHash");

-- CreateIndex
CREATE INDEX "shopify_webhook_events_connectionId_createdAt_idx" ON "shopify_webhook_events"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_connections_webhookSecret_key" ON "shopify_connections"("webhookSecret");

-- AddForeignKey
ALTER TABLE "shopify_product_links" ADD CONSTRAINT "shopify_product_links_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "shopify_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_product_links" ADD CONSTRAINT "shopify_product_links_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopify_product_links" ADD CONSTRAINT "shopify_product_links_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
