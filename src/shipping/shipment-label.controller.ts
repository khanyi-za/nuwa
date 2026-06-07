import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ShipmentLabelService } from './shipment-label.service';

/**
 * Merchant downloads the printed waybill PDF for a paid order.
 * Mounted at `/stores/:storeId/orders/:orderId/shipping-label`.
 *
 * Returns the PDF binary with `application/pdf` content-type and an
 * inline disposition so browsers preview rather than auto-download
 * (frontend can override per-request if needed).
 */
@Controller('stores/:storeId/orders/:orderId/shipping-label')
export class ShipmentLabelController {
  constructor(private readonly service: ShipmentLabelService) {}

  @Get()
  async download(
    @CurrentUser('id') userId: string,
    @Param('storeId') storeId: string,
    @Param('orderId') orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const label = await this.service.getLabelForOrder(userId, storeId, orderId);
    res
      .status(200)
      .setHeader('Content-Type', label.contentType)
      .setHeader('Content-Length', label.buffer.length)
      .setHeader(
        'Content-Disposition',
        `inline; filename="${label.filename}"`,
      )
      .send(label.buffer);
  }
}
