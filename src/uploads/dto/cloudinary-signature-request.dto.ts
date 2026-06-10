import { IsEnum, IsNotEmpty, IsString, ValidateIf } from 'class-validator';

/**
 * The upload context identifies which preset, folder, and authz rules apply.
 * One value per surface that uses Cloudinary uploads in YIIVA.
 */
export enum UploadContext {
  STORE_LOGO = 'store_logo',
  STORE_BANNER = 'store_banner',
  STORE_BANNER_VIDEO = 'store_banner_video',
  PRODUCT_IMAGE = 'product_image',
  PRODUCT_VIDEO = 'product_video',
  COLLECTION_IMAGE = 'collection_image',
  CATEGORY_IMAGE = 'category_image',
  // Buyer/merchant chat image attachments. No store/admin scope — any
  // authenticated user, namespaced to their own folder.
  CHAT_ATTACHMENT = 'chat_attachment',
}

// Helper context sets used by @ValidateIf for conditional-required field checks.
const STORE_SCOPED_CONTEXTS: UploadContext[] = [
  UploadContext.STORE_LOGO,
  UploadContext.STORE_BANNER,
  UploadContext.STORE_BANNER_VIDEO,
  UploadContext.PRODUCT_IMAGE,
  UploadContext.PRODUCT_VIDEO,
  UploadContext.COLLECTION_IMAGE,
];

const PRODUCT_CONTEXTS: UploadContext[] = [
  UploadContext.PRODUCT_IMAGE,
  UploadContext.PRODUCT_VIDEO,
];

export class CloudinarySignatureRequestDto {
  @IsEnum(UploadContext)
  uploadContext: UploadContext;

  // Required for all contexts except category_image.
  @ValidateIf((o) => STORE_SCOPED_CONTEXTS.includes(o.uploadContext))
  @IsString()
  @IsNotEmpty()
  storeId?: string;

  // Required for product_image and product_video.
  @ValidateIf((o) => PRODUCT_CONTEXTS.includes(o.uploadContext))
  @IsString()
  @IsNotEmpty()
  productId?: string;

  // Required for collection_image.
  @ValidateIf((o) => o.uploadContext === UploadContext.COLLECTION_IMAGE)
  @IsString()
  @IsNotEmpty()
  collectionId?: string;

  // Required for category_image (admin-only).
  @ValidateIf((o) => o.uploadContext === UploadContext.CATEGORY_IMAGE)
  @IsString()
  @IsNotEmpty()
  categoryId?: string;
}
