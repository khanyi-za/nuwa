import { Get, Query } from '@nestjs/common';
import { MobileController } from '../common/mobile-controller.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileSocialService } from './mobile-social.service';
import { BookmarksQueryDto } from './dto/bookmarks-query.dto';

/**
 * `/api/me/*` social lists (auth-required). Bookmarks (Wishlist screen) now;
 * likes / follows lists land here later (social.md §5/§6).
 */
@MobileController('api/me')
export class MobileMeController {
  constructor(private readonly social: MobileSocialService) {}

  @Get('bookmarks')
  bookmarks(@Query() dto: BookmarksQueryDto, @CurrentUser('id') userId: string) {
    return this.social.listBookmarks(userId, {
      limit: dto.limit ?? 20,
      cursor: dto.cursor,
      sort: dto.sort,
    });
  }
}
