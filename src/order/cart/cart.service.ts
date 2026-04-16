import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** Phase 3 — cart CRUD + soft stock reservation. Placeholder. */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}
}
