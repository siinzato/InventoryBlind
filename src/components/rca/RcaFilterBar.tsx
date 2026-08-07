import { CAUSE_CATEGORIES } from '../../lib/rcaAlgorithm';
import type { RcaFilters } from '../../lib/rcaService';

interface RcaFilterBarProps {
  filters: RcaFilters;
  onChange: (filters: RcaFilters) => void;
}

/** Filtros por período/causa/SKU/operador/endereço/fornecedor/recorrência — sem componente
 *  de filtro compartilhado no app (Risk/CBC/ABC-XYZ também fazem isso manualmente), então
 *  segue a mesma convenção de pill-buttons + inputs simples usada nesses dashboards. */
export function RcaFilterBar({ filters, onChange }: RcaFilterBarProps) {
  const set = (patch: Partial<RcaFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => set({ causeCategory: undefined })}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            !filters.causeCategory ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'
          }`}
        >
          Todas as causas
        </button>
        {CAUSE_CATEGORIES.map(c => (
          <button
            key={c.value}
            onClick={() => set({ causeCategory: c.value })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              filters.causeCategory === c.value ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input type="date" value={filters.from ?? ''} onChange={e => set({ from: e.target.value || undefined })}
          className="p-2 border border-edge rounded-lg bg-surface text-xs text-fg" title="De" />
        <input type="date" value={filters.to ?? ''} onChange={e => set({ to: e.target.value || undefined })}
          className="p-2 border border-edge rounded-lg bg-surface text-xs text-fg" title="Até" />
        <input placeholder="SKU" value={filters.sku ?? ''} onChange={e => set({ sku: e.target.value || undefined })}
          className="p-2 border border-edge rounded-lg bg-surface text-xs text-fg" />
        <input placeholder="Operador" value={filters.operatorName ?? ''} onChange={e => set({ operatorName: e.target.value || undefined })}
          className="p-2 border border-edge rounded-lg bg-surface text-xs text-fg" />
        <input placeholder="Endereço" value={filters.location ?? ''} onChange={e => set({ location: e.target.value || undefined })}
          className="p-2 border border-edge rounded-lg bg-surface text-xs text-fg" />
        <input placeholder="Fornecedor" value={filters.supplierName ?? ''} onChange={e => set({ supplierName: e.target.value || undefined })}
          className="p-2 border border-edge rounded-lg bg-surface text-xs text-fg" />
        <label className="flex items-center gap-1.5 text-xs text-fg-muted px-2">
          <input type="checkbox" checked={!!filters.recurringOnly} onChange={e => set({ recurringOnly: e.target.checked || undefined })} />
          Só recorrentes
        </label>
      </div>
    </div>
  );
}
