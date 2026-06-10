import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { MessageSenderType } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../common/types/jwt-payload.interface';
import { ChatService } from './chat.service';

const room = (conversationId: string) => `conversation:${conversationId}`;

/**
 * Real-time delivery for chat. REST owns the writes; this gateway only fans out
 * already-persisted events to connected participants. JWT is verified on the
 * handshake; clients `join` a conversation room (re-checked against
 * `resolveParticipant`), then receive `message:new` / `read` events.
 *
 * `afterInit` injects the emit hooks into ChatService — this avoids a circular
 * DI dependency (gateway → service for join-auth; service → gateway for emit).
 */
@WebSocketGateway({ namespace: '/chat', cors: { origin: '*' } })
export class ChatGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(ChatGateway.name);

  @WebSocketServer() server!: Server;

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  afterInit(): void {
    this.chat.emitMessage = (conversationId, message) => {
      this.server.to(room(conversationId)).emit('message:new', message);
    };
    this.chat.emitRead = (conversationId, by) => {
      this.server.to(room(conversationId)).emit('read', { conversationId, by });
    };
  }

  handleConnection(client: Socket): void {
    try {
      const payload = this.jwt.verify<JwtPayload>(this.extractToken(client), {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
      client.data.userId = payload.sub;
    } catch {
      client.disconnect(true);
    }
  }

  @SubscribeMessage('join')
  async onJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const userId = client.data.userId as string | undefined;
    if (!userId || !body?.conversationId) return { ok: false };
    try {
      await this.chat.resolveParticipant(body.conversationId, userId);
      await client.join(room(body.conversationId));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  @SubscribeMessage('leave')
  async onLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.conversationId) await client.leave(room(body.conversationId));
    return { ok: true };
  }

  private extractToken(client: Socket): string {
    const auth = client.handshake.auth as { token?: string } | undefined;
    const header = client.handshake.headers.authorization?.replace(
      /^Bearer\s+/i,
      '',
    );
    const query =
      typeof client.handshake.query.token === 'string'
        ? client.handshake.query.token
        : undefined;
    const token = auth?.token || header || query;
    if (!token) throw new Error('No token');
    return token;
  }
}

// Re-exported for typing convenience in tests / consumers.
export type { MessageSenderType };
