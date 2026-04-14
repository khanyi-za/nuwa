import { Module } from '@nestjs/common';
import { StoreModule } from '../store/store.module';
import { ProductController } from './product.controller';
import { ProductService } from './product.service';
import { CategoryController } from './category/category.controller';
import { CategoryService } from './category/category.service';
import { CollectionController } from './collection/collection.controller';
import { CollectionService } from './collection/collection.service';
import { PublicCollectionController } from './collection/public-collection.controller';
import { ImageController } from './image/image.controller';
import { ImageService } from './image/image.service';
import { VariantController } from './variant/variant.controller';
import { VariantService } from './variant/variant.service';
import { CategoryLinkController } from './category-link/category-link.controller';
import { CategoryLinkService } from './category-link/category-link.service';
import { TagController } from './tag/tag.controller';
import { TagService } from './tag/tag.service';
import { PublicProductController } from './public-product.controller';
import { PublicCatalogController } from './public-catalog.controller';

@Module({
  imports: [StoreModule],
  controllers: [
    ProductController,
    CategoryController,
    CollectionController,
    PublicCollectionController,
    ImageController,
    VariantController,
    CategoryLinkController,
    TagController,
    PublicProductController,
    PublicCatalogController,
  ],
  providers: [
    ProductService,
    CategoryService,
    CollectionService,
    ImageService,
    VariantService,
    CategoryLinkService,
    TagService,
  ],
  exports: [ProductService],
})
export class ProductModule {}
