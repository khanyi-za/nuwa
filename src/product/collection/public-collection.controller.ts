import { Controller, Get, Param } from '@nestjs/common';
import { Public } from '../../auth/decorators/public.decorator';
import { CollectionService } from './collection.service';

@Controller('stores/:slug/collections')
export class PublicCollectionController {
  constructor(private readonly collectionService: CollectionService) {}

  @Public()
  @Get()
  getPublicCollections(@Param('slug') slug: string) {
    return this.collectionService.getPublicCollections(slug);
  }
}
