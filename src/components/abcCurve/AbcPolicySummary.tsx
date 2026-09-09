// Curva ABC — leitura da política comercial que gerou as recomendações DESTA análise.
// Somente leitura, deliberadamente: a política de uma análise publicada é histórico, e um
// formulário aqui sugeriria que editá-la reprocessaria o passado. Para mudar parâmetros,
// publica-se uma análise nova.

import { policySummaryRows, type AbcCommercialPolicy } from '../../lib/abcCurve/abcCurvePolicy';

export function AbcPolicySummary({ policy }: { policy: AbcCommercialPolicy }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1.5">
      {policySummaryRows(policy).map(row => (
        <div key={row.label} className="flex items-baseline gap-1.5 text-xs">
          <dt className="text-fg-subtle">{row.label}</dt>
          <dd className="tabular-nums text-fg">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default AbcPolicySummary;
