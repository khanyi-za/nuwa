import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShopifyConnectionService } from './shopify-connection.service';
import { ShopifyCatalogueService } from './shopify-catalogue.service';
import { ShopifyImportService } from './shopify-import.service';
import { ConnectShopifyDto } from './dto/connect-shopify.dto';
import { StartImportDto } from './dto/start-import.dto';

/**
 * Shopify onboarding endpoints (import wizard). JWT via the global guard;
 * a connection belongs to the authenticated user.
 *
 *   POST   /shopify/connection     — validate token live, store encrypted, return preview
 *   GET    /shopify/connection     — the user's active connection
 *   DELETE /shopify/connection     — disconnect (soft: status flip)
 *   GET    /shopify/import/preview — full catalogue pull + mapping, nothing written
 *   POST   /shopify/import         — start the async import job
 *   GET    /shopify/import/latest  — most recent job (the wizard's poll target)
 *   GET    /shopify/import/:id     — a specific job (404-not-403 on ownership)
 */
@Controller('shopify')
export class ShopifyController {
  constructor(
    private readonly connections: ShopifyConnectionService,
    private readonly catalogue: ShopifyCatalogueService,
    private readonly imports: ShopifyImportService,
  ) {}

  @Post('connection')
  connect(@CurrentUser('id') userId: string, @Body() dto: ConnectShopifyDto) {
    return this.connections.connect(userId, dto);
  }

  @Get('connection')
  getMine(@CurrentUser('id') userId: string) {
    return this.connections.getMine(userId);
  }

  @Delete('connection')
  disconnect(@CurrentUser('id') userId: string) {
    return this.connections.disconnect(userId);
  }

  /**
   * Wizard step 2 — "here's what we'll import". Pulls + maps the whole
   * catalogue (read-only; can take a few seconds on large shops). 400
   * SHOP_CURRENCY_UNSUPPORTED for non-ZAR shops — the import gate, applied
   * here too so the wizard learns before an import is attempted.
   */
  @Get('import/preview')
  preview(@CurrentUser('id') userId: string) {
    return this.catalogue.previewForUser(userId);
  }

  /** Wizard step 3 — start the import. Returns the PENDING job to poll. */
  @Post('import')
  startImport(@CurrentUser('id') userId: string, @Body() dto: StartImportDto) {
    return this.imports.startImport(userId, dto);
  }

  @Get('import/latest')
  latestImport(@CurrentUser('id') userId: string) {
    return this.imports.getLatest(userId);
  }

  @Get('import/:id')
  importById(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.imports.getById(userId, id);
  }
}
