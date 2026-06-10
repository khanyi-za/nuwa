import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { StoreService } from '../store/store.service';
import { ChatService } from './chat.service';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Merchant chat surface (consumed by the merchant dashboard repo). Raw shape
 * (not the mobile envelope), auth-required, `canManageStore` authz. Message-
 * level operations reuse ChatService, whose `resolveParticipant` already gates
 * on canManageStore — so a merchant can only touch their own conversations.
 */
@Controller('stores/:storeId/conversations')
export class MerchantConversationsController {
  constructor(
    private readonly chat: ChatService,
    private readonly storeService: StoreService,
  ) {}

  @Get()
  async list(
    @Param('storeId') storeId: string,
    @CurrentUser('id') userId: string,
  ) {
    await this.assertCanManage(userId, storeId);
    return this.chat.listConversationsForStore(storeId);
  }

  @Get(':conversationId/messages')
  messages(
    @Param('conversationId') conversationId: string,
    @Query() dto: GetMessagesQueryDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.getMessages(conversationId, userId, {
      limit: dto.limit,
      before: dto.before,
      after: dto.after,
    });
  }

  @Post(':conversationId/messages')
  @HttpCode(201)
  send(
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.sendMessage(conversationId, userId, dto, idempotencyKey);
  }

  @Patch(':conversationId/read')
  @HttpCode(200)
  read(
    @Param('conversationId') conversationId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.markRead(conversationId, userId);
  }

  private async assertCanManage(userId: string, storeId: string): Promise<void> {
    if (!(await this.storeService.canManageStore(userId, storeId))) {
      throw new ForbiddenException(
        'You do not have permission to manage this store',
      );
    }
  }
}
