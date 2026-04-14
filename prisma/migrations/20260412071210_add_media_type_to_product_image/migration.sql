-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "product_images" ADD COLUMN     "mediaType" "MediaType" NOT NULL DEFAULT 'IMAGE';
