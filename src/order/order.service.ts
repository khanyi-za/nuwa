import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Top-level order lifecycle service (placeholder).
 *
 * Real logic — merchant order list, buyer order list, status transitions,
 * cancel, admin overrides — lands in Phases 5–7. Phase 1 only registers the
 * provider so downstream modules (Payments, Shipping) can import the token
 * once they need it.
 */
@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}
}
