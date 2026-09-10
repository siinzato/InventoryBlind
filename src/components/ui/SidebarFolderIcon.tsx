let uid = 0;

/** Ícone de pasta usado pelos 4 grupos operacionais do Sidebar (Operações,
 *  Automações, Produtos, Ferramentas) — desenho próprio (formas/gradiente
 *  autorais, não um asset extraído da Apple/macOS), redesenhado para seguir
 *  de perto a referência exata enviada pelo usuário: aba pequena arredondada
 *  + corpo arredondado abaixo, ambos amostrando o MESMO gradiente diagonal
 *  (`gradientUnits="userSpaceOnUse"`) para lerem como uma única superfície,
 *  não duas cores contrastantes.
 *
 *  Cor fixa nos dois temas — igual à referência, que mantém o mesmo ciano/azul
 *  da pasta em light e dark — por isso não usa `--accent` (que reage a tema)
 *  e sim os tons próprios da referência (ver README §5.1: cores semânticas
 *  fixas, mesmo padrão já aplicado a Badge.tsx). */
export function SidebarFolderIcon({ size = 18, className = '' }: { size?: number; className?: string }) {
  const gradId = `ib-folder-grad-${(uid += 1)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="3" y1="4" x2="21" y2="19" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#70D7F7" />
          <stop offset="1" stopColor="#1C8FE0" />
        </linearGradient>
      </defs>
      <rect x="3" y="4.6" width="9.5" height="4.2" rx="1.7" fill={`url(#${gradId})`} />
      <rect x="3" y="7.4" width="18" height="11.6" rx="2.4" fill={`url(#${gradId})`} />
      <ellipse cx="9.5" cy="8.6" rx="5" ry="0.9" fill="#FFFFFF" fillOpacity="0.22" />
    </svg>
  );
}
