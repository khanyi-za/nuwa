import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';

/**
 * GET /stores/:storeId/inventory/low-stock — items at/below their
 * lowStockThreshold (variant-aware, reservation-aware). Distinct path from
 * /stores/:storeId/products/* so it can never collide with the :id route.
 */
@Controller('stores/:storeId/inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get('low-stock')
  getLowStock(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
  ) {
    return this.inventory.getLowStock(userId, storeId);
  }
}
