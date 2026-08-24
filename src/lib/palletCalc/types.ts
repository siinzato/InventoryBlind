// Tipos centrais da Calculadora de Paletização — sem dependência de nenhum
// outro módulo interno, pra todo o resto poder importar sem ciclo.

export type RotationPolicy = 'none' | 'base90' | 'any';

export interface BoxSpec {
  sku?: string;
  description?: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightKg: number;
  quantity: number;
  rotation: RotationPolicy;
  stackable: boolean;
  maxLayers?: number;
  /** Carga máxima que PODE ficar sobre uma unidade desta caixa (kg). */
  maxLoadOnBoxKg?: number;
}

export interface EdgeMm {
  front: number;
  back: number;
  left: number;
  right: number;
}

export function uniformEdgeMm(value: number): EdgeMm {
  return { front: value, back: value, left: value, right: value };
}

export interface PalletSpec {
  name: string;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  tareKg: number;
  maxLoadKg: number;
  maxTotalHeightMm: number;
  overhangMm: EdgeMm;
  /** Limite operacional de camadas (política do usuário), independente do
   *  limite físico calculado por altura/peso. */
  operationalMaxLayers?: number;
  /** Percentual mínimo de apoio (0-100) exigido entre uma caixa e as de
   *  baixo, só relevante para camadas alternadas. */
  minSupportPct?: number;
}

export type AlertSeverity = 'error' | 'warning';

export interface PalletAlert {
  code: string;
  severity: AlertSeverity;
  message: string;
}
