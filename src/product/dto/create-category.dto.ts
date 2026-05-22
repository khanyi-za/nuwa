import { IsString, IsOptional, IsUrl, IsInt, Min, Length } from 'class-validator';
import { IsCloudinaryUrl } from '../../uploads/validators/is-cloudinary-url.validator';

export class CreateCategoryDto {
  @IsString()
  @Length(2, 80)
  name: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @IsOptional()
  @IsUrl()
  @IsCloudinaryUrl()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  parentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
