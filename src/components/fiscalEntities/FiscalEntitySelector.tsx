import { useEffect, useRef, useState } from 'react';
import { Select } from '../ui';
import { listFiscalEntities } from '../../lib/fiscalEntities/fiscalEntityService';
import { formatCnpj } from '../../lib/fiscalEntities/cnpjUtils';
import type { FiscalEntity } from '../../lib/fiscalEntities/fiscalEntityTypes';

interface FiscalEntitySelectorProps {
  companyId: string;
  value: string | null;
  onChange: (fiscalEntityId: string | null) => void;
  disabled?: boolean;
}

/** Seletor reutilizável de empresa fiscal — usar apenas nos fluxos que
 *  realmente precisam de contexto fiscal (ex.: vincular uma conexão de
 *  ERP), nunca como um filtro global.
 *
 *  Uma empresa ativa: seleciona sozinho. Várias: usa a padrão, permitindo
 *  trocar. Nenhuma: orienta o cadastro em vez de mostrar uma lista vazia. */
export function FiscalEntitySelector({ companyId, value, onChange, disabled }: FiscalEntitySelectorProps) {
  const [entities, setEntities] = useState<FiscalEntity[] | null>(null);
  const autoSelected = useRef(false);

  useEffect(() => {
    let cancelled = false;
    autoSelected.current = false;
    setEntities(null);
    listFiscalEntities(companyId)
      .then(all => {
        if (cancelled) return;
        setEntities(all.filter(e => e.status === 'active'));
      })
      .catch(() => {
        if (!cancelled) setEntities([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  useEffect(() => {
    if (!entities || autoSelected.current || value) return;
    const auto = entities.length === 1 ? entities[0] : entities.find(e => e.isDefault);
    if (auto) {
      autoSelected.current = true;
      onChange(auto.id);
    }
  }, [entities, value, onChange]);

  if (entities === null) {
    return <p className="text-xs text-fg-subtle">Carregando empresas fiscais...</p>;
  }

  if (entities.length === 0) {
    return (
      <p className="text-xs text-fg-subtle">
        Cadastre uma empresa e seu CNPJ nas configurações do workspace para utilizar este recurso.
      </p>
    );
  }

  return (
    <Select
      className="w-full"
      value={value ?? ''}
      disabled={disabled}
      onChange={e => onChange(e.target.value || null)}
    >
      <option value="">Selecione a empresa fiscal</option>
      {entities.map(entity => (
        <option key={entity.id} value={entity.id}>
          {entity.legalName} — {formatCnpj(entity.cnpj)}
          {entity.isDefault ? ' (padrão)' : ''}
        </option>
      ))}
    </Select>
  );
}
