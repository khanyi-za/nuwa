/*
  Warnings:

  - You are about to drop the column `bannerUrl` on the `stores` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "stores" DROP COLUMN "bannerUrl";

-- CreateTable
CREATE TABLE "store_banner_media" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_banner_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_banner_media_storeId_sortOrder_idx" ON "store_banner_media"("storeId", "sortOrder");

-- AddForeignKey
ALTER TABLE "store_banner_media" ADD CONSTRAINT "store_banner_media_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
