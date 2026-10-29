// Pulmão -> Movimentar. A operação de chão: guardar, retirar e transferir.
//
// É a mesma tela que o QR da vaga abre no celular. O QR leva para
// `/app/operacoes/pulmao?v=<codigo>`, e o endereço já chega preenchido — por isso ela
// funciona igual no desktop (digitando o endereço) e no telefone (escaneando).
//
// Nada aqui escreve saldo direto: as três ações chamam as RPCs `wms_bin_*`, que gravam
// o movimento e o saldo na mesma transação. É o que garante que todo número tenha um
// documento com autor e horário.

import { useCallback, useEffect, useState } from 'react';
import { ArrowRightLeft, PackageMinus, PackagePlus } from 'lucide-react';
import { Badge, Button, Input, Notice, Panel, PanelSection, Table, Td, Th, Thead, Tr } from '../ui';
import {
  lastKnownPackSize, listBinContents, pick, putaway, searchProducts, transfer,
  type BinStockRow, type ProductOption, type StorageBin,
} from '../../lib/wms/wmsService';

type Action = 'guardar' | 'retirar' | 'transferir';

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

  const bin = bins.find(b => b.code === binCode.trim().toUpperCase()) ?? null;

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
            Escaneie o QR da vaga pelo celular — o endereço chega preenchido. No computador, digite o código.
          </p>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
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
                  {action === 'transferir' && (
                    <label className="block">
                      <span className="text-caption">Endereço de destino</span>
                      <Input value={destCode} onChange={e => setDestCode(e.target.value)} placeholder="PP-B02-N1" list="wms-bin-codes" />
                    </label>
                  )}
                </div>
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
              <Button onClick={run} disabled={busy}>
                {busy ? 'Registrando...' : ACTION_LABEL[action]}
              </Button>
            </div>
          </PanelSection>
        </Panel>
      )}
    </>
  );
}
