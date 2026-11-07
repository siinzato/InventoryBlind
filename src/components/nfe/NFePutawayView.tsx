import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, MapPin, PackagePlus } from 'lucide-react';
import type { NfeInvoice, NfeInvoiceItem } from '../../lib/nfe/nfeTypes';
import { getInvoiceItems } from '../../lib/nfe/nfeService';
import {
  PUTAWAY_STATUS_LABEL, boxesThatFit, buildLines, suggestPack, summarizePutaway,
  validatePlacement, type PutawayLine, type PutawayStatus,
} from '../../lib/nfe/nfePutawayDomain';
import {
  binsHoldingProducts, listInvoiceAssignments, placeItem, type ExistingSpot,
} from '../../lib/nfe/nfePutawayService';
import { lastKnownPackSize } from '../../lib/wms/wmsService';
import { useLotControl } from '../../lib/lotControl/hooks';
import { Badge, Button, Card, Input } from '../ui';

interface Props {
  invoice: NfeInvoice;
  /** Quem pode movimentar estoque. Mesma lista que `wms_require_operator` exige no
   *  banco, então a tela nunca oferece um botão que a RPC recusaria. */
  canPutaway: boolean;
  onBack: () => void;
}

const inteiro = new Intl.NumberFormat('pt-BR');

const STATUS_TONE: Record<PutawayStatus, 'neutral' | 'accent' | 'success' | 'warning'> = {
  pendente: 'neutral',
  parcial: 'accent',
  completo: 'success',
  bloqueado: 'warning',
};

/** Endereçamento do recebimento — o passo que faltava depois da conferência.
 *
 *  A conferência diz o que chegou e para por aí; a mercadoria fica no chão do
 *  recebimento sem endereço. Aqui cada item conferido vai para um endereço do Pulmão,
 *  pela mesma RPC que o Pulmão usa, com o progresso guardado — fechar a tela no meio
 *  e voltar amanhã mostra exatamente o que falta.
 *
 *  Endereçar NÃO altera o saldo do catálogo. Diz onde a mercadoria está, não quanta
 *  existe: é a mesma separação que a conferência já faz. */
