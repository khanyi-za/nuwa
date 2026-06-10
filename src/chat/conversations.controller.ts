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
import { MobileController } from '../mobile/common/mobile-controller.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import { GetMessagesQueryDto } from './dto/get-messages-query.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { ReportConversationDto } from './dto/report-conversation.dto';

/**
 * Buyer chat surface (maya). Auth-required throughout — guests can't have
 * conversations (CH-15). Enveloped like the rest of `/api`.
 */
@MobileController('api/conversations')
export class ConversationsController {
  constructor(private readonly chat: ChatService) {}

  @Get('by-merchant/:username')
  getOrCreate(
    @Param('username') username: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.getOrCreateByMerchant(userId, username);
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

  @Post(':conversationId/report')
  @HttpCode(200)
  report(
    @Param('conversationId') conversationId: string,
    @Body() dto: ReportConversationDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.chat.report(conversationId, userId, dto);
  }
}
