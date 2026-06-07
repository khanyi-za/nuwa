-- AlterTable
ALTER TABLE "store_dispatch_addresses" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "store_dispatch_addresses_storeId_deletedAt_idx" ON "store_dispatch_addresses"("storeId", "deletedAt");
