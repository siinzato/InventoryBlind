// Conversão física mm <-> pontos PDF (72pt = 1 polegada = 25,4mm).
export const PT_PER_MM = 72 / 25.4;

export function mmToPt(mm: number): number {
  return mm * PT_PER_MM;
}

export function ptToMm(pt: number): number {
  return pt / PT_PER_MM;
}
