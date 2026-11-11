// Fechamento da linha — apontamento de QUAIS produtos divergiram.
//
// A contagem manual sempre gravou só o agregado ("deram 4 divergências"), nunca em
// quais produtos. Nesta base são 349 divergências declaradas e zero identificadas,
// e é por isso que o RCA, o mapa de calor e a reincidência por SKU ficam sem base.
//
// O que este bloco NÃO faz, de propósito:
//  - não altera `divergencias_reais` da contagem: aquele número continua sendo o que
//    o operador digitou, e aqui ele serve de META a reconciliar, não de campo a
//    sobrescrever;
//  - não grava `status` nem `divergence` no item, porque a view do painel conta as
//    duas colunas e o merge SOMA o agregado da contagem manual por cima — marcar
//    ambas faria 4 divergências virarem 8 na tela. Ver o bloco de comentário em
//    inventoryCycleService.ts;
//  - não corrige saldo e não cria movimentação de estoque.

import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Loader2, Search } from 'lucide-react';
import { Button, Input, Panel, PanelSection } from '../../ui';
import {
  getActiveCycle,
  listCycleItemsByLabel,
  saveItemDivergenceDetail,
} from '../../../lib/inventoryCycle/inventoryCycleService';
import type { InventoryItem } from '../../../lib/inventoryCycle/inventoryCycleModel';
import {
  findTinyStockSheetSource,
  loadTinyStockSheetBalances,
  type SourceBalance,
} from '../../../lib/integrations/stockSheet/stockSheetSourceService';
import { int, plural } from '../../../lib/formatPtBr';

interface Props {
  companyId: string;
  /** Rótulo da linha de contagem — é por ele que os itens do ciclo são resolvidos. */
  brandName: string;
  /** Divergências reais declaradas na contagem. Meta a reconciliar, nunca alterada aqui. */
  declared: number;
}

/** Rascunho por item: o que o operador digitou antes de salvar. */
type Draft = Record<string, string>;

