import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ProductService } from './product.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

@Controller('stores/:slug/products')
export class PublicProductController {
  constructor(private readonly productService: ProductService) {}

  @Public()
  @Get()
  getStorePublicCatalog(
    @Param('slug') slug: string,
    @Query() query: CatalogQueryDto,
  ) {
    return this.productService.getStorePublicCatalog(slug, query);
  }

  @Public()
  @Get(':productSlug')
  getPublicProduct(
    @Param('slug') storeSlug: string,
    @Param('productSlug') productSlug: string,
  ) {
    return this.productService.getPublicProduct(storeSlug, productSlug);
  }
}
