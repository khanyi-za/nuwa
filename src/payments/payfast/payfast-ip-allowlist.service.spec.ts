import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import * as dnsModule from 'dns';
import { PayfastIpAllowlistService } from './payfast-ip-allowlist.service';
import { PayfastConfig } from './payfast-config';

const mockConfig = {
  notifyHosts: ['www.payfast.co.za', 'sandbox.payfast.co.za'],
  skipIpCheck: false,
} as unknown as PayfastConfig;

// `dns.promises.lookup` has overloaded signatures (single vs `all: true`).
// The TS compiler can't narrow which overload jest is mocking; cast away
// the noise without losing runtime behavior.
const mockLookup = jest.spyOn(dnsModule.promises, 'lookup') as unknown as jest.Mock;

describe('PayfastIpAllowlistService', () => {
  let service: PayfastIpAllowlistService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        PayfastIpAllowlistService,
        { provide: PayfastConfig, useValue: { ...mockConfig } },
      ],
    }).compile();
    service = module.get(PayfastIpAllowlistService);

    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    service.stop();
  });

  describe('isAllowed', () => {
    it('returns true for an IP that resolved from a configured host', async () => {
      mockLookup.mockResolvedValue([
        { address: '197.97.144.10', family: 4 } as any,
        { address: '197.97.144.11', family: 4 } as any,
      ]);
      await service.onModuleInit();

      expect(service.isAllowed('197.97.144.10')).toBe(true);
      expect(service.isAllowed('197.97.144.11')).toBe(true);
    });

    it('returns false for an IP not in the resolved set', async () => {
      mockLookup.mockResolvedValue([
        { address: '197.97.144.10', family: 4 } as any,
      ]);
      await service.onModuleInit();
      expect(service.isAllowed('8.8.8.8')).toBe(false);
    });

    it('strips ::ffff: prefix from IPv4-mapped IPv6 before comparing', async () => {
      mockLookup.mockResolvedValue([
        { address: '197.97.144.10', family: 4 } as any,
      ]);
      await service.onModuleInit();
      expect(service.isAllowed('::ffff:197.97.144.10')).toBe(true);
    });

    it('handles native IPv6 addresses unchanged', async () => {
      mockLookup.mockResolvedValue([
        { address: '2001:db8::1', family: 6 } as any,
      ]);
      await service.onModuleInit();
      expect(service.isAllowed('2001:db8::1')).toBe(true);
      expect(service.isAllowed('2001:db8::2')).toBe(false);
    });
  });

  describe('skipIpCheck dev bypass', () => {
    it('returns true unconditionally when skipIpCheck=true', async () => {
      const bypassConfig = {
        notifyHosts: ['www.payfast.co.za'],
        skipIpCheck: true,
      } as unknown as PayfastConfig;
      const module = await Test.createTestingModule({
        providers: [
          PayfastIpAllowlistService,
          { provide: PayfastConfig, useValue: bypassConfig },
        ],
      }).compile();
      const dev = module.get(PayfastIpAllowlistService);

      mockLookup.mockResolvedValue([]);
      await dev.onModuleInit();

      expect(dev.isAllowed('8.8.8.8')).toBe(true);
      expect(dev.isAllowed('any-garbage-ip')).toBe(true);
      dev.stop();
    });
  });

  describe('refresh failure handling', () => {
    it('keeps previous allowlist when refresh produces empty set', async () => {
      // First refresh succeeds
      mockLookup.mockResolvedValueOnce([
        { address: '197.97.144.10', family: 4 } as any,
      ]);
      await service.onModuleInit();
      expect(service.isAllowed('197.97.144.10')).toBe(true);

      // Manually trigger a refresh that returns nothing
      mockLookup.mockRejectedValue(new Error('DNS down'));
      await (service as any).refresh();

      // Previous allowlist preserved
      expect(service.isAllowed('197.97.144.10')).toBe(true);
    });

    it('starts with empty allowlist if initial refresh fails (fail-closed)', async () => {
      mockLookup.mockRejectedValue(new Error('DNS down at boot'));
      await service.onModuleInit();
      expect(service.isAllowed('197.97.144.10')).toBe(false);
      expect(service.isAllowed('any-ip')).toBe(false);
    });
  });

  describe('host configuration', () => {
    it('resolves every configured host', async () => {
      mockLookup.mockResolvedValue([
        { address: '1.1.1.1', family: 4 } as any,
      ]);
      await service.onModuleInit();
      expect(mockLookup).toHaveBeenCalledWith(
        'www.payfast.co.za',
        expect.objectContaining({ all: true }),
      );
      expect(mockLookup).toHaveBeenCalledWith(
        'sandbox.payfast.co.za',
        expect.objectContaining({ all: true }),
      );
    });

    it('deduplicates IPs across hosts', async () => {
      mockLookup.mockResolvedValue([
        { address: '1.2.3.4', family: 4 } as any,
      ]);
      await service.onModuleInit();
      // Both hosts return the same IP — Set should hold one
      expect(service.getAllowedIps().size).toBe(1);
    });
  });
});
