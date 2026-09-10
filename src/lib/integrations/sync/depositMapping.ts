// Sync Engine — deposit mapping.
//
// Which deposit is the general one, which are fulfilment deposits, and which are
// excluded from the count. All of it is CONFIGURATION per connection, never a
// constant in this file.
//
// That is not a style preference. Deposit names are the customer's own words: one
// account has "AZ ML FULLFILMENT" (with that spelling), another will have "CD
// Mercado Livre", a third "ML-FULL". Any name matched by a hardcoded pattern would
// work for exactly one customer and fail silently for everyone else — and failing
// silently here means a Full withdrawal transferring stock into the wrong deposit.
//
// So the engine knows deposit ROLES and the customer supplies the NAMES.
//
// Pure module: no I/O. Lives in configuration on integration_connections.

/** What a deposit is for, from the engine's point of view. */
export type DepositRole =
  /** The main deposit. Destination of Full withdrawals, and the default target for
   *  a write that does not name a deposit. Exactly one per connection. */
  | 'general'
  /** Stock allocated to a sales channel — a marketplace fulfilment centre, or
   *  channel-reserved stock sitting in the seller's own warehouse. */
  | 'fulfillment'
  /** In transit between deposits. Counted as owned but not sellable. */
  | 'transit'
  /** Held back: damaged, under inspection, reserved. Owned, not sellable. */
  | 'quarantine'
  /** Excluded from every total. Mirrors Tiny's own `desconsiderar` flag. */
  | 'ignored';

export interface DepositMapping {
  /** The deposit name exactly as the ERP spells it. Matched case-insensitively
   *  and trimmed, but never guessed at or normalised beyond that. */
  externalName: string;
  role: DepositRole;
  /** Free-form channel label for a fulfilment deposit ("Mercado Livre", "Shopee",
   *  "TikTok"). Display and reporting only — the engine never branches on it,
   *  because a channel name is not a behaviour. */
  channel?: string | null;
  /** Whether this deposit's balance participates in the total InventoryBlind
   *  compares against. Defaults are set by role in `depositIsCountable`; this
   *  overrides them when a customer's reality differs. */
  countable?: boolean;
}

export interface DepositConfig {
  deposits: DepositMapping[];
}

export const EMPTY_DEPOSIT_CONFIG: DepositConfig = { deposits: [] };

/** Case-insensitive, whitespace-tolerant key for one deposit name.
 *
 *  Only case and surrounding whitespace are ignored. Internal spacing and spelling
 *  are preserved exactly: "AZ ML FULLFILMENT" and "AZ ML FULFILLMENT" are
 *  different deposits, because in the ERP they are, and treating them as the same
 *  would move stock into whichever one happened to match first. */
export function depositKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Does this deposit's balance count toward the total?
 *
 *  Defaults by role: everything the company owns counts except `ignored`.
 *  Fulfilment stock counts because the company still owns it — excluding it would
 *  understate the total and make a count look like a huge shortfall. */
export function depositIsCountable(mapping: DepositMapping): boolean {
  if (mapping.countable !== undefined) return mapping.countable;
  return mapping.role !== 'ignored';
}

export type DepositConfigError =
  /** No general deposit: a Full withdrawal has nowhere to go. */
  | { code: 'missing_general' }
  /** More than one: the destination would be ambiguous, and picking one silently
   *  is how stock lands in the wrong place. */
  | { code: 'multiple_general'; names: string[] }
  | { code: 'duplicate_deposit'; name: string }
  | { code: 'empty_name' };

/** Validate before any sync runs.
 *
 *  Returns every problem rather than the first, so an operator fixes the
 *  configuration once instead of discovering the next error on the next attempt. */
export function validateDepositConfig(config: DepositConfig): DepositConfigError[] {
  const errors: DepositConfigError[] = [];

  const generals = config.deposits.filter(deposit => deposit.role === 'general');
  if (generals.length === 0) errors.push({ code: 'missing_general' });
  if (generals.length > 1) {
    errors.push({ code: 'multiple_general', names: generals.map(deposit => deposit.externalName) });
  }

  const seen = new Set<string>();
  for (const deposit of config.deposits) {
    if (deposit.externalName.trim().length === 0) {
      errors.push({ code: 'empty_name' });
      continue;
    }
    const key = depositKey(deposit.externalName);
    if (seen.has(key)) errors.push({ code: 'duplicate_deposit', name: deposit.externalName });
    seen.add(key);
  }

  return errors;
}

export function isDepositConfigUsable(config: DepositConfig): boolean {
  return validateDepositConfig(config).length === 0;
}

/** Look up a deposit by the name the ERP reported.
 *
 *  Returns null for an unmapped deposit rather than inventing a role. An unmapped
 *  deposit appearing in a stock read is a real event — the customer created one in
 *  the ERP and has not classified it here yet — and the honest response is to
 *  surface it, not to assume it is general and start writing into it. */
export function findDeposit(config: DepositConfig, externalName: string | null | undefined): DepositMapping | null {
  if (externalName == null) return null;
  const key = depositKey(externalName);
  return config.deposits.find(deposit => depositKey(deposit.externalName) === key) ?? null;
}

export function generalDeposit(config: DepositConfig): DepositMapping | null {
  return config.deposits.find(deposit => deposit.role === 'general') ?? null;
}

