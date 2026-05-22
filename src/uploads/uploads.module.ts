import { Global, Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { CloudinaryConfig } from './cloudinary-config';
import { UploadsController } from './uploads.controller';
import { UploadsService } from './uploads.service';
import { IsCloudinaryUrlConstraint } from './validators/is-cloudinary-url.validator';

/**
 * UploadsModule
 *
 * Marked @Global because CloudinaryConfig and the IsCloudinaryUrl validator
 * need to be available across store/product modules for DTO-level URL validation
 * without each module having to import UploadsModule.
 *
 * Imports StoreModule to use StoreService.canManageStore() for per-context
 * authorization at sign time.
 */
@Global()
@Module({
  imports: [StoreModule],
  controllers: [UploadsController],
  providers: [UploadsService, CloudinaryConfig, IsCloudinaryUrlConstraint],
  exports: [CloudinaryConfig, IsCloudinaryUrlConstraint],
})
export class UploadsModule {}
