import {
  Body,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { MobileController } from '../common/mobile-controller.decorator';
import { ChatService } from '../../chat/chat.service';
import { GetMessagesQueryDto } from '../../chat/dto/get-messages-query.dto';
import { SendMessageDto } from '../../chat/dto/send-message.dto';
import { MobileMerchantService } from './mobile-merchant.service';

/**
 * Merchant side of chat on the mobile envelope — maya's dashboard inbox.
 * Mirrors the web MerchantConversationsController: the list route resolves the
 * caller's store; message-level routes lean on ChatService.resolveParticipant,
 * which already gates on canManageStore.
 */
@MobileController('api/merchant/conversations')
export class MobileMerchantChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly merchant: MobileMerchantService,
  ) {}

  @Get()
  async list(@CurrentUser('id') userId: string) {
    const store = await this.merchant.resolveManagedStore(userId);
    return this.chat.listConversationsForStore(store.id);
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
    // Bare message view, matching the buyer surface — maya parses both sides
    // of chat with the same code.
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
}
