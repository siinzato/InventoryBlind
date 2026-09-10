// Agregados de peso, altura, área e volume (spec §5) — funções puras,
// unitárias, cada uma fazendo uma única conta para ficar fácil de testar e
// de citar num relatório ("de onde veio esse número").

export function computePalletWeights(boxWeightKg: number, boxesOnPallet: number, tareKg: number) {
  const netKg = boxWeightKg * boxesOnPallet;
  return { netKg, tareKg, grossKg: netKg + tareKg };
}

export function computeHeights(palletHeightMm: number, boxHeightMm: number, layers: number) {
  const cargoHeightMm = boxHeightMm * layers;
  return { cargoHeightMm, totalHeightMm: palletHeightMm + cargoHeightMm };
}

export function computeCargoVolumeM3(boxLengthMm: number, boxWidthMm: number, boxHeightMm: number, boxesOnPallet: number): number {
  const boxVolumeM3 = (boxLengthMm / 1000) * (boxWidthMm / 1000) * (boxHeightMm / 1000);
  return boxVolumeM3 * boxesOnPallet;
}

/** Volume EXTERNO do palete paletizado (a "caixa" que o transporte enxerga) —
 *  base do palete × altura total (palete + carga), não a soma dos volumes
 *  individuais das caixas (isso seria só espaço ocupado, não volume externo
 *  para fins de frete/estiva). */
export function computeExternalVolumeM3(palletLengthMm: number, palletWidthMm: number, totalHeightMm: number): number {
  return (palletLengthMm / 1000) * (palletWidthMm / 1000) * (totalHeightMm / 1000);
}
