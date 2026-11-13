/**
 * Redaction for everything the server returns or logs: tool results (text and
 * resource items), error messages and console output. It removes Flutterwave
 * keys, bearer tokens, JWTs, exact and base64 copies of secret env values, the
 * values of secret fields (in JSON, escaped JSON inside strings, and key=value or
 * key: value text) and card numbers (a known card brand prefix and length, plus
 * the Luhn check; last 4 digits kept).
 */

const MASK = '[REDACTED]';

/** Environment variables whose values must never appear in output. */
const SECRET_ENV = ['FLW_SECRET_KEY', 'FLW_CLIENT_SECRET', 'FLW_ENCRYPTION_KEY', 'FLW_ENCRYPTION_KEY_V4', 'FLW_SECRET_HASH', 'FLW_LIVE_KEY', 'FLW_PROD_SECRET'];

/** Field names whose values are always secret. */
const SECRET_FIELDS = [
  'cvv', 'cvv2', 'cvc', 'pin', 'otp', 'card_number', 'cardnumber', 'pan', 'expiry_month', 'expiry_year',
  'password', 'secret', 'secret_key', 'secret_hash', 'client_secret', 'access_token', 'refresh_token',
  'encryption_key', 'authorization', 'encrypted_card_number', 'encrypted_cvv', 'encrypted_expiry_month',
  'encrypted_expiry_year', 'encrypted_pin',
];
const FIELDS = SECRET_FIELDS.join('|');

/**
 * JSON fields, also when the JSON sits escaped inside a string (\"pin\":\"3310\").
 * Group 2 is the quote prefix of the key (none or backslashes), group 3 of the value.
 */
const FIELD_RE = new RegExp(
  `((\\\\*)"(?:${FIELDS})\\2"\\s*:\\s*)(?:(\\\\*)"(?:(?!\\3").)*?\\3"|-?\\d+(?:\\.\\d+)?)`,
  'gis',
);

/** key=value and key: value text, with or without quotes around the value. */
const KV_RE = new RegExp(`\\b(${FIELDS})(\\s*[:=]\\s*)(['"]?)([^\\s'",;&}]+)\\3`, 'gi');

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

/**
 * A card number by brand prefix and length. This keeps phone numbers (234...,
 * 13 digits) and millisecond timestamps (1...) from being masked.
 */
function looksLikeCard(d: string): boolean {
  const n = d.length;
  const p2 = Number(d.slice(0, 2));
  const p4 = Number(d.slice(0, 4));
  const p6 = Number(d.slice(0, 6));
  if (d[0] === '4') return n === 13 || n === 16 || n === 19; // Visa
  if ((p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720)) return n === 16; // Mastercard
  if (p2 === 34 || p2 === 37) return n === 15; // Amex
  if ((p6 >= 506099 && p6 <= 506198) || (p6 >= 650002 && p6 <= 650027)) return n >= 16 && n <= 19; // Verve
  if (d.startsWith('6011') || p2 === 65 || (p6 >= 622126 && p6 <= 622925)) return n >= 16 && n <= 19; // Discover/UnionPay
  if (p4 >= 5018 && p4 <= 6999) return n >= 16 && n <= 19; // Maestro and other 5/6 ranges
  if (p4 >= 3528 && p4 <= 3589) return n >= 16 && n <= 19; // JCB
  if ((p2 === 36 || p2 === 38 || p2 === 39) || (Number(d.slice(0, 3)) >= 300 && Number(d.slice(0, 3)) <= 305)) {
    return n >= 14 && n <= 19; // Diners Club
  }
  return false;
}

function maskCards(text: string): string {
  return text.replace(/(?<!\d|\d\.)(?:\d[ -]?){12,18}\d(?!\d|\.\d)/g, (match) => {
    const digits = match.replace(/[ -]/g, '');
    return looksLikeCard(digits) && luhn(digits) ? `[CARD ****${digits.slice(-4)}]` : match;
  });
}

/**
 * Base64 or hex runs that decode to text containing a secret (for example a
 * Basic auth header "user:secret") are masked whole (review N4).
 */
function maskEncodedSecrets(text: string, secrets: string[]): string {
  if (secrets.length === 0) return text;
  const holds = (decoded: string) => secrets.some((secret) => decoded.includes(secret));
  return text
    .replace(/[A-Za-z0-9+/_-]{16,}={0,2}/g, (run) => {
      // Other base64-like characters can sit in front of the encoded secret
      // ("Basic x...", "id_..."), so try every 4-character alignment.
      for (let offset = 0; offset < 4; offset++) {
        try {
          if (holds(Buffer.from(run.slice(offset), 'base64').toString('utf8'))) return MASK;
        } catch {
          /* not base64 at this offset */
        }
      }
      return run;
    })
    .replace(/\b(?:[0-9a-fA-F]{2}){8,}\b/g, (run) => (holds(Buffer.from(run, 'hex').toString('utf8')) ? MASK : run));
}

export function redactText(text: string, env: NodeJS.ProcessEnv = process.env): string {
  let out = text;
  const secrets = SECRET_ENV.map((name) => env[name]).filter((v): v is string => !!v && v.length >= 8);
  for (const value of secrets) {
    for (const form of [value, Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')]) {
      out = out.split(form).join(MASK);
    }
  }
  out = maskEncodedSecrets(out, secrets);
  out = out.replace(FIELD_RE, (_m, key: string, keyQuote: string, valueQuote?: string) => {
    const q = valueQuote ?? keyQuote;
    return `${key}${q}"${MASK}${q}"`;
  });
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  out = out.replace(KV_RE, (_m, key: string, sep: string, quote: string) => `${key}${sep}${quote}${MASK}${quote}`);
  return maskCards(out);
}

/** Redact a tool result in place: every text item and every resource text is cleaned. */
export function redactResult<T>(result: T): T {
  const content = (result as { content?: Array<{ type?: string; text?: unknown; resource?: { text?: unknown } }> } | null)?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item) continue;
      if (item.type === 'text' && typeof item.text === 'string') item.text = redactText(item.text);
      if (item.type === 'resource' && item.resource && typeof item.resource.text === 'string') {
        item.resource.text = redactText(item.resource.text);
      }
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
