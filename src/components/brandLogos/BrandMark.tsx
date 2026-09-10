// Selo da marca: logo cadastrado no workspace atual quando existir, iniciais neutras
// quando não existir OU quando a imagem falhar ao carregar (URL assinada expirada, asset
// removido por fora). O NOME da marca nunca é substituído por este selo — ele aparece
// sempre ao lado, então a ausência do logo não esconde informação.
//
// O selo é só a moldura: nenhuma cor da marca vaza para a interface. Fundo, borda e
// radius são os tokens do InventoryBlind, e a imagem entra com object-contain para não
// recortar logo horizontal (Ringke, X-Level, ESR) nem quadrado.

import { useEffect, useState } from 'react';
import { brandInitials } from '../../lib/brandLogos/brandLogoAlgorithm';

const SIZE_CLASS = {
  sm: 'w-8 h-8 rounded-md text-[10px]',
  md: 'w-10 h-10 rounded-lg text-xs',
  lg: 'w-14 h-14 rounded-xl text-sm',
} as const;

interface BrandMarkProps {
  name: string;
  /** URL assinada já resolvida. Ausente/null = fallback de iniciais. */
  url?: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}

export function BrandMark({ name, url, size = 'sm', className = '' }: BrandMarkProps) {
  const [failed, setFailed] = useState(false);

  // URL nova (troca de logo, troca de workspace) merece nova tentativa.
  useEffect(() => { setFailed(false); }, [url]);

  const base = `${SIZE_CLASS[size]} flex-shrink-0 flex items-center justify-center overflow-hidden border border-edge/60`;

  if (url && !failed) {
    return (
      <span className={`${base} bg-surface ${className}`}>
        <img
          src={url}
          alt=""
          className="w-full h-full object-contain"
          onError={() => setFailed(true)}
        />
      </span>
    );
  }

  return (
    <span
      className={`${base} bg-surface-3 font-semibold text-fg-muted tabular-nums ${className}`}
      aria-hidden="true"
    >
      {brandInitials(name)}
    </span>
  );
}

export default BrandMark;
