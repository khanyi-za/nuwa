-- AlterTable
ALTER TABLE "shopify_connections" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "clientSecretEncrypted" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3);
