import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import { PayfastSignatureService } from './payfast-signature.service';
import { phpUrlencode } from './url-encode';

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex');

describe('PayfastSignatureService', () => {
  let service: PayfastSignatureService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [PayfastSignatureService],
    }).compile();
    service = module.get(PayfastSignatureService);
  });

  // ────────────────────────────────────────────────────────────────────────
  // signFormPayload — form-flow signature for redirect payments
  // ────────────────────────────────────────────────────────────────────────

  describe('signFormPayload', () => {
    it('produces an MD5 matching the canonical PayFast form-flow algorithm', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '200.00',
        item_name: 'Test Item',
      };
      const passphrase = 'jt7NOE43FZPn';
      // FORM_FIELD_ORDER iteration: merchant_id, merchant_key, ... amount, item_name, ... passphrase, ...
      // Empty fields skipped. Active fields with passphrase appended at position 30:
      const expected = md5(
        'merchant_id=10000100' +
          '&merchant_key=46f0cd694581a' +
          '&amount=200.00' +
          '&item_name=Test+Item' +
          '&passphrase=jt7NOE43FZPn',
      );
      expect(service.signFormPayload(fields, passphrase)).toBe(expected);
    });

    it('uses the FORM_FIELD_ORDER order (not insertion order of input)', () => {
      // Input given in reverse order — output should still be in canonical order
      const fields = {
        item_name: 'Test',
        amount: '100.00',
        merchant_key: 'KEY',
        merchant_id: 'ID',
      };
      const passphrase = '';
      const expected = md5(
        'merchant_id=ID&merchant_key=KEY&amount=100.00&item_name=Test',
      );
      expect(service.signFormPayload(fields, passphrase)).toBe(expected);
    });

    it('skips empty string values', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: 'X',
        item_description: '', // skip
        cell_number: '', // skip
      };
      const expected = md5(
        'merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00&item_name=X',
      );
      expect(service.signFormPayload(fields, '')).toBe(expected);
    });

    it('skips whitespace-only values (trim before empty check)', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: '  ', // whitespace only — should skip
      };
      const expected = md5(
        'merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00',
      );
      expect(service.signFormPayload(fields, '')).toBe(expected);
    });

    it('trims whitespace from non-empty values', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '  50.00  ',
        item_name: '  Test  ',
      };
      const expected = md5(
        'merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00&item_name=Test',
      );
      expect(service.signFormPayload(fields, '')).toBe(expected);
    });

    it('ignores unknown fields not in FORM_FIELD_ORDER', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: 'X',
        bogus_field: 'should be ignored', // not in FORM_FIELD_ORDER
        something_else: 'also ignored',
      };
      const expected = md5(
        'merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00&item_name=X',
      );
      expect(service.signFormPayload(fields, '')).toBe(expected);
    });

    it('omits passphrase from input when empty', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: 'X',
      };
      const expected = md5(
        'merchant_id=10000100&merchant_key=46f0cd694581a&amount=50.00&item_name=X',
      );
      expect(service.signFormPayload(fields, '')).toBe(expected);
    });

    it('encodes special characters via phpUrlencode (spaces → +)', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: "Müller's t-shirt",
        return_url: 'https://yiiva.co.za/checkout/success',
      };
      const expected = md5(
        'merchant_id=10000100' +
          '&merchant_key=46f0cd694581a' +
          `&return_url=${phpUrlencode('https://yiiva.co.za/checkout/success')}` +
          '&amount=50.00' +
          `&item_name=${phpUrlencode("Müller's t-shirt")}`,
      );
      expect(service.signFormPayload(fields, '')).toBe(expected);
    });

    it('produces identical hash for identical input (deterministic)', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: 'X',
      };
      const a = service.signFormPayload(fields, 'pass');
      const b = service.signFormPayload(fields, 'pass');
      expect(a).toBe(b);
    });

    it('changes hash when any field changes (tamper detection)', () => {
      const baseFields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: 'X',
      };
      const original = service.signFormPayload(baseFields, 'pass');
      const tampered = service.signFormPayload(
        { ...baseFields, amount: '50.01' },
        'pass',
      );
      expect(tampered).not.toBe(original);
    });

    it('changes hash when passphrase changes', () => {
      const fields = {
        merchant_id: '10000100',
        merchant_key: '46f0cd694581a',
        amount: '50.00',
        item_name: 'X',
      };
      const a = service.signFormPayload(fields, 'pass-one');
      const b = service.signFormPayload(fields, 'pass-two');
      expect(a).not.toBe(b);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // signApiRequest — alphabetical (ksort) signature for refunds, history
  // ────────────────────────────────────────────────────────────────────────

  describe('signApiRequest', () => {
    it('produces an MD5 matching ksort-alphabetical algorithm', () => {
      const headers = {
        'merchant-id': '10000100',
        version: 'v1',
        timestamp: '2026-05-01T12:00:00+02:00',
      };
      const query = {};
      const body = { amount: 5000, reason: 'Product returned' };
      const passphrase = 'jt7NOE43FZPn';
      // Alphabetical order: amount, merchant-id, passphrase, reason, timestamp, version
      const expected = md5(
        `amount=5000` +
          `&merchant-id=10000100` +
          `&passphrase=${phpUrlencode('jt7NOE43FZPn')}` +
          `&reason=${phpUrlencode('Product returned')}` +
          `&timestamp=${phpUrlencode('2026-05-01T12:00:00+02:00')}` +
          `&version=v1`,
      );
      expect(service.signApiRequest(headers, query, body, passphrase)).toBe(
        expected,
      );
    });

    it('merges headers, query, and body into one signature input', () => {
      const headers = { 'merchant-id': '10000100' };
      const query = { extra: 'q' };
      const body = { amount: 100 };
      const expected = md5('amount=100&extra=q&merchant-id=10000100');
      expect(service.signApiRequest(headers, query, body, '')).toBe(expected);
    });

    it('omits passphrase when empty', () => {
      const headers = { 'merchant-id': '10000100', version: 'v1' };
      const expected = md5('merchant-id=10000100&version=v1');
      expect(service.signApiRequest(headers, {}, {}, '')).toBe(expected);
    });

    it('does not include the signature key if present in input', () => {
      const headers = {
        'merchant-id': '10000100',
        version: 'v1',
        signature: 'should-be-excluded',
      };
      const expected = md5('merchant-id=10000100&version=v1');
      expect(service.signApiRequest(headers, {}, {}, '')).toBe(expected);
    });

    it('skips undefined and null values (does not stringify them)', () => {
      const headers = {
        'merchant-id': '10000100',
        version: 'v1',
      };
      const body: Record<string, unknown> = {
        amount: 5000,
        reason: undefined,
        notify_buyer: null,
      };
      const expected = md5(
        'amount=5000&merchant-id=10000100&version=v1',
      );
      expect(service.signApiRequest(headers, {}, body, '')).toBe(expected);
    });

    it('does NOT trim values (matches SDK ITN/API behavior)', () => {
      const headers = { 'merchant-id': '  10000100  ' };
      // No trim — leading/trailing spaces are encoded as +
      const expected = md5(`merchant-id=${phpUrlencode('  10000100  ')}`);
      expect(service.signApiRequest(headers, {}, {}, '')).toBe(expected);
    });

    it('produces identical hash for the same input regardless of input dict order', () => {
      const a = service.signApiRequest(
        { z: '1', a: '2', m: '3' },
        {},
        {},
        '',
      );
      const b = service.signApiRequest(
        { a: '2', m: '3', z: '1' },
        {},
        {},
        '',
      );
      expect(a).toBe(b);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // verifyItnSignature — accept valid PayFast ITNs, reject tampered/forged
  // ────────────────────────────────────────────────────────────────────────

  describe('verifyItnSignature', () => {
    function buildItnPayload(passphrase: string): {
      body: Record<string, string>;
      signature: string;
    } {
      const baseFields = {
        m_payment_id: 'm-uuid-123',
        pf_payment_id: 'pf-uuid-456',
        payment_status: 'COMPLETE',
        item_name: 'Order ord_1',
        amount_gross: '550.00',
        amount_fee: '-12.65',
        amount_net: '537.35',
        merchant_id: '10000100',
      };
      // Build the same param string PayFast would produce
      let paramString = Object.entries(baseFields)
        .map(([k, v]) => `${k}=${phpUrlencode(v)}`)
        .join('&');
      if (passphrase) {
        paramString += `&passphrase=${phpUrlencode(passphrase)}`;
      }
      const signature = md5(paramString);
      return { body: { ...baseFields, signature }, signature };
    }

    it('accepts a valid signature with passphrase', () => {
      const passphrase = 'jt7NOE43FZPn';
      const { body } = buildItnPayload(passphrase);
      expect(service.verifyItnSignature(body, passphrase)).toBe(true);
    });

    it('accepts a valid signature without passphrase (passphrase-less merchant)', () => {
      const { body } = buildItnPayload('');
      expect(service.verifyItnSignature(body, '')).toBe(true);
    });

    it('rejects when any field is tampered', () => {
      const passphrase = 'jt7NOE43FZPn';
      const { body } = buildItnPayload(passphrase);
      const tampered = { ...body, amount_gross: '999.00' };
      expect(service.verifyItnSignature(tampered, passphrase)).toBe(false);
    });

    it('rejects when signature itself is tampered', () => {
      const passphrase = 'jt7NOE43FZPn';
      const { body } = buildItnPayload(passphrase);
      const tampered = { ...body, signature: '0'.repeat(32) };
      expect(service.verifyItnSignature(tampered, passphrase)).toBe(false);
    });

    it('rejects when passphrase is wrong', () => {
      const { body } = buildItnPayload('correct-pass');
      expect(service.verifyItnSignature(body, 'wrong-pass')).toBe(false);
    });

    it('rejects when signature field is missing', () => {
      const passphrase = 'jt7NOE43FZPn';
      const { body } = buildItnPayload(passphrase);
      const noSig: Record<string, string> = { ...body };
      delete noSig.signature;
      expect(service.verifyItnSignature(noSig, passphrase)).toBe(false);
    });

    it('rejects when signature is empty string', () => {
      const passphrase = 'jt7NOE43FZPn';
      const { body } = buildItnPayload(passphrase);
      expect(
        service.verifyItnSignature({ ...body, signature: '' }, passphrase),
      ).toBe(false);
    });

    it('rejects safely when received signature has different length (no timing crash)', () => {
      const passphrase = 'jt7NOE43FZPn';
      const { body } = buildItnPayload(passphrase);
      // 32 chars expected, give a 16-char fake
      expect(
        service.verifyItnSignature(
          { ...body, signature: 'abc' },
          passphrase,
        ),
      ).toBe(false);
    });

    it('breaks iteration at signature field (fields after signature are ignored)', () => {
      // PayFast SDK does `break;` not `continue;` when it hits signature.
      // So if signature is in the middle of the body, trailing fields are not signed.
      // We need to compute the signature OVER THE FIELDS BEFORE signature.
      const passphrase = 'jt7NOE43FZPn';
      const fieldsBeforeSig = { m_payment_id: 'm1', amount_gross: '100.00' };
      const paramString =
        `m_payment_id=m1&amount_gross=100.00&passphrase=${phpUrlencode(passphrase)}`;
      const sig = md5(paramString);
      // Body has signature in the middle, then bogus trailing fields
      const body: Record<string, string> = {
        ...fieldsBeforeSig,
        signature: sig,
        bogus_trailing: 'whatever',
      };
      expect(service.verifyItnSignature(body, passphrase)).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // buildPostbackBody — the body POSTed to /eng/query/validate
  // ────────────────────────────────────────────────────────────────────────

  describe('buildPostbackBody', () => {
    it('builds the same param string as the signature input (no passphrase, no signature)', () => {
      const body: Record<string, string> = {
        m_payment_id: 'm-uuid',
        pf_payment_id: 'pf-uuid',
        payment_status: 'COMPLETE',
        amount_gross: '550.00',
        signature: 'abc123',
      };
      expect(service.buildPostbackBody(body)).toBe(
        'm_payment_id=m-uuid' +
          '&pf_payment_id=pf-uuid' +
          '&payment_status=COMPLETE' +
          '&amount_gross=550.00',
      );
    });

    it('preserves insertion order from the parsed body', () => {
      const body: Record<string, string> = {
        z_field: '1',
        a_field: '2',
        m_field: '3',
        signature: 'sig',
      };
      expect(service.buildPostbackBody(body)).toBe(
        'z_field=1&a_field=2&m_field=3',
      );
    });

    it('urlencodes values via phpUrlencode', () => {
      const body: Record<string, string> = {
        item_name: 'Müller t-shirt',
        signature: 'sig',
      };
      expect(service.buildPostbackBody(body)).toBe(
        `item_name=${phpUrlencode('Müller t-shirt')}`,
      );
    });

    it('excludes fields after signature (matches break-at-signature pattern)', () => {
      const body: Record<string, string> = {
        m_payment_id: 'm1',
        signature: 'sig',
        bogus: 'should-not-appear',
      };
      expect(service.buildPostbackBody(body)).toBe('m_payment_id=m1');
    });

    it('returns empty string when body has only signature', () => {
      expect(service.buildPostbackBody({ signature: 'sig' })).toBe('');
    });

    it('returns the same param string used internally by verifyItnSignature', () => {
      // This is a load-bearing invariant: PayFast's server compares the postback
      // body to the data they sent us. Mismatch → INVALID. So the postback body
      // MUST equal what verifyItnSignature uses internally as input.
      const passphrase = 'jt7NOE43FZPn';
      const baseFields = {
        m_payment_id: 'm-uuid',
        pf_payment_id: 'pf-uuid',
        payment_status: 'COMPLETE',
        amount_gross: '550.00',
      };
      const paramString = Object.entries(baseFields)
        .map(([k, v]) => `${k}=${phpUrlencode(v)}`)
        .join('&');
      const sig = md5(`${paramString}&passphrase=${phpUrlencode(passphrase)}`);
      const body = { ...baseFields, signature: sig };

      // Verify roundtrips
      expect(service.verifyItnSignature(body, passphrase)).toBe(true);
      // Postback body equals the signature input string
      expect(service.buildPostbackBody(body)).toBe(paramString);
    });
  });
});
