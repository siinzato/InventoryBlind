// Predicados puros usados só para feedback imediato na interface (habilitar/
// desabilitar botões). A autoridade das regras é sempre a RPC correspondente
// (migration 087) — estas funções espelham a mesma lógica, nunca a substituem.

import type { FiscalEntity } from './fiscalEntityTypes';

/** Espelha o bloqueio de fiscal_entities_archive: uma empresa padrão não
 *  pode ser arquivada (e, por construção, a única empresa ativa é sempre a
 *  padrão, então isso também cobre esse caso). */
export function canArchiveFiscalEntity(entity: Pick<FiscalEntity, 'status' | 'isDefault'>): boolean {
  return entity.status === 'active' && !entity.isDefault;
}

/** Espelha fiscal_entities_create: a primeira empresa ativa do workspace
 *  sempre vira a padrão automaticamente. */
export function shouldAutoDefaultOnCreate(activeCount: number): boolean {
  return activeCount === 0;
}

/** Espelha fiscal_entities_restore: se, após restaurar, não sobrar nenhuma
 *  outra empresa ativa, a restaurada vira a padrão automaticamente. */
export function shouldAutoDefaultOnRestore(otherActiveCount: number): boolean {
  return otherActiveCount === 0;
}
