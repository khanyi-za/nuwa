import { Test } from '@nestjs/testing';
import { AddressService } from '../../order/address/address.service';
import { MobileAddressesService } from './mobile-addresses.service';

const nuwaAddress = {
  id: 'a1',
  userId: 'u1',
  recipientName: 'Jane Doe',
  phone: '+27821234567',
  addressLine1: '123 Long Street',
  addressLine2: 'Apt 4B',
  suburb: 'CBD',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '8001',
  country: 'South Africa',
  isDefault: true,
  label: 'Home',
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAddressService = {
  list: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

describe('MobileAddressesService', () => {
  let service: MobileAddressesService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        MobileAddressesService,
        { provide: AddressService, useValue: mockAddressService },
      ],
    }).compile();
    service = module.get(MobileAddressesService);
    jest.clearAllMocks();
  });

  it('maps nuwa addresses to the maya shape (line1/line2, country ZA)', async () => {
    mockAddressService.list.mockResolvedValue([nuwaAddress]);

    const { addresses } = await service.list('u1');

    expect(addresses[0]).toEqual({
      id: 'a1',
      recipientName: 'Jane Doe',
      phone: '+27821234567',
      line1: '123 Long Street',
      line2: 'Apt 4B',
      city: 'Cape Town',
      province: 'Western Cape',
      postalCode: '8001',
      country: 'ZA',
      isDefault: true,
      label: 'Home',
    });
  });

  it('maps maya line1/line2 to nuwa addressLine1/addressLine2 on create', async () => {
    mockAddressService.create.mockResolvedValue(nuwaAddress);

    await service.create('u1', {
      recipientName: 'Jane Doe',
      phone: '+27821234567',
      line1: '123 Long Street',
      line2: 'Apt 4B',
      city: 'Cape Town',
      province: 'Western Cape',
      postalCode: '8001',
    });

    expect(mockAddressService.create).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        addressLine1: '123 Long Street',
        addressLine2: 'Apt 4B',
      }),
    );
  });

  it('setDefault promotes via update with isDefault: true', async () => {
    mockAddressService.update.mockResolvedValue(nuwaAddress);
    await service.setDefault('u1', 'a1');
    expect(mockAddressService.update).toHaveBeenCalledWith('u1', 'a1', {
      isDefault: true,
    });
  });
});
