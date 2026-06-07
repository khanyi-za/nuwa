import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { ShipLogicClient } from './shiplogic/shiplogic-client.service';

export interface ShipmentLabelPdf {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

/**
 * Fetches the printable waybill PDF for an order's shipment from ShipLogic.
 * Used by the merchant-facing controller endpoint
 * `GET /stores/:storeId/orders/:orderId/shipping-label`.
 *
 * Authz: caller must be able to manage the store (owner OR active accepted
 * employee). The Order must belong to the store. Both are enforced here
 * before any ShipLogic call.
 */
@Injectable()
export class ShipmentLabelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly client: ShipLogicClient,
  ) {}

  async getLabelForOrder(
    userId: string,
    storeId: string,
    orderId: string,
  ): Promise<ShipmentLabelPdf> {
    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        storeId: true,
        orderNumber: true,
        shipment: { select: { shiplogicShipmentId: true, waybillNumber: true } },
      },
    });
    if (!order || order.storeId !== storeId) {
      // 404 (not 403) for cross-store — enumeration prevention. Matches the
      // pattern used everywhere else in OrderService / DispatchAddressService.
      throw new NotFoundException('Order not found');
    }
    if (!order.shipment || !order.shipment.shiplogicShipmentId) {
      throw new NotFoundException(
        'Shipping label is not available yet for this order',
      );
    }

    const { buffer, contentType } = await this.client.getBinary(
      `/shipments/label?id=${encodeURIComponent(order.shipment.shiplogicShipmentId)}`,
    );

    return {
      buffer,
      contentType: contentType ?? 'application/pdf',
      filename: `YIIVA-${order.orderNumber}-waybill.pdf`,
    };
  }
}
