// Aviso de possível duplicidade de número de OC — nunca um bloqueio, nunca uma
// sobrescrita automática. A decisão final é sempre do operador.

export interface ExistingPoRef {
  id: string;
  poNumber: string;
  supplierName: string;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Devolve as OCs existentes (mesma empresa) com o mesmo número + fornecedor, para
 *  a tela avisar antes de salvar. Nunca impede o salvamento — só informa. */
export function findPossibleDuplicatePos(
  existing: ExistingPoRef[],
  poNumber: string,
  supplierName: string,
  excludeId?: string
): ExistingPoRef[] {
  const targetNumber = normalize(poNumber);
  const targetSupplier = normalize(supplierName);
  if (!targetNumber || !targetSupplier) return [];

  return existing.filter(po =>
    po.id !== excludeId &&
    normalize(po.poNumber) === targetNumber &&
    normalize(po.supplierName) === targetSupplier
  );
}
