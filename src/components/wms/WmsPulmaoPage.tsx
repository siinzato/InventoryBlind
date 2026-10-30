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
import { Lock, PackagePlus, Printer, Search, Trash2, Unlock, Warehouse } from 'lucide-react';
import {
  Badge, Button, Input, Notice, Page, PageHeader, Panel, PanelSection,
  SegmentedControl, Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
  type SegmentedOption,
} from '../ui';
import { renderBarcodeSVG } from '../../lib/barcode/barcodeExport';
import { WmsBinOperations } from './WmsBinOperations';
import {
  boxesByBin, buildBinCodes, createBins, deleteBins, listBins, listMovements, searchStock, setBinBlocked,
  type BinMovement, type BinStockRow, type StorageBin,
} from '../../lib/wms/wmsService';

type Mode = 'movimentar' | 'enderecos' | 'consulta' | 'movimentos';

const MODES: SegmentedOption<Mode>[] = [
  { value: 'movimentar', label: 'Movimentar', icon: PackagePlus },
  { value: 'enderecos', label: 'Endereços', icon: Warehouse },
  { value: 'consulta', label: 'Consultar SKU', icon: Search },
  { value: 'movimentos', label: 'Movimentos', icon: Printer },
];

/** Caminho que o QR abre: a própria tela, com o endereço na query. Não precisou de rota
 *  nova — o roteamento do app resolve pelo pathname e ignora a query, então o adesivo
 *  cai direto em "Movimentar" com a vaga já preenchida. */
const SCAN_PATH = '/app/operacoes/pulmao';
export const SCAN_PARAM = 'v';

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
    return new URLSearchParams(window.location.search).get(SCAN_PARAM)?.trim().toUpperCase() ?? '';
  });
  const [mode, setMode] = useState<Mode>(scannedBin ? 'movimentar' : 'enderecos');
  const [bins, setBins] = useState<StorageBin[]>([]);
  const [occupancy, setOccupancy] = useState<Map<string, number>>(new Map());
  const [movements, setMovements] = useState<BinMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Gerador de endereços
  const [prefix, setPrefix] = useState('PP');
  const [streets, setStreets] = useState('A, B, C');
  const [modules, setModules] = useState('5');
  const [levels, setLevels] = useState('4');
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
    () => buildBinCodes({
      prefix,
      streets: streets.split(',').map(s => s.trim()).filter(Boolean),
      modulesPerStreet: Math.max(0, parseInt(modules) || 0),
      levelsPerModule: Math.max(0, parseInt(levels) || 0),
    }),
    [prefix, streets, modules, levels],
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
        body > *:not(#ib-wms-print-root) { display: none !important; }
        #ib-wms-print-root {
          display: grid !important;
          grid-template-columns: repeat(4, 1fr);
          background: #fff; color: #000;
        }
        #ib-wms-print-root .ib-wms-label {
          display: flex; flex-direction: column; align-items: center; justify-content: center;
          break-inside: avoid; padding: 5mm 2mm;
        }
        #ib-wms-print-root .ib-wms-label svg { width: 28mm; height: 28mm; }
        #ib-wms-print-root .ib-wms-label span {
          margin-top: 2mm; font-size: 10pt; font-weight: 700; letter-spacing: .02em;
        }
        @page { margin: 8mm; }
      }
    `;

    const cleanup = () => {
      root.remove();
      style.remove();
    };

    try {
      try { localStorage.setItem(QR_BASE_KEY, base); } catch { /* modo privado */ }

      for (const bin of bins) {
        const svg = await renderBarcodeSVG('qrcode', `${base}${SCAN_PATH}?${SCAN_PARAM}=${bin.code}`, {
          showHumanReadable: false,
          scale: 1,
          eccLevel: 'M',
        });
        const cell = document.createElement('div');
        cell.className = 'ib-wms-label';
        cell.innerHTML = `${svg}<span>${bin.code}</span>`;
        root.appendChild(cell);
      }

      document.head.appendChild(style);
      document.body.appendChild(root);
      // Limpa quando a caixa de impressão fecha, tenha a pessoa impresso ou cancelado.
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
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

      <StatRow>
        <StatCell><Stat label="Endereços" value={stats.total} /></StatCell>
        <StatCell><Stat label="Ocupados" value={stats.ocupados} context={`${stats.livres} livres`} /></StatCell>
        <StatCell><Stat label="Caixas armazenadas" value={stats.caixas} /></StatCell>
        <StatCell><Stat label="Bloqueados" value={stats.bloqueados} context="não recebem mercadoria" /></StatCell>
      </StatRow>

      <SegmentedControl label="Seção" options={MODES} value={mode} onChange={setMode} />

      {mode === 'movimentar' && (
        <WmsBinOperations bins={bins} initialBinCode={scannedBin} onMoved={load} />
      )}

      {mode === 'enderecos' && (
        <>
          {canManage && (
            <Panel>
              <PanelSection padding="sm">
                <h3 className="text-title">Criar endereços em lote</h3>
                <p className="text-caption mt-1">
                  O código é hierárquico de propósito: ordenado alfabeticamente ele já dá a sequência de
                  caminhada pelo corredor. Use um prefixo diferente de <code>P1-</code> e <code>P2-</code>,
                  que são os vãos de picking das capas.
                </p>
              </PanelSection>
              <PanelSection padding="sm">
                <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                  <label className="block">
                    <span className="text-caption">Prefixo</span>
                    <Input value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="PP" />
                  </label>
                  <label className="block">
                    <span className="text-caption">Ruas (separadas por vírgula)</span>
                    <Input value={streets} onChange={e => setStreets(e.target.value)} placeholder="A, B, C" />
                  </label>
                  <label className="block">
                    <span className="text-caption">Módulos por rua</span>
                    <Input type="number" min={1} value={modules} onChange={e => setModules(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-caption">Níveis por módulo</span>
                    <Input type="number" min={1} value={levels} onChange={e => setLevels(e.target.value)} />
                  </label>
                  <label className="block">
                    <span className="text-caption">Capacidade (caixas, opcional)</span>
                    <Input type="number" min={1} value={capacity} onChange={e => setCapacity(e.target.value)} />
                  </label>
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
            </Panel>
          )}

          <Panel>
            <PanelSection padding="sm" className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-title">Etiquetas</h3>
                <p className="text-caption mt-1">
                  Um QR por endereço, colado na estrutura da vaga. Ao escanear pelo celular, abre esta
                  mesma tela em <strong>Movimentar</strong>, já com a vaga preenchida.
                </p>
              </div>
              <Button variant="secondary" onClick={handlePrint} disabled={printing || bins.length === 0 || isLocalOrigin(qrBase)}>
                <Printer size={16} />
                {printing ? 'Gerando...' : `Imprimir ${bins.length} etiquetas`}
              </Button>
            </PanelSection>

            <PanelSection padding="sm">
              <label className="block">
                <span className="text-caption">Endereço do sistema que vai dentro do QR</span>
                <Input value={qrBase} onChange={e => setQrBase(e.target.value)} />
              </label>
              <p className="text-caption mt-2">
                Cada adesivo vai conter <code>{(qrBase || '…').replace(/\/+$/, '')}{SCAN_PATH}?{SCAN_PARAM}=PP-A01-N1</code>
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
                    Este endereço fica colado em 85 adesivos por anos. Se um dia o sistema mudar de
                    endereço, todos param de funcionar de uma vez — por isso o ideal é um domínio seu
                    (ex.: <code>estoque.azbuy.com.br</code>) apontando para o sistema, e não o do provedor.
                  </Notice>
                </div>
              )}
            </PanelSection>
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