export function ClosingDivergenceSection({ companyId, brandName, declared }: Props) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  // Saldo por produto vindo da Fonte de Saldo. `expected_quantity` do item NÃO serve:
  // ele vem de `products.stock_quantity`, que está zerado nos 4.628 produtos desta
  // base — a Fonte, por decisão de produto, não escreve no catálogo.
  const [saldos, setSaldos] = useState<Map<string, SourceBalance>>(new Map());
  const [semFonte, setSemFonte] = useState(false);
  const [loading, setLoading] = useState(true);
  const [semPar, setSemPar] = useState(false);
  const [busca, setBusca] = useState('');
  const [draft, setDraft] = useState<Draft>({});
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    let ativo = true;
    setLoading(true);
    setErro(null);
    (async () => {
      try {
        const cycle = await getActiveCycle(companyId);
        if (!cycle) { if (ativo) { setItems([]); setSemPar(true); setLoading(false); } return; }
        const rows = await listCycleItemsByLabel(cycle.id, brandName);
        if (!ativo) return;
        setItems(rows);
        // Lista vazia aqui não é "linha sem produto": é rótulo sem par no ciclo.
        setSemPar(rows.length === 0);
        // Pré-carrega o que já foi apontado antes, para o bloco reabrir no estado salvo.
        const inicial: Draft = {};
        for (const item of rows) {
          if (item.countedQuantity !== null) inicial[item.id] = String(item.countedQuantity);
        }
        setDraft(inicial);

        // Saldo da Fonte, em lote. Best-effort: a fonte pode não estar configurada,
        // e nesse caso o bloco continua utilizável informando a diferença na mão.
        try {
          const conexao = await findTinyStockSheetSource();
          if (!ativo) return;
          if (!conexao) { setSemFonte(true); return; }
          const mapa = await loadTinyStockSheetBalances(conexao.id, rows.map(r => r.productId));
          if (ativo) setSaldos(mapa);
        } catch {
          if (ativo) setSemFonte(true);
        }
      } catch (e) {
        if (ativo) setErro(e instanceof Error ? e.message : 'Não foi possível carregar os produtos da linha.');
      } finally {
        if (ativo) setLoading(false);
      }
    })();
    return () => { ativo = false; };
  }, [companyId, brandName]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (termo === '') return items;
    return items.filter(i =>
      (i.sku ?? '').toLowerCase().includes(termo) ||
      (i.productName ?? '').toLowerCase().includes(termo) ||
      (i.location ?? '').toLowerCase().includes(termo));
  }, [items, busca]);

  /**
   * Saldo do sistema para o item, SEMPRE da Fonte de Saldo.
   * `null` = a Fonte não cobre este produto, ou cobre de forma ambígua (mais de um
   * registro apontando para ele). Nos dois casos não há diferença calculável, e
   * chutar zero transformaria qualquer contagem numa sobra inventada.
   */
  const saldoDe = useMemo(() => (productId: string): number | null => {
    const saldo = saldos.get(productId);
    if (!saldo || saldo.ambiguous) return null;
    return saldo.quantity;
  }, [saldos]);

  /** Apontados = com quantidade digitada E diferente do saldo. Digitar o mesmo saldo
   *  não é divergência, é confirmação — e não conta como apontado. */
  const apontados = useMemo(
    () => items.filter(i => {
      const esperado = saldoDe(i.productId);
      if (esperado === null) return false;
      const texto = draft[i.id];
      if (texto === undefined || texto.trim() === '') return false;
      const valor = Number(texto);
      return Number.isFinite(valor) && valor !== esperado;
    }),
    [items, draft, saldoDe]
  );

  /** Produtos desta linha que a Fonte de Saldo não cobre — precisam aparecer como
   *  limite real, não sumir da lista. */
  const semSaldo = useMemo(
    () => items.filter(i => saldoDe(i.productId) === null).length,
    [items, saldoDe]
  );

  async function handleSalvar() {
    setSaving(true);
    setErro(null);
    try {
      for (const item of items) {
        const esperado = saldoDe(item.productId);
        // Sem saldo da Fonte não há diferença calculável; o item não é gravado.
        if (esperado === null) continue;
        const texto = draft[item.id];
        const preenchido = texto !== undefined && texto.trim() !== '';
        const valor = preenchido ? Number(texto) : null;
        const novo = preenchido && Number.isFinite(valor) ? valor : null;
        // Só escreve o que mudou — reabrir o modal e salvar de novo não reescreve tudo.
        if (novo === item.countedQuantity && esperado === item.expectedQuantity) continue;
        // O saldo vai junto: congela a foto da Fonte, que é substituída todo dia, e
        // deixa a diferença derivável do próprio item depois.
        await saveItemDivergenceDetail({ itemId: item.id, countedQuantity: novo, expectedQuantity: esperado });
      }
      const cycle = await getActiveCycle(companyId);
      if (cycle) setItems(await listCycleItemsByLabel(cycle.id, brandName));
      setSalvo(true);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar os apontamentos.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="border-t border-edge pt-4">
        <p className="text-sm text-fg-subtle flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Carregando produtos da linha...
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-edge pt-4">
      <p className="text-sm font-semibold text-fg">Quais produtos divergiram</p>
      <p className="text-caption mt-0.5">
        Informe a quantidade encontrada nos produtos que não bateram. A diferença e o tipo
        — falta ou sobra — saem do saldo do sistema, você não precisa calcular.
      </p>

      {semPar ? (
        <p className="mt-3 text-sm text-fg-muted flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5 text-amber-600" />
          Esta linha de contagem não tem produtos correspondentes no inventário ativo, então
          não há lista para apontar. O vínculo é feito pelo nome da linha.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-fg-muted">
              {int(declared)} {plural(declared, 'declarada', 'declaradas')} na contagem ·{' '}
              <span className={apontados.length === declared ? 'text-fg' : 'text-amber-700 dark:text-amber-500'}>
                {int(apontados.length)} {plural(apontados.length, 'apontada', 'apontadas')}
              </span>
            </span>
            <span className="text-xs text-fg-subtle">
              {int(items.length)} {plural(items.length, 'produto', 'produtos')} na linha
            </span>
            {semFonte && (
              <span className="text-xs text-amber-700 dark:text-amber-500">
                Fonte de Saldo não configurada
              </span>
            )}
            {!semFonte && semSaldo > 0 && (
              <span className="text-xs text-amber-700 dark:text-amber-500">
                {int(semSaldo)} sem saldo na fonte
              </span>
            )}
          </div>

          <div className="relative mt-3">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por SKU, nome ou endereço"
              className="pl-9"
            />
          </div>

          <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-edge divide-y divide-edge/60">
            {visiveis.length === 0 && (
              <p className="px-3 py-4 text-sm text-fg-subtle">Nenhum produto encontrado para essa busca.</p>
            )}
            {visiveis.map(item => {
              const texto = draft[item.id] ?? '';
              const valor = texto.trim() === '' ? null : Number(texto);
              const esperado = saldoDe(item.productId);
              const dif = esperado !== null && valor !== null && Number.isFinite(valor) ? valor - esperado : null;
              return (
                <div key={item.id} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-fg truncate">{item.productName ?? '—'}</p>
                    <p className="text-xs text-fg-subtle truncate">
                      {item.sku ?? '—'}
                      {item.location ? ` · ${item.location}` : ''}
                      {esperado !== null ? ` · sistema: ${int(esperado)}` : ' · sem saldo na fonte'}
                    </p>
                  </div>
                  {/* Largura no container, não na classe: o `Input` já traz `w-full`, que
                      vence `w-24` no CSS gerado e engolia a coluna do nome do produto. */}
                  <div className="w-24 flex-none">
                    <Input
                      type="number"
                      inputMode="numeric"
                      value={texto}
                      disabled={esperado === null}
                      onChange={e => { setSalvo(false); setDraft(d => ({ ...d, [item.id]: e.target.value })); }}
                      placeholder={esperado === null ? '—' : 'contado'}
                      className="text-right"
                    />
                  </div>
                  <span className="w-24 text-right text-xs">
                    {dif === null || dif === 0 ? (
                      <span className="text-fg-subtle">{dif === 0 ? 'bateu' : '—'}</span>
                    ) : dif < 0 ? (
                      <span className="text-red-600 dark:text-red-400">falta {int(Math.abs(dif))}</span>
                    ) : (
                      <span className="text-emerald-700 dark:text-emerald-400">sobra {int(dif)}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>

          {apontados.length !== declared && (
            <Panel className="mt-2">
              <PanelSection padding="sm">
                <p className="text-xs text-fg-muted">
                  {apontados.length < declared
                    ? `Faltam ${int(declared - apontados.length)} ${plural(declared - apontados.length, 'produto', 'produtos')} para fechar com as ${int(declared)} divergências declaradas. Pode salvar assim mesmo — o que ficar sem apontamento continua na fila de pendências.`
                    : `Você apontou ${int(apontados.length - declared)} ${plural(apontados.length - declared, 'produto', 'produtos')} a mais do que as ${int(declared)} declaradas na contagem. O número declarado não é alterado por aqui.`}
                </p>
              </PanelSection>
            </Panel>
          )}

          {erro && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{erro}</p>}

          <div className="mt-3 flex items-center gap-3">
            <Button size="sm" onClick={handleSalvar} disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Salvando...' : 'Salvar apontamentos'}
            </Button>
            {salvo && !saving && <span className="text-xs text-fg-muted">Apontamentos salvos.</span>}
          </div>
        </>
      )}
    </div>
  );
}
