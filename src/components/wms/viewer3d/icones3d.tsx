// Os pictogramas do mapa 3D — os que o Lucide não tem.
//
// ── Por que desenhar ícone à mão ───────────────────────────────────────────────
// O HUD precisava nomear coisas que só existem num WMS: porta-pallets, mesa de expedição,
// área de doca, planta do galpão, vaga por código. O Lucide não tem nenhuma delas, e o que
// vinha sendo usado era aproximação genérica — `Hammer` para o modo de edição, `View` para
// a vista, `Layers` para a legenda. Ícone aproximado é pior que nenhum: ele ocupa o lugar
// de um símbolo e não diz o que a palavra ao lado já não dissesse, que é exatamente o ruído
// que fazia este painel parecer montado por gerador.
//
// ── A regra que eles seguem ────────────────────────────────────────────────────
// §11 da Design Constitution: ícone customizado entra no MESMO peso de linha da família
// existente, para não introduzir uma segunda linguagem visual. Lucide desenha em viewBox
// 24 com stroke 2 e pontas arredondadas; estes fazem igual. `currentColor` em tudo — ícone
// de ação tem a cor do texto em volta, nunca cor própria.
//
// Também não são ilustração: cada um é a PLANTA ou a SEÇÃO do objeto real, do jeito que
// aparece num desenho técnico de galpão. Um porta-pallets visto de frente é dois montantes
// e duas longarinas; é isso que o ícone desenha, e é por isso que ele é reconhecível para
// quem trabalha no galpão em vez de bonito para quem não trabalha.

import type { SVGProps } from 'react';

/** `size` existe para os pictogramas serem intercambiáveis com os do Lucide, que o
 *  `SegmentedControl` já consome assim. Sem ele, usar um destes num segmentado exigiria
 *  um caso especial no componente compartilhado — e aí seriam duas linguagens de novo. */
type Props = SVGProps<SVGSVGElement> & { size?: number };

/** Base comum: o que mantém os oito no mesmo peso. */
function Pictograma({ children, size, ...props }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      {...(size ? { width: size, height: size } : null)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

/** Porta-pallets visto de frente: dois montantes, duas longarinas, carga no nível de baixo. */
export function IconePortaPallets(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M4 3v18M20 3v18" />
      <path d="M4 9h16M4 15h16" />
      <path d="M8 15v-3h5v3" />
    </Pictograma>
  );
}

/** Mesa de expedição em seção: tampo e pés — o que distingue bancada de caixote. */
export function IconeMesaDeExpedicao(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M3 9h18" />
      <path d="M6 9v10M18 9v10" />
      <path d="M3 9 6 5h12l3 4" />
    </Pictograma>
  );
}

/** Área de doca: a demarcação no piso, em perspectiva, com o zebrado da borda. */
export function IconeAreaDeDoca(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M2 18 8 7h8l6 11H2Z" />
      <path d="M7 18h2M11 18h2M15 18h2" />
      <path d="M12 7v7" />
    </Pictograma>
  );
}

/** Cursor de seleção sobre uma peça — a ferramenta que não constrói. */
export function IconeSelecionar(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M4 4l7 16 2-6 6-2L4 4Z" />
      <path d="M14 14l6 6" />
    </Pictograma>
  );
}

/**
 * Planta do galpão: o contorno do prédio com as fileiras dentro.
 *
 * É literalmente o que a vista desenha — fileiras posicionadas pelas medidas, vistas de
 * cima. O par dele, `IconeCodigoDeVaga`, é a grade regular: os dois lado a lado no
 * segmentado explicam a escolha sem precisar do texto.
 */
export function IconePlantaDoGalpao(props: Props) {
  return (
    <Pictograma {...props}>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M7 7v10M12 7v6M17 7v10" />
    </Pictograma>
  );
}

/** Vaga por código: a grade regular, com uma célula marcada — a que o endereço aponta. */
export function IconeCodigoDeVaga(props: Props) {
  return (
    <Pictograma {...props}>
      <rect x="3" y="3" width="18" height="18" rx="1.5" />
      <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
      <path d="M9 9h6v6H9z" fill="currentColor" stroke="none" opacity={0.85} />
    </Pictograma>
  );
}

/** Rua/corredor: duas fileiras e o vão entre elas, visto de cima. */
export function IconeRua(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M4 3v18M20 3v18" />
      <path d="M9 3v18M15 3v18" strokeDasharray="2 3" />
    </Pictograma>
  );
}

/** Pavimento: lajes empilhadas, a de baixo cheia — o andar em que se está. */
export function IconePavimento(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M3 17.5 12 21l9-3.5" />
      <path d="M3 12.5 12 16l9-3.5" />
      <path d="M12 3 3 7l9 3.5L21 7 12 3Z" />
    </Pictograma>
  );
}

/** Legenda de cor: a escala que explica o que cada tom significa. */
export function IconeLegenda(props: Props) {
  return (
    <Pictograma {...props}>
      <rect x="3" y="4" width="5" height="5" rx="1" />
      <rect x="3" y="14" width="5" height="5" rx="1" />
      <path d="M12 6.5h9M12 16.5h9" />
    </Pictograma>
  );
}

/** Pallet no chão: estrado de três tábuas com a carga em cima — a mercadoria que ocupa
 *  corredor esperando conferência ou carregamento. */
export function IconePalletNoChao(props: Props) {
  return (
    <Pictograma {...props}>
      <path d="M3 17h18" />
      <path d="M6 17v3M12 17v3M18 17v3" />
      <path d="M6 17V8h12v9" />
      <path d="M12 8v9" />
    </Pictograma>
  );
}
