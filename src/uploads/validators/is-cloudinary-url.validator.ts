import { Injectable } from '@nestjs/common';
import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { CloudinaryConfig } from '../cloudinary-config';

/**
 * IsCloudinaryUrlConstraint — class-validator constraint that asserts a string
 * value is an https URL pointing at YIIVA's configured Cloudinary cloud.
 *
 * Resolves CloudinaryConfig via NestJS DI. This works because main.ts calls
 * `useContainer(app.select(AppModule), { fallbackOnErrors: true })`, which
 * lets class-validator look up validators in the NestJS container.
 *
 * Use via the @IsCloudinaryUrl() decorator below.
 */
@ValidatorConstraint({ name: 'IsCloudinaryUrl', async: false })
@Injectable()
export class IsCloudinaryUrlConstraint implements ValidatorConstraintInterface {
  constructor(private readonly cloudinaryConfig: CloudinaryConfig) {}

  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return value.startsWith(this.cloudinaryConfig.urlPrefix);
  }

  defaultMessage(): string {
    return 'Image URL must be uploaded to YIIVA Cloudinary';
  }
}

/**
 * Apply to any DTO field that accepts a Cloudinary asset URL. Pair with
 * `@IsUrl()` declared first so format validation runs before the prefix check.
 *
 * Example:
 *   @IsOptional()
 *   @IsUrl()
 *   @IsCloudinaryUrl()
 *   logoUrl?: string;
 */
export function IsCloudinaryUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsCloudinaryUrlConstraint,
    });
  };
}
