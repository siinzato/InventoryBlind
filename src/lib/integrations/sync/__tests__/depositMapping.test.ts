import { describe, expect, it } from 'vitest';
import {
  depositIsCountable,
  depositKey,
  describeDepositConfigError,
  describeFullWithdrawalFailure,
  findDeposit,
  fulfillmentDeposits,
  generalDeposit,
  isDepositConfigUsable,
  resolveFullWithdrawal,
  suggestDepositRole,
  unmappedDeposits,
  validateDepositConfig,
  type DepositConfig,
} from '../depositMapping';

/** The customer's real deposit list, spelling included. Used as the fixture on
 *  purpose: "FULLFILMENT" with two Ls is how their ERP spells it, and any code
 *  that only works for the dictionary spelling is broken for this account. */
const AZ_CONFIG: DepositConfig = {
  deposits: [
    { externalName: 'GERAL', role: 'general' },
    { externalName: 'AZ ML FULLFILMENT', role: 'fulfillment', channel: 'Mercado Livre' },
    { externalName: 'AZ SHOPEE FULLFILMENT', role: 'fulfillment', channel: 'Shopee' },
    { externalName: 'AZ FILIAL 02 FULLFILMENT', role: 'fulfillment', channel: 'Filial 02' },
    { externalName: 'AZ FBA ONSITE', role: 'fulfillment', channel: 'Amazon FBA Onsite' },
    { externalName: 'GOCASE ML FULLFILMENT', role: 'fulfillment', channel: 'Mercado Livre' },
    { externalName: 'GOCASE SHEIN FULLFILMENT', role: 'fulfillment', channel: 'Shein' },
    { externalName: 'GOCASE SHOPEE FULLFILMENT', role: 'fulfillment', channel: 'Shopee' },
    { externalName: 'GOCASE TIKTOK LOCAL', role: 'fulfillment', channel: 'TikTok' },
  ],
};

describe('depositKey', () => {
  it('ignores case and surrounding whitespace', () => {
    expect(depositKey('  GERAL ')).toBe('geral');
    expect(depositKey('AZ ML FULLFILMENT')).toBe(depositKey('az ml fullfilment'));
  });

  it('collapses internal whitespace runs but keeps the words', () => {
    expect(depositKey('AZ  ML   FULLFILMENT')).toBe('az ml fullfilment');
  });

  it('keeps different spellings distinct', () => {
    // In the ERP these are two different deposits, and treating them as one would
    // move stock into whichever matched first.
    expect(depositKey('AZ ML FULLFILMENT')).not.toBe(depositKey('AZ ML FULFILLMENT'));
  });
});

describe('validateDepositConfig', () => {
  it('accepts the customer configuration', () => {
    expect(validateDepositConfig(AZ_CONFIG)).toEqual([]);
    expect(isDepositConfigUsable(AZ_CONFIG)).toBe(true);
  });

  it('refuses a configuration with no general deposit', () => {
    // A Full withdrawal would have nowhere to go.
    const config: DepositConfig = { deposits: [{ externalName: 'AZ ML FULLFILMENT', role: 'fulfillment' }] };
    expect(validateDepositConfig(config)).toEqual([{ code: 'missing_general' }]);
  });

  it('refuses two general deposits, because the destination would be ambiguous', () => {
    const config: DepositConfig = {
      deposits: [
        { externalName: 'GERAL', role: 'general' },
        { externalName: 'MATRIZ', role: 'general' },
      ],
    };
    expect(validateDepositConfig(config)).toEqual([
      { code: 'multiple_general', names: ['GERAL', 'MATRIZ'] },
    ]);
  });

  it('catches the same deposit listed twice, even spelled differently in case', () => {
    const config: DepositConfig = {
      deposits: [
        { externalName: 'GERAL', role: 'general' },
        { externalName: ' geral ', role: 'fulfillment' },
      ],
    };
    expect(validateDepositConfig(config)).toContainEqual({ code: 'duplicate_deposit', name: ' geral ' });
  });

  it('reports every problem at once, not just the first', () => {
    const config: DepositConfig = {
      deposits: [
        { externalName: '', role: 'fulfillment' },
        { externalName: 'X', role: 'fulfillment' },
      ],
    };
    const errors = validateDepositConfig(config);
    expect(errors).toContainEqual({ code: 'missing_general' });
    expect(errors).toContainEqual({ code: 'empty_name' });
  });
});

