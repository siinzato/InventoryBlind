// Pulmão -> Movimentar. A operação de chão: guardar, retirar e transferir.
//
// É a mesma tela que o QR da vaga abre no celular. O QR leva para
// `/app/operacoes/pulmao?v=<codigo>`, e o endereço já chega preenchido — por isso ela
// funciona igual no desktop (digitando o endereço) e no telefone (escaneando).
//
// Nada aqui escreve saldo direto: as três ações chamam as RPCs `wms_bin_*`, que gravam
// o movimento e o saldo na mesma transação. É o que garante que todo número tenha um
// documento com autor e horário.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Lightbulb, PackageMinus, PackagePlus, QrCode } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Table, Td, Th, Thead, Tr } from '../ui';
import { WmsBinScanner } from './WmsBinScanner';
import {
  lastKnownPackSize, listBinContents, listPulmaoStock, pick, putaway, searchProducts, transfer,
  type BinStockRow, type ProductOption, type StorageBin,
} from '../../lib/wms/wmsService';
import {
  EMPTY_OCCUPANCY, occupancyByProduct, previewTransfer, rejectionFor, suggestBins,
} from '../../lib/wms/binSuggestion';
import type { StockPlacement } from '../../lib/wms/stockInsights';

type Action = 'guardar' | 'retirar' | 'transferir';

/** Qual campo a câmera está preenchendo. O leitor é o mesmo nos dois casos — ele
 *  devolve um código e não sabe o que vai ser feito com ele. */
type ScanTarget = 'origem' | 'destino' | 'conferir';

const SCAN_TITLE: Record<ScanTarget, string> = {
  origem: 'Escanear endereço',
  destino: 'Escanear endereço de destino',
  conferir: 'Conferir a vaga',
};

const ACTION_LABEL: Record<Action, string> = {
  guardar: 'Guardar',
  retirar: 'Retirar',
  transferir: 'Transferir',
};

const ageInDays = (iso: string): number =>
  Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));

