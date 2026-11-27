// O HUD do mapa 3D: legenda, modo, pavimento, busca, rota, filtros e a barra do builder.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo. Duas mudanças de
// comportamento, as duas de responsividade:
//
//   1. O painel esquerdo COLAPSA. Ele tem 15 rem de largura fixa e vive sobre o canvas;
//      num celular em pé (~380 px) ele comia metade da tela, e a gaveta de detalhe (19
//      rem, à direita) entrava por cima dele. Abaixo de 768 px ele começa recolhido.
//   2. Recolhido, sobra só o botão de abrir — a cena fica inteira à vista, que é o motivo
//      de alguém abrir um mapa 3D num celular.
//
// As props chegam AGRUPADAS por assunto (legenda, visão, busca, filtros, câmera,
// builder). Soltas eram 30 e poucas, e a assinatura escondia o que pertencia a quê.

import { useState } from 'react';
import type { ReactNode, SVGProps } from 'react';
import {
  Camera, ChevronDown, Crosshair, Footprints, Maximize, Minimize, PanelLeftClose,
  PanelLeftOpen, RotateCcw, RotateCw, Ruler, Search, ShieldAlert, SlidersHorizontal,
  Sun, SunDim, Trash2,
} from 'lucide-react';
import {
  Button, Input, Modal, Notice, Panel, Select, SegmentedControl,
} from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import {
  posicaoDoCodigo, posicaoEmTexto, rotacaoEmGraus, type AlvoDeExclusao,
} from '../../../lib/wms/warehouse3dBuilder';
import {
  IconeAreaDeDoca, IconeLegenda, IconeMesaDeExpedicao, IconePalletNoChao,
  IconePortaPallets, IconeRua, IconeSelecionar,
} from './icones3d';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import { LAYOUT_PADRAO, LIMITES, baseDaRua, type Layout3DConfig } from '../../../lib/wms/warehouse3dLayout';
import type { AbcClasse, AbcDoArmazem } from '../../../lib/wms/warehouse3dAbc';
import type { ParadaDaRota } from '../../../lib/wms/warehouse3dRota';
import type { FundoDaCena } from '../WarehouseEnvironment';
import {
  CATALOGO, CORES_DE_ESTANTE, COR_ALERTA_GIRO, COR_ATENUADA, COR_VAGA, ESCALA_ABC,
  ESTANTES, LEGENDA, LEGENDA_ABC, MODOS, MODOS_VISOR, PASSO_GRADE_BUILDER,
  LARGURA_ESTREITA, ORIGENS_DO_DESENHO,
  type FerramentaBuilder, type FiltroStatus, type ModoCor, type ModoVisor,
  type ObjetoConstruido, type TipoDeEstante,
} from './aparencia';
import type { VagaDesenhavel } from './recursos3d';
import type { RotaDesenhavel } from './Cena3D';



/**
 * Botão de ícone da fileira de vista.
 *
 * O ícone sozinho não diz nada a quem não o reconhece, nem a um leitor de tela. Por isso
 * o `rotulo` vai nos dois lugares que resolvem isso — `title` para quem passa o mouse,
 * `aria-label` para quem não vê o desenho — e ele descreve a AÇÃO, não o estado.
 *
 * `aria-pressed` só aparece quando o botão é um alternador de verdade. Num botão que
 * apenas dispara (resetar, capturar) ele seria uma promessa de estado que não existe.
 *
 * `h-11` não é estética: é o mínimo de alvo de toque que a Design Constitution exige, e
 * quem usa este mapa no celular está com o telefone na mão dentro do galpão.
 */
