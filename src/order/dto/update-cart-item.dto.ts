import { IsInt, Min } from 'class-validator';

/**
 * Update-cart-item payload. Quantity is the absolute new quantity, not a
 * delta. To remove a line entirely, use `DELETE /cart/items/:id` — setting
 * quantity to 0 is rejected by the `@Min(1)` validator.
 */
export class UpdateCartItemDto {
  @IsInt()
  @Min(1)
  quantity: number;
}
