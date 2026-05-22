import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { MediaType } from '@prisma/client';
import { IsCloudinaryUrl } from '../../uploads/validators/is-cloudinary-url.validator';

export class AddImageDto {
  @IsUrl()
  @IsCloudinaryUrl()
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsEnum(MediaType)
  mediaType?: MediaType;
}
