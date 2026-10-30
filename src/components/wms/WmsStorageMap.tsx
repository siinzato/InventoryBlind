// Pulmão -> Mapa. Visualização 2D dos endereços de armazenagem.
//
// Por que um mapa e não só a lista: a pergunta operacional do porta-pallet é espacial
// ("onde tem vaga livre nesta rua?", "quanto desta rua está cheio?"), e uma tabela
// ordenada por código responde isso mal. O mapa não é enfeite — é a mesma informação
// na forma em que ela é consumida no corredor.
//
// A grade espelha a estrutura física: uma coluna por módulo, e os níveis de cima para
// baixo, com o nível mais alto no topo — igual a olhar o porta-pallet de frente.
//
// NÃO há estado inventado aqui: todas as posições vêm de `warehouse_storage_bins` e a
// ocupação vem do saldo real. Código que não segue o padrão de nomenclatura não é
// descartado nem "corrigido" — cai num grupo próprio, listado como está.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { Lock, PackageOpen } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Select } from '../ui';
import { parseBinCode } from '../../lib/wms/binCode';
import {
  listBinContents, listMovementsForBin, setBinCapacity,
  type BinMovement, type BinStockRow, type StorageBin,
} from '../../lib/wms/wmsService';

type Status = 'livre' | 'ocupado' | 'quase-cheio' | 'bloqueado';

/** A partir daqui a vaga é tratada como "quase cheia". 85% é o ponto em que ainda cabe
 *  alguma coisa mas já não cabe um recebimento inteiro — é quando vale avisar, não aos
 *  100%, que é tarde. Só se aplica a endereço COM capacidade declarada: sem limite
 *  declarado não existe "quase". */
const NEARLY_FULL_RATIO = 0.85;

/** `PP-A01-N3` -> rua A, módulo 01, nível 3. Mora em `lib/wms/binCode` porque a etiqueta
 *  impressa faz exatamente a mesma leitura: duas cópias do regex divergiriam na primeira
 *  vez que o padrão de endereço mudasse. Fora do padrão devolve `null` e cai no grupo
 *  "sem posição definida". */
const parseCode = parseBinCode;

/** Percentual de ocupação, ou `null` quando o endereço não tem capacidade declarada —
 *  nesse caso não existe denominador e inventar um seria dado falso. */
const occupancyRatio = (bin: StorageBin, boxes: number): number | null =>
  bin.capacityBoxes ? boxes / bin.capacityBoxes : null;

const statusOf = (bin: StorageBin, boxes: number): Status => {
  if (bin.blocked) return 'bloqueado';
  if (boxes === 0) return 'livre';
  const ratio = occupancyRatio(bin, boxes);
  return ratio !== null && ratio >= NEARLY_FULL_RATIO ? 'quase-cheio' : 'ocupado';
};

/** Cor com significado, não decoração: ocupado usa o acento do produto, bloqueado fica
 *  apagado, livre é superfície neutra. Três estados, três tratamentos — sem paleta
 *  inventada por variedade. */
const CELL_STYLE: Record<Status, string> = {
  livre: 'bg-surface-3 border-edge text-fg-subtle hover:border-fg-subtle',
  ocupado: 'bg-accent/10 border-accent/40 text-fg hover:border-accent',
  // Âmbar é o token de atenção do projeto, e aqui ele carrega significado real: ainda
  // cabe, mas não cabe muito. Não é uma quarta cor por variedade.
  'quase-cheio': 'bg-warning/10 border-warning/50 text-fg hover:border-warning',
  bloqueado: 'bg-surface-2 border-edge text-fg-subtle opacity-60 hover:opacity-100',
};

/** Preenchimento da barra de ocupação — mesma semântica da célula. */
const BAR_FILL: Record<Status, string> = {
  livre: 'bg-edge',
  ocupado: 'bg-accent',
  'quase-cheio': 'bg-warning',
  bloqueado: 'bg-fg-subtle',
};

const STATUS_LABEL: Record<Status, string> = {
  livre: 'Livre',
  ocupado: 'Ocupado',
  'quase-cheio': 'Quase cheio',
  bloqueado: 'Bloqueado',
};

const MOVEMENT_LABEL: Record<BinMovement['movementType'], string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  transferencia: 'Transferência',
};

const STATUS_BADGE: Record<Status, 'neutral' | 'accent' | 'warning'> = {
  livre: 'neutral',
  ocupado: 'accent',
  'quase-cheio': 'warning',
  bloqueado: 'neutral',
};

