-- CreateEnum
CREATE TYPE "GenderType" AS ENUM ('WOMEN', 'MEN', 'UNISEX');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "genderType" "GenderType";

-- CreateIndex
CREATE INDEX "products_genderType_idx" ON "products"("genderType");
