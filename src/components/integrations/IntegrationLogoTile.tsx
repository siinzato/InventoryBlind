import { useState } from 'react';
import { ImageOff } from 'lucide-react';

/** Tile de identidade visual de uma integração do catálogo.
 *
 *  `logoSrc` é sempre um caminho local em /public (nunca uma URL externa) para
 *  um asset oficial ou de fonte confiável — ver src/lib/integrations/catalog.ts
 *  para a origem de cada arquivo. Fundo branco por padrão no container: várias
 *  marcas usam preto ou cores muito escuras no traço, que desapareceriam sobre
 *  o fundo escuro do tema dark do InventoryBlind sem essa base neutra.
 *  `logoBg` troca esse fundo só quando o próprio asset exige (ex.: um traçado
 *  100% branco), sempre para uma cor oficial da marca, nunca arbitrária. Quando
 *  não há asset (`logoSrc` ausente) ou o arquivo falha ao carregar, o container
 *  mostra um placeholder neutro e claramente temporário — nunca iniciais
 *  fingindo ser a marca. */
interface IntegrationLogoTileProps {
  name: string;
  logoSrc?: string;
  logoBg?: string;
  size?: 'sm' | 'md';
}

export function IntegrationLogoTile({ name, logoSrc, logoBg, size = 'md' }: IntegrationLogoTileProps) {
  const [failed, setFailed] = useState(false);
  const dimension = size === 'sm' ? 'h-9 w-9' : 'h-11 w-11';
  const showPlaceholder = !logoSrc || failed;

  return (
    <div
      className={`flex flex-shrink-0 items-center justify-center overflow-hidden rounded-container border border-edge/60 p-1.5 ${dimension}`}
      style={{ backgroundColor: showPlaceholder ? undefined : (logoBg ?? '#ffffff') }}
    >
      {showPlaceholder ? (
        <ImageOff size={size === 'sm' ? 16 : 18} className="text-gray-300" aria-label={`Logo de ${name} indisponível`} />
      ) : (
        <img
          src={logoSrc}
          alt={name}
          className="h-full w-full object-contain"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}
