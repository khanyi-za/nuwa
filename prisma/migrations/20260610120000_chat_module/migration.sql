-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('BUYER', 'MERCHANT');

-- CreateEnum
CREATE TYPE "ConversationReportReason" AS ENUM ('HARASSMENT', 'SCAM', 'SPAM', 'OTHER');

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "buyerLastReadAt" TIMESTAMP(3),
    "merchantLastReadAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "senderId" TEXT NOT NULL,
    "text" TEXT,
    "attachments" JSONB,
    "orderId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_reports" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" "ConversationReportReason" NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversations_storeId_lastMessageAt_idx" ON "conversations"("storeId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_buyerId_lastMessageAt_idx" ON "conversations"("buyerId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_buyerId_storeId_key" ON "conversations"("buyerId", "storeId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_conversationId_idempotencyKey_key" ON "messages"("conversationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "conversation_reports_conversationId_idx" ON "conversation_reports"("conversationId");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_reports" ADD CONSTRAINT "conversation_reports_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
