import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CloudinarySignatureRequestDto } from './dto/cloudinary-signature-request.dto';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  // POST /uploads/cloudinary-signature
  // Issues a one-shot Cloudinary upload signature scoped to a specific context
  // (store logo, product image, etc.) after verifying the user has permission.
  // Per-context authz happens inside the service — see uploads-module-api.md.
  @Post('cloudinary-signature')
  @HttpCode(200)
  cloudinarySignature(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') userRole: UserRole,
    @Body() dto: CloudinarySignatureRequestDto,
  ) {
    return this.uploadsService.generateSignature(userId, userRole, dto);
  }
}
