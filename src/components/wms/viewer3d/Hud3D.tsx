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
import type { ReactNode } from 'react';
import {
  Camera, ChevronDown, Crosshair, Footprints, Layers, Maximize, Minimize,
  PanelLeftClose, PanelLeftOpen, RotateCcw, Ruler, Search, ShieldAlert,
  SlidersHorizontal, Sun, SunDim, View,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Button, Input, Modal, Notice, Panel, PanelSection, Select, SegmentedControl,
} from '../../ui';
import type { Theme } from '../../../lib/useTheme';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import { LAYOUT_PADRAO, LIMITES, baseDaRua, type Layout3DConfig } from '../../../lib/wms/warehouse3dLayout';
import type { AbcClasse, AbcDoArmazem } from '../../../lib/wms/warehouse3dAbc';
import type { ParadaDaRota } from '../../../lib/wms/warehouse3dRota';
import type { FundoDaCena } from '../WarehouseEnvironment';
import {
  CATALOGO, CORES_DE_ESTANTE, COR_ALERTA_GIRO, COR_ATENUADA, COR_VAGA, ESCALA_ABC,
  ESTANTES, FILTROS, LEGENDA, LEGENDA_ABC, MODOS, MODOS_VISOR, PASSO_GRADE_BUILDER,
  LARGURA_ESTREITA,
  type FerramentaBuilder, type FiltroStatus, type ModoCor, type ModoVisor,
  type TipoConstruido, type TipoDeEstante,
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
 * Um grupo do painel: cabeçalho com ícone, resumo do que está ativo e corpo recolhível.
 *
 * ── Por que agrupar ────────────────────────────────────────────────────────────
 * O painel era uma coluna única de onze controles sem hierarquia nenhuma: legenda, modo,
 * planta, pavimento, busca, rota, cor, ruas, status, alertas, câmera. Tudo com o mesmo
 * peso, nessa ordem, e nada dizendo o que pertencia a quê — "Colorir por" ficava no meio
 * da seção de busca, a três controles de distância da legenda que ele comanda.
 *
 * ── Por que o resumo aparece SEMPRE, aberto ou fechado ─────────────────────────
 * É ele que torna o recolhimento honesto. Uma seção fechada escondendo um filtro ligado
 * faria a tela mentir sobre o que está mostrando — e um mapa que esconde que está
 * filtrado é pior do que um mapa sem filtro. Com o resumo no cabeçalho, "2 ruas · 207 de
 * 215" continua visível com o grupo inteiro recolhido.
 *
 * `destacado` acende ícone e resumo no accent: a cor de ação e estado ativo do produto,
 * nunca decoração. Sem nada fora do padrão, o grupo fica neutro.
 *
 * Sem fundo de hover no cabeçalho inteiro, de propósito: um bloco cinza por trás de cada
 * título devolveria ao painel as cinco caixas que o agrupamento veio tirar. O que dá a
 * pista de que é clicável é o galão girando e o título acendendo.
 */
function SecaoDoHud({
  titulo,
  icone: Icone,
  resumo,
  destacado = false,
  comecaAberta = true,
  children,
}: {
  titulo: string;
  icone: LucideIcon;
  /** O que está ativo aqui dentro, em uma linha curta. */
  resumo?: string;
  /** Há algo fora do padrão neste grupo. */
  destacado?: boolean;
  comecaAberta?: boolean;
  children: ReactNode;
}) {
  const [aberta, setAberta] = useState(comecaAberta);

  return (
    <PanelSection padding="sm" className="space-y-2">
      <button
        type="button"
        onClick={() => setAberta(a => !a)}
        aria-expanded={aberta}
        className="group flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Icone
          aria-hidden
          className={`h-3.5 w-3.5 shrink-0 ${destacado ? 'text-accent' : 'text-fg-subtle'}`}
        />
        <span className="text-xs font-medium text-fg-muted transition-colors group-hover:text-fg">
          {titulo}
        </span>
        <span
          className={`ml-auto truncate text-xs ${destacado ? 'text-accent' : 'text-fg-subtle'}`}
        >
          {resumo ?? ''}
        </span>
        <ChevronDown
          aria-hidden
          className={`h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform ${aberta ? '' : '-rotate-90'}`}
        />
      </button>
      {aberta && children}
    </PanelSection>
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
  objetos: { id: string }[];
  /** Id da peça selecionada SE for porta-pallets — tipo e cor só valem para estante. */
  selecionadoDoTipoEstante: string | null;
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
    salvandoPecas, erroAoSalvar, salvoEm,
  } = builder;
  const {
    setModo, setModoVisor, setMostrarPlantaFisica, setAndar, setBusca, setFiltro,
    setRuasSelecionadas, limparRuas, setRotaAberta, setParadaAtual, setCaminhando, setFundo,
    alternarTelaCheia, setAjustando, setFerramenta, setEstanteEscolhida, setCorEscolhida,
    setSelecionadoNoBuilder, ajustarObjeto, salvarConstrucao, focarVaga, voarAteParada,
    resetarCamera, capturarCena, trocarLayout,
  } = acoes;

  /**
   * Painel recolhido.
   *
   * Nasce fechado em tela estreita e aberto no resto. Lido UMA vez, na montagem: trocar
   * sozinho a cada redimensionamento reabriria o painel que a pessoa acabou de fechar.
   */
  const [aberto, setAberto] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= LARGURA_ESTREITA,
  );

  // ── Resumos de cabeçalho ──────────────────────────────────────────────────────
  //
  // O que cada grupo diz de si quando está recolhido. Calculados aqui, e não dentro de
  // `SecaoDoHud`, porque é o HUD que sabe o que conta como "fora do padrão" em cada
  // assunto — a seção só sabe desenhar.

  const filtrando = ruasSelecionadas.size > 0 || filtro !== 'todas';
  const resumoDosFiltros = filtrando
    ? [
        ruasSelecionadas.size > 0
          ? `${ruasSelecionadas.size} ${ruasSelecionadas.size === 1 ? 'rua' : 'ruas'}`
          : null,
        // O número em destaque entra no RESUMO, não só no corpo: é ele que diz quanto do
        // armazém sobrou na tela, e é exatamente o que não pode sumir num grupo fechado.
        `${emDestaque} de ${totalDeVagas}`,
      ]
        .filter(Boolean)
        .join(' · ')
    : `${totalDeVagas} ${totalDeVagas === 1 ? 'vaga' : 'vagas'}`;

  const buscaAtiva = busca.trim().length >= 2;
  const resumoDaBusca = !buscaAtiva
    ? undefined
    : buscando
      ? 'procurando…'
      : `${achadas.length} ${achadas.length === 1 ? 'vaga' : 'vagas'}`;

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
            <PanelSection padding="sm">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <Button
                  variant={ferramenta === 'navegar' ? 'primary' : 'ghost'}
                  size="sm"
                  onClick={() => setFerramenta('navegar')}
                >
                  Selecionar / Navegar
                </Button>
                <span aria-hidden className="mx-0.5 h-5 w-px bg-edge" />
                {(Object.keys(CATALOGO) as TipoConstruido[]).map(tipo => (
                  <Button
                    key={tipo}
                    variant={ferramenta === tipo ? 'primary' : 'ghost'}
                    size="sm"
                    onClick={() => {
                      setFerramenta(tipo);
                      // Soltar a seleção ao armar a ferramenta: a mini-barra de girar e
                      // excluir sobre a peça antiga só atrapalharia a mira da nova.
                      setSelecionadoNoBuilder(null);
                    }}
                  >
                    + {CATALOGO[tipo].rotulo}
                  </Button>
                ))}
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
              <div className="mt-2 flex items-center justify-center gap-2 border-t border-edge pt-2">
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

              <p className="mt-1.5 text-center text-xs text-fg-subtle">
                {ferramenta === 'navegar'
                  ? `Clique numa peça para girar ou excluir. ${objetos.length} ${objetos.length === 1 ? 'peça colocada' : 'peças colocadas'}.`
                  : 'Mova o ponteiro sobre o piso e clique para construir. R gira, Del exclui.'}
              </p>
            </PanelSection>
          </Panel>
        </div>
      )}

      {/* Recolhido, sobra SÓ este botão. Em tela estreita o painel de 15 rem cobria metade
          do canvas e a gaveta de detalhe entrava por cima dele — e quem abre um mapa 3D no
          celular quer ver o galpão, não os controles. */}
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

      {/* `max-h` + rolagem: o painel cresceu com o seletor de modo e o catálogo, e numa
          altura de canvas menor ele passava do fim da moldura — o rodapé (contagem em
          destaque, resetar câmera, capturar vista) simplesmente ficava fora da tela, sem
          nada indicando que havia mais coisa ali. */}
      {aberto && (
      <Panel className="pointer-events-auto absolute left-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[15rem] max-w-[calc(100%-1.5rem)] flex-col overflow-y-auto">
        {/* Fechar fica no TOPO do painel, não flutuando fora dele: é a borda que a pessoa
            já está olhando quando decide que quer a cena inteira. */}
        <PanelSection padding="sm" className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg-muted">Controles</span>
          <button
            type="button"
            onClick={() => setAberto(false)}
            aria-label="Recolher os controles do mapa"
            aria-expanded
            className="-mr-1 rounded-control p-1 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg"
          >
            <PanelLeftClose aria-hidden className="h-4 w-4" />
          </button>
        </PanelSection>
        {/* A legenda acompanha o modo. Mostrar as duas ao mesmo tempo obrigaria a
            pessoa a descobrir sozinha qual delas explica o que está na tela. */}
        <SecaoDoHud
          titulo="Legenda"
          icone={Layers}
          resumo={MODOS.find(m => m.value === modo)?.label.toLowerCase()}
        >
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
        <div className="space-y-2">
          {LEGENDA.map(({ status, rotulo }) => (
            <div key={status} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-xs text-fg-muted">
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
              <span className="text-code text-xs text-fg">{contagem[status]}</span>
            </div>
          ))}
        </div>
        )}
        </SecaoDoHud>

        {/* Os dois atalhos de alerta, FORA de qualquer grupo recolhível.
            Eles viviam no meio da seção de filtros — e um aviso de mercadoria acima da
            capacidade atrás de um cabeçalho fechado é um aviso que não avisa. Aqui a
            faixa só existe quando há o que apontar, então ela nunca é espaço vazio. */}
        {temAlerta && (
          <PanelSection padding="sm" className="space-y-2">
            {/* Atalho para o alerta. Aparece SÓ quando há alerta: um botão permanente
                marcando zero vira ruído e, pior, treina a pessoa a ignorá-lo. */}
            {contagem.divergence > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  setFiltro('divergence');
                  focarVaga(divergentes[0]?.slot);
                }}
              >
                {/* A cor vem da CENA, não de `text-amber-400`: o ícone tem de ser
                    exatamente o âmbar que pinta a vaga lá dentro. Paleta Tailwind crua
                    aqui criaria um segundo amarelo, parecido e diferente. */}
                <ShieldAlert
                  aria-hidden
                  className="mr-1.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: COR_VAGA[theme].divergence }}
                />
                Ver <span className="text-code mx-1">{contagem.divergence}</span> acima da capacidade
              </Button>
            )}

            {/* Mesma regra do atalho acima: aparece só quando há o que apontar. Leva junto
                o modo de cor, porque o alerta não faz sentido sobre o mapa de Status — o
                losango explica POR QUE a vaga está marcada apenas quando a cor é a curva. */}
            {alertasGiro.length > 0 && (
              <Button
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  setModo('abc');
                  focarVaga(alertasGiro[0]);
                }}
              >
                {/* Vermelho do marcador 3D do mesmo alerta — o losango que paira sobre a
                    vaga. Ícone e marcador têm de ser a mesma cor, senão são lidos como
                    dois avisos diferentes. */}
                <ShieldAlert
                  aria-hidden
                  className="mr-1.5 h-3.5 w-3.5 shrink-0"
                  style={{ color: COR_ALERTA_GIRO }}
                />
                <span className="text-code mr-1">{alertasGiro.length}</span>
                {alertasGiro.length === 1 ? 'vaga de alto giro elevada' : 'vagas de alto giro elevadas'}
              </Button>
            )}
          </PanelSection>
        )}

        {/* Para que serve a cena. Fica no topo porque decide o que vem abaixo: no modo
            Edição o painel continua sendo o mesmo, mas a cena aceita construção. */}
        <SecaoDoHud
          titulo="Vista"
          icone={View}
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
          <Button
            variant={mostrarPlantaFisica ? 'primary' : 'secondary'}
            size="sm"
            className="w-full"
            onClick={() => setMostrarPlantaFisica(v => !v)}
          >
            {mostrarPlantaFisica ? 'Planta do galpão' : 'Vagas por código'}
          </Button>
          <p className="text-xs text-fg-muted">
            {mostrarPlantaFisica
              ? 'Fileiras desenhadas pelas medidas da planta: 10,3 × 45,2 m, corredores de 2,65 m no galpão novo. Status, busca, filtro e rota valem aqui também.'
              : 'Vagas posicionadas pelo código do endereço, em grade regular. Não coincide com o desenho da planta.'}
          </p>

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
          titulo="Busca e rota"
          icone={Search}
          resumo={resumoDaBusca}
          destacado={buscaAtiva}
        >
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

        </SecaoDoHud>

        {/* Filtros começa RECOLHIDO, e é o único grupo que começa assim: são os controles
            que menos se mexem e os que mais ocupavam coluna. O que impede isso de
            esconder estado é o resumo do cabeçalho, que diz quantas ruas e quantas vagas
            sobraram em destaque mesmo com o grupo inteiro fechado. */}
        <SecaoDoHud
          titulo="Filtros"
          icone={SlidersHorizontal}
          resumo={resumoDosFiltros}
          destacado={filtrando}
          comecaAberta={false}
        >
          {/* Caixas em vez de dropdown: conferir DUAS ruas lado a lado é o caso comum, e
              o dropdown obrigava a escolher uma ou ver o galpão inteiro. Conjunto vazio
              significa "todas" — é o estado inicial e o que o botão Limpar devolve. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">
                {ruasSelecionadas.size === 0
                  ? 'Todas as ruas'
                  : `${ruasSelecionadas.size} de ${ruas.length} ruas`}
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
            <div className="flex flex-wrap gap-1">
              {ruas.map(r => {
                const ativa = ruasSelecionadas.has(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={ativa}
                    onClick={() =>
                      setRuasSelecionadas(atual => {
                        const proximo = new Set(atual);
                        if (proximo.has(r)) proximo.delete(r); else proximo.add(r);
                        return proximo;
                      })
                    }
                    className={`text-code rounded-control border px-2 py-1 text-xs ${
                      ativa
                        ? 'border-accent bg-accent/15 text-fg'
                        : 'border-edge text-fg-muted hover:bg-surface-3'
                    }`}
                  >
                    {r}
                  </button>
                );
              })}
            </div>
          </div>

          {/* O filtro de status agora DIZ que está ligado.
              Um `<select>` marcando "Livres" tem exatamente a mesma aparência de um
              marcando "Todas as vagas" — e com ele ligado o mapa esconde a maior parte do
              armazém. O anel no accent e o "Limpar" são o mesmo par que as ruas já
              tinham; faltava ao status, que é o filtro mais radical dos dois. */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">Situação</span>
              {filtro !== 'todas' && (
                <button
                  type="button"
                  className="text-xs text-accent underline-offset-2 hover:underline"
                  onClick={() => setFiltro('todas')}
                >
                  Limpar
                </button>
              )}
            </div>
            <Select
              value={filtro}
              onChange={e => setFiltro(e.target.value as FiltroStatus)}
              className={`w-full ${filtro !== 'todas' ? 'border-accent ring-1 ring-accent/30' : ''}`}
            >
              {FILTROS.map(f => (
                <option key={f.value} value={f.value}>
                  {f.rotulo}
                  {f.value === 'todas' ? '' : ` (${contagem[f.value]})`}
                </option>
              ))}
            </Select>
          </div>

          {/* O filtro isola, não amputa: as demais vagas continuam desenhadas em tom
              apagado, senão o armazém perderia a forma e o 3D perderia a razão. */}
          <p className="text-xs text-fg-subtle">
            <span className="text-code">{emDestaque}</span> de{' '}
            <span className="text-code">{totalDeVagas}</span> em destaque
          </p>
        </SecaoDoHud>

        {/* Vaga sem posição não é descartada em silêncio: some do desenho, mas o
            número fica à vista. Senão o 3D mostraria menos armazém do que existe. */}
        {naoPosicionaveis > 0 && (
          <PanelSection padding="sm">
            <p className="text-xs leading-relaxed text-fg-muted">
              <span className="text-code">{naoPosicionaveis}</span> vaga(s) fora do
              padrão de código não aparecem no mapa.
            </p>
          </PanelSection>
        )}

        <SecaoDoHud
          titulo="Câmera e galpão"
          icone={Camera}
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
      </Panel>
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
