// Operação Inteligente -> Pulmão (Porta-Pallet).
//
// Controle de excesso de mercadoria no porta-pallet, no modelo de armazenagem do SAP:
// endereço (storage bin) -> saldo por endereço (quant) -> movimento como documento.
//
// O que esta tela resolve: hoje achar o excesso de um SKU é procurar no olho, porque o
// porta-pallet não tem local fixo (a rotatividade é alta) e `products.location` é um
// campo único por produto — não comporta o mesmo SKU em várias posições ao mesmo tempo.
//
// O que ela NÃO faz: não encosta no vão de PICKING das capas. `products.location` e o
// campo de local do Tiny continuam sendo daquele fluxo e não são lidos nem escritos aqui.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, LayoutGrid, Lock, PackagePlus, Plus, Printer, Search, Trash2, Unlock, Warehouse } from 'lucide-react';
import {
  Badge, Button, Input, Notice, Page, PageHeader, Panel, PanelSection,
  SegmentedControl, Select, Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
  type SegmentedOption,
} from '../ui';
import { BIN_SCAN_PARAM } from '../../lib/appRoutes';
import { renderBarcodeSVG } from '../../lib/barcode/barcodeExport';
import { parseBinCode } from '../../lib/wms/binCode';
import {
  A4_PER_PAGE, LABEL_FORMATS, fallbackValuePt, planLabels, sheetsFor,
  type A4PerPage, type LabelFormatId,
} from '../../lib/wms/labelLayout';
import { WmsBinOperations } from './WmsBinOperations';
import { WmsStorageMap } from './WmsStorageMap';
import {
  boxesByBin, buildBinCodes, createBins, deleteBins, listBins, listMovements, searchStock, setBinBlocked,
  type BinMovement, type BinStockRow, type BinStreetSpec, type StorageBin,
} from '../../lib/wms/wmsService';

type Mode = 'mapa' | 'movimentar' | 'enderecos' | 'consulta' | 'movimentos';

const MODES: SegmentedOption<Mode>[] = [
  { value: 'mapa', label: 'Mapa', icon: LayoutGrid },
  { value: 'movimentar', label: 'Movimentar', icon: PackagePlus },
  { value: 'enderecos', label: 'Endereços', icon: Warehouse },
  { value: 'consulta', label: 'Consultar SKU', icon: Search },
  { value: 'movimentos', label: 'Movimentos', icon: Printer },
];

/** O QR aponta para a RAIZ, nao para o caminho da secao. Motivo: a hospedagem estatica
 *  so responde em "/" — caminho de secao digitado direto devolve 404 do servidor, e o
 *  adesivo nasceria morto. O App le este parametro na entrada e redireciona para ca com
 *  a vaga preenchida, entao o resultado para quem escaneia e o mesmo. */
const SCAN_PATH = '/';

/** A etiqueta é montada por `innerHTML` (é SVG cru vindo do gerador, não JSX). O código
 *  do endereço vem do banco e, embora o gerador em lote só produza letra, número e
 *  hífen, a coluna é texto livre — então escapa. */
const esc = (value: string): string =>
  value.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));

/** Milímetro com uma casa: `3.0000000000000004mm` é CSS válido mas ilegível no DevTools
 *  de quem for depurar uma etiqueta torta depois. */
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Formato de etiqueta escolhido. Fica no navegador de quem imprime porque é
 *  propriedade do rolo que a pessoa tem na mesa, não da empresa. */
const LABEL_FORMAT_KEY = 'ib_wms_label_format';

interface LabelPrefs {
  format: LabelFormatId;
  perPage: A4PerPage;
  customWidthMm: number;
  customHeightMm: number;
}

const DEFAULT_LABEL_PREFS: LabelPrefs = {
  format: 'a4',
  perPage: 8,
  customWidthMm: 70,
  customHeightMm: 50,
};

const readLabelPrefs = (): LabelPrefs => {
  try {
    const raw = localStorage.getItem(LABEL_FORMAT_KEY);
    return raw ? { ...DEFAULT_LABEL_PREFS, ...(JSON.parse(raw) as Partial<LabelPrefs>) } : DEFAULT_LABEL_PREFS;
  } catch {
    return DEFAULT_LABEL_PREFS;
  }
};

