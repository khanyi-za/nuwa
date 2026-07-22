-- CreateEnum
CREATE TYPE "ShopifyConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "ShopifyImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "shopify_connections" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "storeId" TEXT,
    "shopDomain" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "shopName" TEXT,
    "currencyCode" TEXT,
    "status" "ShopifyConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shopify_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopify_import_jobs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" "ShopifyImportStatus" NOT NULL DEFAULT 'PENDING',
    "summary" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shopify_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shopify_connections_storeId_key" ON "shopify_connections"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "shopify_connections_shopDomain_key" ON "shopify_connections"("shopDomain");

-- CreateIndex
CREATE INDEX "shopify_connections_userId_idx" ON "shopify_connections"("userId");

-- CreateIndex
CREATE INDEX "shopify_import_jobs_connectionId_createdAt_idx" ON "shopify_import_jobs"("connectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "shopify_import_jobs" ADD CONSTRAINT "shopify_import_jobs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "shopify_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

