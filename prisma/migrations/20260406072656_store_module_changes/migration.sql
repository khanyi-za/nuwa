/*
  Warnings:

  - You are about to drop the column `city` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `name` on the `stores` table. All the data in the column will be lost.
  - You are about to drop the column `province` on the `stores` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[companyName]` on the table `stores` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[displayName]` on the table `stores` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `companyName` to the `stores` table without a default value. This is not possible if the table is not empty.
  - Added the required column `displayName` to the `stores` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "stores_city_province_idx";

-- AlterTable
ALTER TABLE "stores" DROP COLUMN "city",
DROP COLUMN "name",
DROP COLUMN "province",
ADD COLUMN     "companyName" TEXT NOT NULL,
ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "rejectionReason" TEXT;

-- CreateTable
CREATE TABLE "store_addresses" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "streetNumber" TEXT NOT NULL,
    "streetName" TEXT NOT NULL,
    "buildingName" TEXT,
    "city" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_employees" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "employeeNumber" TEXT,
    "inviteToken" TEXT,
    "inviteExpiry" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_employees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "store_addresses_storeId_idx" ON "store_addresses"("storeId");

-- CreateIndex
CREATE INDEX "store_employees_storeId_idx" ON "store_employees"("storeId");

-- CreateIndex
CREATE INDEX "store_employees_userId_idx" ON "store_employees"("userId");

-- CreateIndex
CREATE INDEX "store_employees_email_idx" ON "store_employees"("email");

-- CreateIndex
CREATE UNIQUE INDEX "store_employees_storeId_email_key" ON "store_employees"("storeId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "stores_companyName_key" ON "stores"("companyName");

-- CreateIndex
CREATE UNIQUE INDEX "stores_displayName_key" ON "stores"("displayName");

-- AddForeignKey
ALTER TABLE "store_addresses" ADD CONSTRAINT "store_addresses_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_employees" ADD CONSTRAINT "store_employees_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_employees" ADD CONSTRAINT "store_employees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
