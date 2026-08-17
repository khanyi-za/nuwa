import { Module } from '@nestjs/common';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyTokenService } from './shopify-token.service';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyRehostService } from './shopify-rehost.service';
import { ShopifyProductWriterService } from './shopify-product-writer.service';
import { ShopifyImportService } from './shopify-import.service';
import { ShopifyWebhookRegistrationService } from './shopify-webhook-registration.service';
import { ShopifySyncService } from './shopify-sync.service';
import { ShopifyWebhookService } from './shopify-webhook.service';
import { ShopifyWebhookController } from './shopify-webhook.controller';
import { ShopifySyncCronService } from './shopify-sync-cron.service';
import { ShopifyStockDecrementService } from './shopify-stock-decrement.service';
import { ShopifyController } from './shopify.controller';

/**
 * ShopifyModule — merchant onboarding via Shopify (docs/shopify-app/
 * shopify-app-foundation.md). Phase status:
 *
 *   Phase 1a — connect: token validation, encrypted storage, shop preview ✅
 *   Phase 1b — catalogue pull (paginated GraphQL) + YIIVA mapping
 *              (src/shopify/mapping/) + import preview endpoint ✅
 *   Phase 1c — import executor: async ShopifyImportJob → Store (DRAFT if
 *              new)/Products/Variants/Images + server-side Cloudinary
 *              rehost, polled via GET /shopify/import/latest ✅
 *   Phase 2  — continuous sync: webhook receiver (path secret + optional
 *              HMAC, ShopifyWebhookEvent idempotency), auto-registration
 *              post-import, appliers (update/create/delete/inventory) over
 *              the ShopifyProductLink table, nightly reconcile cron, and
 *              inventoryAdjustQuantities decrement on paid YIIVA orders ✅
 *
 * SA-1 decided: nuwa module (not a separate service). SA-2 decided: Phase 1
 * auth = merchant-created custom-app Admin token; OAuth later, same storage.
 * CloudinaryConfig resolves from the @Global UploadsModule.
 * ShopifyStockDecrementService is exported for PaymentsModule's post-payment
 * side-effect hook (one-way import, mirroring ShipmentCreationService).
 */
@Module({
  controllers: [ShopifyController, ShopifyWebhookController],
  providers: [
    ShopifyConfig,
    ShopifyClient,
    ShopifyTokenService,
    ShopifyConnectionService,
    ShopifyCatalogueService,
    ShopifyRehostService,
    ShopifyProductWriterService,
    ShopifyImportService,
    ShopifyWebhookRegistrationService,
    ShopifySyncService,
    ShopifyWebhookService,
    ShopifySyncCronService,
    ShopifyStockDecrementService,
  ],
  exports: [ShopifyConfig, ShopifyClient, ShopifyStockDecrementService],
})
export class ShopifyModule {}
