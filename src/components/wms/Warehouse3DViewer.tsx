// Pulmão -> Visualização 3D.
//
// Por que 3D, se o `WmsStorageMap` 2D já existe: o mapa 2D responde bem "quanto desta
// rua está cheio", porque achata uma rua de cada vez. O que ele não mostra é a relação
// entre ruas — altura ocupada, corredores vazios inteiros, alerta concentrado num
// nível. Essa é a pergunta que justifica a terceira dimensão; se não fosse, a tabela
// bastava.
//
// A regra de status NÃO mora aqui: ela está em `lib/wms/warehouse3dSlots.ts`, onde é
// testável sem WebGL. Dentro do `<Canvas>` só se poderia prová-la por screenshot, que
// é a forma mais fraca de mostrar que uma cor significa o que diz.
//
// ── Desenho em lote ─────────────────────────────────────────────────────────────
// As vagas são desenhadas com `<Instances>`: DOIS objetos de GPU no total, não um por
// vaga. Com um `<mesh>` por vaga, 5.000 endereços seriam 5.000 draw calls e a placa
// engasgaria muito antes disso. Aqui o custo de GPU é praticamente o mesmo para 71 ou
// para 5.000 — o que cresce é o lado React, não o desenho.
//
// Este arquivo ainda não é importado por nenhuma tela — plugá-lo numa rota é passo
// separado e deliberado.

import {
  Component, useCallback, useEffect, useMemo, useRef, useState,
  type ElementRef, type ReactNode,
} from 'react';
import { PerspectiveCamera, Vector3 } from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, PointerLockControls } from '@react-three/drei';
// Só os pesos e o subconjunto que esta tela usa. O pacote inteiro tem 2,4 MB (todos os
// alfabetos e pesos); estes três arquivos somam 72 kB. E ficam no CHUNK DO MAPA 3D, que
// é carregado sob demanda — quem nunca abre a seção não baixa fonte nenhuma.
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import '@fontsource/jetbrains-mono/latin-600.css';
import { BrandLoader, Button, Notice } from '../ui';
import { useTheme } from '../../lib/useTheme';
import {
  aplicarSaldo, loadWarehouseSlots,
  type Slot, type SlotStatus, type WarehouseSlots,
} from '../../lib/wms/warehouse3dSlots';
import { assinarMudancasDoPulmao } from '../../lib/wms/warehouse3dRealtime';
import {
  VAGA, baseDaRua, carregarLayout, posicaoDaVaga, salvarLayout, type Layout3DConfig,
} from '../../lib/wms/warehouse3dLayout';
import { boxesForBin, searchStock } from '../../lib/wms/wmsService';
import { listarPecas, salvarPecas } from '../../lib/wms/builderObjects';
// A ponte com o Slotting: a planta do armazém é UMA só, e quem a edita é o configurador
// 2D. O 3D lê a publicada em vez de manter uma segunda verdade sobre o mesmo galpão.
import { getPublishedLayout, getFloorPlanSignedUrl } from '../../lib/slottingLayoutService';
// A planta como geometria: as fileiras vêm das medidas, não do código da vaga.
import {
  AZ2027_TERREO, blocosDaPlanta, comprimentoTotal, LARGURA_DO_PREDIO, mesasDaPlanta,
} from '../../lib/wms/warehouse3dPlantaFisica';
// As medidas da planta vêm do banco; a constante acima fica como retrato e como fallback.
import {
  ROTULOS_PADRAO, carregarPlantaFisica, listarPavimentos, type PlantaFisicaCarregada,
} from '../../lib/wms/planoFisicoService';
// Onde a vaga está, conforme a vista ativa. As duas geometrias não se convertem por
// offset — ver o cabeçalho do módulo.
import {
  cabeceiraDaPlanta, emMundo, indiceDosVaos, offsetDaPlanta, recuoDeFoco,
  type Ponto, type ResolvedorLocal,
} from '../../lib/wms/warehouse3dCoordenadas';
// A regra de destaque, compartilhada pelas duas vistas.
import { destaqueDaVaga, type ContextoDeDestaque } from '../../lib/wms/warehouse3dDestaque';
// Cerca do prédio e colisão da caminhada. As paredes da cena são cenário, não o galpão.
import {
  caixasDaPlanta, cercaDaPlanta, cercaDeContorno, type CaixaPlana,
} from '../../lib/wms/warehouse3dColisao';
import {
  ABC_VAZIO, alertasDeGiro, loadAbcDoArmazem,
  type AbcClasse, type AbcDoArmazem,
} from '../../lib/wms/warehouse3dAbc';
import {
  areaDoRadar, caminhoDoCone, celulasDoRadar, localParaMundo, mundoParaLocal, prenderNaArea,
} from '../../lib/wms/warehouse3dRadar';
import {
  caminhoNoPiso, paradasDaRota, subidasAteAVaga, type ParadaDaRota,
} from '../../lib/wms/warehouse3dRota';
import {
  ALTURA_DA_TARJA, anguloDaCamera, desenharLegenda, legendaDaAuditoria, nomeDoArquivo,
} from '../../lib/wms/warehouse3dSnapshot';
import { montantesDoArmazem, vigasDoArmazem } from '../../lib/wms/warehouse3dEstrutura';
import { type FundoDaCena } from './WarehouseEnvironment';
// ── O módulo fatiado ─────────────────────────────────────────────────────────────
// Cor, catálogo e medidas em `aparencia`; objetos de GPU em `recursos3d`; tudo que vive
// dentro do `<Canvas>` em `Cena3D`. Este arquivo ficou com estado, carregamento e HUD.
import {
  ANDAR_INICIAL, CORES_DE_ESTANTE, COR_ATENUADA, COR_BUSCA, COR_PULSO, DURACAO_PULSO,
  LARGURA_ESTREITA,
  MARGEM_DA_CERCA,
  corDaVaga,
  type FerramentaBuilder, type FiltroStatus, type ModoCor, type ModoVisor,
  type ObjetoConstruido, type TipoConstruido, type TipoDeEstante,
} from './viewer3d/aparencia';
import { type VagaDesenhavel } from './viewer3d/recursos3d';
import { esquecerConteudoDaVaga } from './viewer3d/cacheDeConteudo';
import { Hud3D } from './viewer3d/Hud3D';
import { PainelDetalhe } from './viewer3d/PainelDetalhe';
import { Radar } from './viewer3d/Radar3D';
import {
  Caminhada, CapturadorDeCena, Cena, PanSuave, SondaDeCamera,
  type CanalDeHover, type DestinoDeCamera, type PlacaDeRua, type PlantaNoPiso,
  type RotaDesenhavel,
} from './viewer3d/Cena3D';

export type { Slot, SlotStatus } from '../../lib/wms/warehouse3dSlots';

// ── Geometria ──────────────────────────────────────────────────────────────────
//
// As medidas e a conversão endereço -> posição moram em `lib/wms/warehouse3dLayout`,
// onde são aritmética conferível sem WebGL. Aqui só se desenha.
//
// Uma vaga é 1,2 x 1,4 x 1,2 METROS — palete PBR carregado, não um cubo arbitrário.
// Cubo perfeito faria o armazém parecer uma estante de cubos, que é a leitura errada.

// ── Cor ────────────────────────────────────────────────────────────────────────
//
// Aqui o hex é inevitável: material de WebGL não lê variável CSS. Então o arquivo
// mantém o seu próprio mapa — um único ponto de verdade, como um token — em vez de
// espalhar literais pelo JSX.
//
// `occupied` é PAPELÃO, não a navy da marca — e a troca foi deliberada quando a vaga
// deixou de ser um cubo e passou a ser pallet com caixas.
//
// "Ocupada" é o estado da maioria esmagadora das vagas de um armazém saudável. Pintar
// a maioria com uma cor forte gasta o recurso mais escasso da cena — a atenção — no
// caso que não pede nenhuma, e é exatamente o que a Design Constitution proíbe: estado
// default se desenha neutro. Com o papelão como base, o âmbar da divergência e o
// vermelho do giro passaram a ser as ÚNICAS cores saturadas da estante, e saltam.
//
// O tom é pardo dessaturado, não o `#D97706` sugerido: aquele é âmbar, vizinho do
// `#F59E0B` que significa "acima da capacidade" nesta mesma cena. Carga parecida com
// alerta é como apagar o alerta.
//
// A navy da marca não sumiu — ela continua sendo a escala do modo Ocupação, onde
// significa QUANTIDADE e não estado.
// numa das ruas.
const DIRECAO_CAMERA: [number, number, number] = [7.5, 6.5, 9.5];

/** Multiplicador sobre a diagonal do armazém. 1,5 dá a folga da vista de referência. */
const FOLGA_CAMERA = 1.5;

/**
 * Distância da câmera suficiente para o armazém inteiro caber no quadro.
 *
 * Usa a DIAGONAL da caixa que contém tudo, não só a maior aresta: um armazém longo e
 * estreito e um quadrado de mesma largura precisam de recuos diferentes, e a diagonal
 * é o que distingue os dois.
 */
