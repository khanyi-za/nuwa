import { IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * A single line in a guest checkout. Authenticated buyers don't use this —
 * their items come from the server-side cart.
 */
export class CheckoutItemDto {
  @IsString()
  productId: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  @IsInt()
  @Min(1)
  quantity: number;
}