const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function WmsStorageMap({
  bins,
  occupancy,
  canManage,
  onOperate,
  onCapacityChanged,
}: {
  bins: StorageBin[];
  occupancy: Map<string, number>;
  canManage: boolean;
  onOperate: (binCode: string) => void;
  onCapacityChanged: () => void;
}) {
  const [street, setStreet] = useState('');
  const [status, setStatus] = useState<'' | Status>('');
  const [selected, setSelected] = useState<StorageBin | null>(null);
  const [contents, setContents] = useState<BinStockRow[] | null>(null);
  const [history, setHistory] = useState<BinMovement[]>([]);
  const [capacityDraft, setCapacityDraft] = useState('');
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  /** Estrutura do galpão derivada dos códigos existentes — nunca de uma configuração
   *  paralela que poderia divergir do que está cadastrado. */
  const layout = useMemo(() => {
    const streets = new Map<string, { modules: Set<string>; levels: Set<number>; bins: Map<string, StorageBin> }>();
    const loose: StorageBin[] = [];

    for (const bin of bins) {
      const parsed = parseCode(bin.code);
      if (!parsed) { loose.push(bin); continue; }
      const entry = streets.get(parsed.street) ?? { modules: new Set(), levels: new Set(), bins: new Map() };
      entry.modules.add(parsed.module);
      entry.levels.add(parsed.level);
      entry.bins.set(`${parsed.module}|${parsed.level}`, bin);
      streets.set(parsed.street, entry);
    }

    return {
      streets: [...streets.entries()]
        .map(([name, entry]) => ({
          name,
          modules: [...entry.modules].sort(),
          // Nível mais alto no topo: a grade fica igual a olhar a estrutura de frente.
          levels: [...entry.levels].sort((a, b) => b - a),
          bins: entry.bins,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      loose,
    };
  }, [bins]);

  const visibleStreets = street ? layout.streets.filter(s => s.name === street) : layout.streets;

  const matches = (bin: StorageBin | undefined): boolean => {
    if (!bin) return false;
    if (!status) return true;
    return statusOf(bin, occupancy.get(bin.code) ?? 0) === status;
  };

  useEffect(() => {
    setCapacityDraft(selected?.capacityBoxes != null ? String(selected.capacityBoxes) : '');
    setCapacityError(null);
    if (!selected) { setContents(null); setHistory([]); return; }
    let cancelled = false;
    setLoadingDetail(true);
    Promise.all([listBinContents(selected.code), listMovementsForBin(selected.id)])
      .then(([rows, moves]) => {
        if (cancelled) return;
        setContents(rows);
        setHistory(moves);
      })
      .catch(err => console.error('[wms] falha ao abrir o detalhe da vaga:', err))
      .finally(() => { if (!cancelled) setLoadingDetail(false); });
    return () => { cancelled = true; };
  }, [selected]);

  const selectedBoxes = selected ? occupancy.get(selected.code) ?? 0 : 0;
  const selectedStatus = selected ? statusOf(selected, selectedBoxes) : 'livre';
  const selectedRatio = selected ? occupancyRatio(selected, selectedBoxes) : null;
  const selectedParsed = selected ? parseCode(selected.code) : null;

  const handleSaveCapacity = async () => {
    if (!selected) return;
    setSavingCapacity(true);
    setCapacityError(null);
    try {
      const raw = capacityDraft.trim();
      await setBinCapacity(selected.id, raw === '' ? null : Number(raw));
      onCapacityChanged();
    } catch (err) {
      // Reduzir abaixo do que já está guardado é recusado pelo banco (trigger da 118):
      // a mensagem vem de lá, com o número real de caixas.
      setCapacityError(err instanceof Error ? err.message : 'Não foi possível salvar a capacidade.');
    } finally {
      setSavingCapacity(false);
    }
  };

  if (bins.length === 0) {
    return (
      <Panel>
        <PanelSection padding="lg">
          <div className="flex flex-col items-center text-center gap-2 py-8">
            <PackageOpen size={32} className="opacity-40" />
            <p className="text-sm font-medium text-fg">Nenhum endereço cadastrado</p>
            <p className="text-xs text-fg-subtle max-w-[32ch]">
              Crie os endereços na aba Endereços para o mapa do porta-pallet aparecer aqui.
            </p>
          </div>
        </PanelSection>
      </Panel>
    );
  }

  return (
    <>
      <Panel>
        <PanelSection padding="sm" className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2">
            <span className="text-caption">Rua</span>
            <Select value={street} onChange={e => setStreet(e.target.value)} className="w-auto">
              <option value="">Todas</option>
              {layout.streets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
            </Select>
          </label>

          <label className="flex items-center gap-2">
            <span className="text-caption">Situação</span>
            <Select value={status} onChange={e => setStatus(e.target.value as '' | Status)} className="w-auto">
              <option value="">Todas</option>
              <option value="livre">Livre</option>
              <option value="ocupado">Ocupado</option>
              <option value="quase-cheio">Quase cheio</option>
              <option value="bloqueado">Bloqueado</option>
            </Select>
          </label>

          {/* Legenda inline: três amostras pequenas, sem bloco próprio. */}
          <div className="flex items-center gap-3 ml-auto">
            {(['livre', 'ocupado', 'quase-cheio', 'bloqueado'] as Status[]).map(s => (
              <span key={s} className="flex items-center gap-1.5 text-caption">
                <span className={`w-3 h-3 rounded-sm border ${CELL_STYLE[s].split(' ').slice(0, 2).join(' ')}`} />
                {STATUS_LABEL[s]}
              </span>
            ))}
          </div>
        </PanelSection>

        {visibleStreets.map(s => (
          <PanelSection key={s.name} padding="sm">
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="text-title">Rua {s.name}</h3>
              <span className="text-caption">
                {s.modules.length} {s.modules.length === 1 ? 'módulo' : 'módulos'}
                {' · '}
                {s.levels.length} {s.levels.length === 1 ? 'nível' : 'níveis'}
              </span>
            </div>

            {/* Grade elástica: a coluna encolhe até caber a rua inteira na largura
                disponível — um paredão de 16 módulos tem que ser visto de uma vez, não
                em duas rolagens. O mínimo garante que a célula continue legível; abaixo
                disso (celular) a rolagem horizontal própria assume, sem empurrar a
                página de lado. */}
            <div className="overflow-x-auto -mx-1 px-1">
              <div
                className="grid gap-1.5"
                style={{
                  gridTemplateColumns: `2rem repeat(${s.modules.length}, minmax(2.5rem, 1fr))`,
                  // Teto: sem ele, uma rua de 3 módulos estica cada célula por toda a
                  // largura e fica desproporcional ao lado de uma de 16.
                  maxWidth: `${2 + s.modules.length * (4.5 + 0.375)}rem`,
                }}
              >
                {s.levels.map(level => (
                  <Fragment key={level}>
                    <span className="flex items-center justify-end pr-1 text-caption text-numeric">
                      N{level}
                    </span>
                    {s.modules.map(module => {
                      const bin = s.bins.get(`${module}|${level}`);
                      if (!bin) {
                        // Buraco real na estrutura (nível que não existe naquele módulo).
                        return <span key={module} aria-hidden="true" />;
                      }
                      const boxes = occupancy.get(bin.code) ?? 0;
                      const st = statusOf(bin, boxes);
                      const dim = !matches(bin);
                      return (
                        <button
                          key={module}
                          type="button"
                          onClick={() => setSelected(bin)}
                          aria-label={`${bin.code} — ${STATUS_LABEL[st]}`}
                          aria-pressed={selected?.id === bin.id}
                          className={`rounded-container border px-1 py-2 text-center transition-colors
                            ${CELL_STYLE[st]}
                            ${dim ? 'opacity-25' : ''}
                            ${selected?.id === bin.id ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-2' : ''}`}
                        >
                          <span className="block text-[11px] font-semibold text-numeric leading-tight">{module}</span>
                          <span className="block text-caption leading-tight mt-0.5">
                            {st === 'bloqueado'
                              ? <Lock size={11} className="inline" />
                              : bin.capacityBoxes
                                ? `${boxes}/${bin.capacityBoxes}`
                                : boxes > 0
                                  ? `${boxes} cx`
                                  : '—'}
                          </span>
                          {/* Barra só existe quando há capacidade declarada: sem
                              denominador não há proporção a desenhar. */}
                          {bin.capacityBoxes != null && st !== 'bloqueado' && (
                            <span className="block h-1 mt-1 rounded-full bg-edge/60 overflow-hidden" aria-hidden="true">
                              <span
                                className={`block h-full rounded-full ${BAR_FILL[st]}`}
                                style={{ width: `${Math.min(100, Math.round((occupancyRatio(bin, boxes) ?? 0) * 100))}%` }}
                              />
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </div>
          </PanelSection>
        ))}

        {layout.loose.length > 0 && (
          <PanelSection padding="sm">
            <h3 className="text-title">Fora do padrão de nomenclatura</h3>
            <p className="text-caption mt-1">
              Estes endereços não seguem o formato rua/módulo/nível e por isso não entram na grade.
              Continuam funcionando normalmente.
            </p>
            <div className="flex flex-wrap gap-1.5 mt-3">
              {layout.loose.map(bin => {
                const boxes = occupancy.get(bin.code) ?? 0;
                return (
                  <button
                    key={bin.id}
                    type="button"
                    onClick={() => setSelected(bin)}
                    className={`rounded-container border px-2.5 py-1.5 text-xs transition-colors ${CELL_STYLE[statusOf(bin, boxes)]}`}
                  >
                    {bin.code}
                  </button>
                );
              })}
            </div>
          </PanelSection>
        )}
      </Panel>

      {selected && (
        <Panel>
          <PanelSection padding="sm" className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-title">{selected.code}</h3>
                <Badge variant={STATUS_BADGE[selectedStatus]}>{STATUS_LABEL[selectedStatus]}</Badge>
              </div>
              {/* Endereço decomposto: o código é compacto para caber na célula, mas na
                  hora de mandar alguém até lá "Rua A · Módulo 03 · Nível 2" é o que a
                  pessoa usa. */}
              <p className="text-caption mt-1">
                {selectedParsed
                  ? `Rua ${selectedParsed.street} · Módulo ${selectedParsed.module} · Nível ${selectedParsed.level}`
                  : 'Endereço fora do padrão rua/módulo/nível'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={() => onOperate(selected.code)}>Movimentar</Button>
              <Button variant="secondary" onClick={() => setSelected(null)}>Fechar</Button>
            </div>
          </PanelSection>

          <PanelSection padding="sm">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div>
                <span className="text-caption">Caixas guardadas</span>
                <p className="text-lg font-semibold text-fg text-numeric">{selectedBoxes}</p>
              </div>
              <div>
                <span className="text-caption">Capacidade</span>
                <p className="text-lg font-semibold text-fg text-numeric">{selected.capacityBoxes ?? 'sem limite'}</p>
              </div>
              <div>
                <span className="text-caption">Espaço disponível</span>
                <p className="text-lg font-semibold text-fg text-numeric">
                  {selected.capacityBoxes ? Math.max(0, selected.capacityBoxes - selectedBoxes) : '—'}
                </p>
              </div>
              <div>
                <span className="text-caption">Produtos distintos</span>
                <p className="text-lg font-semibold text-fg text-numeric">{contents?.length ?? 0}</p>
              </div>
            </div>

            {selectedRatio !== null && (
              <div className="mt-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-caption">Ocupação</span>
                  <span className="text-caption text-numeric">{Math.round(selectedRatio * 100)}%</span>
                </div>
                <span className="block h-1.5 mt-1.5 rounded-full bg-edge/60 overflow-hidden">
                  <span
                    className={`block h-full rounded-full ${BAR_FILL[selectedStatus]}`}
                    style={{ width: `${Math.min(100, Math.round(selectedRatio * 100))}%` }}
                  />
                </span>
              </div>
            )}

            {selected.blocked && selected.blockedReason && (
              <p className="text-caption mt-3">Motivo do bloqueio: {selected.blockedReason}</p>
            )}

            {canManage && (
              <div className="mt-4 flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="text-caption">Capacidade em caixas</span>
                  <Input
                    type="number"
                    min={1}
                    value={capacityDraft}
                    onChange={e => setCapacityDraft(e.target.value)}
                    placeholder="sem limite"
                    className="w-40"
                  />
                </label>
                <Button variant="secondary" onClick={handleSaveCapacity} disabled={savingCapacity}>
                  {savingCapacity ? 'Salvando...' : 'Salvar capacidade'}
                </Button>
                <span className="text-caption">Vazio = sem limite declarado.</span>
              </div>
            )}

            {capacityError && <div className="mt-3"><Notice tone="danger">{capacityError}</Notice></div>}
          </PanelSection>

          <PanelSection padding="sm">
            {loadingDetail ? (
              <p className="text-caption">Carregando...</p>
            ) : contents && contents.length > 0 ? (
              <ul className="divide-y divide-edge">
                {contents.map(row => (
                  <li key={row.productId} className="py-2 flex items-baseline justify-between gap-3">
                    <span className="min-w-0">
                      <span className="text-numeric text-sm text-fg">{row.sku}</span>
                      <span className="text-sm text-fg-muted"> · {row.productName}</span>
                    </span>
                    <span className="text-sm text-fg-muted shrink-0 text-numeric">
                      {row.boxes} cx · {row.units} un
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-caption">Esta vaga está vazia.</p>
            )}

          </PanelSection>

          <PanelSection padding="sm">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-section">Histórico desta vaga</h4>
              {history.length > 0 && (
                <span className="text-caption">Última: {formatDateTime(history[0].createdAt)}</span>
              )}
            </div>

            {loadingDetail ? (
              <p className="text-caption mt-2">Carregando...</p>
            ) : history.length === 0 ? (
              <p className="text-caption mt-2">Nenhuma movimentação registrada nesta vaga.</p>
            ) : (
              <ul className="divide-y divide-edge mt-1">
                {history.map(move => (
                  <li key={move.id} className="py-2 flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="text-fg">{MOVEMENT_LABEL[move.movementType]}</span>
                      <span className="text-fg-muted"> · {move.sku ?? '—'}</span>
                      {move.movementType === 'transferencia' && (
                        <span className="text-caption"> · {move.fromCode} → {move.toCode}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-fg-muted text-numeric">
                      {move.boxes} cx
                      <span className="text-caption"> · {formatDateTime(move.createdAt)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>
        </Panel>
      )}
    </>
  );
}
