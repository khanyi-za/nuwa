import { Test } from '@nestjs/testing';
import { CheckoutService } from '../../order/checkout/checkout.service';
import { MobileCheckoutService } from './mobile-checkout.service';

const mockCheckout = { quote: jest.fn() };

describe('MobileCheckoutService', () => {
  let service: MobileCheckoutService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileCheckoutService,
        { provide: CheckoutService, useValue: mockCheckout },
      ],
    }).compile();
    service = module.get(MobileCheckoutService);
    jest.clearAllMocks();
  });

  it('flattens per-store totals and returns VAT-included tax (not added on top)', async () => {
    mockCheckout.quote.mockResolvedValue({
      grandSubtotalInCents: 219900,
      grandShippingInCents: 6500,
      grandTotalInCents: 226400,
      shippingQuoteId: 'q1',
      stores: [],
    });

    const result = await service.quote('u1', { addressId: 'a1' });

    expect(result).toEqual({
      subtotal: 219900,
      shipping: 6500,
      tax: 29530, // VAT portion already inside 226400 (= 226400 − 226400/1.15)
      total: 226400,
      currency: 'ZAR',
    });
  });
});
