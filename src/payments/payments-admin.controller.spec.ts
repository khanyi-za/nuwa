import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { PaymentsAdminController } from './payments-admin.controller';
import { PaymentsReconcileService } from './payments-reconcile.service';

describe('PaymentsAdminController', () => {
  let controller: PaymentsAdminController;
  const reconcile = jest.fn();

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [PaymentsAdminController],
      providers: [
        { provide: PaymentsReconcileService, useValue: { reconcile } },
      ],
    }).compile();
    controller = module.get(PaymentsAdminController);
    jest.clearAllMocks();
  });

  it('delegates the path :id to the reconcile service', async () => {
    reconcile.mockResolvedValue({ verdict: 'MATCH' });
    await controller.reconcile('pg-1');
    expect(reconcile).toHaveBeenCalledWith('pg-1');
  });

  it('returns whatever the service returns', async () => {
    const expected = { verdict: 'NOT_FOUND', payfast: { found: false } };
    reconcile.mockResolvedValue(expected);
    const result = await controller.reconcile('pg-1');
    expect(result).toBe(expected);
  });

  it('is decorated with @Roles(ADMIN) at the controller level', () => {
    const reflector = new Reflector();
    const roles = reflector.get<UserRole[]>('roles', PaymentsAdminController);
    expect(roles).toEqual([UserRole.ADMIN]);
  });

  it('propagates errors (e.g., 404 from service)', async () => {
    reconcile.mockRejectedValue(new Error('PaymentGroup not found'));
    await expect(controller.reconcile('missing')).rejects.toThrow(
      'PaymentGroup not found',
    );
  });
});