export function enquadrarCamera(slots: readonly Slot[], cfg: Layout3DConfig): [number, number, number] {
  const magnitude = Math.hypot(...DIRECAO_CAMERA);
  if (slots.length === 0) return DIRECAO_CAMERA;

  const largura = (Math.max(...slots.map(s => s.rua)) - 1) * cfg.rowSpacing + VAGA.largura;
  const profundidade = (Math.max(...slots.map(s => s.modulo)) - 1) * cfg.moduleWidth + VAGA.profundidade;
  // A altura inclui a elevação da estrutura: com o pulmão suspenso a 3 m, a câmera
  // precisa recuar mais, senão o armazém sobe para fora do quadro.
  const topo = Math.max(...slots.map(s => baseDaRua(s.ruaCodigo, cfg) + s.nivel * cfg.levelHeight));

  const distancia = Math.max(Math.hypot(largura, profundidade, topo) * FOLGA_CAMERA, 6);
  const escala = distancia / magnitude;
  return [DIRECAO_CAMERA[0] * escala, DIRECAO_CAMERA[1] * escala, DIRECAO_CAMERA[2] * escala];
}

const FOV_BASE = 45;
const ASPECTO_BASE = 16 / 9;

/**
 * Trava o campo de visão HORIZONTAL em vez do vertical.
 *
 * O three aplica `fov` na vertical, então numa div estreita (celular em pé) o mesmo
 * fov cobre bem menos largura e o armazém sai cortado pelas laterais. Aqui o fov
 * vertical cresce à medida que o aspecto encolhe, de modo que a largura enquadrada
 * permanece a mesma em qualquer formato.
 *
 * Teto de 95°: além disso a perspectiva distorce tanto que as ruas do fundo viram um
 * borrão, e o remédio passa a ser pior que a doença.
 */
function EnquadramentoResponsivo() {
  const camera = useThree(estado => estado.camera);
  const largura = useThree(estado => estado.size.width);
  const altura = useThree(estado => estado.size.height);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera) || altura === 0) return;
    const aspecto = largura / altura;
    const fov =
      aspecto >= ASPECTO_BASE
        ? FOV_BASE
        : (2 * Math.atan(Math.tan((FOV_BASE * Math.PI) / 360) * (ASPECTO_BASE / aspecto)) * 180) / Math.PI;
    camera.fov = Math.min(fov, 95);
    camera.updateProjectionMatrix();
  }, [camera, largura, altura]);

  return null;
}

// ── Proteção contra falha ──────────────────────────────────────────────────────
//
// WebGL falha de formas que um `try/catch` não alcança: driver bloqueado, contexto
// recusado, máquina sem GPU. Sem esta fronteira, qualquer uma dessas derruba a árvore
// React INTEIRA — ou seja, a tela do WMS junto. O armazém some; o resto fica de pé.
//
// Precisa ser classe: React só oferece `componentDidCatch` nessa forma.
interface FronteiraState {
  falhou: boolean;
}

class FronteiraDeErro extends Component<{ children: ReactNode; aoFalhar: ReactNode }, FronteiraState> {
  state: FronteiraState = { falhou: false };

  static getDerivedStateFromError(): FronteiraState {
    return { falhou: true };
  }

  render() {
    return this.state.falhou ? this.props.aoFalhar : this.props.children;
  }
}


interface Warehouse3DViewerProps {
  /**
   * Vagas a desenhar. Omitido, o componente busca os endereços reais do Pulmão.
   * Passar explicitamente serve para teste e para telas que já carregaram os dados.
   */
  slots?: readonly Slot[];
  /**
   * Empresa cuja Curva ABC publicada colore o modo "Curva ABC".
   *
   * Prop, e não `useAuth()` aqui dentro: o componente é renderizável isolado — é para
   * isso que `slots` existe —, e chamar o contexto de autenticação passaria a exigir o
   * `AuthProvider` para desenhar um cubo. Omitido, o modo Curva ABC avisa que não há
   * classificação em vez de sumir.
   */
  companyId?: string;
  /** Chamado ao clicar numa vaga, além de abrir o painel de detalhe interno. */
  onSelectSlot?: (slot: Slot) => void;
  /** Omitido, o botão de leitura de QR Code não aparece. */
  onScanRequest?: (slot: Slot) => void;
  /** Omitido, o botão de movimentação não aparece. */
  onOperate?: (slot: Slot) => void;
  className?: string;
}

type Estado =
  | { fase: 'carregando' }
  | { fase: 'erro'; mensagem: string }
  | { fase: 'pronto'; dados: WarehouseSlots };

// `hud-3d` é o escopo da JetBrains Mono: a regra no index.css só alcança o que está
// dentro desta moldura, então a tipografia técnica do resto do produto fica intocada.
const MOLDURA = 'hud-3d relative h-full min-h-[24rem] w-full overflow-hidden rounded-container bg-surface-2';