function BotaoDeVista({
  rotulo,
  ativo,
  disabled,
  onClick,
  children,
}: {
  rotulo: string;
  ativo?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={rotulo}
      aria-label={rotulo}
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-11 flex-1 items-center justify-center rounded-control border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 ${
        ativo
          ? 'border-accent bg-accent/10 text-accent'
          : 'border-edge text-fg-muted hover:bg-surface-2 hover:text-fg'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * A superfície de um painel do HUD.
 *
 * ── Por que não é o `Panel` do produto ─────────────────────────────────────────
 * `Panel` é superfície de PÁGINA: raio de container, sombra de painel, padding de seção.
 * Usado aqui, ele faz o HUD parecer o que ele estava parecendo — uma tela de configurações
 * pairando sobre um 3D. Instrumento tem outra cara: canto menor, filete mais fino, e uma
 * faixa-título escura que separa o nome do conteúdo.
 *
 * ── Por que o corpo continua claro ─────────────────────────────────────────────
 * A referência tem o painel inteiro em navy, e seria o visual mais forte. Mas
 * `SegmentedControl`, `Button` e `Input` do produto são construídos para superfície clara
 * — a pista do segmentado é `surface-3`, um cinza claro, que sobre navy vira um bloco
 * esbranquiçado no meio do painel. Escurecer o painel direito exige redesenhar esses três
 * primitivos para fundo escuro, e isso é trabalho de Design System, não acabamento de uma
 * tela (§25). Fazer pela metade seria exatamente o remendo cosmético que já falhou.
 * Então o navy entra onde ele é inteiramente meu: a faixa-título.
 */
function PainelDoHud({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={`pointer-events-auto overflow-hidden rounded-control border border-edge/70 bg-surface-2 shadow-panel ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * A faixa-título de um painel do HUD: navy, como as placas de rua da cena.
 *
 * É o mesmo `rail` que pinta as placas lá dentro — então o HUD e a sinalização do galpão
 * passam a falar a mesma cor, e o painel deixa de ser "mais uma caixa cinza do app" para
 * ser a mesma família do que está desenhado na cena. É o que um instrumento faz: ele se
 * identifica com o que mede.
 *
 * O ícone aqui TEM função — ele é o pictograma do assunto (porta-pallets, planta, rua),
 * desenhado em `icones3d`, e não um glifo genérico escolhido por combinar. Quando não há
 * pictograma que diga algo, não entra ícone nenhum.
 */
function CabecalhoDoHud({
  titulo,
  icone: Icone,
  children,
}: {
  titulo: string;
  icone?: (props: SVGProps<SVGSVGElement>) => JSX.Element;
  /** Ação à direita: recolher, limpar, fechar. */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 bg-rail px-3 py-2 text-rail-fg">
      {Icone && <Icone className="h-3.5 w-3.5 shrink-0 text-rail-fg-muted" />}
      <span className="text-[11px] font-semibold uppercase tracking-[0.09em]">{titulo}</span>
      <span className="ml-auto flex items-center gap-1">{children}</span>
    </div>
  );
}

/**
 * Uma faixa do painel, na densidade de PALETA — não na de página.
 *
 * `PanelSection` existe para seção de página de largura cheia, e sua menor opção de
 * padding é 20 px. Medido: num painel de 240 px isso é 17% da largura em respiro
 * horizontal e ~280 px de respiro vertical nas sete faixas — quase metade da altura
 * visível. É o que faz o HUD parecer uma tela de configurações pairando sobre a cena em
 * vez de uma paleta de ferramenta.
 *
 * 12 px na horizontal e 10 px na vertical é densidade de instrumento. O filete desce para
 * `edge/60`: com sete divisórias numa coluna estreita, a borda cheia vira grade.
 */
function FaixaDoHud({ className = '', children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`border-t border-edge/60 px-3 py-2.5 first:border-t-0 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Um grupo do painel: cabeçalho, resumo do que está ativo e corpo recolhível.
 *
 * ── Por que o resumo aparece SEMPRE, aberto ou fechado ─────────────────────────
 * É ele que torna o recolhimento honesto. Uma seção fechada escondendo um filtro ligado
 * faria a tela mentir sobre o que está mostrando — e um mapa que esconde que está
 * filtrado é pior do que um mapa sem filtro. Com o resumo no cabeçalho, "2 ruas · 207 de
 * 215" continua visível com o grupo inteiro recolhido.
 *
 * ── Por que o cabeçalho perdeu o ícone ─────────────────────────────────────────
 * Layers, View, Search, Sliders e Camera não diziam nada que a palavra ao lado já não
 * dissesse. O §11 da Design Constitution exige função no ícone, e cinco glifos decorativos
 * numa coluna de 240 px são exatamente o ruído que faz a interface parecer montada por
 * gerador. Ícone sobrou só onde ele SUBSTITUI a palavra (a fileira de ações) ou onde a
 * cor dele É o dado (os dois alertas).
 *
 * ── A escala, que é o que faltava ──────────────────────────────────────────────
 * Antes o painel inteiro era 13 px: título, rótulo, contagem e ajuda no mesmo tamanho, com
 * a hierarquia carregada só por peso e por cinza. Aqui o título vira RÓTULO de 11 px em
 * maiúsculas com tracking — ele nomeia a faixa, não compete com o conteúdo — e o conteúdo
 * fica em 13 px. A contagem sai em mono tabular, que é a terceira voz.
 */
function SecaoDoHud({
  titulo,
  resumo,
  destacado = false,
  comecaAberta = true,
  children,
}: {
  titulo: string;
  /** O que está ativo aqui dentro, em uma linha curta. */
  resumo?: ReactNode;
  /** Há algo fora do padrão neste grupo. */
  destacado?: boolean;
  comecaAberta?: boolean;
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(comecaAberta);

  return (
    <FaixaDoHud className={aberta ? 'space-y-2' : ''}>
      <button
        type="button"
        onClick={() => setAberta(a => !a)}
        aria-expanded={aberta}
        className="group flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-fg-subtle transition-colors group-hover:text-fg-muted">
          {titulo}
        </span>
        <span className={`ml-auto truncate text-xs ${destacado ? 'text-accent' : 'text-fg-subtle'}`}>
          {resumo ?? ''}
        </span>
        <ChevronDown
          aria-hidden
          className={`h-3 w-3 shrink-0 text-fg-subtle transition-transform ${aberta ? '' : '-rotate-90'}`}
        />
      </button>
      {aberta && children}
    </FaixaDoHud>
  );
}

/**
 * As ferramentas do Modo Edição, com o pictograma de cada peça.
 *
 * Mora aqui e não em `aparencia.ts` porque carrega componente React — e `aparencia` é o
 * módulo de VALORES da cena, que o 3D importa sem arrastar JSX junto.
 */
const FERRAMENTAS_DO_BUILDER: {
  valor: FerramentaBuilder;
  rotulo: string;
  Icone: (props: SVGProps<SVGSVGElement>) => JSX.Element;
}[] = [
  { valor: 'navegar', rotulo: 'Selecionar', Icone: IconeSelecionar },
  { valor: 'porta-pallets', rotulo: 'Porta-pallets', Icone: IconePortaPallets },
  { valor: 'mesa', rotulo: 'Mesa', Icone: IconeMesaDeExpedicao },
  { valor: 'doca', rotulo: 'Doca', Icone: IconeAreaDeDoca },
  { valor: 'pallet', rotulo: 'Pallet', Icone: IconePalletNoChao },
];

/**
 * A trilha de ruas: multisseleção na MESMA gramática do `SegmentedControl`.
 *
 * Eram oito chips, cada um com borda própria — oito caixinhas soltas numa coluna de
 * 198 px, que é precisamente o padrão "N caixinhas em fila" que a Design Constitution
 * manda trocar por um controle só. Não dá para usar o `SegmentedControl` em si, porque
 * ele é escolha única e aqui conferir DUAS ruas lado a lado é o caso comum; o que dá para
 * reusar é o desenho: uma pista com borda, segmentos sem borda dentro dela.
 *
 * Letra em mono: é código de endereço, da mesma família de `PP-A13-N3`.
 */
function TrilhaDeRuas({
  ruas,
  selecionadas,
  onAlternar,
}: {
  ruas: string[];
  selecionadas: ReadonlySet<string>;
  onAlternar: (rua: string) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filtrar por rua"
      className="flex max-w-full flex-wrap items-center gap-1 rounded-control border border-edge bg-surface-3 p-1"
    >
      {ruas.map(r => {
        const ativa = selecionadas.has(r);
        return (
          <button
            key={r}
            type="button"
            aria-pressed={ativa}
            onClick={() => onAlternar(r)}
            className={`text-code flex h-7 min-w-[1.75rem] items-center justify-center rounded-control px-1.5 text-xs font-medium transition-colors ${
              ativa ? 'bg-surface text-fg shadow-control' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {r}
          </button>
        );
      })}
    </div>
  );
}

// ── Ajuste da estrutura ────────────────────────────────────────────────────────

/** Campo numérico com unidade e limites do próprio domínio. */
function CampoMetros({
  rotulo,
  ajuda,
  valor,
  min,
  max,
  onMudar,
}: {
  rotulo: string;
  ajuda?: string;
  valor: number;
  min: number;
  max: number;
  onMudar: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-fg">{rotulo}</span>
      {ajuda && <span className="mt-0.5 block text-xs leading-relaxed text-fg-muted">{ajuda}</span>}
      <div className="mt-1 flex items-center gap-2">
        <Input
          type="number"
          step={0.1}
          min={min}
          max={max}
          value={valor}
          // Campo vazio vira NaN em `Number('')`, e um NaN no eixo Y faz a vaga sumir
          // da cena sem erro nenhum. O valor anterior fica até digitarem um número.
          onChange={e => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onMudar(n);
          }}
          className="w-full"
        />
        <span className="text-xs text-fg-muted">m</span>
      </div>
    </label>
  );
}

/**
 * Ajuste da estrutura física do porta-pallets.
 *
 * Estas medidas NÃO vêm do banco: são propriedade do galpão, não do endereço. Ficam
 * no navegador de quem monta o mapa, e por isso o painel é uma preferência local, não
 * um cadastro — gravar isso como dado da empresa sem alguém decidir seria inventar
 * uma regra de negócio.
 *
 * O que NÃO está aqui, de propósito: número de níveis por rua. Quantos níveis uma rua
 * tem é consequência dos endereços cadastrados, não escolha de exibição. Um campo
 * para isso desenharia vagas que não existem ou esconderia vagas que existem.
 */
function AjusteDeEstrutura({
  aberto,
  onFechar,
  layout,
  ruas,
  onMudar,
}: {
  aberto: boolean;
  onFechar: () => void;
  layout: Layout3DConfig;
  ruas: string[];
  onMudar: (patch: Partial<Layout3DConfig>) => void;
}) {
  const [ruaEmFoco, setRuaEmFoco] = useState<string>('');

  if (!aberto) return null;

  const elevacaoDaRua = ruaEmFoco ? baseDaRua(ruaEmFoco, layout) : layout.baseOffsetY;

  return (
    <Modal open onClose={onFechar} title="Ajustar estrutura do porta-pallets">
      <div className="space-y-4">
        <p className="text-xs leading-relaxed text-fg-muted">
          Medidas do galpão, em metros. Ficam salvas neste navegador e não alteram nenhum
          endereço cadastrado.
        </p>

        <CampoMetros
          rotulo="Elevação da base"
          ajuda="Altura do piso até a primeira prateleira. Use 0 para estrutura apoiada no chão; acima disso o mapa desenha os montantes de sustentação."
          valor={layout.baseOffsetY}
          min={LIMITES.baseOffsetY.min}
          max={LIMITES.baseOffsetY.max}
          onMudar={v => onMudar({ baseOffsetY: v })}
        />

        <CampoMetros
          rotulo="Altura por nível"
          ajuda="Distância entre andares, incluindo a longarina e a folga de entrada do garfo."
          valor={layout.levelHeight}
          min={LIMITES.levelHeight.min}
          max={LIMITES.levelHeight.max}
          onMudar={v => onMudar({ levelHeight: v })}
        />

        <CampoMetros
          rotulo="Passo entre módulos"
          ajuda="Distância de um módulo ao seguinte, ao longo da rua."
          valor={layout.moduleWidth}
          min={LIMITES.moduleWidth.min}
          max={LIMITES.moduleWidth.max}
          onMudar={v => onMudar({ moduleWidth: v })}
        />

        <CampoMetros
          rotulo="Distância entre ruas"
          ajuda="Inclui o corredor de manobra. Encolher aqui faz o desenho mentir sobre caber a empilhadeira."
          valor={layout.rowSpacing}
          min={LIMITES.rowSpacing.min}
          max={LIMITES.rowSpacing.max}
          onMudar={v => onMudar({ rowSpacing: v })}
        />

        {ruas.length > 1 && (
          <div className="border-t border-edge pt-4">
            <p className="text-xs font-medium text-fg">Elevação de uma rua específica</p>
            <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
              Para quando só parte do pulmão é suspensa. Sem ajuste próprio, a rua segue a
              elevação geral acima.
            </p>
            <Select
              value={ruaEmFoco}
              onChange={e => setRuaEmFoco(e.target.value)}
              className="mt-2 w-full"
            >
              <option value="">Escolha a rua…</option>
              {ruas.map(r => (
                <option key={r} value={r}>
                  Rua {r}
                  {layout.baseByStreet[r] !== undefined ? ` · ${layout.baseByStreet[r]} m` : ''}
                </option>
              ))}
            </Select>

            {ruaEmFoco && (
              <div className="mt-3 space-y-2">
                <CampoMetros
                  rotulo={`Elevação da rua ${ruaEmFoco}`}
                  valor={elevacaoDaRua}
                  min={LIMITES.baseOffsetY.min}
                  max={LIMITES.baseOffsetY.max}
                  onMudar={v => onMudar({ baseByStreet: { ...layout.baseByStreet, [ruaEmFoco]: v } })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const resto = { ...layout.baseByStreet };
                    delete resto[ruaEmFoco];
                    onMudar({ baseByStreet: resto });
                  }}
                >
                  Voltar ao padrão geral
                </Button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-between gap-2 border-t border-edge pt-4">
          <Button variant="ghost" size="sm" onClick={() => onMudar({ ...LAYOUT_PADRAO })}>
            Restaurar padrão
          </Button>
          <Button variant="primary" size="sm" onClick={onFechar}>
            Concluir
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Props agrupadas por assunto ──────────────────────────────────────────────────
//
// Soltas eram mais de trinta, e a assinatura não dizia o que pertencia a quê. Agrupadas,
// cada bloco do HUD puxa só o seu — e a desestruturação no corpo mantém os nomes que o
// JSX já usava, para o fatiamento não virar também uma renomeação.

export interface LegendaDoHud {
  modo: ModoCor;
  contagem: Record<SlotStatus, number>;
  contagemAbc: { porClasse: Record<AbcClasse, number>; semCurva: number };
  abc: AbcDoArmazem;
  abcFalhou: boolean;
}

export interface VisaoDoHud {
  modoVisor: ModoVisor;
  mostrarPlantaFisica: boolean;
  /** `vazio` = pavimento sem planta cadastrada; o HUD diz isso por extenso. */
  origemDaPlanta: 'banco' | 'constante' | 'vazio';
  pavimentos: number[];
  andar: number;
  caminhando: boolean;
  fundo: FundoDaCena;
  telaCheia: boolean;
  /** Falso esconde o botão: API ausente, ou bloqueada por estar num iframe. */
  suportaTelaCheia: boolean;
}

export interface BuscaDoHud {
  busca: string;
  buscando: boolean;
  achados: ReadonlySet<string> | null;
  achadas: VagaDesenhavel[];
  rota: RotaDesenhavel | null;
  rotaAberta: boolean;
  paradaAtual: number;
}

export interface FiltrosDoHud {
  ruas: string[];
  ruasSelecionadas: ReadonlySet<string>;
  filtro: FiltroStatus;
  alertasGiro: Slot[];
  divergentes: VagaDesenhavel[];
  emDestaque: number;
  totalDeVagas: number;
  naoPosicionaveis: number;
}

export interface BuilderDoHud {
  ferramenta: FerramentaBuilder;
  estanteEscolhida: TipoDeEstante;
  corEscolhida: string;
  /** As peças inteiras, não só os ids: o gerenciador lê tipo, posição e rotação de cada
   *  uma. Antes só a CONTAGEM era usada, e por isso bastava `{ id }`. */
  objetos: ObjetoConstruido[];
  /** Id da peça selecionada SE for porta-pallets — tipo e cor só valem para estante. */
  selecionadoDoTipoEstante: string | null;
  /** Id da peça selecionada, de qualquer tipo. */
  selecionadoNoBuilder: string | null;
  /** O que o comando de excluir está mirando: peça de esboço, endereço, ou nada. */
  alvoDeExclusao: AlvoDeExclusao;
  /** Enquanto o endereço é apagado no banco, o botão fica preso. */
  excluindoEndereco: boolean;
  /** O banco recusou? Endereço com saldo ou histórico, ou papel sem permissão. */
  erroAoExcluir: string | null;
  /** Qual endereço acabou de ser apagado. Some ao escolher outro alvo. */
  enderecoExcluido: string | null;
  /** Quantos níveis a posição selecionada tem. Acima de 1, vale oferecer apagar a
   *  coluna inteira — que é o que se aponta ao apontar um porta-pallets. */
  niveisDaPosicao: number;
  salvandoPecas: boolean;
  erroAoSalvar: string | null;
  salvoEm: Date | null;
}

export interface AcoesDoHud {
  setModo: (m: ModoCor) => void;
  setModoVisor: (m: ModoVisor) => void;
  setMostrarPlantaFisica: (f: (v: boolean) => boolean) => void;
  setAndar: (a: number) => void;
  setBusca: (s: string) => void;
  setFiltro: (f: FiltroStatus) => void;
  setRuasSelecionadas: (f: (atual: Set<string>) => Set<string>) => void;
  limparRuas: () => void;
  setRotaAberta: (f: (v: boolean) => boolean) => void;
  setParadaAtual: (n: number) => void;
  setCaminhando: (f: (v: boolean) => boolean) => void;
  setFundo: (f: (v: FundoDaCena) => FundoDaCena) => void;
  alternarTelaCheia: () => void;
  setAjustando: (v: boolean) => void;
  setFerramenta: (f: FerramentaBuilder) => void;
  setEstanteEscolhida: (t: TipoDeEstante) => void;
  setCorEscolhida: (c: string) => void;
  setSelecionadoNoBuilder: (id: string | null) => void;
  ajustarObjeto: (id: string, patch: { estante?: TipoDeEstante; cor?: string }) => void;
  salvarConstrucao: () => void;
  /** Executa a exclusão do alvo atual — peça de esboço ou endereço. */
  onExcluirAlvo: () => void;
  /** Exclui TODOS os níveis da posição selecionada. */
  onExcluirPosicao: () => void;
  /** Exclui uma peça do esboço pela lista, por id. */
  onExcluirPeca: (id: string) => void;
  /** Esvazia o pavimento na tela. Não mexe no que já foi salvo até alguém salvar. */
  onLimparPecas: () => void;
  /** Gira uma peça pela lista, sem precisar achá-la na cena. */
  onGirarPeca: (id: string, sentido?: 1 | -1) => void;
  focarVaga: (slot: Slot | undefined) => void;
  voarAteParada: (parada: ParadaDaRota) => void;
  resetarCamera: () => void;
  capturarCena: () => void;
  trocarLayout: (patch: Partial<Layout3DConfig>) => void;
}

/**
 * O painel de controles, a barra do builder e o modal de ajuste.
 *
 * O painel esquerdo é COLAPSÁVEL, e abaixo de 768 px começa recolhido: com 15 rem de
 * largura fixa sobre um canvas de ~380 px, ele comia metade da tela e a gaveta de detalhe
 * entrava por cima. Recolhido sobra o botão de abrir — a cena fica inteira à vista.
 */
export function Hud3D({
  legenda,
  visao,
  busca: dadosDaBusca,
  filtros,
  builder,
  acoes,
  layout,
  ajustando,
  theme,
}: {
  legenda: LegendaDoHud;
  visao: VisaoDoHud;
  busca: BuscaDoHud;
  filtros: FiltrosDoHud;
  builder: BuilderDoHud;
  acoes: AcoesDoHud;
  layout: Layout3DConfig;
  ajustando: boolean;
  theme: Theme;
}) {
  const { modo, contagem, contagemAbc, abc, abcFalhou } = legenda;
  const {
    modoVisor, mostrarPlantaFisica, origemDaPlanta, pavimentos, andar, caminhando, fundo,
    telaCheia, suportaTelaCheia,
  } = visao;
  const { busca, buscando, achados, achadas, rota, rotaAberta, paradaAtual } = dadosDaBusca;
  const { ruas, ruasSelecionadas, filtro, alertasGiro, divergentes, emDestaque, totalDeVagas, naoPosicionaveis } = filtros;
  const {
    ferramenta, estanteEscolhida, corEscolhida, objetos, selecionadoDoTipoEstante,
    selecionadoNoBuilder, alvoDeExclusao, excluindoEndereco, erroAoExcluir, enderecoExcluido,
    niveisDaPosicao,
    salvandoPecas, erroAoSalvar, salvoEm,
  } = builder;
  const {
    setModo, setModoVisor, setMostrarPlantaFisica, setAndar, setBusca, setFiltro,
    setRuasSelecionadas, limparRuas, setRotaAberta, setParadaAtual, setCaminhando, setFundo,
    alternarTelaCheia, setAjustando, setFerramenta, setEstanteEscolhida, setCorEscolhida,
    setSelecionadoNoBuilder, ajustarObjeto, salvarConstrucao, onExcluirAlvo, onExcluirPosicao, onExcluirPeca, onLimparPecas, onGirarPeca,
    focarVaga, voarAteParada,
    resetarCamera, capturarCena, trocarLayout,
  } = acoes;

  /**
   * Painel recolhido.
   *
   * Nasce fechado em tela estreita e aberto no resto. Lido UMA vez, na montagem: trocar
   * sozinho a cada redimensionamento reabriria o painel que a pessoa acabou de fechar.
   */
  /** A gaveta de Controles. Fechada por padrão: o que está nela se mexe uma vez por
   *  sessão, e deixá-la aberta devolveria a coluna de 15 rem que o redesenho veio tirar. */
  const [controlesAbertos, setControlesAbertos] = useState(false);

  const [aberto, setAberto] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= LARGURA_ESTREITA,
  );

  // ── Resumos de cabeçalho ──────────────────────────────────────────────────────
  //
  // O que cada grupo diz de si quando está recolhido. Calculados aqui, e não dentro de
  // `SecaoDoHud`, porque é o HUD que sabe o que conta como "fora do padrão" em cada
  // assunto — a seção só sabe desenhar.

  // `filtrando` governa também o cabeçalho do painel: é ele que decide entre mostrar o
  // total do armazém e mostrar a fração em destaque. O contador saiu do meio do grupo
  // justamente porque ali ele só existia com o grupo aberto.
  const filtrando = ruasSelecionadas.size > 0 || filtro !== 'todas';

  /** Quantos ajustes estão fora do padrão. É o que impede a gaveta de esconder estado:
   *  fechada, o botão continua dizendo que há algo mexido lá dentro. */
  const ajustesAtivos =
    (ruasSelecionadas.size > 0 ? 1 : 0) +
    (caminhando ? 1 : 0) +
    (fundo === 'limpo' ? 1 : 0) +
    (modoVisor === 'edicao' ? 1 : 0) +
    (pavimentos.length > 1 && andar !== 1 ? 1 : 0);

  const resumoDasRuas =
    ruasSelecionadas.size === 0
      ? `${ruas.length}`
      : `${ruasSelecionadas.size} de ${ruas.length}`;


  const resumoDaVista = [
    mostrarPlantaFisica ? 'planta' : 'código',
    pavimentos.length > 1 ? (andar === 1 ? 'térreo' : `${andar}º andar`) : null,
    modoVisor === 'edicao' ? 'edição' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const resumoDaCamera = [
    caminhando ? 'caminhando' : null,
    telaCheia ? 'tela cheia' : null,
    fundo === 'limpo' ? 'sem galpão' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  /** Os dois atalhos de alerta existem? Decide se a faixa de alertas é desenhada. */
  const temAlerta = contagem.divergence > 0 || alertasGiro.length > 0;

  return (
    <>
      {/* Catálogo de construção. Barra inferior e não painel lateral: a mão vai do
          catálogo para o chão o tempo todo, e a borda de baixo é o caminho mais curto
          entre escolher a peça e mirar na grade. */}
      {modoVisor === 'edicao' && (
        <div className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2">
          <Panel>
            <FaixaDoHud>
              {/* Ferramenta como PICTOGRAMA sobre o rótulo, não texto numa fileira.
                  "+ Porta-Pallets", "+ Mesa de expedição" e "+ Área de doca" eram três
                  botões de texto do mesmo tamanho: para escolher era preciso LER os três.
                  Com o desenho da peça em cima — dois montantes e duas longarinas, tampo
                  com pés, demarcação hachurada —, a escolha passa a ser reconhecimento. Os
                  pictogramas são próprios (`icones3d`) porque o Lucide não tem nenhum
                  deles, e ícone aproximado é pior que ícone nenhum. */}
              <div className="flex flex-wrap items-stretch justify-center gap-1">
                {FERRAMENTAS_DO_BUILDER.map(({ valor, rotulo, Icone }) => {
                  const ativa = ferramenta === valor;
                  return (
                    <button
                      key={valor}
                      type="button"
                      aria-pressed={ativa}
                      title={rotulo}
                      onClick={() => {
                        setFerramenta(valor);
                        // Soltar a seleção ao armar a ferramenta: a barra de girar e
                        // excluir sobre a peça antiga só atrapalharia a mira da nova.
                        if (valor !== 'navegar') setSelecionadoNoBuilder(null);
                      }}
                      className={`flex w-[5.25rem] flex-col items-center gap-1 rounded-control border px-1 py-2 text-[11px] font-medium leading-tight transition-colors ${
                        ativa
                          ? 'border-accent bg-accent/10 text-accent'
                          : 'border-transparent text-fg-muted hover:bg-surface-3 hover:text-fg'
                      }`}
                    >
                      <Icone className="h-5 w-5 shrink-0" />
                      {rotulo}
                    </button>
                  );
                })}
              </div>
              {/* Tipo e cor valem para a PRÓXIMA peça e, com algo selecionado, para a
                  peça selecionada — corrigir sem excluir e refazer é o uso mais comum. */}
              {(ferramenta === 'porta-pallets' || selecionadoDoTipoEstante) && (
                <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 border-t border-edge pt-2">
                  {(Object.keys(ESTANTES) as TipoDeEstante[]).map(t => (
                    <Button
                      key={t}
                      variant={estanteEscolhida === t ? 'primary' : 'ghost'}
                      size="sm"
                      onClick={() => {
                        setEstanteEscolhida(t);
                        if (selecionadoDoTipoEstante) ajustarObjeto(selecionadoDoTipoEstante, { estante: t });
                      }}
                    >
                      {ESTANTES[t].rotulo}
                    </Button>
                  ))}
                  <span aria-hidden className="mx-0.5 h-5 w-px bg-edge" />
                  {CORES_DE_ESTANTE.map(c => (
                    <button
                      key={c.chave}
                      type="button"
                      aria-label={`Cor ${c.rotulo}`}
                      title={c.rotulo}
                      onClick={() => {
                        setCorEscolhida(c.chave);
                        if (selecionadoDoTipoEstante) ajustarObjeto(selecionadoDoTipoEstante, { cor: c.chave });
                      }}
                      className={`h-6 w-6 rounded-control border-2 ${corEscolhida === c.chave ? 'border-accent' : 'border-edge'}`}
                      style={{ backgroundColor: c.hex }}
                    />
                  ))}
                </div>
              )}
              {/* ── O gerenciador ────────────────────────────────────────────────
                  A cena mostra o galpão; a lista mostra o INVENTÁRIO do que foi montado.
                  São leituras diferentes e as duas fazem falta: na cena não dá para
                  selecionar a peça escondida atrás de outra, nem ler a posição exata, nem
                  conferir se uma ficou girada por engano. Aqui cada linha traz o
                  pictograma do tipo, a coordenada e o ângulo em mono tabular, e seleciona
                  ao clicar — a mesma seleção da cena, sem segundo estado.

                  Rola a partir de seis peças: a barra é rodapé, e um rodapé que cresce
                  com o galpão acabaria cobrindo o galpão. */}
              {objetos.length > 0 && (
                <div className="mt-2 border-t border-edge pt-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-fg-subtle">
                      Peças montadas
                    </span>
                    <span className="text-code text-xs text-fg-muted">{objetos.length}</span>
                  </div>
                  <ul className="max-h-[9.5rem] space-y-0.5 overflow-y-auto pr-0.5">
                    {objetos.map(obj => {
                      const ativa = selecionadoNoBuilder === obj.id;
                      const Icone =
                        FERRAMENTAS_DO_BUILDER.find(f => f.valor === obj.tipo)?.Icone ?? IconeSelecionar;
                      return (
                        <li key={obj.id}>
                          <div
                            className={`flex items-center gap-1.5 rounded-control px-1.5 py-1 transition-colors ${
                              ativa ? 'bg-accent/10' : 'hover:bg-surface-3'
                            }`}
                          >
                            <button
                              type="button"
                              aria-pressed={ativa}
                              title="Selecionar esta peça na cena"
                              onClick={() => setSelecionadoNoBuilder(ativa ? null : obj.id)}
                              className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            >
                              <Icone
                                className={`h-3.5 w-3.5 shrink-0 ${ativa ? 'text-accent' : 'text-fg-subtle'}`}
                              />
                              <span className={`truncate text-xs ${ativa ? 'text-fg' : 'text-fg-muted'}`}>
                                {CATALOGO[obj.tipo].rotulo}
                              </span>
                              <span className="text-code ml-auto shrink-0 text-[11px] text-fg-subtle">
                                {posicaoEmTexto(obj)}
                              </span>
                              <span className="text-code w-9 shrink-0 text-right text-[11px] text-fg-subtle">
                                {rotacaoEmGraus(obj.rotacaoY)}°
                              </span>
                            </button>
                            <button
                              type="button"
                              title="Girar esta peça 90°"
                              onClick={() => onGirarPeca(obj.id, 1)}
                              className="shrink-0 rounded-control p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
                            >
                              <RotateCw aria-hidden className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              title="Excluir esta peça"
                              onClick={() => onExcluirPeca(obj.id)}
                              className="shrink-0 rounded-control p-1 text-fg-subtle transition-colors hover:bg-danger/10 hover:text-danger"
                            >
                              <Trash2 aria-hidden className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {/* Excluir deixou de depender de acertar um alvo de 16 px dentro da cena.
                  Medido antes: a barra que flutua sobre a peça selecionada usava
                  `distanceFactor`, e o botão "Excluir" era pintado em 16 × 27 px — abaixo
                  do mínimo para clicar, e encolhendo a cada passo de afastamento da
                  câmera. O caminho que de fato funcionava era a tecla Del, anunciada
                  apenas numa linha de ajuda. Agora a exclusão da peça selecionada mora
                  aqui, em tamanho de botão, ao lado do que ela exclui. */}
              <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5 border-t border-edge pt-2">
                {/* O botão diz O QUE vai apagar.
                    Ele marcava sempre "Excluir peça" e só acendia com peça de esboço
                    selecionada — por isso clicar num porta-pallets da planta parecia não
                    ter exclusão: o alvo ali é um ENDEREÇO, e o botão nem olhava para ele.
                    Agora o rótulo troca com o alvo e traz o código em mono, que é o que
                    deixa claro que o clique vai apagar `PP-D16-N1` e não um desenho. */}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!alvoDeExclusao || excluindoEndereco}
                  title={
                    !alvoDeExclusao
                      ? 'Nada selecionado. Clique numa peça montada ou num endereço da cena.'
                      : alvoDeExclusao.tipo === 'peca'
                        ? 'Excluir a peça selecionada (Del)'
                        : `Excluir o endereço ${alvoDeExclusao.codigo} — vai ao banco e não volta (Del)`
                  }
                  onClick={onExcluirAlvo}
                >
                  <Trash2 aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                  {!alvoDeExclusao ? (
                    'Excluir seleção'
                  ) : alvoDeExclusao.tipo === 'peca' ? (
                    'Excluir peça'
                  ) : (
                    <>
                      Excluir <span className="text-code ml-1">{alvoDeExclusao.codigo}</span>
                    </>
                  )}
                </Button>

                {/* E a POSIÇÃO inteira, quando ela tem mais de um nível.
                    Apagar só o nível clicado deixa os de cima no ar: a estante continua
                    lá com um vão a menos, e o comando parece não ter feito nada. "Aquele
                    porta-pallets" é a coluna de níveis daquele ponto da rua, e é isto que
                    este botão apaga. A rua inteira continua fora — ela não é linha de
                    tabela, é o contador de fileiras da planta publicada. */}
                {alvoDeExclusao?.tipo === 'endereco' && niveisDaPosicao > 1 && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={excluindoEndereco}
                    title={`Excluir os ${niveisDaPosicao} níveis da posição ${posicaoDoCodigo(alvoDeExclusao.codigo) ?? alvoDeExclusao.codigo} — o porta-pallets inteiro naquele ponto`}
                    onClick={onExcluirPosicao}
                  >
                    <Trash2 aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
                    Excluir posição
                    <span className="text-code ml-1">{niveisDaPosicao}</span>
                  </Button>
                )}
                {/* Limpar tudo pede confirmação porque é o único clique aqui que não tem
                    volta por outro clique: apagar trinta peças uma a uma é recuperável,
                    apagar as trinta de uma vez não. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={objetos.length === 0}
                  title="Remover todas as peças colocadas neste pavimento"
                  onClick={() => {
                    if (objetos.length === 0) return;
                    const texto = `Remover as ${objetos.length} peças montadas neste pavimento? Isto não desfaz o que já foi salvo — só volta a tela ao estado vazio.`;
                    if (window.confirm(texto)) onLimparPecas();
                  }}
                >
                  Limpar tudo
                </Button>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-edge" />
                <Button size="sm" onClick={salvarConstrucao} disabled={salvandoPecas}>
                  {salvandoPecas ? 'Salvando...' : 'Salvar construção'}
                </Button>
                <span className="text-xs text-fg-subtle">
                  {erroAoSalvar
                    ? erroAoSalvar
                    : salvoEm
                      ? `Salvo às ${salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                      : 'Ainda não salvo nesta sessão'}
                </span>
              </div>

              {/* A recusa do BANCO, dita por extenso.
                  Apagar endereço é a única ação daqui que pode ser negada por quem não é
                  esta tela: endereço com saldo ou com histórico é barrado pela chave
                  estrangeira, e papel sem permissão é barrado pela policy. Engolir isso
                  faria o clique parecer não ter feito nada — que é precisamente a queixa
                  que trouxe este trabalho. */}
              {erroAoExcluir && (
                <div className="mt-2">
                  <Notice tone="warning">{erroAoExcluir}</Notice>
                </div>
              )}

              {/* E o SUCESSO, dito por extenso.
                  Sem isto, apagar um endereço era a ficha fechando, o botão apagando e a
                  contagem caindo de 215 para 214 sozinha — a tela mudando de ideia em vez
                  de confirmar o que você fez. */}
              {enderecoExcluido && !erroAoExcluir && (
                <div className="mt-2">
                  <Notice tone="neutral">
                    Endereço <span className="text-code">{enderecoExcluido}</span> removido do
                    galpão. A contagem de vagas no topo já está atualizada.
                  </Notice>
                </div>
              )}

              {/* A contagem fica SEMPRE, com ferramenta armada ou não: ela é o estado da
                  construção, e sumia justamente enquanto se constrói — que é quando saber
                  quantas peças já foram colocadas importa. A instrução ao lado é que muda. */}
              <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-1.5 text-center text-xs text-fg-subtle">
                <span className="text-code font-medium text-fg">{objetos.length}</span>
                <span>{objetos.length === 1 ? 'peça colocada' : 'peças colocadas'}</span>
                <span aria-hidden className="text-fg-subtle">·</span>
                {ferramenta === 'navegar' ? (
                  <span>Clique numa peça para selecioná-la; no vazio, para soltar.</span>
                ) : (
                  <span>
                    Clique no piso para construir. <span className="text-code">R</span> gira,{' '}
                    <span className="text-code">Del</span> exclui.
                  </span>
                )}
              </p>
            </FaixaDoHud>
          </Panel>
        </div>
      )}

      {/* ── A arquitetura do HUD ──────────────────────────────────────────────────
          Era UM painel de 15 rem encostado na esquerda, com tudo dentro e a altura do
          canvas inteiro. Esse é o formato de sidebar de dashboard, e nenhuma quantidade de
          acabamento tira dele a cara de template: o problema não era o estilo das caixas,
          era haver uma coluna única de controles ao lado de um mapa.

          Agora são INSTRUMENTOS nas bordas, cada um com um assunto só:
            · topo-esquerda  — a legenda, que é também o filtro de situação;
            · topo-centro    — a busca, que é o verbo principal da tela e por isso fica
                               onde todo mapa põe busca;
            · topo-direita   — Controles, uma gaveta com o que se mexe pouco (vista,
                               pavimento, ruas, câmera, medidas da estante);
            · base-esquerda  — os alertas e o que o mapa não consegue desenhar;
            · base-centro    — a barra de edição, só no Modo Edição;
            · base-direita   — ficha da vaga e radar, que já viviam ali.

          O meio da tela fica livre. Num mapa, o espaço vazio é o produto. */}

      {/* Recolhido, sobra SÓ este botão. Em tela estreita o painel cobria metade do canvas
          e a gaveta de detalhe entrava por cima dele — e quem abre um mapa 3D no celular
          quer ver o galpão, não os controles. */}
      {!aberto && (
        <button
          type="button"
          onClick={() => setAberto(true)}
          aria-label="Abrir os controles do mapa"
          aria-expanded={false}
          className="pointer-events-auto absolute left-3 top-3 rounded-control border border-edge bg-surface p-2 text-fg-muted shadow-control transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <PanelLeftOpen aria-hidden className="h-4 w-4" />
        </button>
      )}

      {/* ── Topo-esquerda: legenda e situação ─────────────────────────────────── */}
      {aberto && (
        <PainelDoHud className="absolute left-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[14.5rem] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto">
          <CabecalhoDoHud titulo="Legenda" icone={IconeLegenda}>
            <button
              type="button"
              onClick={() => setAberto(false)}
              aria-label="Recolher os controles do mapa"
              aria-expanded
              className="-mr-1 rounded-control p-1 text-rail-fg-muted transition-colors hover:bg-white/10 hover:text-rail-fg"
            >
              <PanelLeftClose aria-hidden className="h-3.5 w-3.5" />
            </button>
          </CabecalhoDoHud>

          {/* O número que a tela existe para dizer, em mono tabular — a mesma voz de
              `PP-A13-N3`. Sem filtro, um número só; com filtro, a fração. É isto que tira o
              contador de dentro de um grupo recolhível, onde ele só existia aberto. */}
          <FaixaDoHud className="flex items-baseline gap-1">
            {filtrando && <span className="text-code text-sm font-medium text-accent">{emDestaque}</span>}
            {filtrando && <span className="text-code text-sm text-fg-subtle">/</span>}
            <span className={`text-code text-sm font-medium ${filtrando ? 'text-fg-subtle' : 'text-fg'}`}>
              {totalDeVagas}
            </span>
            <span className="ml-1 text-[11px] uppercase tracking-[0.09em] text-fg-subtle">
              {filtrando ? 'em destaque' : 'vagas'}
            </span>
          </FaixaDoHud>

          <FaixaDoHud className="space-y-2">
          {/* "Colorir por" vive AQUI, encostado na legenda que ele comanda. Antes ficava
              no meio da seção de busca, a três controles de distância — e a legenda
              trocava inteira sem nada por perto explicando por quê. */}
          <SegmentedControl options={MODOS} value={modo} onChange={setModo} label="Colorir por" width="full" />

        {modo === 'abc' ? (
          <div className="space-y-2">
            {LEGENDA_ABC.map(({ classe, rotulo }) => (
              <div key={classe} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: ESCALA_ABC[theme][classe] }}
                  />
                  {rotulo}
                </span>
                <span className="text-code text-xs text-fg">{contagemAbc.porClasse[classe]}</span>
              </div>
            ))}

            {contagemAbc.semCurva > 0 && (
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-xs text-fg-muted">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: COR_ATENUADA[theme] }}
                  />
                  Sem classificação
                </span>
                <span className="text-code text-xs text-fg">{contagemAbc.semCurva}</span>
              </div>
            )}

            {/* A curva tem DATA. A análise classifica um período fechado e não é
                recalculada quando o estoque se move — dizer qual período está colorindo
                é a diferença entre um mapa e um palpite com cara de mapa. */}
            {abc.analise ? (
              <p className="border-t border-edge pt-2 text-xs leading-relaxed text-fg-subtle">
                Curva de giro de <span className="text-fg-muted">{abc.analise.nome}</span>, com
                vendas até <span className="text-code">{abc.analise.periodoFim}</span>.
              </p>
            ) : (
              <p className="border-t border-edge pt-2 text-xs leading-relaxed text-fg-subtle">
                {abcFalhou
                  ? 'Não foi possível carregar a Curva ABC agora. O mapa segue válido nos demais modos.'
                  : 'Nenhuma Curva ABC publicada. Publique uma análise para colorir o armazém por giro.'}
              </p>
            )}
          </div>
        ) : (
        /* A LEGENDA É O FILTRO.
           Havia dois controles listando as mesmas quatro situações: esta legenda, que só
           explicava a cor, e um `<select>` logo abaixo, que filtrava por elas. Duas
           gramáticas, duas listas, os mesmos quatro itens — e nenhuma das duas dizia que a
           outra existia. Agora a linha da legenda É o botão: clicar isola aquela situação,
           clicar de novo devolve o armazém inteiro. O `<select>` deixou de ter o que
           fazer e saiu.

           Só no modo Status. Na Curva ABC a legenda explica classes de giro, que não são
           filtro de situação — linha clicável ali prometeria o que não existe. */
        <div className="-mx-1">
          {LEGENDA.map(({ status, rotulo }) => {
            const ativa = filtro === status;
            return (
              <button
                key={status}
                type="button"
                aria-pressed={ativa}
                title={ativa ? `Mostrar todas as vagas` : `Mostrar só as vagas: ${rotulo.toLowerCase()}`}
                onClick={() => setFiltro(ativa ? 'todas' : status)}
                className={`flex w-full items-center justify-between gap-2 rounded-control px-1 py-1 text-left transition-colors ${
                  ativa ? 'bg-accent/10 text-fg' : 'text-fg-muted hover:bg-surface-3'
                }`}
              >
                <span className="flex items-center gap-2 text-xs">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
                    style={
                      status === 'empty'
                        ? { border: `1px solid ${COR_VAGA[theme].empty}` }
                        : { backgroundColor: COR_VAGA[theme][status] }
                    }
                  />
                  {rotulo}
                </span>
                {/* `.text-code`: é contagem numa coluna, e alinhar na vertical é o que
                    torna a legenda legível de relance. */}
                <span className={`text-code text-xs ${ativa ? 'text-accent' : 'text-fg'}`}>
                  {contagem[status]}
                </span>
              </button>
            );
          })}
        </div>
        )}
          </FaixaDoHud>
        </PainelDoHud>
      )}

      {/* ── Topo-centro: a busca ───────────────────────────────────────────────
          Verbo principal da tela: procurar um produto e descobrir onde ele está. Fica no
          centro do topo porque é onde todo mapa operacional põe busca, e porque ela não
          pertence a nenhum dos outros assuntos — estava no meio de uma coluna de ajustes,
          abaixo da legenda e acima dos filtros, como se fosse mais uma preferência. */}
      {aberto && (
        <PainelDoHud className="absolute left-1/2 top-3 w-[19rem] max-w-[calc(100%-1.5rem)] -translate-x-1/2">
          <FaixaDoHud className="space-y-2">
          {/* "SKU ou produto", NÃO "SKU ou lote". O WMS não tem camadas de lote: o saldo
              é uma linha por endereço e produto, com uma única data de entrada. Oferecer
              busca por lote prometeria algo que nunca encontraria nada. */}
          {/* O ícone dentro do campo é o que o `Input` já sabe fazer: a lupa marcava
              presença só no cabeçalho do grupo, e um campo de busca sem lupa no meio de
              seis controles parecidos não se anuncia como busca. */}
          <Input
            type="search"
            icon={<Search aria-hidden />}
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar SKU ou produto…"
            className="w-full"
          />

          {busca.trim().length >= 2 && (
            <p className="text-xs text-fg-muted">
              {buscando ? (
                'Procurando…'
              ) : achados === null || achados.size === 0 ? (
                'Nenhuma vaga com esse produto.'
              ) : (
                <>
                  <span className="text-code">{achadas.length}</span>{' '}
                  {achadas.length === 1 ? 'vaga encontrada' : 'vagas encontradas'}
                  {/* Com um único resultado, levar a câmera até lá é a ação óbvia — e
                      com vários seria arbitrário escolher qual. */}
                  {achadas.length === 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-1 w-full"
                      onClick={() => focarVaga(achadas[0]?.slot)}
                    >
                      Ir até <span className="text-code ml-1">{achadas[0].slot.id}</span>
                    </Button>
                  )}
                </>
              )}
            </p>
          )}

          {/* Rota de coleta. Vive AQUI, colada na busca, e não num quarto painel
              flutuante: a rota não existe sozinha — ela é a lista que a busca
              produziu, e separá-las esconderia de onde ela veio. */}
          {rota && (
            <div className="space-y-2 border-t border-edge pt-2">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-medium text-fg">
                  <Crosshair aria-hidden className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
                  Rota de coleta
                </span>
                <Button variant="ghost" size="sm" onClick={() => setRotaAberta(a => !a)} aria-expanded={rotaAberta}>
                  {rotaAberta ? 'Recolher' : 'Expandir'}
                </Button>
              </div>

              {rotaAberta && (
                <>
                  {/* O rótulo diz o que a ordem É. Chamar isto de "rota ideal" seria
                      prometer uma otimização que exige distância — e o pulmão não tem
                      distância cadastrada, só a hierarquia do endereço. */}
                  <p className="text-xs leading-relaxed text-fg-subtle">
                    Da entrada mais antiga para a mais nova. Não é a rota mais curta: o pulmão não
                    tem distâncias cadastradas.
                  </p>

                  <ol className="space-y-1">
                    {rota.paradas.map((parada, i) => (
                      <li key={parada.slot.id}>
                        <button
                          type="button"
                          onClick={() => {
                            voarAteParada(parada);
                            setParadaAtual(i + 1);
                          }}
                          className={`flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2 ${
                            i === Math.min(paradaAtual, rota.paradas.length - 1)
                              ? 'bg-surface-2 text-fg'
                              : 'text-fg-muted'
                          }`}
                        >
                          <span className="text-code text-fg-subtle">{parada.ordem}</span>
                          <span className="text-code">{parada.slot.id}</span>
                          <span className="ml-auto shrink-0 text-fg-subtle">N{parada.slot.nivel}</span>
                        </button>
                      </li>
                    ))}
                  </ol>

                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      if (paradaAtual >= rota.paradas.length) {
                        setParadaAtual(0);
                        voarAteParada(rota.paradas[0]);
                        setParadaAtual(1);
                        return;
                      }
                      voarAteParada(rota.paradas[paradaAtual]);
                      setParadaAtual(paradaAtual + 1);
                    }}
                  >
                    {paradaAtual >= rota.paradas.length
                      ? 'Recomeçar a rota'
                      : `Avançar para a parada ${paradaAtual + 1}`}
                  </Button>
                </>
              )}
            </div>
          )}
          </FaixaDoHud>
        </PainelDoHud>
      )}

      {/* ── Topo-direita: a gaveta de Controles ────────────────────────────────
          O que se mexe POUCO. Vista, pavimento, ruas, câmera e medidas da estante são
          ajustes de sessão: escolhe-se uma vez e opera-se por minutos. Deixá-los sempre na
          tela era o que fazia o painel ter a altura do canvas. Numa gaveta, eles continuam
          a um clique e param de ocupar a vista.

          O botão mostra quantos ajustes estão fora do padrão: sem nada mexido, ele é
          neutro; com rua filtrada ou caminhada ligada, acende. É o que impede a gaveta de
          esconder estado — mesmo problema, mesma solução do resumo nos cabeçalhos. */}
      {aberto && (
        <div className="pointer-events-auto absolute right-3 top-3 flex w-[15.5rem] max-w-[calc(100%-1.5rem)] flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => setControlesAbertos(a => !a)}
            aria-expanded={controlesAbertos}
            className={`flex items-center gap-2 rounded-control border px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.09em] shadow-control transition-colors ${
              controlesAbertos
                ? 'border-rail bg-rail text-rail-fg'
                : 'border-edge bg-surface-2 text-fg-muted hover:text-fg'
            }`}
          >
            <SlidersHorizontal aria-hidden className="h-3.5 w-3.5 shrink-0" />
            Controles
            {ajustesAtivos > 0 && (
              <span className="text-code rounded-full bg-accent px-1.5 text-[10px] font-semibold leading-4 text-white">
                {ajustesAtivos}
              </span>
            )}
          </button>

          {controlesAbertos && (
            <PainelDoHud className="flex max-h-[calc(100vh-10rem)] w-full flex-col overflow-y-auto">
        <SecaoDoHud
          titulo="Vista"
          comecaAberta={false}
          resumo={resumoDaVista}
          destacado={modoVisor === 'edicao'}
        >
          <SegmentedControl
            options={MODOS_VISOR}
            value={modoVisor}
            onChange={setModoVisor}
            label="Modo"
            width="full"
          />
          {/* Origem do desenho: ESCOLHA entre duas, então controle de escolha.
              Era um botão de largura cheia que trocava de rótulo a cada clique — "Planta
              do galpão" virava "Vagas por código" —, e um botão que muda de nome ao ser
              clicado não diz se o nome é o estado atual ou o destino. Num segmentado as
              duas opções ficam na tela ao mesmo tempo e a selecionada é óbvia.

              A explicação de 144 caracteres saiu do corpo e virou `title`: prosa dentro de
              uma coluna de 198 px é o sintoma de uma interface que não confia no próprio
              rótulo. Quem quiser a medida da planta passa o mouse. */}
          <div
            title={
              mostrarPlantaFisica
                ? 'Fileiras desenhadas pelas medidas da planta: 10,3 × 45,2 m, corredores de 2,65 m no galpão novo. Status, busca, filtro e rota valem aqui também.'
                : 'Vagas posicionadas pelo código do endereço, em grade regular. Não coincide com o desenho da planta.'
            }
          >
            <SegmentedControl
              options={ORIGENS_DO_DESENHO}
              value={mostrarPlantaFisica ? 'planta' : 'codigo'}
              onChange={v => setMostrarPlantaFisica(() => v === 'planta')}
              label="Origem do desenho"
              width="full"
            />
          </div>

          {/* Seletor de pavimento. Só aparece com mais de um andar cadastrado: um botão
              único marcando "Térreo" seria enfeite ocupando a coluna. */}
          {pavimentos.length > 1 && (
            <div className="flex flex-wrap items-center gap-1 border-t border-edge pt-2">
              <span className="mr-1 text-xs font-medium text-fg-muted">Pavimento</span>
              {pavimentos.map(p => (
                <Button
                  key={p}
                  variant={andar === p ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setAndar(p)}
                >
                  {p === 1 ? 'Térreo' : `${p}º andar`}
                </Button>
              ))}
            </div>
          )}

          {/* Pavimento sem planta: dito por extenso. O desenho vazio sozinho pareceria
              falha de carregamento — e herdar a planta do térreo, que era o que acontecia
              antes, seria pior: mostraria o andar de baixo com o nome do de cima. */}
          {origemDaPlanta === 'vazio' && (
            <Notice tone="neutral">
              Este pavimento ainda não tem planta cadastrada, então não há o que desenhar
              aqui. As medidas de cada trecho — comprimento, fileiras e corredores — são o
              que o mapa usa para montar o galpão.
            </Notice>
          )}
          {modoVisor === 'edicao' && (
            <p className="text-xs text-fg-muted">
              Grade de {PASSO_GRADE_BUILDER} m acesa no piso, e o catálogo de construção na barra
              de baixo. "Salvar construção" grava para a equipe inteira; sem salvar, o que você
              montar some ao sair da tela.
            </p>
          )}
        </SecaoDoHud>

        <SecaoDoHud
          titulo="Ruas"
          resumo={resumoDasRuas}
          destacado={ruasSelecionadas.size > 0}
          comecaAberta={false}
        >
          {/* Trilha, não oito chips soltos.
              Conferir DUAS ruas lado a lado é o caso comum, então o controle é
              multisseleção — mas ele agora usa o MESMO desenho do `SegmentedControl`: uma
              pista com borda e segmentos sem borda dentro. Oito caixinhas com borda
              própria numa coluna de 198 px eram a definição de "N caixinhas em fila" que a
              Design Constitution manda trocar por um controle só.
              Conjunto vazio significa "todas" — é o estado inicial e o que Limpar devolve. */}
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-xs text-fg-muted">
              <IconeRua className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />
              {ruasSelecionadas.size === 0 ? 'Todas' : `${ruasSelecionadas.size} de ${ruas.length}`}
            </span>
            {ruasSelecionadas.size > 0 && (
              <button
                type="button"
                className="text-xs text-accent underline-offset-2 hover:underline"
                onClick={limparRuas}
              >
                Limpar
              </button>
            )}
          </div>
          <TrilhaDeRuas
            ruas={ruas}
            selecionadas={ruasSelecionadas}
            onAlternar={r =>
              setRuasSelecionadas(atual => {
                const proximo = new Set(atual);
                if (proximo.has(r)) proximo.delete(r); else proximo.add(r);
                return proximo;
              })
            }
          />
        </SecaoDoHud>

        <SecaoDoHud
          titulo="Câmera"
          comecaAberta={false}
          resumo={resumoDaCamera}
          destacado={caminhando}
        >
          <Button
            variant={caminhando ? 'primary' : 'secondary'}
            size="sm"
            className="w-full"
            onClick={() => setCaminhando(v => !v)}
          >
            {/* O ícone some na saída: "Sair da caminhada" é o fim de um estado, e pegada
                nenhuma ilustra sair. Pôr o mesmo ícone nos dois faria o botão parecer o
                mesmo botão antes e depois do clique. */}
            {!caminhando && <Footprints aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />}
            {caminhando ? 'Sair da caminhada' : 'Caminhar no galpão'}
          </Button>
          {caminhando && (
            <p className="text-xs text-fg-muted">
              Clique na cena para assumir o controle. <span className="text-code">W A S D</span> anda,
              o mouse olha, <span className="text-code">Esc</span> solta o ponteiro. Enquanto caminha,
              clicar não abre vaga.
            </p>
          )}
          {/* Fileira de ícones, não quatro botões empilhados de largura cheia.
              Empilhados, eles davam o mesmo peso visual a coisas de pesos diferentes e
              empurravam o painel para baixo — e a tela cheia seria o quinto. Agrupados,
              ficam lidos pelo que têm em comum: todos mexem na VISTA, nenhum muda dado.
              O rótulo de cada um vai no `title` e no `aria-label`, e diz o que o clique
              FAZ. É a correção do antigo "Fundo: galpão", que mostrava o estado atual e
              deixava ninguém saber se clicar ligava ou desligava. */}
          <div className="flex items-center gap-1">
            <BotaoDeVista
              rotulo="Resetar a câmera para a vista inicial"
              onClick={resetarCamera}
              disabled={caminhando}
            >
              <RotateCcw aria-hidden className="h-4 w-4" />
            </BotaoDeVista>
            {/* "Limpo" existe para quem precisa de quadro: o cenário custa um piso, quatro
                paredes e um passe de sombra, e numa máquina fraca isso é o que sobra de
                orçamento. Voltar para ele devolve exatamente a cena anterior. */}
            <BotaoDeVista
              rotulo={fundo === 'galpao' ? 'Esconder o galpão em volta' : 'Mostrar o galpão em volta'}
              ativo={fundo === 'galpao'}
              onClick={() => setFundo(f => (f === 'galpao' ? 'limpo' : 'galpao'))}
            >
              {fundo === 'galpao'
                ? <Sun aria-hidden className="h-4 w-4" />
                : <SunDim aria-hidden className="h-4 w-4" />}
            </BotaoDeVista>
            {/* Escondido quando a API não existe ou está bloqueada — um botão de tela
                cheia que não abre tela cheia é pior do que nenhum. */}
            {suportaTelaCheia && (
              <BotaoDeVista
                rotulo={telaCheia ? 'Sair da tela cheia (F)' : 'Ver em tela cheia (F)'}
                ativo={telaCheia}
                onClick={alternarTelaCheia}
              >
                {telaCheia
                  ? <Minimize aria-hidden className="h-4 w-4" />
                  : <Maximize aria-hidden className="h-4 w-4" />}
              </BotaoDeVista>
            )}
            <BotaoDeVista rotulo="Capturar a visão 3D como imagem" onClick={capturarCena}>
              <Camera aria-hidden className="h-4 w-4" />
            </BotaoDeVista>
          </div>
          {/* Fora da fileira: abre um modal e mexe na MEDIDA da estante, não na vista.
              Na fileira, pareceria mais um ajuste de câmera. A régua diz isso num
              desenho — é medida, não enquadramento. */}
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setAjustando(true)}>
            <Ruler aria-hidden className="mr-1.5 h-3.5 w-3.5 shrink-0" />
            Ajustar estrutura
          </Button>
        </SecaoDoHud>
            </PainelDoHud>
          )}
        </div>
      )}

      {/* ── Base-esquerda: o que o mapa precisa apontar ────────────────────────
          Alerta e vaga-sem-posição não são ajuste: são FATOS sobre o armazém que a tela
          tem obrigação de mostrar. Ficavam no meio da coluna de controles, entre a legenda
          e a vista, com o mesmo peso de um seletor de pavimento. Aqui embaixo, soltos e
          sem painel em volta, eles só existem quando há o que dizer — e nunca somem atrás
          de um cabeçalho recolhido nem competem com um controle. */}
      {aberto && (temAlerta || naoPosicionaveis > 0) && (
        <div className="pointer-events-auto absolute bottom-3 left-3 flex w-[14.5rem] max-w-[calc(100%-1.5rem)] flex-col gap-1.5">
          {/* Acima da capacidade. Aparece SÓ quando há: um chip permanente marcando zero
              vira ruído e, pior, treina a pessoa a ignorá-lo.
              A cor do ícone vem da CENA, não de `text-amber-400` — tem de ser exatamente o
              âmbar que pinta a vaga lá dentro, senão viram dois amarelos parecidos e
              diferentes. */}
          {contagem.divergence > 0 && (
            <button
              type="button"
              title="Isolar as vagas acima da capacidade e levar a câmera até a primeira"
              onClick={() => {
                setFiltro('divergence');
                focarVaga(divergentes[0]?.slot);
              }}
              className="pointer-events-auto flex items-center gap-2 rounded-control border border-edge/70 bg-surface-2 px-2.5 py-2 text-left shadow-panel transition-colors hover:bg-surface-3"
            >
              <ShieldAlert
                aria-hidden
                className="h-4 w-4 shrink-0"
                style={{ color: COR_VAGA[theme].divergence }}
              />
              <span className="text-code text-sm font-medium text-fg">{contagem.divergence}</span>
              <span className="text-xs text-fg-muted">acima da capacidade</span>
            </button>
          )}

          {/* Mesma regra. Leva junto o modo de cor, porque o alerta não faz sentido sobre o
              mapa de Status — o losango explica POR QUE a vaga está marcada apenas quando a
              cor é a curva. O vermelho é o do marcador 3D do mesmo alerta: ícone e marcador
              têm de ser a mesma cor, senão são lidos como dois avisos. */}
          {alertasGiro.length > 0 && (
            <button
              type="button"
              title="Colorir por Curva ABC e levar a câmera até a primeira vaga de alto giro elevada"
              onClick={() => {
                setModo('abc');
                focarVaga(alertasGiro[0]);
              }}
              className="pointer-events-auto flex items-center gap-2 rounded-control border border-edge/70 bg-surface-2 px-2.5 py-2 text-left shadow-panel transition-colors hover:bg-surface-3"
            >
              <ShieldAlert aria-hidden className="h-4 w-4 shrink-0" style={{ color: COR_ALERTA_GIRO }} />
              <span className="text-code text-sm font-medium text-fg">{alertasGiro.length}</span>
              <span className="text-xs text-fg-muted">
                {alertasGiro.length === 1 ? 'alto giro elevado' : 'alto giro elevadas'}
              </span>
            </button>
          )}

          {/* Vaga sem posição não é descartada em silêncio: some do desenho, mas o número
              fica à vista. Senão o 3D mostraria menos armazém do que existe. Não é botão —
              não há para onde levar a câmera. */}
          {naoPosicionaveis > 0 && (
            <p className="rounded-control border border-edge/70 bg-surface-2 px-2.5 py-2 text-xs leading-relaxed text-fg-muted shadow-panel">
              <span className="text-code text-fg">{naoPosicionaveis}</span> vaga(s) fora do padrão
              de código não aparecem no mapa.
            </p>
          )}
        </div>
      )}

      <AjusteDeEstrutura
        aberto={ajustando}
        onFechar={() => setAjustando(false)}
        layout={layout}
        ruas={ruas}
        onMudar={trocarLayout}
      />
    </>
  );
}
