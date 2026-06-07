import {
  toShipLogicCollectionAddress,
  toShipLogicDeliveryAddress,
} from './shiplogic-address';

describe('shiplogic-address', () => {
  describe('toShipLogicCollectionAddress', () => {
    const baseOrigin = {
      addressLine1: '194 Bancor Avenue',
      addressLine2: null,
      suburb: 'Menlyn',
      city: 'Pretoria',
      province: 'Gauteng',
      postalCode: '0181',
      country: 'South Africa',
      latitude: -25.786,
      longitude: 28.281,
    };

    it('maps the full origin address with default business type', () => {
      const out = toShipLogicCollectionAddress(baseOrigin, {
        company: 'YIIVA',
      });
      expect(out).toEqual({
        type: 'business',
        company: 'YIIVA',
        street_address: '194 Bancor Avenue',
        local_area: 'Menlyn',
        city: 'Pretoria',
        zone: 'Gauteng',
        country: 'ZA',
        code: '0181',
        lat: -25.786,
        lng: 28.281,
      });
    });

    it('concatenates addressLine1 + addressLine2 with comma', () => {
      const out = toShipLogicCollectionAddress({
        ...baseOrigin,
        addressLine1: 'Unit 4B',
        addressLine2: '194 Bancor Avenue',
      });
      expect(out.street_address).toBe('Unit 4B, 194 Bancor Avenue');
    });

    it('omits addressLine2 when null or empty', () => {
      expect(
        toShipLogicCollectionAddress({ ...baseOrigin, addressLine2: '' })
          .street_address,
      ).toBe('194 Bancor Avenue');
      expect(
        toShipLogicCollectionAddress({ ...baseOrigin, addressLine2: '   ' })
          .street_address,
      ).toBe('194 Bancor Avenue');
    });

    it('omits optional fields when null/undefined (no junk in payload)', () => {
      const out = toShipLogicCollectionAddress({
        ...baseOrigin,
        suburb: null,
        latitude: null,
        longitude: null,
      });
      expect(out).not.toHaveProperty('local_area');
      expect(out).not.toHaveProperty('lat');
      expect(out).not.toHaveProperty('lng');
    });

    it('does not include company when not provided', () => {
      const out = toShipLogicCollectionAddress(baseOrigin);
      expect(out).not.toHaveProperty('company');
    });

    it('always maps country to ZA (v1 SA-only)', () => {
      expect(
        toShipLogicCollectionAddress({ ...baseOrigin, country: null }).country,
      ).toBe('ZA');
      expect(
        toShipLogicCollectionAddress({
          ...baseOrigin,
          country: 'South Africa',
        }).country,
      ).toBe('ZA');
    });
  });

  describe('toShipLogicDeliveryAddress', () => {
    const baseDest = {
      streetAddress: '10 Midas Avenue',
      suburb: 'Olympus AH',
      city: 'Pretoria',
      province: 'Gauteng',
      postalCode: '0081',
      country: 'South Africa',
    };

    it('defaults type to residential for delivery', () => {
      const out = toShipLogicDeliveryAddress(baseDest);
      expect(out.type).toBe('residential');
    });

    it('respects an overridden type (e.g., counter for locker drops)', () => {
      const out = toShipLogicDeliveryAddress(baseDest, { type: 'counter' });
      expect(out.type).toBe('counter');
    });

    it('passes streetAddress through trimmed; omits suburb when null', () => {
      const out = toShipLogicDeliveryAddress({
        ...baseDest,
        streetAddress: '  10 Midas Avenue, Apt 2  ',
        suburb: null,
      });
      expect(out.street_address).toBe('10 Midas Avenue, Apt 2');
      expect(out).not.toHaveProperty('local_area');
    });
  });
});