export function WmsBinOperations({
  bins,
  initialBinCode,
  onMoved,
}: {
  bins: StorageBin[];
  initialBinCode: string;
  onMoved: () => void;
}) {
  const [binCode, setBinCode] = useState(initialBinCode);
  const [contents, setContents] = useState<BinStockRow[] | null>(null);
  const [action, setAction] = useState<Action>('guardar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Guardar
  const [term, setTerm] = useState('');
  const [options, setOptions] = useState<ProductOption[]>([]);
  const [chosen, setChosen] = useState<ProductOption | null>(null);
  const [unitsPerBox, setUnitsPerBox] = useState('');

  // Comum
  const [boxes, setBoxes] = useState('1');
  const [targetProductId, setTargetProductId] = useState('');
  const [destCode, setDestCode] = useState('');

  const [scanFor, setScanFor] = useState<ScanTarget | null>(null);
  /** Vaga cuja etiqueta o operador conferiu com a camera nesta sessao de tela. */
  const [confirmedCode, setConfirmedCode] = useState<string | null>(null);

  /** Saldo de TODO o pulmão — base do ranking de endereços. Mesma consulta da Fase 3;
   *  nenhuma fonte nova e nenhuma chamada por sugestão. */
  const [placements, setPlacements] = useState<StockPlacement[]>([]);

  const bin = bins.find(b => b.code === binCode.trim().toUpperCase()) ?? null;
  const destBin = bins.find(b => b.code === destCode.trim().toUpperCase()) ?? null;

  const loadPlacements = useCallback(() => {
    listPulmaoStock()
      .then(r => setPlacements(r.placements))
      // Sugestão é auxílio, não requisito: falhando, a tela segue funcionando na mão.
      .catch(() => setPlacements([]));
  }, []);

  useEffect(() => { loadPlacements(); }, [loadPlacements]);

  // ── Sugestão de endereço ────────────────────────────────────────────────────────────
  // O produto e o pack em questão dependem da ação: guardar trabalha com o que foi
  // escolhido na busca, transferir com o que já está na origem.
  const rowAtOrigin = (contents ?? []).find(r => r.productId === targetProductId) ?? null;

  const activeProductId = action === 'guardar' ? chosen?.id ?? null : targetProductId || null;
  const activePack = action === 'guardar'
    ? parseInt(unitsPerBox) || null
    : rowAtOrigin?.unitsPerBox ?? null;

  const qty = parseInt(boxes) || 0;

  const occupancyByCode = useMemo(
    () => occupancyByProduct(placements, activeProductId),
    [placements, activeProductId],
  );

  const suggestions = useMemo(() => {
    if (!activeProductId || qty <= 0) return [];
    return suggestBins({
      bins,
      occupancyByCode,
      boxes: qty,
      unitsPerBox: activePack,
      excludeCode: action === 'transferir' ? bin?.code : undefined,
    }).slice(0, 4);
  }, [bins, occupancyByCode, qty, activePack, activeProductId, action, bin?.code]);

  /** Por que o destino escolhido não serve — a mesma regra que a RPC aplicaria. */
  const destRejection = destBin
    ? rejectionFor(destBin, occupancyByCode.get(destBin.code) ?? EMPTY_OCCUPANCY, {
        boxes: qty,
        unitsPerBox: activePack,
        excludeCode: bin?.code,
      })
    : null;

  const balance = destBin && rowAtOrigin && qty > 0
    ? previewTransfer(
        occupancyByCode.get(bin?.code ?? '') ?? EMPTY_OCCUPANCY,
        occupancyByCode.get(destBin.code) ?? EMPTY_OCCUPANCY,
        Math.min(qty, rowAtOrigin.boxes),
      )
    : null;

  const applyScan = (code: string) => {
    if (scanFor === 'conferir') setConfirmedCode(code);
    else if (scanFor === 'destino') setDestCode(code);
    else { setBinCode(code); setTargetProductId(''); }
    setScanFor(null);
    setError(null);
    setDone(null);
  };

  /** Recusa que a RPC já faria, antecipada: poupa a ida ao servidor quando o motivo está
   *  escrito na tela, logo acima do botão. Campo de destino VAZIO não entra aqui — para
   *  esse caso a mensagem de `run` explica melhor que um botão apagado sem motivo. */
  const knownBad =
    (action === 'guardar' && bin?.blocked === true) ||
    (action === 'transferir' && destCode.trim() !== '' && (!destBin || destRejection !== null)) ||
    // Retirar mais do que existe: o saldo da origem está na tela, logo acima.
    (action !== 'guardar' && rowAtOrigin !== null && qty > rowAtOrigin.boxes);

  const loadContents = useCallback(async (code: string) => {
    if (!code.trim()) { setContents(null); return; }
    try {
      setContents(await listBinContents(code.trim().toUpperCase()));
      setError(null);
    } catch (err) {
      console.error('[wms] falha ao ler o endereço:', err);
      setError('Não foi possível ler o conteúdo deste endereço.');
    }
  }, []);

  useEffect(() => { loadContents(binCode); }, [binCode, loadContents]);

  // Pack padronizado: pergunta uma vez por SKU e nunca mais. A fonte é o histórico de
  // movimentos, que nunca é apagado — por isso o cadastro de produto fica intocado.
  useEffect(() => {
    if (!chosen) return;
    let cancelled = false;
    lastKnownPackSize(chosen.id)
      .then(known => { if (!cancelled && known) setUnitsPerBox(String(known)); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [chosen]);

  useEffect(() => {
    if (term.trim().length < 2) { setOptions([]); return; }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProducts(term)
        .then(found => { if (!cancelled) setOptions(found); })
        .catch(() => undefined);
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [term]);

  const reset = () => {
    setBoxes('1');
    setTerm('');
    setOptions([]);
    setChosen(null);
    setUnitsPerBox('');
    setTargetProductId('');
    setDestCode('');
  };

  const run = async () => {
    const code = binCode.trim().toUpperCase();
    const qty = parseInt(boxes) || 0;
    if (!code || qty <= 0) return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      if (action === 'guardar') {
        if (!chosen) throw new Error('Escolha o produto.');
        const upb = parseInt(unitsPerBox) || 0;
        if (upb <= 0) throw new Error('Informe quantas unidades tem a caixa.');
        await putaway({ binCode: code, productId: chosen.id, boxes: qty, unitsPerBox: upb });
        setDone(`${qty} caixa(s) de ${chosen.sku} guardada(s) em ${code}.`);
      } else if (action === 'retirar') {
        if (!targetProductId) throw new Error('Escolha o produto a retirar.');
        await pick({ binCode: code, productId: targetProductId, boxes: qty });
        setDone(`${qty} caixa(s) retirada(s) de ${code}.`);
      } else {
        if (!targetProductId) throw new Error('Escolha o produto a transferir.');
        if (!destCode.trim()) throw new Error('Informe o endereço de destino.');
        await transfer({
          fromBinCode: code,
          toBinCode: destCode.trim().toUpperCase(),
          productId: targetProductId,
          boxes: qty,
        });
        setDone(`${qty} caixa(s) transferida(s) de ${code} para ${destCode.trim().toUpperCase()}.`);
      }
      reset();
      await loadContents(code);
      // O ranking tem que enxergar o movimento que acabou de acontecer.
      loadPlacements();
      onMoved();
    } catch (err) {
      // A mensagem vem da própria RPC (saldo insuficiente, endereço bloqueado, pack
      // diferente). É mais útil ao operador que qualquer texto genérico daqui.
      setError(err instanceof Error ? err.message : 'Não foi possível concluir o movimento.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Panel>
        <PanelSection padding="sm">
          <h3 className="text-title">Endereço</h3>
          <p className="text-caption mt-1">
            Escaneie o QR colado na vaga. No computador, digite o código.
          </p>

          {/* Enquanto não há endereço, escanear é a única coisa a fazer nesta tela — e o
              painel da movimentação nem existe ainda, então o destaque não disputa com
              nada. Resolvido o endereço, o peso passa para o botão que confirma. */}
          <Button
            variant={bin ? 'secondary' : 'primary'}
            onClick={() => setScanFor('origem')}
            className="mt-3 w-full sm:w-auto"
          >
            <QrCode size={18} />
            Escanear QR Code
          </Button>

          <div className="mt-2 flex flex-col sm:flex-row gap-2">
            <Input
              value={binCode}
              onChange={e => setBinCode(e.target.value)}
              placeholder="PP-A01-N1"
              list="wms-bin-codes"
              className="flex-1"
            />
            <datalist id="wms-bin-codes">
              {bins.map(b => <option key={b.id} value={b.code} />)}
            </datalist>
          </div>

          {binCode.trim() && !bin && (
            <p className="text-caption mt-2 text-red-600 dark:text-red-400">
              Endereço não cadastrado.
            </p>
          )}
          {bin && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge variant={bin.blocked ? 'warning' : 'accent'}>{bin.code}</Badge>
              <span className="text-caption">
                {bin.blocked ? 'Endereço bloqueado' : 'Endereço reconhecido'}
                {bin.capacityBoxes !== null && ` · capacidade ${bin.capacityBoxes} cx`}
              </span>
              {/* Conferência: aponta a câmera para a etiqueta e prova que está na vaga
                  certa. Digitar o código não prova nada sobre onde a pessoa está. */}
              {confirmedCode === bin.code ? (
                <Badge variant="success">Vaga conferida</Badge>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setScanFor('conferir')}>
                  <QrCode size={14} />
                  Conferir no local
                </Button>
              )}
            </div>
          )}
          {bin?.blocked && (
            <div className="mt-3">
              <Notice tone="warning">
                Endereço bloqueado: não recebe mercadoria nova. Retirar e transferir para fora continuam liberados.
              </Notice>
            </div>
          )}
        </PanelSection>

        {contents !== null && bin && (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>SKU</Th>
                  <Th>Produto</Th>
                  <Th className="text-center">Caixas</Th>
                  <Th className="text-center">Unidades</Th>
                  <Th className="text-center">Idade</Th>
                </Tr>
              </Thead>
              <tbody>
                {contents.length === 0 ? (
                  <Tr><Td colSpan={5}>Endereço vazio.</Td></Tr>
                ) : (
                  contents.map(row => (
                    <Tr key={row.productId}>
                      <Td className="text-numeric">{row.sku}</Td>
                      <Td>{row.productName}</Td>
                      <Td className="text-center text-numeric">{row.boxes}</Td>
                      <Td className="text-center text-numeric">{row.units}</Td>
                      <Td className="text-center text-caption">{ageInDays(row.firstStoredAt)}d</Td>
                    </Tr>
                  ))
                )}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {bin && (
        <Panel>
          <PanelSection padding="sm">
            <div className="flex flex-wrap gap-2">
              {(['guardar', 'retirar', 'transferir'] as Action[]).map(a => (
                <Button
                  key={a}
                  variant={action === a ? 'primary' : 'secondary'}
                  onClick={() => { setAction(a); setError(null); setDone(null); }}
                >
                  {a === 'guardar' ? <PackagePlus size={16} /> : a === 'retirar' ? <PackageMinus size={16} /> : <ArrowRightLeft size={16} />}
                  {ACTION_LABEL[a]}
                </Button>
              ))}
            </div>
          </PanelSection>

          <PanelSection padding="sm">
            {action === 'guardar' ? (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-caption">Produto (SKU, nome ou EAN)</span>
                  <Input value={term} onChange={e => { setTerm(e.target.value); setChosen(null); }} placeholder="Buscar produto..." />
                </label>

                {!chosen && options.length > 0 && (
                  <div className="border border-edge rounded-container divide-y divide-edge max-h-56 overflow-y-auto">
                    {options.map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => { setChosen(opt); setTerm(`${opt.sku} — ${opt.name}`); setOptions([]); }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-3 transition-colors"
                      >
                        <span className="text-numeric text-sm text-fg">{opt.sku}</span>
                        <span className="text-sm text-fg-muted"> · {opt.name}</span>
                      </button>
                    ))}
                  </div>
                )}

                {chosen && (
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="text-caption">Caixas</span>
                      <Input type="number" min={1} value={boxes} onChange={e => setBoxes(e.target.value)} />
                    </label>
                    <label className="block">
                      <span className="text-caption">Unidades por caixa</span>
                      <Input type="number" min={1} value={unitsPerBox} onChange={e => setUnitsPerBox(e.target.value)} />
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <label className="block">
                  <span className="text-caption">Produto no endereço</span>
                  <select
                    value={targetProductId}
                    onChange={e => setTargetProductId(e.target.value)}
                    className="w-full p-2.5 border border-edge rounded-lg bg-surface text-fg text-sm"
                  >
                    <option value="">Selecione...</option>
                    {(contents ?? []).map(row => (
                      <option key={row.productId} value={row.productId}>
                        {row.sku} — {row.boxes} cx
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-caption">Caixas</span>
                    <Input type="number" min={1} value={boxes} onChange={e => setBoxes(e.target.value)} />
                  </label>
                </div>

                {action === 'transferir' && (
                  <div>
                    <span className="text-caption">Endereço de destino</span>
                    {/* Fora da grade de duas colunas: no celular o operador está parado na
                        origem e precisa escanear o destino, e meia largura não comporta
                        campo e botão lado a lado. */}
                    <div className="mt-1 flex flex-col sm:flex-row gap-2">
                      <Input
                        value={destCode}
                        onChange={e => setDestCode(e.target.value)}
                        placeholder="PP-B02-N1"
                        list="wms-bin-codes"
                        className="flex-1"
                      />
                      <Button variant="secondary" onClick={() => setScanFor('destino')} className="w-full sm:w-auto">
                        <QrCode size={18} />
                        Escanear
                      </Button>
                    </div>

                    {destCode.trim() && !destBin && (
                      <p className="text-caption mt-2 text-red-600 dark:text-red-400">
                        Endereço de destino não cadastrado.
                      </p>
                    )}
                    {/* O motivo exato, igual ao que a RPC responderia — mas antes de ir
                        até o servidor e voltar com erro. */}
                    {destBin && destRejection && (
                      <p className="text-caption mt-2 text-amber-700 dark:text-amber-400">
                        {destRejection === 'bloqueado' && 'Destino bloqueado: não recebe mercadoria.'}
                        {destRejection === 'mesma-origem' && 'Destino igual à origem.'}
                        {destRejection === 'pack-diferente' && 'O destino já tem este produto com outra quantidade por caixa.'}
                        {destRejection === 'sem-capacidade' && 'O destino não comporta essa quantidade.'}
                      </p>
                    )}
                    {destBin && !destRejection && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="accent">{destBin.code}</Badge>
                        <span className="text-caption">
                          Destino reconhecido
                          {destBin.capacityBoxes !== null && ` · capacidade ${destBin.capacityBoxes} cx`}
                        </span>
                      </div>
                    )}

                    {/* A conta dos dois lados, antes de confirmar. */}
                    {balance && !destRejection && (
                      <p className="text-caption mt-2 text-numeric">
                        {bin?.code}: {balance.fromBefore} → <strong>{balance.fromAfter}</strong> cx
                        {' · '}
                        {destBin?.code}: {balance.toBefore} → <strong>{balance.toAfter}</strong> cx
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Sugestão de endereço: lista, motivo e um toque para aplicar. Nunca
                aplica sozinha — o operador decide, como manda a regra de não movimentar
                nada sem confirmação. Só aparece com produto e quantidade definidos,
                porque antes disso não há o que ranquear. */}
            {action !== 'retirar' && suggestions.length > 0 && (
              <div className="mt-4 rounded-container border border-edge p-3">
                <div className="flex items-center gap-2">
                  <Lightbulb size={16} className="text-fg-subtle" />
                  <span className="text-caption">
                    {action === 'guardar' ? 'Onde guardar' : 'Destinos compatíveis'}
                    {' · '}
                    {qty} cx
                  </span>
                </div>

                <div className="mt-2 space-y-1.5">
                  {suggestions.map(s => {
                    const atual = action === 'guardar'
                      ? s.bin.code === bin?.code
                      : s.bin.code === destBin?.code;
                    return (
                      <button
                        key={s.bin.id}
                        type="button"
                        onClick={() => {
                          if (action === 'guardar') setBinCode(s.bin.code);
                          else setDestCode(s.bin.code);
                          setError(null);
                        }}
                        className={`w-full min-h-[44px] rounded-control border px-3 py-2 text-left transition-colors ${
                          atual
                            ? 'border-accent bg-accent/10'
                            : 'border-edge bg-surface-3 hover:bg-edge'
                        }`}
                      >
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-fg">{s.bin.code}</span>
                          {s.consolidates && <Badge variant="success">Consolida</Badge>}
                          {atual && <Badge variant="accent">Atual</Badge>}
                        </span>
                        <span className="block text-caption mt-0.5">{s.reasons.join(' · ')}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Nenhuma vaga serve: dizer isso é mais útil que uma lista vazia. */}
            {action !== 'retirar' && activeProductId && qty > 0 && suggestions.length === 0 && (
              <div className="mt-4">
                <Notice tone="warning">
                  Nenhum endereço do pulmão comporta {qty} caixa(s) deste produto agora —
                  todos estão bloqueados, sem espaço, ou já têm este SKU com outra quantidade
                  por caixa.
                </Notice>
              </div>
            )}

            {/* Retirar mais do que existe: barrado na tela, com o número à vista. */}
            {action !== 'guardar' && rowAtOrigin && qty > rowAtOrigin.boxes && (
              <div className="mt-3">
                <Notice tone="danger">
                  {bin?.code} tem {rowAtOrigin.boxes} caixa(s) deste produto. Não dá para
                  {action === 'retirar' ? ' retirar ' : ' transferir '}{qty}.
                </Notice>
              </div>
            )}

            {error && <div className="mt-3"><Notice tone="danger">{error}</Notice></div>}
            {done && (
              <div className="mt-3 flex items-center gap-2">
                <Badge variant="accent">Registrado</Badge>
                <span className="text-sm text-fg-muted">{done}</span>
              </div>
            )}

            <div className="mt-4">
              <Button onClick={run} disabled={busy || knownBad} className="w-full sm:w-auto">
                {busy ? 'Registrando...' : ACTION_LABEL[action]}
              </Button>
            </div>
          </PanelSection>
        </Panel>
      )}

      <WmsBinScanner
        open={scanFor !== null}
        title={scanFor ? SCAN_TITLE[scanFor] : ''}
        onClose={() => setScanFor(null)}
        expectCode={scanFor === 'conferir' ? bin?.code : undefined}
        onDetected={applyScan}
      />
    </>
  );
}
