import { IsEnum, IsUrl } from 'class-validator';
import { MediaType } from '@prisma/client';
import { IsCloudinaryUrl } from '../../../uploads/validators/is-cloudinary-url.validator';

export class AddBannerMediaDto {
  @IsUrl()
  @IsCloudinaryUrl()
  url: string;

  @IsEnum(MediaType)
  mediaType: MediaType;
}