export function Warehouse3DViewer({
  slots: slotsExternos,
  companyId,
  onSelectSlot,
  onScanRequest,
  onOperate,
  className = '',
}: Warehouse3DViewerProps) {
  const { theme } = useTheme();
  const controlsRef = useRef<ElementRef<typeof OrbitControls>>(null);
  const [estado, setEstado] = useState<Estado>(() =>
    slotsExternos ? { fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [], codigoPorBinId: new Map() } } : { fase: 'carregando' },
  );

  const [modoVisor, setModoVisor] = useState<ModoVisor>('operacional');

  // A planta reproduzida em 3D pelas medidas. Ligada por padrão: é o desenho do galpão
  // de verdade. Desligar devolve as vagas montadas pelo código, que é onde vivem status,
  // busca e rota — as duas não podem aparecer juntas porque ocupam o mesmo chão.
  const [mostrarPlantaFisica, setMostrarPlantaFisica] = useState(true);

  /**
   * Caminhar dentro do galpão, em vez de orbitar por fora.
   *
   * Sai da órbita porque são dois jeitos incompatíveis de mexer na mesma câmera. Entrar
   * trava o ponteiro do mouse — por isso o rótulo diz como sair, senão a pessoa fica
   * presa sem saber que é Esc.
   */
  const [caminhando, setCaminhando] = useState(false);

  /**
   * As MEDIDAS da planta, agora lidas do banco (migration 133).
   *
   * Nasce com a constante em vez de `null`: assim o primeiro quadro já desenha o galpão
   * inteiro e a leitura só corrige a medida, se houver o que corrigir. Começando vazio, o
   * mapa abriria sem galpão por um instante e a câmera se enquadraria pelo nada.
   */
  const [plantaMedida, setPlantaMedida] = useState<PlantaFisicaCarregada>(() => ({
    trechos: AZ2027_TERREO,
    rotulos: ROTULOS_PADRAO,
    origem: 'constante',
  }));

  /** Pavimento desenhado. Troca recarrega planta e peças — vagas e saldo são do galpão. */
  const [andar, setAndar] = useState(ANDAR_INICIAL);
  /** Pavimentos com planta cadastrada. O térreo entra sempre. */
  const [pavimentos, setPavimentos] = useState<number[]>([ANDAR_INICIAL]);

  useEffect(() => {
    let cancelado = false;
    listarPavimentos().then(lista => {
      if (!cancelado) setPavimentos(lista);
    });
    return () => { cancelado = true; };
  }, []);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const carregada = await carregarPlantaFisica(andar);
      if (cancelado) return;
      // `vazio` também entra no estado, e é o ponto do pavimento honesto: o andar sem
      // planta cadastrada precisa aparecer VAZIO, não herdar o desenho do térreo. Só
      // `constante` é descartada — ela já é o valor inicial, e reatribuí-la geraria um
      // render a mais com o mesmo desenho.
      if (carregada.origem !== 'constante') setPlantaMedida(carregada);
      else if (andar === ANDAR_INICIAL) setPlantaMedida(carregada);
    })();
    return () => { cancelado = true; };
  }, [andar]);

  // ── A planta do armazém no piso do 3D ────────────────────────────────────────────
  // A ponte que faltava: o mapa 3D posicionava tudo por aritmética do código da vaga e
  // nunca tinha olhado para a planta. Aqui ele passa a ler a MESMA planta publicada que
  // o configurador 2D edita — imagem e escala — e desenhá-la no chão da cena.
  const [plantaNoPiso, setPlantaNoPiso] = useState<PlantaNoPiso | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let cancelado = false;
    (async () => {
      // A planta do piso é a do PAVIMENTO desenhado. Sem o andar, o mezanino apareceria
      // com a imagem do térreo no chão.
      setPlantaNoPiso(null);
      const planta = await getPublishedLayout(companyId, andar);
      if (cancelado || !planta?.background_image_path) return;
      const url = await getFloorPlanSignedUrl(planta.background_image_path);
      if (cancelado || !url) return;
      setPlantaNoPiso({
        url,
        // Metros reais, não células: é a escala calibrada que faz a planta ocupar no 3D
        // o mesmo tamanho que ocupa no galpão.
        largura: planta.grid_width * planta.cell_size_meters,
        profundidade: planta.grid_height * planta.cell_size_meters,
      });
    })();
    return () => { cancelado = true; };
  }, [companyId, andar]);

  // ── Builder: tudo local, nada no banco ───────────────────────────────────────────
  // Construir precisa ser barato de desfazer. Com cada clique indo ao Supabase, testar
  // um arranjo deixaria rastro em produção e a borracha dependeria da rede.
  const [ferramenta, setFerramenta] = useState<FerramentaBuilder>('navegar');
  const [objetos, setObjetos] = useState<ObjetoConstruido[]>([]);
  const [selecionadoNoBuilder, setSelecionadoNoBuilder] = useState<string | null>(null);
  // Tipo e cor valem para a PRÓXIMA peça e para a selecionada: escolher antes de colocar
  // e corrigir depois de colocar são as duas formas de usar isto, e as duas precisam
  // funcionar sem obrigar a excluir e refazer.
  const [estanteEscolhida, setEstanteEscolhida] = useState<TipoDeEstante>('simples');
  const [corEscolhida, setCorEscolhida] = useState(CORES_DE_ESTANTE[0].chave);
  const [salvandoPecas, setSalvandoPecas] = useState(false);
  const [erroAoSalvar, setErroAoSalvar] = useState<string | null>(null);
  const [salvoEm, setSalvoEm] = useState<Date | null>(null);

  // Carrega o que a equipe já montou NESTE pavimento. Recarrega ao trocar de andar, e não
  // a cada troca de modo: o esboço do mezanino não pode aparecer no térreo, mas recarregar
  // por mudança de modo descartaria o que a pessoa acabou de colocar e ainda não salvou.
  useEffect(() => {
    let cancelado = false;
    // Lista nova por pavimento: sem isto, trocar de andar manteria na tela as peças do
    // anterior e o "Salvar construção" as gravaria no andar errado.
    setObjetos([]);
    setSelecionadoNoBuilder(null);
    listarPecas(andar).then(salvas => {
      if (cancelado || salvas.length === 0) return;
      setObjetos(salvas.map(p => ({
        id: p.id,
        tipo: p.tipo as TipoConstruido,
        estante: p.estante as TipoDeEstante,
        cor: p.cor,
        x: p.x,
        z: p.z,
        rotacaoY: p.rotacaoY,
      })));
    });
    return () => { cancelado = true; };
  }, [andar]);

  const salvarConstrucao = useCallback(async () => {
    setErroAoSalvar(null);
    setSalvandoPecas(true);
    const r = await salvarPecas(
      objetos.map(o => ({
        id: o.id, tipo: o.tipo, estante: o.estante, cor: o.cor, x: o.x, z: o.z, rotacaoY: o.rotacaoY,
      })),
      andar,
    );
    setSalvandoPecas(false);
    if (!r.ok) { setErroAoSalvar(r.erro ?? 'Não foi possível salvar.'); return; }
    setSalvoEm(new Date());
  }, [objetos, andar]);
  // Contador em vez de random: o id só precisa ser único dentro desta sessão de edição,
  // e um contador é reproduzível quando se está depurando o que foi colocado onde.
  const proximoIdDoObjeto = useRef(1);

  const construirObjeto = useCallback(
    (x: number, z: number) => {
      setFerramenta(atual => {
        if (atual === 'navegar') return atual;
        const id = `obj-${proximoIdDoObjeto.current++}`;
        setObjetos(lista => [
          ...lista,
          { id, tipo: atual, estante: estanteEscolhida, cor: corEscolhida, x, z, rotacaoY: 0 },
        ]);
        setSelecionadoNoBuilder(id);
        return atual;
      });
    },
    [estanteEscolhida, corEscolhida],
  );

  /** Troca tipo ou cor da peça selecionada, para corrigir sem excluir e refazer. */
  const ajustarObjeto = useCallback((id: string, patch: Partial<Pick<ObjetoConstruido, 'estante' | 'cor'>>) => {
    setObjetos(lista => lista.map(o => (o.id === id ? { ...o, ...patch } : o)));
  }, []);

  /** Id da peça selecionada SE ela for porta-pallets — tipo e cor só valem para estante. */
  const selecionadoDoTipoEstante = useMemo(() => {
    const alvo = objetos.find(o => o.id === selecionadoNoBuilder);
    return alvo?.tipo === 'porta-pallets' ? alvo.id : null;
  }, [objetos, selecionadoNoBuilder]);

  const girarObjeto = useCallback((id: string) => {
    setObjetos(lista =>
      lista.map(o => (o.id === id ? { ...o, rotacaoY: o.rotacaoY + Math.PI / 2 } : o)),
    );
  }, []);

  const excluirObjeto = useCallback((id: string) => {
    setObjetos(lista => lista.filter(o => o.id !== id));
    setSelecionadoNoBuilder(atual => (atual === id ? null : atual));
  }, []);

  // Sair do Modo Edição desarma a ferramenta. Sem isto, voltar para cá traria o fantasma
  // já colado no cursor e o primeiro clique construiria sem intenção.
  useEffect(() => {
    if (modoVisor === 'operacional') {
      setFerramenta('navegar');
      setSelecionadoNoBuilder(null);
    }
  }, [modoVisor]);

  // Atalhos R e Del, só com peça selecionada no Modo Edição.
  useEffect(() => {
    if (modoVisor !== 'edicao' || !selecionadoNoBuilder) return;
    const aoTeclar = (e: KeyboardEvent) => {
      // Enquanto a pessoa digita na busca, R é letra, não atalho.
      const alvo = e.target as HTMLElement | null;
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        girarObjeto(selecionadoNoBuilder);
      }
      if (e.key === 'Delete') {
        e.preventDefault();
        excluirObjeto(selecionadoNoBuilder);
      }
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [modoVisor, selecionadoNoBuilder, girarObjeto, excluirObjeto]);

  const [modo, setModo] = useState<ModoCor>('status');
  const [filtro, setFiltro] = useState<FiltroStatus>('todas');
  /** Conjunto VAZIO significa todas as ruas. Guardar "todas" como um valor sentinela
   *  obrigaria cada leitura a lembrar do sentinela; o conjunto vazio ja diz isso. */
  const [ruasSelecionadas, setRuasSelecionadas] = useState<Set<string>>(() => new Set());
  // Lido do localStorage uma vez, na montagem. É preferência de quem monta o mapa, não
  // dado do armazém — o banco não guarda a altura da estrutura.
  const [layout, setLayout] = useState<Layout3DConfig>(carregarLayout);
  const [ajustando, setAjustando] = useState(false);
  const [busca, setBusca] = useState('');
  /** Códigos de vaga que contêm o termo. `null` = nenhuma busca em curso. */
  const [achados, setAchados] = useState<Set<string> | null>(null);
  /** Os mesmos endereços de `achados`, na ordem FIFO que o banco devolveu. */
  const [ordemFifo, setOrdemFifo] = useState<string[]>([]);
  const [rotaAberta, setRotaAberta] = useState(true);
  const [paradaAtual, setParadaAtual] = useState(0);
  const [buscando, setBuscando] = useState(false);
  /**
   * O hover NÃO é estado do React aqui.
   *
   * Ele muda dezenas de vezes por segundo e interessa a um desenho só — o contorno da
   * vaga apontada. Como `useState` neste componente, cada movimento do mouse
   * re-renderizava o visualizador inteiro e, na planta, os ~1.245 elementos dos vãos
   * junto. Agora o valor vive num ref e quem precisa dele assina o canal.
   */
  const canalDeHover = useRef<CanalDeHover>({ atual: null, ouvintes: new Set() });
  /** Moldura, para trocar o cursor sem passar por render. */
  const molduraRef = useRef<HTMLDivElement>(null);

  const apontar = useCallback((slot: Slot | null) => {
    const canal = canalDeHover.current;
    // `onPointerMove` dispara a cada pixel; sem este corte, o mesmo valor seria
    // retransmitido dezenas de vezes por segundo para todos os ouvintes.
    if ((canal.atual?.id ?? null) === (slot?.id ?? null)) return;
    canal.atual = slot;
    molduraRef.current?.classList.toggle('cursor-pointer', !!slot);
    canal.ouvintes.forEach(ouvinte => ouvinte(slot));
  }, []);

  /** Estável de propósito: é o que permite `React.memo` na cena segurar o hover. */
  const assinarHover = useCallback((ouvinte: (slot: Slot | null) => void) => {
    const canal = canalDeHover.current;
    canal.ouvintes.add(ouvinte);
    return () => { canal.ouvintes.delete(ouvinte); };
  }, []);

  const [selecionada, setSelecionada] = useState<Slot | null>(null);
  /** Classificação de giro por endereço. Carregada UMA vez, separada das vagas: o mapa
   *  abre e já desenha no modo Status enquanto isto ainda vem. */
  const [abc, setAbc] = useState<AbcDoArmazem>(ABC_VAZIO);
  const [abcFalhou, setAbcFalhou] = useState(false);
  /**
   * Radar recolhido em tela estreita.
   *
   * Num celular em pé, o radar (12 rem) e a gaveta de detalhe (19 rem) disputam o mesmo
   * canto inferior direito. Recolhido ele vira uma linha de título, e abrir continua sendo
   * um clique. Lido uma vez, na montagem — como o painel de controles.
   */
  const [radarAberto, setRadarAberto] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= LARGURA_ESTREITA,
  );
  const [fundo, setFundo] = useState<FundoDaCena>('galpao');
  /** Preenchida pelo `CapturadorDeCena` assim que o Canvas monta. */
  const capturarRef = useRef<(() => string) | null>(null);
  /** Vagas mexidas por outro operador nos últimos segundos. */
  const [pulsando, setPulsando] = useState<ReadonlySet<string>>(() => new Set());
  const relogiosDoPulso = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** Mapa UUID -> código sempre atual, sem refazer a inscrição a cada recarga. */
  const codigoPorBinIdRef = useRef<ReadonlyMap<string, string>>(new Map());
  /** Vagas que mudaram durante a janela do debounce — a atualização é só delas. */
  const pendentesRef = useRef<Set<string>>(new Set());
  /** Alguma mudança exigiu recarga COMPLETA: vaga criada, bloqueada ou apagada. */
  const completaRef = useRef(false);
  const recargaRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nós do radar movidos por fora do React, a cada quadro. Ver `SondaDeCamera`.
  const radarGrupoRef = useRef<SVGGElement>(null);
  const radarConeRef = useRef<SVGPathElement>(null);
  /** Destino da transição suave. Ref, não estado: muda a cada quadro durante o pan. */
  const destinoRef = useRef<DestinoDeCamera | null>(null);
  /**
   * A câmera está voando até um destino.
   *
   * Precisa ser ESTADO, mesmo com o destino morando num ref: é o que mantém o laço de
   * quadros vivo em `frameloop="demand"`. Sem isto, mandar a câmera para uma parada
   * agendaria um voo que nunca aconteceria, porque ninguém pediria o próximo quadro.
   */
  const [voando, setVoando] = useState(false);

  useEffect(() => {
    if (!companyId) {
      setAbc(ABC_VAZIO);
      return;
    }
    let vivo = true;
    setAbcFalhou(false);
    loadAbcDoArmazem(companyId)
      .then(dados => {
        if (vivo) setAbc(dados);
      })
      .catch(() => {
        // Falhar aqui NÃO derruba o mapa: a curva é uma camada a mais sobre um mapa que
        // já é útil sem ela. Mas o modo Curva ABC não pode fingir que está colorindo o
        // armazém inteiro de cinza por não haver classificação — isso é dito na tela.
        if (vivo) {
          setAbc(ABC_VAZIO);
          setAbcFalhou(true);
        }
      });
    return () => {
      vivo = false;
    };
  }, [companyId]);

  const buscar = useCallback(() => {
    let vivo = true;
    setEstado({ fase: 'carregando' });
    loadWarehouseSlots()
      .then(dados => {
        if (vivo) setEstado({ fase: 'pronto', dados });
      })
      .catch((erro: unknown) => {
        // A mensagem do Supabase é mostrada como está: inventar um texto genérico
        // ("algo deu errado") esconde justamente o que distingue rede caída de
        // permissão negada, que é o que decide o que fazer em seguida.
        if (vivo) setEstado({ fase: 'erro', mensagem: erro instanceof Error ? erro.message : String(erro) });
      });
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (slotsExternos) {
      setEstado({ fase: 'pronto', dados: { slots: [...slotsExternos], naoPosicionaveis: [], codigoPorBinId: new Map() } });
      return;
    }
    return buscar();
  }, [slotsExternos, buscar]);

  /**
   * Busca o termo no saldo e guarda os endereços que o contêm.
   *
   * Usa `searchStock`, que já roda em produção na seção "Consultar SKU" e casa por SKU
   * ou nome do produto. Nenhuma query nova, nenhuma fonte nova de verdade.
   *
   * O atraso de 300 ms existe porque cada tecla dispararia uma ida ao banco: digitar
   * "GCGCM116" seriam oito consultas, sete delas descartadas. `cancelado` descarta a
   * resposta de um termo que já não é o atual — sem isso, uma resposta lenta de um
   * termo antigo sobrescreveria a do termo novo.
   */
  useEffect(() => {
    const termo = busca.trim();
    if (termo.length < 2) {
      setAchados(null);
      setOrdemFifo([]);
      setBuscando(false);
      return;
    }
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      searchStock(termo)
        .then(linhas => {
          if (!cancelado) {
            setAchados(new Set(linhas.map(l => l.binCode)));
            // A ORDEM das linhas é informação, e o Set a joga fora. `searchStock`
            // devolve do saldo mais antigo para o mais novo — é a ordem em que o
            // estoque deve ser consumido, e é ela que vira a rota de coleta.
            setOrdemFifo(linhas.map(l => l.binCode));
            setParadaAtual(0);
            setBuscando(false);
          }
        })
        .catch(() => {
          // Busca que falha não derruba o mapa: volta a mostrar tudo, sem alarde.
          if (!cancelado) {
            setAchados(null);
            setOrdemFifo([]);
            setBuscando(false);
          }
        });
    }, 300);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca]);

  const dados = estado.fase === 'pronto' ? estado.dados : null;
  const vagas = useMemo(() => dados?.slots ?? [], [dados]);

  // ── Tempo real ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (dados) codigoPorBinIdRef.current = dados.codigoPorBinId;
  }, [dados]);

  /** Recarga SEM passar por "carregando": o loader apagaria a cena inteira a cada
   *  movimentação alheia, e quem está olhando o mapa perderia o próprio enquadramento
   *  várias vezes por minuto num galpão em operação. */
  const recarregarSilencioso = useCallback(() => {
    loadWarehouseSlots()
      .then(novos => {
        // Só atualiza se a tela JÁ estava pronta. Sobrescrever um estado de erro ou de
        // carga em curso faria duas fontes disputarem a mesma tela.
        setEstado(atual => (atual.fase === 'pronto' ? { fase: 'pronto', dados: novos } : atual));
      })
      .catch(() => {
        // Falha de recarga em segundo plano não derruba o que está na tela: o mapa
        // continua mostrando o último estado bom, que é melhor que um erro no lugar de
        // um armazém.
      });
  }, []);

  /**
   * Atualiza só as vagas que mudaram.
   *
   * Medido em produção, a recarga completa custa ~1,5 s (215 endereços + a view de saldo)
   * para refletir a movimentação de uma vaga. Aqui vai uma leitura por vaga afetada, e o
   * resto da tela não se mexe: a cena não remonta lote nenhum quando a contagem por status
   * não muda.
   *
   * Qualquer tropeço cai na recarga completa — vaga desconhecida, erro de leitura, estado
   * que ainda não está pronto. Incremental é otimização; completa é a verdade.
   */
  const atualizarVagas = useCallback(
    async (codigos: readonly string[]) => {
      try {
        const saldos = await Promise.all(
          codigos.map(async codigo => [codigo, await boxesForBin(codigo)] as const),
        );
        let desconhecida = false;
        setEstado(atual => {
          if (atual.fase !== 'pronto') return atual;
          let dados = atual.dados;
          for (const [codigo, caixas] of saldos) {
            const proximo = aplicarSaldo(dados, codigo, caixas);
            // Mesma referência com saldo diferente = a vaga não está na tela. Saldo igual
            // também devolve a mesma referência, e aí não há o que recarregar.
            if (proximo === dados && !dados.slots.some(s => s.id === codigo)) desconhecida = true;
            dados = proximo;
          }
          return dados === atual.dados ? atual : { fase: 'pronto', dados };
        });
        if (desconhecida) recarregarSilencioso();
      } catch {
        recarregarSilencioso();
      }
    },
    [recarregarSilencioso],
  );

  /**
   * Uma rajada de movimentações vira UMA atualização.
   *
   * Sem isto, descarregar um pallet de vinte caixas dispararia vinte consultas em
   * sequência. Os códigos se ACUMULAM durante a janela: antes bastava marcar "recarregar",
   * porque a recarga era do armazém inteiro de qualquer jeito.
   *
   * Sem código (vaga criada, bloqueada ou apagada por outro operador) a rajada inteira vira
   * recarga completa — mudança de endereço não se resolve lendo saldo.
   */
  const agendarRecarga = useCallback(
    (codigo?: string | null) => {
      if (codigo) pendentesRef.current.add(codigo);
      else pendentesRef.current.clear();
      if (!codigo) completaRef.current = true;

      if (recargaRef.current) clearTimeout(recargaRef.current);
      recargaRef.current = setTimeout(() => {
        recargaRef.current = null;
        const codigos = [...pendentesRef.current];
        const completa = completaRef.current;
        pendentesRef.current.clear();
        completaRef.current = false;
        if (completa || codigos.length === 0) recarregarSilencioso();
        else void atualizarVagas(codigos);
      }, 400);
    },
    [recarregarSilencioso, atualizarVagas],
  );

  const destacarVaga = useCallback((codigo: string) => {
    setPulsando(anterior => new Set(anterior).add(codigo));
    const relogios = relogiosDoPulso.current;
    // Mexer de novo na mesma vaga reinicia a contagem em vez de somar um segundo
    // temporizador — dois relógios para a mesma vaga apagariam o destaque cedo demais.
    const anterior = relogios.get(codigo);
    if (anterior) clearTimeout(anterior);
    relogios.set(
      codigo,
      setTimeout(() => {
        relogios.delete(codigo);
        setPulsando(atual => {
          const proximo = new Set(atual);
          proximo.delete(codigo);
          return proximo;
        });
      }, DURACAO_PULSO),
    );
  }, []);

  useEffect(() => {
    // Sem empresa, ou com vagas vindas por prop (uso isolado/teste), não há canal a
    // abrir: assinar ali seria socket aberto para dado que ninguém vai usar.
    if (!companyId || slotsExternos) return;
    const assinatura = assinarMudancasDoPulmao(
      companyId,
      () => codigoPorBinIdRef.current,
      codigo => {
        // Sem código conhecido ainda assim recarrega: pode ser vaga criada por outro
        // operador, que precisa APARECER mesmo sem ter o que destacar.
        if (codigo) destacarVaga(codigo);
        // O conteúdo guardado desta vaga acabou de ficar velho. Sem código conhecido,
        // esquece TUDO: não dá para saber qual mudou, e saldo velho com cara de atual é
        // pior do que a espera que o cache economiza.
        esquecerConteudoDaVaga(codigo ?? undefined);
        agendarRecarga(codigo);
      },
    );
    return () => assinatura.cancelar();
  }, [companyId, slotsExternos, destacarVaga, agendarRecarga]);

  // Desmontagem: nenhum temporizador sobrevive à tela que os criou.
  useEffect(() => {
    const relogios = relogiosDoPulso.current;
    return () => {
      relogios.forEach(clearTimeout);
      relogios.clear();
      if (recargaRef.current) clearTimeout(recargaRef.current);
    };
  }, []);

  const contagem = useMemo(() => {
    const base: Record<SlotStatus, number> = { empty: 0, occupied: 0, divergence: 0, blocked: 0 };
    for (const s of vagas) base[s.status] += 1;
    return base;
  }, [vagas]);

  const ruas = useMemo(() => [...new Set(vagas.map(s => s.ruaCodigo))].sort(), [vagas]);

  /** Quantas vagas cada curva colore. Vaga vazia não entra: ela não guarda SKU nenhum,
   *  então não tem giro — entrar como "sem classificação" inflaria esse número com o
   *  armazém vazio e esconderia o que de fato falta classificar. */
  const contagemAbc = useMemo(() => {
    const porClasse: Record<AbcClasse, number> = { A: 0, B: 0, C: 0 };
    let semCurva = 0;
    for (const s of vagas) {
      if (s.status === 'empty') continue;
      const classe = abc.porVaga.get(s.id)?.classe;
      if (classe) porClasse[classe] += 1;
      else semCurva += 1;
    }
    return { porClasse, semCurva };
  }, [vagas, abc]);

  /** Vagas de alto giro fora da face de piso. Calculado FORA do modo de cor: o atalho
   *  precisa aparecer mesmo para quem está olhando o mapa por Status, senão só descobre
   *  o problema quem já foi procurar. */
  const alertasGiro = useMemo(() => alertasDeGiro(vagas, abc.porVaga), [vagas, abc]);

  /**
   * Filtro de rua, filtro de status, busca e pulso num objeto só.
   *
   * Agrupado porque as DUAS vistas aplicam a mesma regra (`destaqueDaVaga`), e passar
   * quatro campos soltos para cada uma foi justamente o caminho pelo qual a planta ficou
   * sem busca, sem filtro de status e sem pulso.
   */
  const contextoDeDestaque = useMemo<ContextoDeDestaque>(
    () => ({ ruasSelecionadas, filtro, achados, pulsando }),
    [ruasSelecionadas, filtro, achados, pulsando],
  );

  /**
   * A planta física pronta para desenhar, com as vagas REAIS ligadas aos vãos.
   *
   * O mapa por código é o que faz o clique funcionar: cada vão sabe o endereço que
   * ocupa, acha a vaga e abre a MESMA que a vista por código abriria. Sem ele o vão
   * seria enfeite — desenho bonito que não responde a clique.
   */
  const plantaFisica = useMemo(() => {
    if (!mostrarPlantaFisica) return null;

    // Maior posição cadastrada por rua. Entra no desenho para a fileira nunca ficar mais
    // curta que o cadastro — sem isso, vaga com carga numa posição alta não tem vão onde
    // aparecer e a mercadoria some do mapa.
    const posicoesPorRua: Record<string, number> = {};
    for (const v of vagas) {
      posicoesPorRua[v.ruaCodigo] = Math.max(posicoesPorRua[v.ruaCodigo] ?? 0, v.modulo);
    }

    return {
      blocos: blocosDaPlanta(plantaMedida.trechos, plantaMedida.rotulos, posicoesPorRua),
      mesas: mesasDaPlanta(plantaMedida.trechos),
      // Vai junto para a cena não precisar recalcular a medida por conta própria: duas
      // contas do mesmo comprimento é como o desenho e o enquadramento se desalinham.
      comprimento: comprimentoTotal(plantaMedida.trechos),
      vagasPorCodigo: new Map(vagas.map(v => [v.id, v])),
      modoCor: modo,
      maxCaixas: vagas.reduce((m, s) => Math.max(m, s.caixas), 0),
      abcPorVaga: abc.porVaga,
      destaque: contextoDeDestaque,
    };
  }, [mostrarPlantaFisica, vagas, modo, abc.porVaga, contextoDeDestaque, plantaMedida]);

  // Posição e cor de cada vaga, calculadas uma vez por mudança real de entrada. Sem
  // isto, cada movimento do mouse (que muda `apontada`) recalcularia a cena inteira.
  const {
    solidas, divergentes, raioX, fiosAtivos, fiosAtenuados,
    colunas, comCarga, placas, achadas, extensao: extensaoDasVagas, deslocamento,
  } = useMemo(() => {
    const maxCaixas = vagas.reduce((m, s) => Math.max(m, s.caixas), 0);
    const atenuada = COR_ATENUADA[theme];

    const desenhaveis: VagaDesenhavel[] = vagas.map(slot => {
      // A MESMA função que a planta física usa. Antes a regra vivia escrita aqui dentro,
      // e era por isso que a outra vista não tinha como aplicá-la.
      const { ativa, achada, pulsando: pulso } = destaqueDaVaga(slot, contextoDeDestaque);
      return {
        slot,
        posicao: posicaoDaVaga(slot, layout),
        // O azul da busca vence a cor de status: achado o produto, a pergunta na tela
        // passou a ser "onde está", não "como está".
        // O pulso vence tudo: é a informação mais NOVA da tela. Durante dois segundos
        // a pergunta deixa de ser "como está esta vaga" e passa a ser "alguém acabou
        // de mexer aqui".
        cor: pulso
          ? COR_PULSO
          : achada
            ? COR_BUSCA
            : ativa
              ? corDaVaga(slot, modo, theme, maxCaixas, abc.porVaga)
              : atenuada,
        ativa,
      };
    });

    const vazio = {
      solidas: [], divergentes: [], raioX: [], fiosAtivos: [], fiosAtenuados: [],
      colunas: [], comCarga: [], placas: [], achadas: [],
      extensao: 10, deslocamento: [0, 0, 0] as [number, number, number],
    };
    if (vagas.length === 0) return vazio;

    const maxRua = Math.max(...vagas.map(s => s.rua));
    const maxModulo = Math.max(...vagas.map(s => s.modulo));
    const larguraTotal = (maxRua - 1) * layout.rowSpacing;
    const profundidadeTotal = (maxModulo - 1) * layout.moduleWidth;

    // Montantes só onde a estrutura está elevada. Um por extremidade de rua e um a
    // cada 4 módulos: o suficiente para ler "isto está suspenso" sem virar floresta.
    const colunas: { x: number; z: number; altura: number }[] = [];
    const placas: PlacaDeRua[] = [];
    for (const letra of new Set(vagas.map(s => s.ruaCodigo))) {
      const daRua = vagas.filter(s => s.ruaCodigo === letra);
      const base = baseDaRua(letra, layout);
      const x = (daRua[0].rua - 1) * layout.rowSpacing;
      const modulos = [...new Set(daRua.map(s => s.modulo))].sort((a, b) => a - b);

      if (base > 0) {
        const escolhidos = modulos.filter((m, i) => i === 0 || i === modulos.length - 1 || m % 4 === 0);
        for (const m of escolhidos) colunas.push({ x, z: (m - 1) * layout.moduleWidth, altura: base });
      }

      // Placa um metro ACIMA do último nível daquela rua, nas duas pontas do corredor.
      // A altura é por rua, não global: com uma rua suspensa e outra no chão, uma placa
      // na média ficaria enterrada numa e perdida no alto da outra.
      const maxNivel = Math.max(...daRua.map(s => s.nivel));
      const y = base + maxNivel * layout.levelHeight + 1;
      const pontas = modulos.length > 1 ? [modulos[0], modulos[modulos.length - 1]] : [modulos[0]];
      for (const m of pontas) placas.push({ rotulo: letra, x, y, z: (m - 1) * layout.moduleWidth });
    }

    return {
      solidas: desenhaveis.filter(v => v.ativa && v.slot.status !== 'empty' && v.slot.status !== 'divergence'),
      divergentes: desenhaveis.filter(v => v.ativa && v.slot.status === 'divergence'),
      // Fora do filtro, mas com carga: vidro, para dar a profundidade do raio-X.
      raioX: desenhaveis.filter(v => !v.ativa && v.slot.status !== 'empty'),
      fiosAtivos: desenhaveis.filter(v => v.ativa && v.slot.status === 'empty'),
      fiosAtenuados: desenhaveis.filter(v => !v.ativa && v.slot.status === 'empty'),
      // Contorno dos achados: inclui a vaga VAZIA que casou com a busca, que de outro
      // modo seria só um fio cinza e sumiria no meio dos outros fios.
      achadas: achados === null ? [] : desenhaveis.filter(v => achados.has(v.slot.id)),
      colunas,
      // Toda vaga com carga ganha palete, dentro ou fora do filtro: o filtro esconde o
      // destaque da mercadoria, não faz o estrado sumir de baixo dela.
      comCarga: desenhaveis.filter(v => v.slot.status !== 'empty'),
      placas,
      extensao: Math.max(larguraTotal, profundidadeTotal) + 4,
      // Centraliza na origem para o OrbitControls orbitar o armazém, não um canto dele.
      deslocamento: [-larguraTotal / 2, 0, -profundidadeTotal / 2] as [number, number, number],
    };
  }, [vagas, modo, theme, contextoDeDestaque, achados, layout, abc]);

  // ── Coordenadas da vista ativa ─────────────────────────────────────────────────
  //
  // Câmera e radar liam a posição SEMPRE da grade por código. Com a planta desenhada — o
  // padrão da tela — a mesma vaga fica a 10,6 m de distância (medido: `PP-E03-N2` em
  // `[2; 2,5; −7,15]` contra `[−4,3; 2,1; 1,32]`), e as escalas dos eixos são diferentes,
  // então não existe offset que converta uma geometria na outra. Daqui para baixo quem
  // responde "onde está esta vaga" é a vista que está na tela.

  const indiceDeVaos = useMemo(
    () => (plantaFisica ? indiceDosVaos(plantaFisica.blocos) : null),
    [plantaFisica],
  );

  /** Offset do grupo desenhado. O MESMO que `PlantaFisica3D` aplica no seu `<group>`. */
  const deslocamentoAtivo = useMemo<[number, number, number]>(
    () => (plantaFisica ? offsetDaPlanta(LARGURA_DO_PREDIO, plantaFisica.comprimento) : deslocamento),
    [plantaFisica, deslocamento],
  );

  /** Posição LOCAL da vaga na vista ativa, ou `null` quando esta vista não a desenha. */
  const localDaVaga = useMemo<ResolvedorLocal>(
    () =>
      indiceDeVaos
        ? vaga => indiceDeVaos.get(vaga.id)?.centro ?? null
        : vaga => posicaoDaVaga(vaga, layout),
    [indiceDeVaos, layout],
  );

  /**
   * Cerca e obstáculos da caminhada, em coordenada de MUNDO.
   *
   * A cerca sai das medidas da planta, não das paredes da cena: aquelas são um caixote de
   * `extensao × 1,9` (meio-lado 42,94 m) desenhado como cenário, enquanto o prédio tem
   * 10,3 × 45,2 m. A cerca antiga era `±extensao` — 8,8 vezes a meia-largura do galpão.
   *
   * Na vista por código não existe prédio: ali a cerca vem do contorno das vagas e cada
   * rua vira uma caixa.
   */
  const colisao = useMemo<{ caixas: CaixaPlana[]; cerca: CaixaPlana }>(() => {
    if (plantaFisica) {
      return {
        caixas: caixasDaPlanta(plantaFisica.blocos, plantaFisica.mesas, deslocamentoAtivo),
        cerca: cercaDaPlanta(
          LARGURA_DO_PREDIO,
          plantaFisica.comprimento,
          deslocamentoAtivo,
          MARGEM_DA_CERCA,
        ),
      };
    }

    const caixas: CaixaPlana[] = [];
    let larguraTotal = 0;
    let profundidadeTotal = 0;
    for (const letra of new Set(vagas.map(s => s.ruaCodigo))) {
      const daRua = vagas.filter(s => s.ruaCodigo === letra);
      const x = (daRua[0].rua - 1) * layout.rowSpacing;
      const modulos = daRua.map(s => s.modulo);
      const z0 = (Math.min(...modulos) - 1) * layout.moduleWidth - VAGA.profundidade / 2;
      const z1 = (Math.max(...modulos) - 1) * layout.moduleWidth + VAGA.profundidade / 2;
      caixas.push({
        x0: x - VAGA.largura / 2 + deslocamentoAtivo[0],
        x1: x + VAGA.largura / 2 + deslocamentoAtivo[0],
        z0: z0 + deslocamentoAtivo[2],
        z1: z1 + deslocamentoAtivo[2],
      });
      larguraTotal = Math.max(larguraTotal, x + VAGA.largura / 2);
      profundidadeTotal = Math.max(profundidadeTotal, z1);
    }
    // Folga de 2 m em volta: sem prédio desenhado, prender a câmera rente à última rua
    // tiraria o corredor de manobra por onde se anda.
    return { caixas, cerca: cercaDeContorno(larguraTotal, profundidadeTotal, deslocamentoAtivo, 2) };
  }, [plantaFisica, deslocamentoAtivo, vagas, layout]);

  /**
   * Contorno da vaga na vista ativa: onde ela está e quanto mede, em coordenada local.
   *
   * A grade devolve a caixa fixa da vaga; a planta devolve o vão REAL daquela fileira —
   * 13 posições em 15,6 m na rua A dão um vão diferente das 12 em 15 m da rua E. É o que
   * permite o realce existir nas duas vistas com a medida certa em cada uma.
   */
  const contornoDaVaga = useCallback(
    (slot: Slot): { centro: Ponto; tamanho: Ponto } | null => {
      if (indiceDeVaos) return indiceDeVaos.get(slot.id) ?? null;
      return {
        centro: posicaoDaVaga(slot, layout),
        tamanho: [VAGA.largura, VAGA.altura, VAGA.profundidade],
      };
    },
    [indiceDeVaos, layout],
  );

  /** Posição de MUNDO — é o que a câmera e o OrbitControls entendem. */
  const mundoDaVaga = useCallback(
    (vaga: Slot): Ponto | null => {
      const local = localDaVaga(vaga);
      return local ? emMundo(local, deslocamentoAtivo) : null;
    },
    [localDaVaga, deslocamentoAtivo],
  );

  /**
   * Losangos de alto giro, em coordenada local da vista ativa.
   *
   * Saiu do memo das vagas por código para cá: ele é desenhado nas duas vistas, e lá
   * dentro a posição vinha fixa de `posicaoDaVaga`. A altura do vão é 1,4 m nas duas
   * geometrias, então o mesmo recuo serve para as duas.
   *
   * Só no modo Curva ABC: fora dele a cor não está falando de giro, e um losango vermelho
   * pairando sobre o mapa de Status não teria como ser interpretado.
   */
  const marcadores = useMemo<[number, number, number][]>(() => {
    if (modo !== 'abc') return [];
    const pontos: [number, number, number][] = [];
    for (const slot of alertasGiro) {
      const local = localDaVaga(slot);
      if (local) pontos.push([local[0], local[1] + VAGA.altura / 2 + 0.45, local[2]]);
    }
    return pontos;
  }, [modo, alertasGiro, localDaVaga]);

  // Planta baixa. Depende do alerta de giro porque o radar marca as duas famílias de
  // problema — capacidade e giro mal posicionado —, com as cores da própria cena.
  // O radar descreve a vista ATIVA. Antes era sempre a grade por código: com a planta
  // desenhada, o "você está aqui" apontava para uma geometria que não estava na tela.
  const celulasRadar = useMemo(
    () => celulasDoRadar(vagas, layout, new Set(alertasGiro.map(s => s.id)), localDaVaga),
    [vagas, layout, alertasGiro, localDaVaga],
  );
  const areaRadar = useMemo(() => areaDoRadar(celulasRadar), [celulasRadar]);

  // A estante NÃO depende de filtro, modo de cor nem busca: ela é física e está sempre
  // lá. Memos próprios para não refazer a geometria da estrutura a cada troca de modo.
  const montantes = useMemo(() => montantesDoArmazem(vagas, layout), [vagas, layout]);
  const travessas = useMemo(() => vigasDoArmazem(vagas, layout), [vagas, layout]);

  /** Escreve a posição e a abertura da câmera direto nos nós do SVG. Chamado por
   *  quadro: nada aqui pode disparar render. */
  const atualizarRadar = useCallback(
    (x: number, z: number, graus: number, meiaAbertura: number) => {
      const grupo = radarGrupoRef.current;
      if (!grupo) return;
      const [localX, localZ] = mundoParaLocal(x, z, deslocamentoAtivo);
      const [presoX, presoZ] = prenderNaArea(localX, localZ, areaRadar);
      grupo.setAttribute(
        'transform',
        `translate(${presoX.toFixed(3)} ${presoZ.toFixed(3)}) rotate(${graus.toFixed(2)})`,
      );
      const cone = radarConeRef.current;
      if (cone) {
        const alcance = Math.max(areaRadar.largura, areaRadar.profundidade) * 0.55;
        cone.setAttribute('d', caminhoDoCone(meiaAbertura, alcance));
      }
    },
    [deslocamentoAtivo, areaRadar],
  );

  /**
   * Clique no radar: PAN puro, preservando ângulo e distância.
   *
   * Move só o ponto para onde se olha. Recalcular a posição da câmera do zero giraria a
   * cena junto, e quem clicou no radar justamente para não se perder acabaria mais
   * perdido do que antes.
   */
  const irParaNoRadar = useCallback(
    (localX: number, localZ: number) => {
      const controls = controlsRef.current;
      if (!controls) return;
      const [mundoX, mundoZ] = localParaMundo(localX, localZ, deslocamentoAtivo);
      const alvo = new Vector3(mundoX, controls.target.y, mundoZ);
      const afastamento = controls.object.position.clone().sub(controls.target);
      destinoRef.current = { alvo, posicao: alvo.clone().add(afastamento) };
      setVoando(true);
    },
    [deslocamentoAtivo],
  );

  /**
   * Rota de coleta sobre o resultado da busca.
   *
   * A lista de paradas é o que a busca achou, na ordem FIFO. NÃO há pedido de
   * separação no banco — não existe tabela de ordem, nem doca, nem área de picking
   * (as 71 vagas são todas pulmão). A busca é a única lista de coleta real que este
   * sistema sabe produzir hoje.
   *
   * Com uma parada só não há rota: há um destino, e para isso a busca já oferece o
   * "Ir até".
   */
  const rota = useMemo<RotaDesenhavel | null>(() => {
    if (ordemFifo.length < 2) return null;
    // Resolvida pela vista ATIVA: na planta a vaga está em outro lugar, e a rota
    // desenhada com a coordenada da grade apareceria atravessada no galpão.
    const paradas = paradasDaRota(ordemFifo, vagas, layout, localDaVaga);
    if (paradas.length < 2) return null;
    // Na planta, a travessia entre ruas é o corredor transversal de entrada do trecho —
    // as fileiras começam depois dele. Com a cabeceira da grade (−1,17 m) o traçado
    // sairia pela parede dos fundos.
    const cabeceira = plantaFisica ? cabeceiraDaPlanta(plantaFisica.blocos) : undefined;
    return {
      paradas,
      caminho: caminhoNoPiso(paradas, layout, cabeceira),
      subidas: subidasAteAVaga(paradas),
    };
  }, [ordemFifo, vagas, layout, localDaVaga, plantaFisica]);

  /**
   * Extensão que dimensiona o cenário e a câmera.
   *
   * Com a planta física desenhada ela vem da PLANTA, não das vagas: a extensão das vagas
   * por código descreve outra geometria, e usá-la deixava o galpão de 45,2 m cortado pela
   * parede e fora do enquadramento — foi o que apareceu no primeiro teste.
   */
  const extensao = plantaFisica ? Math.max(extensaoDasVagas, plantaFisica.comprimento) : extensaoDasVagas;

  /** Muda quando o conjunto desenhado muda — é o gatilho para refazer a sombra. */
  const chaveDeSombra = `${solidas.length}-${divergentes.length}-${fiosAtivos.length}-${raioX.length}-${extensao.toFixed(1)}`;

  /**
   * Há algo se movendo sozinho na cena?
   *
   * É o que decide entre desenhar todo quadro e desenhar só quando alguém pede. A lista é
   * EXPLÍCITA porque cada item é uma animação que morreria em silêncio se ficasse de fora
   * — e cena congelada não dá erro, só parece travada:
   *
   *   caminhando            — a câmera anda a cada quadro
   *   voando                — o `PanSuave` interpola até a parada
   *   rota                  — o tracejado corre no sentido da coleta
   *   divergências          — o alerta respira a emissividade
   *   pulso de tempo real   — dura 2 s e precisa aparecer e sumir
   *
   * O que NÃO precisa entrar: orbitar e dar zoom (o OrbitControls pede quadro a cada passo
   * do amortecimento), e tudo que vem de estado do React — o fiber já pede um quadro
   * depois de aplicar mudança de prop.
   */
  const temAnimacao =
    caminhando || voando || !!rota || divergentes.length > 0 || pulsando.size > 0;

  const registrarCapturador = useCallback((fn: (() => string) | null) => {
    capturarRef.current = fn;
  }, []);

  /**
   * Baixa a vista atual como PNG, com uma tarja de data, hora e ângulo.
   *
   * A tarja é acrescentada ABAIXO do desenho, num canvas 2D à parte — escrever por
   * cima cobriria justamente a parte do armazém que alguém quis registrar.
   *
   * O que a imagem NÃO traz: as placas de rua e os números das paradas. São elementos
   * HTML sobrepostos ao Canvas, não pixels do WebGL, e nenhum `toDataURL` os alcança.
   */
  const capturarCena = useCallback(() => {
    const capturar = capturarRef.current;
    const controls = controlsRef.current;
    if (!capturar || !controls) return;

    const desenho = new Image();
    desenho.onload = () => {
      const folha = document.createElement('canvas');
      folha.width = desenho.width;
      folha.height = desenho.height + ALTURA_DA_TARJA;
      const ctx = folha.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(desenho, 0, 0);

      const quando = new Date();
      const { x, y, z } = controls.object.position;
      const alvo = controls.target;
      const angulo = anguloDaCamera([x, y, z], [alvo.x, alvo.y, alvo.z]);
      desenharLegenda(ctx, desenho.width, desenho.height, legendaDaAuditoria(quando, angulo));

      const link = document.createElement('a');
      link.download = nomeDoArquivo(quando);
      link.href = folha.toDataURL('image/png');
      link.click();
    };
    desenho.src = capturar();
  }, []);

  /**
   * Enquadramento inicial.
   *
   * Com a planta física desenhada, enquadrar pelas VAGAS deixa o galpão cortado: o
   * contorno delas tem ~28 m e a planta tem 45,2. A câmera recua na proporção entre as
   * duas extensões, mantendo o mesmo ângulo — é a mesma vista, de mais longe, em vez de
   * uma vista própria que o reset não saberia reproduzir.
   */
  const posicaoCamera = useMemo(() => {
    const base = enquadrarCamera(vagas, layout);
    if (!plantaFisica || extensaoDasVagas <= 0) return base;
    const fator = Math.max(1, plantaFisica.comprimento / extensaoDasVagas);
    return [base[0] * fator, base[1] * fator, base[2] * fator] as [number, number, number];
  }, [vagas, layout, plantaFisica, extensaoDasVagas]);
  const distancia = Math.hypot(...posicaoCamera);

  // A MESMA conta do enquadramento inicial: se o reset usasse um valor próprio, o
  // botão devolveria uma vista que a tela nunca mostrou ao abrir.
  const resetarCamera = () => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.object.position.set(...posicaoCamera);
    controls.target.set(0, 0, 0);
    controls.update();
  };

  /**
   * Leva a câmera até a primeira vaga com alerta.
   *
   * A posição vem do mesmo `deslocamento` que a cena aplica ao grupo, senão a câmera
   * miraria o endereço absoluto e o armazém apareceria deslocado no quadro.
   *
   * O recuo é proporcional ao tamanho da vaga, não um número fixo: com o pulmão
   * suspenso ou com módulos mais largos, uma distância fixa colaria a câmera na vaga.
   */
  const focarVaga = (alvo: Slot | undefined) => {
    const controls = controlsRef.current;
    if (!controls || !alvo) return;
    // Resolvido pela vista ATIVA. Antes vinha de `alvo.posicao`, que é sempre a grade por
    // código — com a planta desenhada a câmera voava para onde a vaga NÃO está.
    const mundo = mundoDaVaga(alvo);
    if (!mundo) return;
    const [alvoX, y, alvoZ] = mundo;
    const recuo = recuoDeFoco(layout, !!plantaFisica);
    controls.target.set(alvoX, y, alvoZ);
    controls.object.position.set(alvoX + recuo, y + recuo * 0.6, alvoZ + recuo);
    controls.update();
  };

  /**
   * Voo suave até uma parada da rota.
   *
   * Mesmo enquadramento do "Ir até" (`focarVaga`), mas animado pelo `PanSuave` em vez
   * de instantâneo. Percorrer a rota é uma sequência: saltar de corte em corte faria
   * perder a relação entre uma parada e a seguinte, que é o que a rota existe para
   * mostrar. O "Ir até" continua instantâneo — ali o salto é o comportamento atual e
   * não há sequência a preservar.
   */
  const voarAteParada = useCallback(
    (parada: ParadaDaRota) => {
      const controls = controlsRef.current;
      if (!controls) return;
      // `parada.naVaga` já vem na coordenada da vista ativa (a rota é montada com o mesmo
      // resolvedor), então aqui só falta o offset do grupo em que ela é desenhada.
      const [x, y, z] = emMundo(parada.naVaga, deslocamentoAtivo);
      const alvo = new Vector3(x, y, z);
      const recuo = recuoDeFoco(layout, !!plantaFisica);
      destinoRef.current = {
        alvo,
        posicao: new Vector3(alvo.x + recuo, y + recuo * 0.6, alvo.z + recuo),
      };
      setVoando(true);
    },
    // `plantaFisica` entra porque o RECUO depende da vista ativa: sem ela aqui, trocar de
    // vista manteria o recuo da anterior — 8,8 m num corredor de 2,65 m.
    [deslocamentoAtivo, layout, plantaFisica],
  );

  const trocarLayout = (patch: Partial<Layout3DConfig>) => {
    setLayout(anterior => {
      const proximo = { ...anterior, ...patch };
      salvarLayout(proximo);
      return proximo;
    });
  };

  const selecionar = useCallback(
    (slot: Slot) => {
      setSelecionada(slot);
      onSelectSlot?.(slot);
    },
    [onSelectSlot],
  );

  if (estado.fase === 'carregando') {
    return (
      <div className={`${MOLDURA} flex items-center justify-center ${className}`}>
        <BrandLoader label="Lendo os endereços do Pulmão" />
      </div>
    );
  }

  if (estado.fase === 'erro') {
    return (
      <div className={`${MOLDURA} flex items-center justify-center p-6 ${className}`}>
        <div className="w-full max-w-md space-y-3">
          <Notice tone="danger">
            Não foi possível carregar os endereços do Pulmão. Nada foi alterado no armazém — é só a
            leitura que falhou.
            <span className="mt-2 block text-code text-xs text-fg-muted">{estado.mensagem}</span>
          </Notice>
          <Button variant="secondary" size="sm" onClick={buscar}>
            Tentar de novo
          </Button>
        </div>
      </div>
    );
  }

  if (vagas.length === 0) {
    return (
      <div className={`${MOLDURA} flex items-center justify-center p-6 ${className}`}>
        <div className="w-full max-w-md">
          <Notice tone="neutral">
            {estado.dados.naoPosicionaveis.length > 0
              ? `Nenhum endereço com posição no espaço. As ${estado.dados.naoPosicionaveis.length} vagas cadastradas não seguem o padrão de código (ex.: PP-A01-N1), então não há como situá-las no mapa 3D.`
              : 'Nenhum endereço cadastrado no Pulmão ainda. Assim que as vagas forem criadas, elas aparecem aqui.'}
          </Notice>
        </div>
      </div>
    );
  }

  const emDestaque = solidas.length + divergentes.length + fiosAtivos.length;

  return (
    // `relative` ancora os overlays; `overflow-hidden` impede que o canvas vaze no
    // instante em que o pai redimensiona. A altura vem do pai — o `min-h` é só a rede
    // de segurança para um pai sem altura definida, onde o canvas colapsaria em 0.
    // O cursor é trocado por `classList` no `apontar`, e não por classe condicional: ler
    // o hover aqui obrigaria o componente inteiro a re-renderizar a cada pixel do mouse.
    <div ref={molduraRef} className={`${MOLDURA} ${className}`}>
      <FronteiraDeErro
        aoFalhar={
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md">
              <Notice tone="warning">
                A visualização 3D não pôde ser desenhada neste dispositivo. Os dados estão corretos —
                o mapa 2D do Pulmão mostra os mesmos endereços.
              </Notice>
            </div>
          </div>
        }
      >
        {/* Sem `background` na cena: o fundo é a div, em `bg-surface-2`. Assim o tema
            continua vindo dos tokens em vez de um hex paralelo dentro do WebGL. */}
        <Canvas
          camera={{ position: posicaoCamera, fov: FOV_BASE, near: 0.1, far: Math.max(200, distancia * 4) }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
          // Em repouso a cena NÃO é redesenhada. Ver `temAnimacao`: `demand` faz o fiber
          // desenhar só quando algo pede, e orbitar continua fluido porque o
          // OrbitControls do drei emite `change` a cada passo do amortecimento, e cada
          // `change` pede um quadro — o amortecimento se auto-sustenta até assentar.
          frameloop={temAnimacao ? 'always' : 'demand'}
          onPointerMissed={() => setSelecionada(null)}
        >
          <EnquadramentoResponsivo />
          <Cena
            vagas={{ solidas, divergentes, raioX, fiosAtivos, fiosAtenuados, comCarga, achadas }}
            estrutura={{ colunas, montantes, travessas, placas }}
            cenario={{
              fundo,
              chaveDeSombra,
              extensao,
              deslocamento,
              deslocamentoAtivo,
              plantaNoPiso,
            }}
            builder={{
              modoVisor,
              ferramenta,
              estanteEscolhida,
              objetos,
              selecionadoNoBuilder,
              onConstruir: construirObjeto,
              onSelecionarObjeto: setSelecionadoNoBuilder,
              onGirarObjeto: girarObjeto,
              onExcluirObjeto: excluirObjeto,
            }}
            interacao={{
              assinarHover,
              selecionada,
              contornoDaVaga,
              caminhando,
              onHover: apontar,
              onSelect: selecionar,
            }}
            plantaFisica={plantaFisica}
            rota={rota}
            marcadores={marcadores}
            theme={theme}
          />
          {/* Os dois controles são mutuamente exclusivos: ambos montados, cada um
              mexeria na mesma câmera por conta própria e a vista brigaria consigo mesma. */}
          {caminhando ? (
            <>
              <PointerLockControls />
              <Caminhada caixas={colisao.caixas} cerca={colisao.cerca} />
            </>
          ) : (
            <OrbitControls
              ref={controlsRef}
              enableDamping
              dampingFactor={0.08}
              // Também proporcionais: um teto fixo prenderia a câmera dentro de um
              // armazém grande, impedindo justamente a vista geral que o 3D existe para dar.
              minDistance={2}
              maxDistance={distancia * 2.5}
              // Trava acima do piso: por baixo do chão não existe ponto de vista real no
              // armazém, e chegar lá é o jeito mais rápido de o operador se perder.
              maxPolarAngle={Math.PI / 2.05}
            />
          )}

          {/* Dentro do Canvas porque é onde `useFrame` existe. Nenhum dos dois desenha
              nada: um lê a câmera para o radar, o outro conduz a transição do clique. */}
          <SondaDeCamera controlsRef={controlsRef} aoAtualizar={atualizarRadar} />
          <PanSuave
            controlsRef={controlsRef}
            destinoRef={destinoRef}
            aoParar={() => setVoando(false)}
          />
          <CapturadorDeCena registrar={registrarCapturador} />
        </Canvas>
      </FronteiraDeErro>

      {/* O HUD inteiro — legenda, modo, pavimento, busca, rota, filtros, builder e o modal
          de ajuste — vive em `viewer3d/Hud3D`. As props vão agrupadas por assunto. */}
      <Hud3D
        legenda={{ modo, contagem, contagemAbc, abc, abcFalhou }}
        visao={{
          modoVisor,
          mostrarPlantaFisica,
          origemDaPlanta: plantaMedida.origem,
          pavimentos,
          andar,
          caminhando,
          fundo,
        }}
        busca={{ busca, buscando, achados, achadas, rota, rotaAberta, paradaAtual }}
        filtros={{
          ruas,
          ruasSelecionadas,
          filtro,
          alertasGiro,
          divergentes,
          emDestaque,
          totalDeVagas: vagas.length,
          naoPosicionaveis: estado.dados.naoPosicionaveis.length,
        }}
        builder={{
          ferramenta,
          estanteEscolhida,
          corEscolhida,
          objetos,
          selecionadoDoTipoEstante,
          salvandoPecas,
          erroAoSalvar,
          salvoEm,
        }}
        acoes={{
          setModo,
          setModoVisor,
          setMostrarPlantaFisica,
          setAndar,
          setBusca,
          setFiltro,
          setRuasSelecionadas,
          limparRuas: () => setRuasSelecionadas(new Set()),
          setRotaAberta,
          setParadaAtual,
          setCaminhando,
          setFundo,
          setAjustando,
          setFerramenta,
          setEstanteEscolhida,
          setCorEscolhida,
          setSelecionadoNoBuilder,
          ajustarObjeto,
          salvarConstrucao,
          focarVaga,
          voarAteParada,
          resetarCamera,
          capturarCena,
          trocarLayout,
        }}
        layout={layout}
        ajustando={ajustando}
        theme={theme}
      />


      {/* Antes do painel de detalhe DE PROPÓSITO: quando os dois ficam altos e se
          sobrepõem, quem vence é o detalhe da vaga selecionada. O radar ajuda a chegar
          lá; depois de chegar, o conteúdo da vaga é a tarefa. */}
      {celulasRadar.length > 0 && (
        <Radar
          celulas={celulasRadar}
          area={areaRadar}
          theme={theme}
          aberto={radarAberto}
          onAlternar={() => setRadarAberto(a => !a)}
          onIrPara={irParaNoRadar}
          grupoRef={radarGrupoRef}
          coneRef={radarConeRef}
        />
      )}

      {selecionada && (
        <PainelDetalhe
          slot={selecionada}
          abc={abc.porVaga.get(selecionada.id)}
          onFechar={() => setSelecionada(null)}
          onScanRequest={onScanRequest}
          // Esquece o conteúdo ao mandar a vaga para a movimentação: a pessoa vai mexer
          // no saldo justamente dela, e voltar encontrando o número antigo seria o cache
          // mentindo sobre o que acabou de acontecer.
          onOperate={onOperate ? slot => { esquecerConteudoDaVaga(slot.id); onOperate(slot); } : undefined}
          // Fecha a gaveta ao procurar: o resultado da busca é a CENA acendendo vários
          // endereços, e o painel aberto por cima esconderia metade deles.
          onProcurarSku={sku => { setBusca(sku); setSelecionada(null); }}
        />
      )}
    </div>
  );
}