describe('findDeposit', () => {
  it('finds a deposit regardless of case', () => {
    expect(findDeposit(AZ_CONFIG, 'az fba onsite')?.channel).toBe('Amazon FBA Onsite');
  });

  it('returns null for an unmapped deposit instead of inventing a role', () => {
    // A new deposit in the ERP is a real event. Assuming it is general and writing
    // into it is the failure this prevents.
    expect(findDeposit(AZ_CONFIG, 'AZ NOVO CD')).toBeNull();
    expect(findDeposit(AZ_CONFIG, null)).toBeNull();
  });
});

describe('countability', () => {
  it('counts everything the company owns, including channel stock', () => {
    // Excluding fulfilment stock would understate the total and make a count look
    // like a huge shortfall.
    for (const deposit of AZ_CONFIG.deposits) {
      expect(depositIsCountable(deposit), deposit.externalName).toBe(true);
    }
  });

  it('excludes an ignored deposit', () => {
    expect(depositIsCountable({ externalName: 'AVARIA', role: 'ignored' })).toBe(false);
  });

  it('lets an explicit override win over the role default', () => {
    expect(depositIsCountable({ externalName: 'X', role: 'fulfillment', countable: false })).toBe(false);
    expect(depositIsCountable({ externalName: 'X', role: 'ignored', countable: true })).toBe(true);
  });
});

describe('unmappedDeposits', () => {
  it('surfaces deposits the ERP reported that nobody classified', () => {
    const unknown = unmappedDeposits(AZ_CONFIG, ['GERAL', 'AZ ML FULLFILMENT', 'AZ CD NOVO', 'OUTRO']);
    expect(unknown).toEqual(['AZ CD NOVO', 'OUTRO']);
  });

  it('ignores blanks and deduplicates', () => {
    expect(unmappedDeposits(AZ_CONFIG, [null, '', '  ', 'NOVO', 'novo'])).toEqual(['NOVO']);
  });

  it('returns nothing when everything is mapped', () => {
    expect(unmappedDeposits(AZ_CONFIG, AZ_CONFIG.deposits.map(d => d.externalName))).toEqual([]);
  });
});

describe('resolveFullWithdrawal', () => {
  it('routes a Full withdrawal from the channel deposit to the general one', () => {
    expect(resolveFullWithdrawal(AZ_CONFIG, 'AZ ML FULLFILMENT')).toEqual({
      ok: true, fromDeposit: 'AZ ML FULLFILMENT', toDeposit: 'GERAL',
    });
  });

  it('works for every fulfilment deposit in the account', () => {
    for (const deposit of fulfillmentDeposits(AZ_CONFIG)) {
      const target = resolveFullWithdrawal(AZ_CONFIG, deposit.externalName);
      expect(target.ok, deposit.externalName).toBe(true);
      if (target.ok) expect(target.toDeposit).toBe('GERAL');
    }
  });

  it('refuses an unmapped source, which needs classifying not guessing', () => {
    const target = resolveFullWithdrawal(AZ_CONFIG, 'AZ CD NOVO');
    expect(target).toEqual({ ok: false, reason: 'unknown_source', name: 'AZ CD NOVO' });
  });

  it('refuses the general deposit as a source', () => {
    // It is the destination of a Full withdrawal, not the origin.
    const target = resolveFullWithdrawal(AZ_CONFIG, 'GERAL');
    expect(target).toMatchObject({ ok: false, reason: 'source_is_general' });
  });

  it('refuses a source that is not a fulfilment deposit', () => {
    const config: DepositConfig = {
      deposits: [
        { externalName: 'GERAL', role: 'general' },
        { externalName: 'AVARIA', role: 'quarantine' },
      ],
    };
    expect(resolveFullWithdrawal(config, 'AVARIA')).toMatchObject({
      ok: false, reason: 'source_not_fulfillment', role: 'quarantine',
    });
  });

  it('separates "unknown deposit" from "wrong kind of deposit"', () => {
    // Different fixes; collapsing them sends an operator looking in the wrong place.
    const unknown = resolveFullWithdrawal(AZ_CONFIG, 'INEXISTENTE');
    const wrongKind = resolveFullWithdrawal(
      { deposits: [{ externalName: 'GERAL', role: 'general' }, { externalName: 'T', role: 'transit' }] },
      'T'
    );
    expect(unknown).toMatchObject({ reason: 'unknown_source' });
    expect(wrongKind).toMatchObject({ reason: 'source_not_fulfillment' });
  });

  it('refuses when there is no general deposit configured', () => {
    const config: DepositConfig = { deposits: [{ externalName: 'ML FULL', role: 'fulfillment' }] };
    expect(resolveFullWithdrawal(config, 'ML FULL')).toEqual({ ok: false, reason: 'no_general_deposit' });
  });
});

