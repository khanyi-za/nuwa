import { Get, Query } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { MobileCategoriesService } from './mobile-categories.service';
import { CategoriesQueryDto } from './dto/categories-query.dto';

@MobileController('api/categories')
export class MobileCategoriesController {
  constructor(private readonly service: MobileCategoriesService) {}

  // Auth: none (public).
  @Public()
  @Get()
  list(@Query() dto: CategoriesQueryDto) {
    return this.service.list(dto.genderType);
  }
}