export function fulfillmentDeposits(config: DepositConfig): DepositMapping[] {
  return config.deposits.filter(deposit => deposit.role === 'fulfillment');
}

/** Deposits the ERP reported that the configuration does not know about.
 *
 *  Fed to the connection screen so a new deposit gets classified deliberately.
 *  Until then it is excluded from totals — counting an unclassified deposit could
 *  either overstate (if it holds channel stock already counted elsewhere) or be
 *  perfectly fine, and there is no way to tell without being told. */
export function unmappedDeposits(config: DepositConfig, reportedNames: (string | null)[]): string[] {
  const known = new Set(config.deposits.map(deposit => depositKey(deposit.externalName)));
  // Keyed by the normalised name so "NOVO" and "novo" resolve to one deposit, but
  // the value keeps the first spelling seen — the operator should be shown the name
  // as their ERP writes it, not a lowercased version of it.
  const unknown = new Map<string, string>();

  for (const name of reportedNames) {
    if (name == null || name.trim().length === 0) continue;
    const key = depositKey(name);
    if (known.has(key) || unknown.has(key)) continue;
    unknown.set(key, name.trim());
  }

  return Array.from(unknown.values()).sort();
}

export type FullWithdrawalTarget =
  | { ok: true; fromDeposit: string; toDeposit: string }
  | { ok: false; reason: 'unknown_source'; name: string }
  | { ok: false; reason: 'source_not_fulfillment'; name: string; role: DepositRole }
  | { ok: false; reason: 'no_general_deposit' }
  | { ok: false; reason: 'source_is_general'; name: string };

/** Resolve where a Full withdrawal moves stock from and to.
 *
 *  Every failure is a configuration or mapping problem, and each is reported
 *  distinctly: "I do not know this deposit" and "this deposit is not a fulfilment
 *  one" need different fixes, and collapsing them would send an operator looking
 *  in the wrong place. */
export function resolveFullWithdrawal(
  config: DepositConfig,
  sourceName: string
): FullWithdrawalTarget {
  const source = findDeposit(config, sourceName);
  if (source == null) return { ok: false, reason: 'unknown_source', name: sourceName };

  if (source.role === 'general') {
    // Withdrawing from the general deposit into itself is not a Full withdrawal;
    // it is a mis-selected source.
    return { ok: false, reason: 'source_is_general', name: source.externalName };
  }

  if (source.role !== 'fulfillment') {
    return { ok: false, reason: 'source_not_fulfillment', name: source.externalName, role: source.role };
  }

  const general = generalDeposit(config);
  if (general == null) return { ok: false, reason: 'no_general_deposit' };

  return { ok: true, fromDeposit: source.externalName, toDeposit: general.externalName };
}

/** pt-BR text for the connection screen. */
export function describeDepositConfigError(error: DepositConfigError): string {
  switch (error.code) {
    case 'missing_general':
      return 'Nenhum depósito foi marcado como Geral. Retiradas de Full não têm destino sem ele.';
    case 'multiple_general':
      return `Mais de um depósito está marcado como Geral (${error.names.join(', ')}). Escolha apenas um, senão o destino das transferências fica ambíguo.`;
    case 'duplicate_deposit':
      return `O depósito "${error.name}" aparece mais de uma vez na configuração.`;
    case 'empty_name':
      return 'Há um depósito sem nome na configuração.';
  }
}

export function describeFullWithdrawalFailure(target: Extract<FullWithdrawalTarget, { ok: false }>): string {
  switch (target.reason) {
    case 'unknown_source':
      return `O depósito "${target.name}" não está mapeado nesta conexão. Classifique-o antes de movimentar estoque.`;
    case 'source_not_fulfillment':
      return `O depósito "${target.name}" está classificado como "${target.role}", não como Fulfillment. Retirada de Full só se aplica a depósitos de canal.`;
    case 'source_is_general':
      return `"${target.name}" é o depósito Geral — ele é o destino de uma retirada de Full, não a origem.`;
    case 'no_general_deposit':
      return 'Esta conexão não tem um depósito Geral definido, então não há para onde transferir.';
  }
}

/** Suggest a role from a deposit name, for the setup screen ONLY.
 *
 *  This is a pre-fill to save typing, never a decision. It is deliberately not
 *  used anywhere in the sync path: a heuristic that guesses "GERAL" correctly for
 *  this customer would guess wrong for one whose main deposit is called "MATRIZ",
 *  and a wrong guess applied silently moves stock into the wrong deposit. The
 *  operator confirms every row.
 *
 *  The patterns are intentionally broad and spelling-tolerant, because they only
 *  ever populate a dropdown a human then checks. */
export function suggestDepositRole(externalName: string): DepositRole {
  const name = depositKey(externalName);

  // Matches "fulfilment", "fulfillment", "fullfilment" and other spellings seen in
  // real accounts, plus the channel words that usually accompany them.
  if (/full?fil+ment|fulfil|\bfba\b|\bfull\b/.test(name)) return 'fulfillment';
  if (/geral|matriz|principal|main|central/.test(name)) return 'general';
  if (/transito|trânsito|transit/.test(name)) return 'transit';
  if (/avaria|quarentena|bloqueado|defeito|inspec/.test(name)) return 'quarantine';

  return 'fulfillment';
}