/** Base da URL que vai dentro do QR. O padrão é o endereço do próprio app — é quase
 *  sempre o certo, e ninguém deveria ter que descobrir o que digitar aqui. Só é editável
 *  porque existe um caso em que o padrão está errado: imprimir a partir do localhost
 *  geraria 85 adesivos que só funcionam na máquina de quem imprimiu. */
const QR_BASE_KEY = 'ib_wms_qr_base';

const readQrBase = (): string => {
  try {
    const saved = localStorage.getItem(QR_BASE_KEY);
    if (saved) return saved;
  } catch {
    // localStorage indisponível — cai no padrão abaixo.
  }
  return typeof window === 'undefined' ? '' : window.location.origin;
};

/** Endereço local nunca deve virar adesivo: fora desta máquina o QR não abre nada. */
const isLocalOrigin = (base: string): boolean => /localhost|127\.0\.0\.1|\[::1\]/i.test(base);

const MOVEMENT_LABEL: Record<BinMovement['movementType'], string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  transferencia: 'Transferência',
};

const formatDate = (iso: string): string => new Date(iso).toLocaleDateString('pt-BR');

/** Dias desde a entrada — o número que denuncia estoque encalhado. */
const ageInDays = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

export function WmsPulmaoPage({ canManage }: { canManage: boolean }) {
  // Veio de um QR de vaga? Abre direto em Movimentar com o endereco preenchido — e a
  // query e lida uma vez so, no primeiro render, para nao reabrir ao trocar de secao.
  const [scannedBin] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get(BIN_SCAN_PARAM)?.trim().toUpperCase() ?? '';
  });
  // Escaneou um QR? Vai direto operar. Senão, o mapa e a visao que responde a pergunta
  // do dia a dia — onde tem vaga, o que esta cheio.
  const [mode, setMode] = useState<Mode>(scannedBin ? 'movimentar' : 'mapa');
  // Vaga escolhida no mapa e levada para a aba Movimentar.
  const [operateBin, setOperateBin] = useState('');
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [bins, setBins] = useState<StorageBin[]>([]);
  const [occupancy, setOccupancy] = useState<Map<string, number>>(new Map());
  const [movements, setMovements] = useState<BinMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gerador de endereços
  const [prefix, setPrefix] = useState('PP');
  // Uma linha por rua/paredão. Estrutura real não é uniforme — um paredão de 13 módulos
  // com 3 níveis convive com um meio de 7 módulos e 1 nível —, e um número único para
  // todas obrigava a criar em várias rodadas.
  const [streetRows, setStreetRows] = useState<BinStreetSpec[]>([
    { street: 'A', modules: 5, levels: 4 },
  ]);

  const patchStreet = (index: number, patch: Partial<BinStreetSpec>) =>
    setStreetRows(rows => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  /** Próxima letra livre: A, B, C... Poupa quem está cadastrando de conferir qual já usou. */
  const addStreet = () =>
    setStreetRows(rows => {
      const usadas = new Set(rows.map(r => r.street.trim().toUpperCase()));
      const livre = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(l => !usadas.has(l)) ?? '';
      const ultima = rows[rows.length - 1];
      return [...rows, { street: livre, modules: ultima?.modules ?? 5, levels: ultima?.levels ?? 1 }];
    });
  const [capacity, setCapacity] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<number | null>(null);

  // Consulta
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<BinStockRow[] | null>(null);
  const [searching, setSearching] = useState(false);

  // Impressão
  const [qrBase, setQrBase] = useState(readQrBase);
  const [printing, setPrinting] = useState(false);
  const [labelPrefs, setLabelPrefs] = useState(readLabelPrefs);

  const plan = planLabels(labelPrefs);
  const sheets = sheetsFor(bins.length, plan);

  const changeLabelPrefs = (patch: Partial<LabelPrefs>) => {
    const next = { ...labelPrefs, ...patch };
    setLabelPrefs(next);
    try { localStorage.setItem(LABEL_FORMAT_KEY, JSON.stringify(next)); } catch { /* modo privado */ }
  };
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [binList, boxes, moves] = await Promise.all([listBins(), boxesByBin(), listMovements(50)]);
      setBins(binList);
      setOccupancy(boxes);
      setMovements(moves);
      setError(null);
    } catch (err) {
      console.error('[wms] falha ao carregar o pulmão:', err);
      setError('Não foi possível carregar os endereços.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const preview = useMemo(
    () => buildBinCodes({ prefix, streets: streetRows }),
    [prefix, streetRows],
  );

  // Endereco sem caixa nenhuma: candidato a limpeza. Se tiver historico, o banco recusa.
  const emptyBins = useMemo(() => bins.filter(b => (occupancy.get(b.code) ?? 0) === 0), [bins, occupancy]);

  const stats = useMemo(() => {
    const ocupados = bins.filter(b => (occupancy.get(b.code) ?? 0) > 0).length;
    return {
      total: bins.length,
      ocupados,
      livres: bins.length - ocupados - bins.filter(b => b.blocked).length,
      bloqueados: bins.filter(b => b.blocked).length,
      caixas: [...occupancy.values()].reduce((acc, n) => acc + n, 0),
    };
  }, [bins, occupancy]);

  const handleCreate = async () => {
    if (preview.length === 0) return;
    setCreating(true);
    setCreated(null);
    try {
      const n = await createBins(preview, capacity ? parseInt(capacity) : null);
      setCreated(n);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar os endereços.');
    } finally {
      setCreating(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setSearching(true);
    try {
      setResults(await searchStock(term));
    } catch (err) {
      console.error('[wms] falha na consulta:', err);
      setError('Não foi possível consultar o saldo.');
    } finally {
      setSearching(false);
    }
  };

  /** Endereço com histórico é barrado pelo próprio banco (FK ON DELETE RESTRICT), e a
   *  mensagem que sobe para a tela vem de lá — não de uma checagem daqui que poderia
   *  divergir da verdade. */
  const handleDelete = async (ids: string[]) => {
    setError(null);
    try {
      await deleteBins(ids);
      setConfirmBulk(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível excluir.');
    }
  };

  const handleToggleBlock = async (bin: StorageBin) => {
    try {
      await setBinBlocked(bin.id, !bin.blocked, bin.blocked ? null : 'Bloqueado pela gestão');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível alterar o bloqueio.');
    }
  };

  /** Folha de etiquetas: um QR por endereço, com o código legível embaixo. O QR carrega
   *  uma URL — a câmera nativa do celular só ABRE algo se for URL; texto puro ela apenas
   *  exibe, e aí o fluxo de três segundos morre. */
  const handlePrint = async () => {
    const base = qrBase.trim().replace(/\/+$/, '');
    if (!base) return;
    setPrinting(true);

    // O container é pendurado DIRETO no <body>, e não dentro da árvore do React. Esse é
    // o detalhe que faz a impressão funcionar: a regra de @media print esconde os irmãos
    // do container, e um elemento aninhado lá no meio do app teria ancestrais escondidos
    // junto — saía folha em branco por mais que o próprio elemento estivesse visível.
    const root = document.createElement('div');
    root.id = 'ib-wms-print-root';
    const style = document.createElement('style');
    style.textContent = `
      #ib-wms-print-root { display: none; }
      @media print {
        /* ISTO é o que fazia a folha sair em branco. O app declara
           \`html, body { overflow-x: hidden; max-width: 100vw }\` (src/index.css), e na
           paginação da impressão esse recorte vale para o documento inteiro: o Chrome
           corta tudo em uma página e não sobra nada. As outras impressões do sistema
           escapam porque usam \`position: fixed\` e são de uma etiqueta só. Desfeito
           apenas dentro do @media print — a tela continua exatamente como está. */
        html, body {
          overflow: visible !important;
          max-width: none !important;
          width: auto !important;
          height: auto !important;
          margin: 0 !important;
          background: #fff !important;
        }
        body > *:not(#ib-wms-print-root) { display: none !important; }
        @page { ${plan.pageCss} }

        #ib-wms-print-root {
          display: grid !important;
          grid-template-columns: repeat(${plan.columns}, ${plan.labelWidthMm}mm);
          ${plan.gapMm ? `gap: ${plan.gapMm}mm;` : ''}
          justify-content: start;
          background: #fff; color: #000;
          font-family: Arial, Helvetica, sans-serif;
        }
        #ib-wms-print-root .ib-wms-label {
          display: flex;
          flex-direction: ${plan.orientation === 'horizontal' ? 'row' : 'column'};
          align-items: center; justify-content: center;
          ${plan.orientation === 'horizontal' ? `gap: ${plan.padMm}mm;` : ''}
          width: ${plan.labelWidthMm}mm; height: ${plan.labelHeightMm}mm;
          padding: ${plan.padMm}mm;
          box-sizing: border-box;
          overflow: hidden;
          break-inside: avoid;
          ${plan.showCutBorder ? 'border: 0.3mm solid #999; border-radius: 1.5mm;' : ''}
        }
        /* Uma etiqueta por página nos formatos de rolo: a etiqueta É a página. */
        ${plan.perPage === 1 ? '#ib-wms-print-root .ib-wms-label { break-after: page; }' : ''}
        #ib-wms-print-root .ib-wms-label svg {
          width: ${plan.qrMm}mm; height: ${plan.qrMm}mm; flex: none;
        }
        #ib-wms-print-root .ib-wms-info {
          display: flex; flex-direction: column; align-items: center;
          min-width: 0;
        }
        #ib-wms-print-root .ib-wms-parts {
          display: flex; align-items: flex-end; justify-content: center;
          gap: ${round1(plan.padMm * 1.2)}mm;
          ${plan.orientation === 'horizontal' ? '' : `margin-top: ${round1(plan.padMm * 0.7)}mm;`}
        }
        #ib-wms-print-root .ib-wms-part {
          display: flex; flex-direction: column; align-items: center;
        }
        #ib-wms-print-root .ib-wms-part b {
          font-size: ${plan.headerPt}pt; font-weight: 700; letter-spacing: .12em; color: #444;
          white-space: nowrap;
        }
        #ib-wms-print-root .ib-wms-part i {
          font-style: normal; font-size: ${plan.valuePt}pt; font-weight: 800; line-height: 1.05;
          white-space: nowrap;
        }
        /* Caixa em volta do nível, e não fundo colorido como no modelo de referência: o
           Chrome só imprime fundo com "Gráficos de plano de fundo" marcado, e uma
           etiqueta que depende dessa caixinha de diálogo é uma etiqueta que um dia sai
           ilegível. Borda sai em qualquer impressora, inclusive preto e branco. */
        #ib-wms-print-root .ib-wms-level i {
          border: 0.6mm solid #000; border-radius: 1mm;
          padding: 0 ${round1(plan.padMm * 0.7)}mm;
        }
        #ib-wms-print-root .ib-wms-code {
          margin-top: ${round1(plan.padMm * 0.6)}mm;
          font-size: ${plan.codePt}pt; letter-spacing: .08em; color: #555;
          white-space: nowrap;
        }
      }
    `;

    const cleanup = () => {
      root.remove();
      style.remove();
    };

    try {
      try { localStorage.setItem(QR_BASE_KEY, base); } catch { /* modo privado */ }

      for (const bin of bins) {
        const svg = await renderBarcodeSVG('qrcode', `${base}${SCAN_PATH}?${BIN_SCAN_PARAM}=${bin.code}`, {
          showHumanReadable: false,
          scale: 1,
          eccLevel: 'M',
        });
        // Rua, módulo e nível em separado e grandes: de pé no corredor, olhando para
        // cima, ninguém lê "PP-A01-N1" — lê "A 01 1". O código inteiro fica embaixo,
        // pequeno, porque é ele que se digita na tela quando a câmera falha.
        const parsed = parseBinCode(bin.code);
        const parts = parsed
          ? `<div class="ib-wms-part"><b>RUA</b><i>${esc(parsed.street)}</i></div>` +
            `<div class="ib-wms-part"><b>MÓDULO</b><i>${esc(parsed.module)}</i></div>` +
            `<div class="ib-wms-part ib-wms-level"><b>NÍVEL</b><i>${parsed.level}</i></div>`
          // Endereço fora do padrão ocupa a linha inteira sozinho: o corpo cede ao
          // comprimento, senão some pela borda da célula.
          : `<div class="ib-wms-part"><b>ENDEREÇO</b>` +
            `<i style="font-size:${fallbackValuePt(plan, bin.code.length)}pt">${esc(bin.code)}</i></div>`;

        // O bloco de texto é um filho só: assim a etiqueta deitada (rolo 100×40) vira
        // QR à esquerda e endereço à direita trocando apenas o flex-direction.
        const cell = document.createElement('div');
        cell.className = 'ib-wms-label';
        cell.innerHTML =
          svg +
          `<div class="ib-wms-info">` +
          `<div class="ib-wms-parts">${parts}</div>` +
          `<div class="ib-wms-code">${esc(bin.code)}</div>` +
          `</div>`;
        root.appendChild(cell);
      }

      document.head.appendChild(style);
      document.body.appendChild(root);
      // Limpa quando a caixa de impressão fecha, tenha a pessoa impresso ou cancelado.
      window.addEventListener('afterprint', cleanup, { once: true });
      // Um respiro antes do snapshot de impressão, como já faz o `printBarcodeArea` do
      // Gerador de Etiquetas: são dezenas de SVGs recém-inseridos para o layout assentar.
      setTimeout(() => window.print(), 200);
    } catch (err) {
      console.error('[wms] falha ao gerar as etiquetas:', err);
      setError('Não foi possível gerar as etiquetas.');
      cleanup();
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Page>
      <PageHeader
        title="Pulmão — Porta-Pallet"
        description="Endereçamento do excesso de mercadoria. Cada vaga tem endereço próprio, e todo saldo vem de um movimento registrado."
      />

      {error && <Notice tone="danger">{error}</Notice>}

      {/* Três números, não quatro: "livres" já vive como contexto de "ocupados", e um KPI
          a menos é uma linha mais legível. O quarto só aparece quando existe bloqueio —
          zero bloqueado não é informação, é ruído. */}
      <StatRow>
        <StatCell><Stat label="Endereços" value={stats.total} context={`${stats.livres} livres`} /></StatCell>
        <StatCell><Stat label="Ocupados" value={stats.ocupados} context={stats.total > 0 ? `${Math.round((stats.ocupados / stats.total) * 100)}% do pulmão` : undefined} /></StatCell>
        <StatCell><Stat label="Caixas armazenadas" value={stats.caixas} /></StatCell>
        {stats.bloqueados > 0 && (
          <StatCell><Stat label="Bloqueados" value={stats.bloqueados} context="não recebem mercadoria" /></StatCell>
        )}
      </StatRow>

      <SegmentedControl label="Seção" options={MODES} value={mode} onChange={setMode} />

      {mode === 'mapa' && (
        <WmsStorageMap
          bins={bins}
          occupancy={occupancy}
          canManage={canManage}
          onOperate={code => { setOperateBin(code); setMode('movimentar'); }}
          onCapacityChanged={load}
        />
      )}

      {mode === 'movimentar' && (
        <WmsBinOperations bins={bins} initialBinCode={operateBin || scannedBin} onMoved={load} />
      )}

      {mode === 'enderecos' && (
        <>
          {canManage && (
            <Panel>
              {/* Recolhido por padrão: criar endereço é ato de configuração, feito uma vez.
                  Deixá-lo aberto empurrava a lista — o conteúdo que se consulta todo dia —
                  para baixo da dobra. */}
              <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-title">Criar endereços em lote</h3>
                  <p className="text-caption mt-1">
                    O código é hierárquico de propósito: ordenado alfabeticamente ele já dá a sequência de
                    caminhada pelo corredor. Use um prefixo diferente de <code>P1-</code> e <code>P2-</code>,
                    que são os vãos de picking das capas.
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setGeneratorOpen(v => !v)} aria-expanded={generatorOpen}>
                  {generatorOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {generatorOpen ? 'Fechar' : 'Abrir'}
                </Button>
              </PanelSection>
              {generatorOpen && (
              <PanelSection padding="sm">
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-caption">Prefixo</span>
                    <Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="PP" />
                  </label>
                  <label className="block">
                    <span className="text-caption">Capacidade (caixas, opcional)</span>
                    <Input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} />
                  </label>
                </div>

                {/* Uma linha por rua, com a própria contagem: é assim que o galpão é, e
                    um número único para todas obrigava a criar em várias rodadas. */}
                <div className="mt-4">
                  <span className="text-caption">Estrutura — uma linha por rua (paredão, meio, bloco)</span>
                  <div className="mt-2 space-y-2">
                    {streetRows.map((row, i) => {
                      const valida = /^[A-Za-z]+$/.test(row.street.trim());
                      const quantas = valida ? Math.max(0, row.modules) * Math.max(0, row.levels) : 0;
                      return (
                        <div key={i} className="flex flex-wrap items-end gap-2">
                          <label className="block w-20">
                            {i === 0 && <span className="text-caption">Rua</span>}
                            <Input
                              value={row.street}
                              onChange={e => patchStreet(i, { street: e.target.value })}
                              placeholder="A"
                            />
                          </label>
                          <label className="block w-24">
                            {i === 0 && <span className="text-caption">Módulos</span>}
                            <Input
                              type="number" min={1}
                              value={row.modules}
                              onChange={e => patchStreet(i, { modules: Math.max(0, parseInt(e.target.value) || 0) })}
                            />
                          </label>
                          <label className="block w-24">
                            {i === 0 && <span className="text-caption">Níveis</span>}
                            <Input
                              type="number" min={1}
                              value={row.levels}
                              onChange={e => patchStreet(i, { levels: Math.max(0, parseInt(e.target.value) || 0) })}
                            />
                          </label>
                          <span className="text-caption pb-2.5 min-w-[9rem]">
                            {valida
                              ? `= ${quantas} endereço(s)`
                              : 'Rua precisa ser letra'}
                          </span>
                          {streetRows.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStreetRows(rows => rows.filter((_, k) => k !== i))}
                              aria-label={`Remover rua ${row.street || i + 1}`}
                            >
                              <Trash2 size={16} />
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <Button variant="secondary" size="sm" onClick={addStreet} className="mt-2">
                    <Plus size={16} />
                    Adicionar rua
                  </Button>

                  {/* A rua é letra porque o código vira número no módulo (`PP-A01-N1`):
                      um dígito na rua tornaria `PP-113-N1` ambíguo. */}
                  <p className="text-caption mt-2">
                    A rua é uma letra — o nome que vocês usam (Paredão 1, Meio 3) vira A, B, C
                    na mesma ordem em que estiverem aqui.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 mt-4">
                  <Button onClick={handleCreate} disabled={creating || preview.length === 0}>
                    {creating ? 'Criando...' : `Criar ${preview.length} endereços`}
                  </Button>
                  {preview.length > 0 && (
                    <span className="text-caption">
                      Primeiro: <strong>{preview[0]}</strong> · Último: <strong>{preview[preview.length - 1]}</strong>
                    </span>
                  )}
                </div>

                {created !== null && (
                  <p className="text-caption mt-3">
                    {created === 0
                      ? 'Nenhum endereço novo — todos já existiam.'
                      : `${created} endereço(s) criado(s). Os que já existiam foram preservados.`}
                  </p>
                )}
              </PanelSection>
              )}
            </Panel>
          )}

          <Panel>
            {/* Impressão também é configuração de uma vez: fica recolhida, abaixo do
                gerador, e não disputa espaço com a lista de endereços. */}
            <PanelSection padding="sm" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-title">Etiquetas</h3>
                <p className="text-caption mt-1">
                  Um QR por endereço, colado na estrutura da vaga. Ao escanear pelo celular, abre esta
                  mesma tela em <strong>Movimentar</strong>, já com a vaga preenchida.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => setLabelsOpen(v => !v)} aria-expanded={labelsOpen}>
                  {labelsOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  {labelsOpen ? 'Fechar' : 'Abrir'}
                </Button>
                <Button variant="secondary" onClick={handlePrint} disabled={printing || bins.length === 0 || isLocalOrigin(qrBase)}>
                  <Printer size={16} />
                  {printing ? 'Gerando...' : `Imprimir ${bins.length}`}
                </Button>
              </div>
            </PanelSection>

            {labelsOpen && (
            <PanelSection padding="sm">
              {/* Formato antes do endereço do QR: é o que muda de uma impressão para a
                  outra. O endereço se configura uma vez na vida. */}
              <div className="space-y-3">
                <div>
                  <span className="text-caption">Formato da etiqueta</span>
                  <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {LABEL_FORMATS.map(fmt => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => changeLabelPrefs({ format: fmt.id })}
                        aria-pressed={labelPrefs.format === fmt.id}
                        className={`min-h-[44px] rounded-control border px-3 py-2 text-left transition-colors ${
                          labelPrefs.format === fmt.id
                            ? 'border-accent bg-accent/10 text-accent'
                            : 'border-edge bg-surface-3 text-fg hover:bg-edge'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{fmt.label}</span>
                        <span className="block text-xs text-fg-subtle mt-0.5">{fmt.hint}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {labelPrefs.format === 'a4' && (
                  <label className="block">
                    <span className="text-caption">Etiquetas por folha</span>
                    <Select
                      value={String(labelPrefs.perPage)}
                      onChange={e => changeLabelPrefs({ perPage: Number(e.target.value) as A4PerPage })}
                      className="mt-1 w-full sm:w-auto"
                    >
                      {A4_PER_PAGE.map(n => <option key={n} value={n}>{n} por folha</option>)}
                    </Select>
                  </label>
                )}

                {labelPrefs.format === 'custom' && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-caption">Largura (mm)</span>
                      <Input
                        type="number" min={25} max={210}
                        value={labelPrefs.customWidthMm}
                        onChange={e => changeLabelPrefs({ customWidthMm: Number(e.target.value) || 0 })}
                      />
                    </label>
                    <label className="block">
                      <span className="text-caption">Altura (mm)</span>
                      <Input
                        type="number" min={15} max={297}
                        value={labelPrefs.customHeightMm}
                        onChange={e => changeLabelPrefs({ customHeightMm: Number(e.target.value) || 0 })}
                      />
                    </label>
                  </div>
                )}

                {/* O que vai sair da impressora, antes de sair. Evita descobrir no papel
                    que 85 endereços viraram 85 páginas. */}
                <p className="text-caption">
                  Etiqueta de <strong>{plan.labelWidthMm} × {plan.labelHeightMm} mm</strong>, QR de {plan.qrMm} mm
                  {' · '}
                  {bins.length} endereço(s) em <strong>{sheets}</strong>{' '}
                  {plan.perPage === 1 ? 'etiqueta(s)' : `folha(s) de ${plan.perPage}`}
                </p>
                <p className="text-caption">
                  A impressora é escolhida na janela de impressão do navegador, que abre em seguida.
                  Confira ali se o tamanho do papel bate com o formato acima.
                </p>
              </div>

              <label className="block mt-4 pt-4 border-t border-edge">
                <span className="text-caption">Endereço do sistema que vai dentro do QR</span>
                <Input value={qrBase} onChange={e => setQrBase(e.target.value)} />
              </label>
              <p className="text-caption mt-2">
                Cada adesivo vai conter <code>{(qrBase || '…').replace(/\/+$/, '')}{SCAN_PATH}?{BIN_SCAN_PARAM}=PP-A01-N1</code>
              </p>

              {isLocalOrigin(qrBase) ? (
                <div className="mt-3">
                  <Notice tone="danger">
                    Você está acessando o sistema por um endereço local. Adesivo gerado assim só funciona
                    nesta máquina — no celular do estoque não abre nada. Troque pelo endereço real do
                    InventoryBlind antes de imprimir.
                  </Notice>
                </div>
              ) : (
                <div className="mt-3">
                  <Notice tone="warning">
                    Este endereço fica colado em cada adesivo por anos. Se um dia o sistema mudar de
                    endereço, todos param de funcionar de uma vez — por isso o ideal é um domínio seu
                    (ex.: <code>estoque.azbuy.com.br</code>) apontando para o sistema, e não o do provedor.
                  </Notice>
                </div>
              )}
            </PanelSection>
            )}
          </Panel>

          <Panel>
            {canManage && emptyBins.length > 0 && (
              <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-title">Limpeza</h3>
                  <p className="text-caption mt-1">
                    {emptyBins.length} endereço(s) sem nenhuma movimentação. Útil quando o padrão
                    saiu errado e o lote gerou mais códigos do que você queria.
                  </p>
                </div>
                {confirmBulk ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-fg">Excluir {emptyBins.length}?</span>
                    <Button onClick={() => handleDelete(emptyBins.map(b => b.id))}>Confirmar</Button>
                    <Button variant="secondary" onClick={() => setConfirmBulk(false)}>Cancelar</Button>
                  </div>
                ) : (
                  <Button variant="secondary" onClick={() => setConfirmBulk(true)}>
                    <Trash2 size={16} />
                    Excluir os {emptyBins.length} vazios
                  </Button>
                )}
              </PanelSection>
            )}

            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Endereço</Th>
                    <Th className="text-center">Caixas</Th>
                    <Th className="text-center">Capacidade</Th>
                    <Th className="text-center">Situação</Th>
                    {canManage && <Th className="text-center">Ações</Th>}
                  </Tr>
                </Thead>
                <tbody>
                  {loading ? (
                    <Tr><Td colSpan={canManage ? 5 : 4}>Carregando...</Td></Tr>
                  ) : bins.length === 0 ? (
                    <Tr>
                      <Td colSpan={canManage ? 5 : 4}>
                        Nenhum endereço cadastrado ainda. Crie os endereços acima para começar.
                      </Td>
                    </Tr>
                  ) : (
                    bins.map(bin => {
                      const boxes = occupancy.get(bin.code) ?? 0;
                      return (
                        <Tr key={bin.id}>
                          <Td className="font-medium text-fg">{bin.code}</Td>
                          <Td className="text-center text-numeric">{boxes}</Td>
                          <Td className="text-center text-numeric">{bin.capacityBoxes ?? '—'}</Td>
                          <Td className="text-center">
                            {bin.blocked
                              ? <Badge variant="neutral">Bloqueado</Badge>
                              : boxes > 0
                                ? <Badge variant="accent">Ocupado</Badge>
                                : <span className="text-caption">Livre</span>}
                          </Td>
                          {canManage && (
                            <Td className="text-center">
                              <div className="flex items-center justify-center gap-2">
                                <Button variant="secondary" onClick={() => handleToggleBlock(bin)}>
                                  {bin.blocked ? <Unlock size={14} /> : <Lock size={14} />}
                                  {bin.blocked ? 'Liberar' : 'Bloquear'}
                                </Button>
                                {/* Só aparece em endereço vazio. Com saldo, o banco recusaria
                                    de qualquer jeito — mas oferecer o botão seria mentira. */}
                                {boxes === 0 && (
                                  <Button variant="secondary" onClick={() => handleDelete([bin.id])}>
                                    <Trash2 size={14} />
                                    Excluir
                                  </Button>
                                )}
                              </div>
                            </Td>
                          )}
                        </Tr>
                      );
                    })
                  )}
                </tbody>
              </Table>
            </div>
          </Panel>
        </>
      )}

      {mode === 'consulta' && (
        <Panel>
          <PanelSection padding="sm">
            <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
              <Input
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="SKU ou nome do produto"
                className="flex-1"
              />
              <Button type="submit" disabled={searching || !term.trim()}>
                <Search size={16} />
                {searching ? 'Buscando...' : 'Buscar'}
              </Button>
            </form>
          </PanelSection>

          {results !== null && (
            <div className="overflow-x-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>SKU</Th>
                    <Th>Produto</Th>
                    <Th>Endereço</Th>
                    <Th className="text-center">Caixas</Th>
                    <Th className="text-center">Unidades</Th>
                    <Th className="text-center">Guardado em</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {results.length === 0 ? (
                    <Tr><Td colSpan={6}>Nada encontrado no pulmão para esse termo.</Td></Tr>
                  ) : (
                    results.map(row => (
                      <Tr key={`${row.productId}-${row.binCode}`}>
                        <Td className="text-numeric">{row.sku}</Td>
                        <Td>{row.productName}</Td>
                        <Td className="font-medium text-fg">{row.binCode}</Td>
                        <Td className="text-center text-numeric">{row.boxes}</Td>
                        <Td className="text-center text-numeric">{row.units}</Td>
                        <Td className="text-center text-caption">
                          {formatDate(row.firstStoredAt)} · {ageInDays(row.firstStoredAt)}d
                        </Td>
                      </Tr>
                    ))
                  )}
                </tbody>
              </Table>
            </div>
          )}
        </Panel>
      )}

      {mode === 'movimentos' && (
        <Panel>
          <PanelSection padding="sm">
            <h3 className="text-title">Últimos movimentos</h3>
            <p className="text-caption mt-1">
              Todo saldo vem de um documento. Este histórico não se edita nem se apaga.
            </p>
          </PanelSection>
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Quando</Th>
                  <Th>Tipo</Th>
                  <Th>SKU</Th>
                  <Th>De</Th>
                  <Th>Para</Th>
                  <Th className="text-center">Caixas</Th>
                  <Th>Motivo</Th>
                </Tr>
              </Thead>
              <tbody>
                {movements.length === 0 ? (
                  <Tr><Td colSpan={7}>Nenhum movimento registrado ainda.</Td></Tr>
                ) : (
                  movements.map(m => (
                    <Tr key={m.id}>
                      <Td className="text-caption">{formatDate(m.createdAt)}</Td>
                      <Td>{MOVEMENT_LABEL[m.movementType]}</Td>
                      <Td className="text-numeric">{m.sku ?? '—'}</Td>
                      <Td>{m.fromCode ?? '—'}</Td>
                      <Td>{m.toCode ?? '—'}</Td>
                      <Td className="text-center text-numeric">{m.boxes}</Td>
                      <Td className="text-caption">{m.reason ?? '—'}</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        </Panel>
      )}

    </Page>
  );
}
