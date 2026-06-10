import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { StoreModule } from '../store/store.module';
import { ChatService } from './chat.service';
import { ChatGateway } from './chat.gateway';
import { ConversationsController } from './conversations.controller';
import { MerchantConversationsController } from './merchant-conversations.controller';

/**
 * Buyer↔merchant chat. ChatService is the durable core shared by the buyer
 * (`/api/conversations`) and merchant (`/stores/:storeId/conversations`)
 * surfaces. ChatGateway (socket.io) attaches the real-time layer on top.
 * Imports StoreModule for `canManageStore`; CloudinaryConfig resolves from the
 * global UploadsModule.
 */
@Module({
  imports: [
    StoreModule,
    // Own JwtModule (same JWT_SECRET as AuthModule) for socket-handshake auth.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [ConversationsController, MerchantConversationsController],
  providers: [ChatService, ChatGateway],
  exports: [ChatService],
})
export class ChatModule {}
