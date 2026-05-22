import { IsInt, IsOptional, IsString, IsUrl, Length, Min } from 'class-validator';
import { IsCloudinaryUrl } from '../../uploads/validators/is-cloudinary-url.validator';

export class CreateCollectionDto {
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
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
