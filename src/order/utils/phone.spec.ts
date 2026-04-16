import { BadRequestException } from '@nestjs/common';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  describe('canonicalizes valid SA numbers', () => {
    it('passes +27 international format through unchanged', () => {
      expect(normalizePhone('+27821234567')).toBe('+27821234567');
    });

    it('converts 0XXXXXXXXX national format to +27XXXXXXXXX', () => {
      expect(normalizePhone('0821234567')).toBe('+27821234567');
    });

    it('adds leading + to 27XXXXXXXXX (no plus)', () => {
      expect(normalizePhone('27821234567')).toBe('+27821234567');
    });
  });

  describe('tolerates formatting characters', () => {
    it('strips spaces', () => {
      expect(normalizePhone('+27 82 123 4567')).toBe('+27821234567');
    });

    it('strips dashes', () => {
      expect(normalizePhone('082-123-4567')).toBe('+27821234567');
    });

    it('strips parentheses and mixed whitespace', () => {
      expect(normalizePhone('(082) 123 4567')).toBe('+27821234567');
    });
  });

  describe('rejects invalid input', () => {
    it.each([
      ['empty string', ''],
      ['letters', '082abcd567'],
      ['too short', '082123456'],
      ['too long', '08212345678'],
      ['non-SA country code', '+15551234567'],
      ['non-zero leading national', '1821234567'],
    ])('throws BadRequestException for %s', (_label, input) => {
      expect(() => normalizePhone(input)).toThrow(BadRequestException);
    });
  });
});
