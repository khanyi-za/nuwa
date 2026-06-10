import { IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateCartItemDto {
  // To remove an item use DELETE, not quantity: 0.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}