export function NFePutawayView({ invoice, canPutaway, onBack }: Props) {
  const [items, setItems] = useState<NfeInvoiceItem[]>([]);
  const [lines, setLines] = useState<PutawayLine[]>([]);
  const [spots, setSpots] = useState<Map<string, ExistingSpot[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  // Um item aberto por vez: endereçar é uma ação de cada vez, e dois formulários
  // abertos convidam a digitar num e confirmar no outro.
  const [aberto, setAberto] = useState<string | null>(null);
  const [bin, setBin] = useState('');
  const [caixas, setCaixas] = useState('');
  const [pack, setPack] = useState('');
  const [lote, setLote] = useState('');
  const [validade, setValidade] = useState('');
  const [salvando, setSalvando] = useState(false);

  // A chave da empresa. Desligada — o normal — nada de lote ou validade aparece:
  // nem campo, nem etiqueta, nem menção. A RPC cobra a mesma chave, então uma tela
  // desatualizada também não consegue gravar.
  const { settings: chave } = useLotControl(invoice.company_id);

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const [itens, atribuicoes] = await Promise.all([
        getInvoiceItems(invoice.id),
        listInvoiceAssignments(invoice.id),
      ]);
      const montadas = buildLines(itens, atribuicoes);
      setItems(itens);
      setLines(montadas);

      const produtos = itens.map(i => i.product_id).filter((id): id is string => !!id);
      // A sugestão de consolidação é complemento: sem ela dá para endereçar do mesmo
      // jeito, então uma falha aqui não derruba a tela.
      setSpots(await binsHoldingProducts(produtos).catch(() => new Map()));
    } catch (err) {
      console.error('[Endereçamento] carregar', err);
      setErro('Não foi possível carregar os itens desta nota.');
    } finally {
      setLoading(false);
    }
  }, [invoice.id]);

  useEffect(() => { load(); }, [load]);

  const resumo = useMemo(() => summarizePutaway(lines), [lines]);

  const abrir = async (linha: PutawayLine) => {
    if (aberto === linha.item.id) { setAberto(null); return; }
    setAberto(linha.item.id);
    setErro(null);
    setAviso(null);
    setBin('');
    // Lote e validade NÃO são herdados da colocação anterior: são da caixa que está
    // na mão agora, e repetir o último valor é como uma remessa inteira acaba
    // gravada com o lote da anterior.
    setLote('');
    setValidade('');

    const ultimo = linha.item.product_id
      ? await lastKnownPackSize(linha.item.product_id).catch(() => null)
      : null;
    const sugerido = suggestPack(linha, ultimo);
    setPack(String(sugerido));
    setCaixas(String(boxesThatFit(linha, sugerido) || ''));
  };

  const confirmar = async (linha: PutawayLine) => {
    const nCaixas = Number(caixas);
    const nPack = Number(pack);

    const problema = validatePlacement(linha, nCaixas, nPack);
    if (problema) { setErro(problema); return; }
    if (!bin.trim()) { setErro('Informe o endereço.'); return; }

    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      await placeItem({
        itemId: linha.item.id,
        binCode: bin.trim().toUpperCase(),
        boxes: nCaixas,
        unitsPerBox: nPack,
        // Só envia o que a chave permite. Mandar um valor com a chave desligada
        // faria a RPC recusar a colocação inteira — e o operador levaria a culpa
        // por um campo que a tela não deveria ter oferecido.
        lotNumber: chave.lotEnabled ? lote : null,
        expiryDate: chave.expiryEnabled ? validade : null,
      });
      setAviso(
        `${inteiro.format(nCaixas * nPack)} unidade(s) de ${linha.item.snapshot_sku ?? linha.item.nfe_code ?? 'item'} em ${bin.trim().toUpperCase()}.`
      );
      setAberto(null);
      await load();
    } catch (err) {
      // A mensagem vem do banco já escrita para o operador — capacidade excedida,
      // endereço bloqueado, pack diferente. Reescrevê-la aqui só a envelheceria.
      console.error('[Endereçamento] confirmar', err);
      setErro(err instanceof Error ? err.message : 'Não foi possível endereçar.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-fg-subtle hover:text-fg transition-colors">
          <ArrowLeft size={16} /> Voltar
        </button>
      </div>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-title">Endereçamento do recebimento</h2>
            <p className="text-sm text-fg-muted mt-0.5">
              NF-e {invoice.invoice_number ?? invoice.invoice_key} · {invoice.supplier_name ?? 'Fornecedor não informado'}
            </p>
          </div>
          {resumo.concluido && lines.length > 0 && (
            <Badge variant="success">
              <CheckCircle2 size={13} /> Tudo endereçado
            </Badge>
          )}
        </div>

        <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
          Cada linha conferida vai para um endereço do Pulmão. Dá para dividir o mesmo item
          entre vários endereços, e o que falta fica guardado — fechar esta tela não perde o
          progresso. Endereçar registra <strong>onde</strong> a mercadoria está; a quantidade
          do catálogo não muda aqui.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
          <Indicador label="Endereçados" valor={resumo.completos} />
          <Indicador label="Parciais" valor={resumo.parciais} />
          <Indicador label="A endereçar" valor={resumo.pendentes} />
          <Indicador label="Unidades restantes" valor={resumo.unidadesRestantes} />
        </div>
      </Card>

      {erro && (
        <div className="flex items-start gap-3 p-4 rounded-container bg-red-500/10 text-red-700 dark:text-red-400">
          <AlertCircle size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{erro}</p>
        </div>
      )}

      {aviso && (
        <div className="flex items-start gap-3 p-4 rounded-container bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 size={20} className="flex-shrink-0 mt-0.5" />
          <p className="text-sm font-medium">{aviso}</p>
        </div>
      )}

      {!canPutaway && (
        <Card>
          <p className="text-sm text-fg-muted">
            Endereçar mercadoria exige permissão para movimentar estoque. A lista abaixo
            continua disponível para acompanhar o que já foi guardado.
          </p>
        </Card>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-fg-subtle">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card><p className="text-sm text-fg-muted">Esta nota não tem itens.</p></Card>
      ) : (
        <div className="space-y-2">
          {lines.map(linha => (
            <LinhaItem
              key={linha.item.id}
              linha={linha}
              spots={linha.item.product_id ? (spots.get(linha.item.product_id) ?? []) : []}
              aberto={aberto === linha.item.id}
              podeEnderecar={canPutaway}
              salvando={salvando}
              bin={bin} setBin={setBin}
              caixas={caixas} setCaixas={setCaixas}
              pack={pack} setPack={setPack}
              lote={lote} setLote={setLote}
              validade={validade} setValidade={setValidade}
              pedeLote={chave.lotEnabled}
              pedeValidade={chave.expiryEnabled}
              onAbrir={() => abrir(linha)}
              onConfirmar={() => confirmar(linha)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Indicador({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-control bg-surface-3 px-3 py-2">
      <p className="text-xs text-fg-subtle">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-fg">{inteiro.format(valor)}</p>
    </div>
  );
}

interface LinhaProps {
  linha: PutawayLine;
  spots: ExistingSpot[];
  aberto: boolean;
  podeEnderecar: boolean;
  salvando: boolean;
  bin: string; setBin: (v: string) => void;
  caixas: string; setCaixas: (v: string) => void;
  pack: string; setPack: (v: string) => void;
  lote: string; setLote: (v: string) => void;
  validade: string; setValidade: (v: string) => void;
  pedeLote: boolean;
  pedeValidade: boolean;
  onAbrir: () => void;
  onConfirmar: () => void;
}

function LinhaItem({
  linha, spots, aberto, podeEnderecar, salvando,
  bin, setBin, caixas, setCaixas, pack, setPack,
  lote, setLote, validade, setValidade, pedeLote, pedeValidade,
  onAbrir, onConfirmar,
}: LinhaProps) {
  const { item } = linha;
  const nome = item.snapshot_product_name ?? item.description ?? 'Item sem descrição';
  const sku = item.snapshot_sku ?? item.nfe_code ?? '—';
  const disponiveis = spots.filter(s => !s.blocked);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-fg">{nome}</p>
          <p className="font-mono text-xs text-fg-subtle">{sku}</p>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right">
            <p className="text-sm tabular-nums text-fg">
              {inteiro.format(linha.placed)} / {inteiro.format(linha.conferred)}
            </p>
            <p className="text-xs text-fg-subtle">unidades endereçadas</p>
          </div>
          <Badge variant={STATUS_TONE[linha.status]}>{PUTAWAY_STATUS_LABEL[linha.status]}</Badge>
        </div>
      </div>

      {linha.blockedReason && (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">{linha.blockedReason}</p>
      )}

      {linha.assignments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {linha.assignments.map(a => (
            <span key={a.id} className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-xs text-fg-muted">
              <MapPin size={12} /> {a.binCode} · {inteiro.format(a.boxes)}×{inteiro.format(a.unitsPerBox)}
              {a.lotNumber && <span className="font-mono"> · {a.lotNumber}</span>}
              {a.expiryDate && <span> · vence {a.expiryDate.split('-').reverse().join('/')}</span>}
            </span>
          ))}
        </div>
      )}

      {podeEnderecar && linha.remaining > 0 && !linha.blockedReason && (
        <div className="mt-3">
          {!aberto ? (
            <Button variant="secondary" size="sm" onClick={onAbrir}>
              <PackagePlus size={15} /> Endereçar {inteiro.format(linha.remaining)} un.
            </Button>
          ) : (
            <div className="rounded-control border border-edge bg-surface-3/40 p-3">
              {disponiveis.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs text-fg-subtle">
                    Este produto já está guardado em — juntar evita espalhar o mesmo SKU:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {disponiveis.map(s => (
                      <button
                        key={s.binCode}
                        type="button"
                        onClick={() => { setBin(s.binCode); setPack(String(s.unitsPerBox)); }}
                        className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-xs text-fg-muted transition-colors hover:text-fg hover:bg-surface-3"
                      >
                        <MapPin size={12} /> {s.binCode} · {inteiro.format(s.boxes)} cx de {inteiro.format(s.unitsPerBox)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-end gap-3">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-fg-subtle">Endereço</span>
                  <Input
                    value={bin}
                    onChange={e => setBin(e.target.value.toUpperCase())}
                    placeholder="PP-A01-N1"
                    className="w-40 font-mono"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-fg-subtle">Caixas</span>
                  <Input
                    type="number" inputMode="numeric" min={1} className="w-24"
                    value={caixas}
                    onChange={e => setCaixas(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-fg-subtle">Unidades por caixa</span>
                  <Input
                    type="number" inputMode="numeric" min={1} className="w-32"
                    value={pack}
                    onChange={e => setPack(e.target.value)}
                  />
                </label>
                {pedeLote && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-fg-subtle">Lote (opcional)</span>
                    <Input
                      value={lote}
                      onChange={e => setLote(e.target.value)}
                      placeholder="L2314"
                      className="w-32 font-mono"
                    />
                  </label>
                )}

                {pedeValidade && (
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-fg-subtle">Validade (opcional)</span>
                    <Input
                      type="date"
                      value={validade}
                      onChange={e => setValidade(e.target.value)}
                      className="w-44"
                    />
                  </label>
                )}

                <Button onClick={onConfirmar} disabled={salvando}>
                  {salvando ? 'Endereçando…' : 'Confirmar'}
                </Button>
              </div>

              <p className="mt-2 text-xs text-fg-subtle">
                {Number(caixas) > 0 && Number(pack) > 0
                  ? `${inteiro.format(Number(caixas) * Number(pack))} unidade(s) de ${inteiro.format(linha.remaining)} restantes.`
                  : 'Mercadoria solta vai com 1 unidade por caixa.'}
              </p>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