describe('generalDeposit and fulfillmentDeposits', () => {
  it('identifies the general deposit and the eight channel deposits', () => {
    expect(generalDeposit(AZ_CONFIG)?.externalName).toBe('GERAL');
    expect(fulfillmentDeposits(AZ_CONFIG)).toHaveLength(8);
  });
});

describe('suggestDepositRole', () => {
  it('pre-fills the customer names correctly, including their spelling', () => {
    expect(suggestDepositRole('GERAL')).toBe('general');
    expect(suggestDepositRole('AZ ML FULLFILMENT')).toBe('fulfillment');
    expect(suggestDepositRole('GOCASE SHEIN FULLFILMENT')).toBe('fulfillment');
    expect(suggestDepositRole('AZ FBA ONSITE')).toBe('fulfillment');
  });

  it('handles the dictionary spellings too', () => {
    expect(suggestDepositRole('CD FULFILLMENT')).toBe('fulfillment');
    expect(suggestDepositRole('ML Fulfilment')).toBe('fulfillment');
  });

  it('recognises other common general-deposit names', () => {
    expect(suggestDepositRole('MATRIZ')).toBe('general');
    expect(suggestDepositRole('Depósito Principal')).toBe('general');
  });

  it('recognises transit and quarantine', () => {
    expect(suggestDepositRole('EM TRANSITO')).toBe('transit');
    expect(suggestDepositRole('AVARIA')).toBe('quarantine');
    expect(suggestDepositRole('QUARENTENA')).toBe('quarantine');
  });

  it('is only a pre-fill, so a wrong guess is harmless', () => {
    // TIKTOK LOCAL has no fulfilment keyword, so the fallback applies. The operator
    // confirms every row, and nothing in the sync path calls this function.
    expect(suggestDepositRole('GOCASE TIKTOK LOCAL')).toBe('fulfillment');
    expect(suggestDepositRole('XPTO')).toBe('fulfillment');
  });
});

describe('operator messages', () => {
  it('explains every configuration error', () => {
    expect(describeDepositConfigError({ code: 'missing_general' })).toContain('Geral');
    expect(describeDepositConfigError({ code: 'multiple_general', names: ['A', 'B'] })).toContain('A, B');
    expect(describeDepositConfigError({ code: 'duplicate_deposit', name: 'X' })).toContain('X');
    expect(describeDepositConfigError({ code: 'empty_name' }).length).toBeGreaterThan(10);
  });

  it('explains every withdrawal failure', () => {
    expect(describeFullWithdrawalFailure({ reason: 'unknown_source', name: 'X', ok: false }))
      .toContain('não está mapeado');
    expect(describeFullWithdrawalFailure({ reason: 'source_is_general', name: 'GERAL', ok: false }))
      .toContain('destino');
    expect(describeFullWithdrawalFailure({ reason: 'no_general_deposit', ok: false }))
      .toContain('Geral');
    expect(
      describeFullWithdrawalFailure({ reason: 'source_not_fulfillment', name: 'T', role: 'transit', ok: false })
    ).toContain('transit');
  });
});
