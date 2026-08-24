// Alertas (spec §6) — nunca esconde uma violação física para "fechar" um
// resultado bonito. Cada checagem é independente; todas rodam sempre.

import type { AlertSeverity, BoxSpec, PalletAlert, PalletSpec } from './types';
import type { LayerLimitsResult } from './layerEngine';

const LOW_OCCUPATION_THRESHOLD_PCT = 70;
const LOW_LAST_PALLET_THRESHOLD_PCT = 50;
const CENTER_IMBALANCE_THRESHOLD_PCT = 15;

export interface AlertsInput {
  box: BoxSpec;
  pallet: PalletSpec;
  boxesPerLayer: number;
  layers: LayerLimitsResult;
  occupationPct: number;
  overhangUsedMm: number;
  netKg: number;
  totalHeightMm: number;
  lastPalletQty: number;
  capacityPerPallet: number;
  centerOffsetPct: number;
  requiresTipping?: boolean;
  actualSupportPct?: number;
}

function alert(code: string, severity: AlertSeverity, message: string): PalletAlert {
  return { code, severity, message };
}

export function computeAlerts(input: AlertsInput): PalletAlert[] {
  const alerts: PalletAlert[] = [];
  const { box, pallet } = input;

  if (box.lengthMm <= 0 || box.widthMm <= 0 || box.heightMm <= 0 || box.weightKg <= 0 || box.quantity <= 0) {
    alerts.push(alert('medidas-invalidas', 'error', 'Medidas ou peso da caixa inválidos (precisam ser maiores que zero).'));
  }
  if (pallet.lengthMm <= 0 || pallet.widthMm <= 0) {
    alerts.push(alert('palete-invalido', 'error', 'Dimensões do palete inválidas.'));
  }

  if (input.boxesPerLayer === 0) {
    alerts.push(alert('caixa-maior-que-palete', 'error', 'A caixa é maior que o palete em qualquer orientação permitida — nenhuma cabe.'));
  }

  if (input.netKg > pallet.maxLoadKg) {
    alerts.push(alert('peso-excedido', 'error', `Peso líquido (${input.netKg.toFixed(1)} kg) excede a capacidade máxima do palete (${pallet.maxLoadKg.toFixed(1)} kg).`));
  } else if (input.boxesPerLayer > 0 && input.layers.byWeight === 0) {
    // O motor já reduz camadas pra nunca ultrapassar o peso (por isso o
    // `netKg` acima nunca chega a exceder sozinho) — quando isso zera as
    // camadas, o problema é o mesmo (peso), só que descoberto antes.
    alerts.push(alert('peso-excedido', 'error', 'O limite de peso do palete não permite sequer uma camada completa desta caixa.'));
  }

  if (input.totalHeightMm > pallet.maxTotalHeightMm) {
    alerts.push(alert('altura-excedida', 'error', `Altura total (${input.totalHeightMm.toFixed(0)} mm) excede o máximo permitido (${pallet.maxTotalHeightMm.toFixed(0)} mm).`));
  }

  if (input.overhangUsedMm > 0) {
    alerts.push(alert('overhang-em-uso', 'warning', `Overhang de ${input.overhangUsedMm.toFixed(0)} mm em uso — confirme compatibilidade com o equipamento de movimentação.`));
  }

  if (!box.stackable) {
    alerts.push(alert('nao-empilhavel', 'warning', 'Produto marcado como não empilhável — limitado a 1 camada.'));
  }

  if (input.layers.limitingFactor === 'carga-sobre-caixa') {
    alerts.push(alert('carga-maxima-caixa', 'warning', 'Número de camadas limitado pela carga máxima suportada sobre a caixa.'));
  }

  if (box.maxLayers != null && input.layers.byOperational < input.layers.byHeight && input.layers.byOperational < input.layers.byWeight) {
    alerts.push(alert('camadas-excessivas', 'warning', `O cálculo físico permitiria mais camadas — limitado ao valor operacional configurado (${input.layers.byOperational}).`));
  }

  if (input.actualSupportPct != null && pallet.minSupportPct != null && input.actualSupportPct < pallet.minSupportPct) {
    alerts.push(alert('apoio-insuficiente', 'error', `Apoio entre camadas (${input.actualSupportPct.toFixed(0)}%) abaixo do mínimo configurado (${pallet.minSupportPct}%).`));
  }

  if (input.centerOffsetPct > CENTER_IMBALANCE_THRESHOLD_PCT) {
    alerts.push(alert('centro-desequilibrado', 'warning', `Centro da carga desviado ${input.centerOffsetPct.toFixed(0)}% do centro do palete — carga pode ficar desequilibrada.`));
  }

  if (input.occupationPct < LOW_OCCUPATION_THRESHOLD_PCT) {
    alerts.push(alert('ociosidade-alta', 'warning', `Ocupação da base é baixa (${input.occupationPct.toFixed(0)}%) — considere outro arranjo ou tamanho de caixa.`));
  }

  if (input.capacityPerPallet > 0) {
    const lastPalletPct = (input.lastPalletQty / input.capacityPerPallet) * 100;
    if (input.lastPalletQty < input.capacityPerPallet && lastPalletPct < LOW_LAST_PALLET_THRESHOLD_PCT) {
      alerts.push(alert('ultimo-palete-baixa-ocupacao', 'warning', `Último palete com baixa ocupação (${lastPalletPct.toFixed(0)}%, ${input.lastPalletQty} de ${input.capacityPerPallet} caixas).`));
    }
  }

  if (input.requiresTipping) {
    alerts.push(alert('tombamento', 'warning', 'O arranjo escolhido muda a orientação vertical da caixa (tombamento) — valide estabilidade física antes de usar.'));
  }

  return alerts;
}
