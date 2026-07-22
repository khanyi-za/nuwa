import { Module } from '@nestjs/common';
import { ShopifyConfig } from './shopify-config';
import { ShopifyClient } from './shopify-client.service';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyRehostService } from './shopify-rehost.service';
import { ShopifyImportService } from './shopify-import.service';
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
 *   Phase 2  — continuous sync (webhooks) + stock decrement on YIIVA sales
 *
 * SA-1 decided: nuwa module (not a separate service). SA-2 decided: Phase 1
 * auth = merchant-created custom-app Admin token; OAuth later, same storage.
 * CloudinaryConfig resolves from the @Global UploadsModule.
 */
@Module({
  controllers: [ShopifyController],
  providers: [
    ShopifyConfig,
    ShopifyClient,
    ShopifyConnectionService,
    ShopifyCatalogueService,
    ShopifyRehostService,
    ShopifyImportService,
  ],
  exports: [ShopifyConfig, ShopifyClient],
})
export class ShopifyModule {}
