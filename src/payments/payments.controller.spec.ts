import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { PaymentsController } from './payments.controller';
import { PaymentsNotifyService } from './payments-notify.service';

describe('PaymentsController', () => {
  let controller: PaymentsController;
  const handle = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsNotifyService, useValue: { handle } }],
    }).compile();
    controller = module.get(PaymentsController);
    jest.clearAllMocks();
  });

  it('delegates req.body and req.ip to the notify service', async () => {
    const body = { m_payment_id: 'm-1', signature: 'sig' };
    const req: any = { body, ip: '197.97.144.10' };
    await controller.notify(req);
    expect(handle).toHaveBeenCalledWith(body, '197.97.144.10');
  });

  it('substitutes empty object when body is missing', async () => {
    const req: any = { body: undefined, ip: '197.97.144.10' };
    await controller.notify(req);
    expect(handle).toHaveBeenCalledWith({}, '197.97.144.10');
  });

  it('substitutes empty string when ip is missing', async () => {
    const req: any = { body: {}, ip: undefined };
    await controller.notify(req);
    expect(handle).toHaveBeenCalledWith({}, '');
  });

  it('propagates errors from the notify service (e.g., 400 BadRequest)', async () => {
    handle.mockRejectedValue(new Error('Bad signature'));
    const req: any = { body: {}, ip: '8.8.8.8' };
    await expect(controller.notify(req)).rejects.toThrow('Bad signature');
  });

  it('is decorated with @Public() so JwtAuthGuard does not block PayFast', () => {
    const reflector = new Reflector();
    const isPublic = reflector.get<boolean>(
      'isPublic',
      controller.notify,
    );
    expect(isPublic).toBe(true);
  });
});
