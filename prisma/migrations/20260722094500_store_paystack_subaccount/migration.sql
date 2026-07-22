-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "payoutAccountLast4" TEXT,
ADD COLUMN     "payoutBankName" TEXT,
ADD COLUMN     "paystackSubaccountCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stores_paystackSubaccountCode_key" ON "stores"("paystackSubaccountCode");

