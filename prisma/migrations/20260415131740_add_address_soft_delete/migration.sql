-- AlterTable
ALTER TABLE "addresses" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "addresses_userId_deletedAt_idx" ON "addresses"("userId", "deletedAt");
