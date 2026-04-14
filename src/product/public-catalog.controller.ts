import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { ProductService } from './product.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';

@Controller('products')
export class PublicCatalogController {
  constructor(private readonly productService: ProductService) {}

  @Public()
  @Get()
  getPublicCatalog(@Query() query: CatalogQueryDto) {
    return this.productService.getPublicCatalog(query);
  }
}
