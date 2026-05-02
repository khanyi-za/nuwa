/**
 * Canonical field ordering for PayFast form-flow signature generation.
 *
 * Source: PayFast PHP SDK, lib/Auth.php → generateSignature() $fields array.
 * Reference: https://github.com/Payfast/payfast-php-sdk/blob/master/lib/Auth.php
 *
 * The signature MD5 is computed over `key=urlencode(trim(value))&...` joined
 * in this exact order, with empty values skipped. PayFast's server iterates
 * the same way to verify, so the order MUST match.
 *
 * `passphrase` lives at position 30 (between `subscription_type` and
 * `billing_date`). For one-off (non-subscription) payments, all subscription
 * fields are empty and skipped, so the passphrase ends up effectively last
 * in the rendered param string.
 *
 * `notify_method` is rarely used (default POST); we typically omit it.
 *
 * DO NOT add or reorder entries without updating signature tests. PayFast may
 * extend this list in the future; new fields would need to be added at the
 * exact position PayFast uses or signatures will mismatch.
 */
export const FORM_FIELD_ORDER: readonly string[] = Object.freeze([
  'merchant_id',
  'merchant_key',
  'return_url',
  'cancel_url',
  'notify_url',
  'notify_method',
  'name_first',
  'name_last',
  'email_address',
  'cell_number',
  'm_payment_id',
  'amount',
  'item_name',
  'item_description',
  'custom_int1',
  'custom_int2',
  'custom_int3',
  'custom_int4',
  'custom_int5',
  'custom_str1',
  'custom_str2',
  'custom_str3',
  'custom_str4',
  'custom_str5',
  'email_confirmation',
  'confirmation_address',
  'currency',
  'payment_method',
  'subscription_type',
  'passphrase',
  'billing_date',
  'recurring_amount',
  'frequency',
  'cycles',
  'subscription_notify_email',
  'subscription_notify_webhook',
  'subscription_notify_buyer',
]);
