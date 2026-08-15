-- AlterTable
ALTER TABLE "users" ADD COLUMN     "resetAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resetLastSentAt" TIMESTAMP(3),
ADD COLUMN     "verificationAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verificationLastSentAt" TIMESTAMP(3);
