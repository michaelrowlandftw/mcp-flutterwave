import type { ApiVersion } from './apiVersion.js';
import { isReadOnlyTool, MONEY_MOVING } from './toolSafety.js';
import { envKeysChosenExplicitly, keySource } from './keychain.js';

/**
 * Live mode stays off until Security approves it. The conditions below are the
 * ones Security accepted on DX-RFC-001 (2026-11-17), with its additions; they are
 * all checked at start-up, so switching LIVE_MODE_APPROVED on is the only code
 * change left. Nothing else turns live mode on.
 */
export const LIVE_MODE_APPROVED = false;

export const LIVE_DISABLED =
  'Live mode is disabled until the security review approves it. Use test keys (v3) or the sandbox (v4).';

/**
 * Money-moving tools by category. With live keys each category needs its own
 * approval in FLW_LIVE_APPROVED_CATEGORIES (Security: "a separate approval for
 * each category of money-moving tool"), on top of the per-call confirmation.
 */
export const MONEY_CATEGORIES: Record<string, readonly string[]> = {
  collections: [
    'charge_tokenized_card', 'charge_bank_account', 'charge_mobile_money', 'charge_mpesa', 'charge_ussd',
    'validate_charge', 'create_charge', 'update_charge', 'create_order', 'update_order',
  ],
  payouts: ['create_transfer', 'update_transfer', 'retry_transfer', 'create_orchestrator_transfer', 'send_stablecoin'],
  refunds: ['create_refund'],
  disputes: ['create_chargeback', 'update_chargeback'],
  bills: ['pay_bill'],
  fx: ['initiate_fx_trade', 'convert_to_stablecoin'],
};

export function categoryOf(tool: string): string | undefined {
  return Object.entries(MONEY_CATEGORIES).find(([, tools]) => tools.includes(tool))?.[0];
}

export function approvedCategories(env: NodeJS.ProcessEnv = process.env): Set<string> {
  return new Set(
    (env.FLW_LIVE_APPROVED_CATEGORIES ?? '').split(',').map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
}

/** True when these credentials point at live money. */
export function credentialsAreLive(apiVersion: ApiVersion, env: NodeJS.ProcessEnv = process.env): boolean {
  if (apiVersion === 'v3') {
    const key = env.FLW_SECRET_KEY ?? '';
    return key !== '' && !key.startsWith('FLWSECK_TEST');
  }
  return env.FLW_ENVIRONMENT === 'production';
}

export type LiveRequest = {
  /** Tools named in --tools, trimmed. */
  tools: string[];
  /** --read-only as given on the command line: undefined when not given. */
  readOnlyFlag?: boolean;
};

/**
 * Every live-mode condition that is not met, as plain sentences. Empty means the
 * configuration would be acceptable for live mode once LIVE_MODE_APPROVED is on.
 */
export function liveConditionProblems(request: LiveRequest, env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  const tools = request.tools.filter((t) => t !== '');

  // Security addition: a per-tool allowlist, no --tools=all.
  if (tools.includes('all')) {
    problems.push('--tools=all is not allowed with live keys: list each tool.');
  }

  // Security: keys from the OS keychain by default.
  if (keySource(env) !== 'keychain' && !envKeysChosenExplicitly(env)) {
    problems.push('Live keys must come from the OS keychain: set FLW_KEY_SOURCE=keychain (see docs/security.md, "Key storage").');
  }

  // Security addition: read-only by default; writes need --read-only=false on the command line.
  const listed = tools.filter((t) => t !== 'all');
  const writes = listed.filter((t) => !isReadOnlyTool(t));
  const moneyTools = listed.filter((t) => MONEY_MOVING.has(t));
  if (writes.length > 0 && request.readOnlyFlag !== false) {
    problems.push('With live keys the server is read-only unless --read-only=false is passed on the command line.');
  }

  // Security addition: a separate approval for each category of money-moving tool.
  const approved = approvedCategories(env);
  const missing = new Set<string>();
  for (const tool of moneyTools) {
    const category = categoryOf(tool);
    if (!category || !approved.has(category)) missing.add(category ?? `uncategorised (${tool})`);
  }
  if (missing.size > 0) {
    problems.push(
      `These money-moving categories are not approved: ${[...missing].join(', ')}. Add them to FLW_LIVE_APPROVED_CATEGORIES (one approval per category).`,
    );
  }

  if (moneyTools.length > 0) {
    // Accepted condition: confirmation can't be switched off.
    if (env.FLW_CONFIRM === 'false') problems.push('FLW_CONFIRM=false is refused with live keys.');
    // Accepted condition: an amount cap for every currency used (FLW_MAX_AMOUNT alone is not enough;
    // a call in a currency without its own cap is refused per call, see capError).
    const perCurrency = Object.keys(env).filter((k) => /^FLW_MAX_AMOUNT_[A-Z]{3,5}$/.test(k) && !!env[k]);
    if (perCurrency.length === 0) {
      problems.push('Set an amount cap for every currency used: FLW_MAX_AMOUNT_<CURRENCY>, for example FLW_MAX_AMOUNT_NGN.');
    }
    // Accepted condition: elicitation required. Enforced per call (guardMoneyTool) and cannot be switched off.
    if (env.FLW_REQUIRE_ELICITATION === 'false') {
      problems.push('FLW_REQUIRE_ELICITATION=false is refused with live keys: money tools need a client that asks the person.');
    }
  }

  // Accepted condition: callback and redirect hosts are listed.
  if ((env.FLW_ALLOWED_URL_HOSTS ?? '').trim() === '') {
    problems.push('Set FLW_ALLOWED_URL_HOSTS to the callback and redirect hosts you use.');
  }

  // Accepted condition: shared stores for tokens and webhook replays when more than one
  // instance runs. This server is stdio only (one process per person), and with live
  // keys the token flow is off (elicitation only), so the in-memory stores hold. A
  // hosted, multi-instance server belongs to the hosted-OAuth RFC.

  return problems;
}

/**
 * Refuse live credentials. v3: the secret key must start with FLWSECK_TEST.
 * v4: FLW_ENVIRONMENT must not be "production". The message lists the live
 * conditions still unmet, so an approval can be checked against a real setup.
 */
export function assertTestCredentials(
  apiVersion: ApiVersion,
  env: NodeJS.ProcessEnv = process.env,
  request: LiveRequest = { tools: [] },
): void {
  if (!credentialsAreLive(apiVersion, env)) return;
  const problems = liveConditionProblems(request, env);
  const what =
    apiVersion === 'v3'
      ? 'FLW_SECRET_KEY is not a test key (test keys start with "FLWSECK_TEST").'
      : 'FLW_ENVIRONMENT=production points the server at live v4 APIs.';
  if (!LIVE_MODE_APPROVED) {
    const unmet = problems.length > 0 ? ` Live conditions not met yet: ${problems.join(' ')}` : ' All live conditions are met.';
    throw new Error(`${what} ${LIVE_DISABLED}${unmet}`);
  }
  if (problems.length > 0) {
    throw new Error(`${what} Live mode conditions not met: ${problems.join(' ')}`);
  }
}
