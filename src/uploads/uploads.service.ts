import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StoreService } from '../store/store.service';
import { CloudinaryConfig } from './cloudinary-config';
import {
  CloudinarySignatureRequestDto,
  UploadContext,
} from './dto/cloudinary-signature-request.dto';

type SignatureResponse = {
  signature: string;
  timestamp: number;
  apiKey: string;
  cloudName: string;
  preset: string;
  folder: string;
  resourceType: 'image' | 'video';
};

// Maps each upload context to its Cloudinary preset name + resource type.
// The preset name MUST exactly match a preset configured in the Cloudinary dashboard.
const PRESETS: Record<
  UploadContext,
  { name: string; resourceType: 'image' | 'video' }
> = {
  [UploadContext.STORE_LOGO]: { name: 'store_logo', resourceType: 'image' },
  [UploadContext.STORE_BANNER]: { name: 'store_banner', resourceType: 'image' },
  [UploadContext.STORE_BANNER_VIDEO]: { name: 'store_banner_video', resourceType: 'video' },
  [UploadContext.PRODUCT_IMAGE]: { name: 'product_image', resourceType: 'image' },
  [UploadContext.PRODUCT_VIDEO]: { name: 'product_video', resourceType: 'video' },
  [UploadContext.COLLECTION_IMAGE]: { name: 'collection_image', resourceType: 'image' },
  [UploadContext.CATEGORY_IMAGE]: { name: 'category_image', resourceType: 'image' },
  [UploadContext.CHAT_ATTACHMENT]: { name: 'chat_attachment', resourceType: 'image' },
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storeService: StoreService,
    private readonly cloudinaryConfig: CloudinaryConfig,
  ) {}

  /**
   * Generates a one-shot Cloudinary upload signature scoped to the requested
   * upload context, after verifying the authenticated user has permission to
   * upload there. Returns the signed payload the frontend forwards to Cloudinary.
   */
  async generateSignature(
    userId: string,
    userRole: UserRole,
    dto: CloudinarySignatureRequestDto,
  ): Promise<SignatureResponse> {
    const folder = await this.authorizeAndResolveFolder(userId, userRole, dto);
    const { name: preset, resourceType } = PRESETS[dto.uploadContext];
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = this.computeSignature({ folder, preset, timestamp });

    return {
      signature,
      timestamp,
      apiKey: this.cloudinaryConfig.apiKey,
      cloudName: this.cloudinaryConfig.cloudName,
      preset,
      folder,
      resourceType,
    };
  }

  /**
   * Verifies the user can upload under the requested context and returns the
   * resolved folder path. Throws ForbiddenException or NotFoundException as
   * appropriate. The folder layout matches the spec in uploads-module-api.md.
   */
  private async authorizeAndResolveFolder(
    userId: string,
    userRole: UserRole,
    dto: CloudinarySignatureRequestDto,
  ): Promise<string> {
    switch (dto.uploadContext) {
      case UploadContext.STORE_LOGO:
        await this.assertCanManageStore(userId, dto.storeId!);
        return `stores/${dto.storeId}/logo`;

      case UploadContext.STORE_BANNER:
      case UploadContext.STORE_BANNER_VIDEO:
        // Image and video banner uploads share the same folder so the gallery's
        // contents live together in Cloudinary's tree. Only the preset differs.
        await this.assertCanManageStore(userId, dto.storeId!);
        return `stores/${dto.storeId}/banner`;

      case UploadContext.PRODUCT_IMAGE:
        await this.assertCanManageStore(userId, dto.storeId!);
        await this.assertProductBelongsToStore(dto.productId!, dto.storeId!);
        return `products/${dto.productId}/images`;

      case UploadContext.PRODUCT_VIDEO:
        await this.assertCanManageStore(userId, dto.storeId!);
        await this.assertProductBelongsToStore(dto.productId!, dto.storeId!);
        return `products/${dto.productId}/videos`;

      case UploadContext.COLLECTION_IMAGE:
        await this.assertCanManageStore(userId, dto.storeId!);
        await this.assertCollectionBelongsToStore(
          dto.collectionId!,
          dto.storeId!,
        );
        return `stores/${dto.storeId}/collections/${dto.collectionId}`;

      case UploadContext.CATEGORY_IMAGE:
        if (userRole !== UserRole.ADMIN) {
          throw new ForbiddenException(
            'You do not have permission to access this resource',
          );
        }
        await this.assertCategoryExists(dto.categoryId!);
        return `categories/${dto.categoryId}`;

      case UploadContext.CHAT_ATTACHMENT:
        // Any authenticated user may upload a chat image; the send-message
        // endpoint validates the resulting URL is a Cloudinary URL. Folder is
        // namespaced per user.
        return `chat/${userId}`;
    }
  }

  /**
   * Verifies the store exists and the user can manage it (owner or active
   * accepted employee). 404 if not found (no enumeration), 403 if forbidden.
   */
  private async assertCanManageStore(
    userId: string,
    storeId: string,
  ): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const canManage = await this.storeService.canManageStore(userId, storeId);
    if (!canManage) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }
  }

  /**
   * 404 if the product doesn't exist OR belongs to a different store than the
   * URL says. Same shape as elsewhere in the codebase — prevents cross-store
   * product enumeration.
   */
  private async assertProductBelongsToStore(
    productId: string,
    storeId: string,
  ): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, storeId: true },
    });
    if (!product || product.storeId !== storeId) {
      throw new NotFoundException('Product not found');
    }
  }

  /** Same 404-not-403 pattern for collections. */
  private async assertCollectionBelongsToStore(
    collectionId: string,
    storeId: string,
  ): Promise<void> {
    const collection = await this.prisma.storeCollection.findUnique({
      where: { id: collectionId },
      select: { id: true, storeId: true },
    });
    if (!collection || collection.storeId !== storeId) {
      throw new NotFoundException('Collection not found');
    }
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }
  }

  /**
   * Cloudinary signature algorithm (per their docs):
   *   sha1(params_sorted_by_key_joined_with_& + api_secret).hex
   *
   * Params we sign (alphabetical order):
   *   folder, source, timestamp, upload_preset
   *
   * `source=uw` is required because YIIVA's frontend uploads through Cloudinary's
   * Upload Widget (next-cloudinary's <CldUploadWidget>). The widget always injects
   * `source=uw` into the upload form-data and Cloudinary includes that param in
   * signature verification. Omitting it produces `401 Invalid Signature` from
   * Cloudinary. See docs/Api-frontend-contracts/uploads-source-uw-signature.md.
   *
   * Excluded from signing: api_key, file, resource_type, cloud_name, signature itself.
   *
   * The frontend MUST pass these exact param values to Cloudinary. Any tampering
   * (e.g. changing the folder) invalidates the signature and Cloudinary rejects.
   */
  private computeSignature(params: {
    folder: string;
    preset: string;
    timestamp: number;
  }): string {
    const paramsString = `folder=${params.folder}&source=uw&timestamp=${params.timestamp}&upload_preset=${params.preset}`;
    return createHash('sha1')
      .update(paramsString + this.cloudinaryConfig.apiSecret)
      .digest('hex');
  }
}
