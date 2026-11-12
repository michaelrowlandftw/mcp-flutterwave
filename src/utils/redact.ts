/**
 * Redaction for everything the server returns or logs: tool results, error
 * messages and console output. It removes Flutterwave keys, bearer tokens,
 * JWTs, the values of secret fields (CVV, PIN, card number, passwords,
 * secrets) and card numbers that pass the Luhn check (last 4 digits kept).
 */

const MASK = '[REDACTED]';

/** Environment variables whose exact values must never appear in output. */
const SECRET_ENV = ['FLW_SECRET_KEY', 'FLW_CLIENT_SECRET', 'FLW_ENCRYPTION_KEY', 'FLW_ENCRYPTION_KEY_V4', 'FLW_SECRET_HASH', 'FLW_LIVE_KEY', 'FLW_PROD_SECRET'];

/** Field names whose values are always secret, in JSON or key=value text. */
const SECRET_FIELDS = [
  'cvv', 'cvv2', 'cvc', 'pin', 'otp', 'card_number', 'cardnumber', 'pan', 'expiry_month', 'expiry_year',
  'password', 'secret', 'secret_key', 'secret_hash', 'client_secret', 'access_token', 'refresh_token',
  'encryption_key', 'authorization', 'encrypted_card_number', 'encrypted_cvv', 'encrypted_expiry_month',
  'encrypted_expiry_year', 'nonce', 'client',
];
const FIELD_RE = new RegExp(
  `("(?:${SECRET_FIELDS.join('|')})"\\s*:\\s*)("(?:[^"\\\\]|\\\\.)*"|-?\\d+(?:\\.\\d+)?)`,
  'gi',
);

const PATTERNS: Array<[RegExp, string]> = [
  [/FLW(?:SECK|PUBK)(?:_TEST)?-[A-Za-z0-9]+(?:-X)?/g, MASK], // Flutterwave keys
  [/FLWSECK_TEST[A-Za-z0-9]{6,}/g, MASK], // encryption keys
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi, `$1 ${MASK}`],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, MASK], // JWTs
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Mask 13 to 19 digit card numbers (spaces or dashes allowed) that pass Luhn. */
function maskCards(text: string): string {
  return text.replace(/(?<![\d.])(?:\d[ -]?){12,18}\d(?![\d.])/g, (match) => {
    const digits = match.replace(/[ -]/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? `[CARD ****${digits.slice(-4)}]` : match;
  });
}

export function redactText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  for (const name of SECRET_ENV) {
    const value = env[name];
    if (value && value.length >= 8) out = out.split(value).join(MASK);
  }
  out = out.replace(FIELD_RE, `$1"${MASK}"`);
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return maskCards(out);
}

/** Redact a tool result in place: every text item is cleaned. */
export function redactResult<T>(result: T): T {
  const content = (result as { content?: Array<{ type?: string; text?: unknown }> } | null)?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item && item.type === 'text' && typeof item.text === 'string') item.text = redactText(item.text);
    }
  }
  return result;
}

/** Route console output through the redactor. Call once at start-up. */
export function installLogRedaction(target: Console = console): void {
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = target[level].bind(target);
    target[level] = (...args: unknown[]) =>
      original(
        ...args.map((arg) => {
          if (typeof arg === 'string') return redactText(arg);
          if (arg instanceof Error) return redactText(arg.stack ?? arg.message);
          try {
            return redactText(JSON.stringify(arg));
          } catch {
            return '[unprintable]';
          }
        }),
      );
  }
}
