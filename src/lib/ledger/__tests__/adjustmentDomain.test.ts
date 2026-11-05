import { describe, expect, it } from 'vitest';
import {
  BLOCK_MESSAGE, blockReason, buildIdempotencyKey, describeDraft, draftFromCount,
  type AdjustmentTarget,
} from '../adjustmentDomain';
import type { LedgerEntry } from '../ledgerDomain';

function contagem(over: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    key: 'contagem:item-1',
    source: 'contagem',
    effect: 'registrou',
    at: '2026-11-04T10:00:00Z',
    title: 'Contagem física',
    detail: 'o sistema marcava 50',
    quantity: 47,
    quantityLabel: 'contado',
    divergence: -3,
    actor: null,
    ...over,
  };
}

const ALVO: AdjustmentTarget = {
  connectionId: 'conn-1',
  connectionName: 'Tiny',
  externalProductId: 'ext-prod-9',
  externalWarehouseId: 'ext-dep-1',
};

describe('o ajuste que sai da contagem', () => {
  // O saldo anterior não está gravado no lançamento: ele é o contado menos a
  // diferença. Errar esse sinal mandaria ao ERP o oposto do que foi apurado.
  it('reconstrói o saldo que o sistema marcava', () => {
    expect(draftFromCount(contagem())).toMatchObject({
      previousQuantity: 50, countedQuantity: 47, deltaQuantity: -3,
    });
  });

  it('funciona igual quando sobrou em vez de faltar', () => {
    expect(draftFromCount(contagem({ quantity: 53, divergence: 3 }))).toMatchObject({
      previousQuantity: 50, countedQuantity: 53, deltaQuantity: 3,
    });
  });

  it('o inventário por SKU vale tanto quanto a contagem física', () => {
    const d = draftFromCount(contagem({ key: 'inventario:i-7', source: 'inventario' }));
    expect(d?.countedQuantity).toBe(47);
  });

  // Contagem antiga sem snapshot do sistema: inventar o saldo anterior mandaria um
  // número que ninguém observou.
  it('sem o número do sistema, não há ajuste', () => {
    expect(draftFromCount(contagem({ divergence: null }))).toBeNull();
    expect(draftFromCount(contagem({ quantity: null }))).toBeNull();
  });

  it('lançamento que não é contagem nunca vira ajuste', () => {
    expect(draftFromCount(contagem({ source: 'devolucao' }))).toBeNull();
    expect(draftFromCount(contagem({ source: 'sincronizacao' }))).toBeNull();
  });
});

describe('a trava contra enviar duas vezes', () => {
  // O duplicado mais caro do sistema é escrever o mesmo ajuste duas vezes no ERP de
  // um cliente. A chave sai do id da contagem, então ela é a mesma em toda tentativa.
  it('a mesma contagem produz sempre a mesma chave', () => {
    expect(draftFromCount(contagem())?.idempotencyKey)
      .toBe(draftFromCount(contagem())?.idempotencyKey);
  });

  it('contagens diferentes produzem chaves diferentes', () => {
    const a = draftFromCount(contagem({ key: 'contagem:item-1' }))?.idempotencyKey;
    const b = draftFromCount(contagem({ key: 'contagem:item-2' }))?.idempotencyKey;
    expect(a).not.toBe(b);
  });

  // A logística reversa usa 'return_item:<id>'. Um prefixo próprio garante que as
  // duas origens não possam colidir no UNIQUE e cancelar uma à outra.
  it('o prefixo separa destas as chaves de outras origens', () => {
    expect(buildIdempotencyKey('contagem:x')).toBe('ledger_count:contagem:x');
    expect(buildIdempotencyKey('contagem:x')).not.toMatch(/^return_item:/);
  });
});

describe('quando o botão não pode ser apertado', () => {
  it('com tudo no lugar, não há impedimento', () => {
    expect(blockReason(contagem(), ALVO, true)).toBeNull();
  });

  it('sem contagem divergente pendente, não há o que enviar', () => {
    expect(blockReason(null, ALVO, true)).toEqual({ code: 'sem_divergencia' });
    expect(blockReason(contagem({ divergence: 0 }), ALVO, true)).toEqual({ code: 'sem_divergencia' });
  });

  it('sem os dois números, o impedimento é específico', () => {
    expect(blockReason(contagem({ divergence: null }), ALVO, true))
      .toEqual({ code: 'numeros_incompletos' });
  });

  // A ordem é a da pergunta de quem usa: mostrar "vincule o produto" a quem nem
  // pode enviar manda resolver o problema errado.
  it('a permissão é verificada antes do estado da integração', () => {
    expect(blockReason(contagem(), null, false)).toEqual({ code: 'sem_permissao' });
  });

  it('distingue falta de conexão, de produto e de depósito', () => {
    expect(blockReason(contagem(), null, true)).toEqual({ code: 'sem_conexao' });
    expect(blockReason(contagem(), { ...ALVO, externalProductId: null }, true))
      .toEqual({ code: 'produto_sem_vinculo' });
    expect(blockReason(contagem(), { ...ALVO, externalWarehouseId: null }, true))
      .toEqual({ code: 'deposito_sem_vinculo' });
  });

  // Um código sem frase deixaria o botão desabilitado sem explicação na tela.
  it('todo impedimento tem uma frase', () => {
    const codigos = [
      'sem_divergencia', 'numeros_incompletos', 'sem_permissao',
      'sem_conexao', 'produto_sem_vinculo', 'deposito_sem_vinculo',
    ] as const;
    for (const c of codigos) expect(BLOCK_MESSAGE[c].length).toBeGreaterThan(10);
  });
});

describe('a frase gravada no ERP', () => {
  // É a mesma frase que vai para `reason` e que um auditor lê meses depois, então
  // precisa conter os dois números, não só a diferença.
  it('diz de quanto para quanto', () => {
    const d = draftFromCount(contagem())!;
    expect(describeDraft(d)).toContain('de 50 para 47');
  });
});
