import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Upload } from 'lucide-react';
import {
  Badge, Button, Input, ListRow, Notice, Page, PageHeader, Panel, PanelSection,
  Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
} from '../ui';
import {
  EFFECT_LABEL, SOURCE_LABEL, contagemSemAjuste, summarize,
  type BalanceEffect, type LedgerEntry,
} from '../../lib/ledger/ledgerDomain';
import {
  fetchProductLedger, searchProducts, type ProductLedger, type ProductRef,
} from '../../lib/ledger/ledgerService';
import { BLOCK_MESSAGE, blockReason, draftFromCount, type AdjustmentTarget } from '../../lib/ledger/adjustmentDomain';
import { fetchAdjustmentTarget, sendCountAdjustment } from '../../lib/ledger/adjustmentService';
import { canSyncIntegrations } from '../../lib/permissionService';
import { logAuditEvent } from '../../lib/auditLogService';
import { useAuth } from '../../lib/auth';

interface ProductLedgerPageProps {
  companyId: string;
}

const inteiro = new Intl.NumberFormat('pt-BR');
const dataHora = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

const EFFECT_TONE: Record<BalanceEffect, 'accent' | 'neutral' | 'warning'> = {
  moveu: 'accent',
  registrou: 'neutral',
  nao_aplicado: 'warning',
};

function quando(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dataHora.format(d);
}

/** Livro-razão por produto — só leitura.
 *
 *  Reúne numa ordem só o que os subsistemas já gravam sobre um SKU. Cada linha diz o
 *  que fez com o saldo, porque no InventoryBlind contar NÃO altera o estoque: a
 *  contagem apura a divergência e para ali, e mandar o ajuste ao ERP é um passo
 *  separado. Uma lista que misturasse as duas coisas sem distinguir faria o usuário
 *  acreditar que o estoque foi corrigido quando não foi. */
export function ProductLedgerPage({ companyId }: ProductLedgerPageProps) {
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<ProductRef[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [produto, setProduto] = useState<ProductRef | null>(null);
  const [razao, setRazao] = useState<ProductLedger | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Envio do ajuste ao ERP. `alvo === undefined` é "ainda não perguntei"; `null` é
  // "não há conexão ativa" — a diferença evita mostrar "configure a integração"
  // durante o meio segundo em que a resposta não chegou.
  const { profile } = useAuth();
  const podeEnviar = canSyncIntegrations(profile?.role);
  const [alvo, setAlvo] = useState<AdjustmentTarget | null | undefined>(undefined);
  const [enviando, setEnviando] = useState(false);
  const [envio, setEnvio] = useState<{ ok: boolean; message: string } | null>(null);

  // Protege contra resposta fora de ordem: digitar rápido dispara várias buscas, e a
  // antiga pode voltar depois da nova e sobrescrever a lista com resultado velho.
  const buscaAtual = useRef(0);

  useEffect(() => {
    const limpo = termo.trim();
    if (limpo.length < 2) { setAchados(null); return; }

    const id = ++buscaAtual.current;
    // Espera a digitação parar: sem isso, cada tecla vira uma consulta.
    const timer = setTimeout(async () => {
      setBuscando(true);
      try {
        const rows = await searchProducts(companyId, limpo);
        if (buscaAtual.current === id) setAchados(rows);
      } catch (err) {
        console.error('[Livro-razão] busca', err);
        if (buscaAtual.current === id) setAchados([]);
      } finally {
        if (buscaAtual.current === id) setBuscando(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [companyId, termo]);

  const abrir = useCallback(async (p: ProductRef) => {
    setProduto(p);
    setRazao(null);
    setErro(null);
    setEnvio(null);
    setAlvo(undefined);
    setCarregando(true);
    try {
      setRazao(await fetchProductLedger(companyId, p.id));
    } catch (err) {
      console.error('[Livro-razão] carregar', err);
      setErro('Não foi possível carregar o histórico deste produto agora.');
    } finally {
      setCarregando(false);
    }
  }, [companyId]);

  // O vínculo com o ERP vem numa consulta à parte, e não dentro de `abrir`: é a
  // resposta a uma pergunta diferente ("dá para enviar?"), e falhar nela não pode
  // impedir o razão de aparecer — ele é útil sozinho, só leitura.
  useEffect(() => {
    if (!produto || !podeEnviar) { setAlvo(undefined); return; }
    let vivo = true;
    fetchAdjustmentTarget(companyId, produto.id)
      .then(t => { if (vivo) setAlvo(t); })
      .catch(err => {
        console.error('[Livro-razão] vínculo com o ERP', err);
        if (vivo) setAlvo(null);
      });
    return () => { vivo = false; };
  }, [companyId, produto, podeEnviar]);

  const voltar = () => {
    setProduto(null); setRazao(null); setErro(null); setEnvio(null); setAlvo(undefined);
  };

  const lancamentos = useMemo(() => razao?.entries ?? [], [razao]);
  const resumo = useMemo(() => summarize(lancamentos), [lancamentos]);
  const pendente = useMemo(() => contagemSemAjuste(lancamentos), [lancamentos]);

  // `undefined` enquanto o vínculo não chegou: não dá para dizer se bloqueia.
  const bloqueio = useMemo(
    () => (alvo === undefined ? undefined : blockReason(pendente, alvo, podeEnviar)),
    [pendente, alvo, podeEnviar]
  );
  const rascunho = useMemo(() => (pendente ? draftFromCount(pendente) : null), [pendente]);

  const enviarAjuste = useCallback(async () => {
    if (!produto || !pendente || !alvo) return;
    setEnviando(true);
    setEnvio(null);
    try {
      const r = await sendCountAdjustment({
        companyId, productId: produto.id, sku: produto.sku, entry: pendente, target: alvo,
      });
      setEnvio({ ok: r.ok, message: r.message });

      if (profile) {
        logAuditEvent({
          companyId,
          userId: profile.id,
          userEmail: profile.email ?? '',
          action: 'ledger.adjustment_sent',
          resourceType: 'integration_stock_adjustments',
          resourceId: r.adjustmentId ?? undefined,
          description: `Ajuste de contagem enviado ao ERP para o SKU ${produto.sku}.`,
          metadata: {
            sku: produto.sku,
            productId: produto.id,
            previousQuantity: rascunho?.previousQuantity ?? null,
            countedQuantity: rascunho?.countedQuantity ?? null,
            aceito: r.ok,
            jaExistia: r.jaExistia,
          },
        });
      }

      // Recarrega o razão: o ajuste recém-criado é um lançamento novo, e o alerta de
      // "contagem sem ajuste" precisa sumir sozinho. Deixá-lo na tela depois do envio
      // faria o usuário apertar o botão de novo.
      if (r.ok) setRazao(await fetchProductLedger(companyId, produto.id));
    } catch (err) {
      console.error('[Livro-razão] enviar ajuste', err);
      setEnvio({
        ok: false,
        message: 'Não foi possível registrar o ajuste agora. Nada foi enviado ao ERP.',
      });
    } finally {
      setEnviando(false);
    }
  }, [companyId, produto, pendente, alvo, profile, rascunho]);

  return (
    <Page>
      <PageHeader
        eyebrow="Operações"
        title="Livro-razão do produto"
        description="Tudo o que foi registrado sobre um SKU, em ordem — e, em cada linha, se aquilo alterou o saldo ou apenas ficou registrado."
      />

      {!produto && (
        <Panel>
          <PanelSection>
            <p className="text-overline mb-1">Escolha o produto</p>
            <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
              O razão é por SKU, porque é assim que a pergunta aparece na operação: não
              "o que aconteceu no estoque", e sim "o que aconteceu com este item".
              Busque por código ou por parte do nome.
            </p>

            <div className="relative max-w-md">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle" />
              <Input
                value={termo}
                onChange={e => setTermo(e.target.value)}
                placeholder="SKU ou nome do produto"
                className="pl-9"
                aria-label="Buscar produto"
              />
            </div>

            {termo.trim().length >= 2 && (
              <div className="mt-4">
                {buscando && achados === null ? (
                  <p className="text-xs text-fg-subtle">Procurando…</p>
                ) : achados && achados.length === 0 ? (
                  <p className="text-xs text-fg-subtle">Nenhum produto encontrado para “{termo.trim()}”.</p>
                ) : (
                  (achados ?? []).map(p => (
                    <ListRow
                      key={p.id}
                      onClick={() => abrir(p)}
                      title={`Abrir o histórico de ${p.sku}`}
                      value={p.stockQuantity === null ? '—' : inteiro.format(p.stockQuantity)}
                    >
                      <p className="truncate text-sm text-fg">{p.name}</p>
                      <p className="font-mono text-xs text-fg-subtle">{p.sku}</p>
                    </ListRow>
                  ))
                )}
              </div>
            )}
          </PanelSection>
        </Panel>
      )}

      {produto && (
        <>
          <Panel>
            <PanelSection>
              <button
                type="button"
                onClick={voltar}
                className="mb-4 inline-flex items-center gap-1.5 text-xs text-fg-muted transition-colors hover:text-fg"
              >
                <ArrowLeft size={14} /> Escolher outro produto
              </button>

              <p className="text-overline mb-1">{produto.sku}</p>
              <p className="mb-4 text-sm text-fg">{produto.name}</p>

              <StatRow>
                <StatCell>
                  <Stat
                    label="Saldo no catálogo"
                    value={produto.stockQuantity === null ? '—' : inteiro.format(produto.stockQuantity)}
                    context="Quantidade que o cadastro informa hoje"
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Lançamentos"
                    value={inteiro.format(resumo.total)}
                    context={`${inteiro.format(resumo.moveram)} alteraram o saldo, ${inteiro.format(resumo.registraram)} apenas registraram`}
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Última contagem"
                    value={resumo.ultimaContagem ? quando(resumo.ultimaContagem.at).split(',')[0] : '—'}
                    context={
                      resumo.ultimaContagem
                        ? SOURCE_LABEL[resumo.ultimaContagem.source]
                        : 'Este produto nunca foi contado'
                    }
                    valueTone={resumo.ultimaContagem ? undefined : 'warning'}
                  />
                </StatCell>
              </StatRow>
            </PanelSection>
          </Panel>

          {erro && <Notice tone="danger">{erro}</Notice>}
          {carregando && <Notice tone="neutral">Reunindo o histórico deste produto…</Notice>}

          {razao && razao.indisponiveis.length > 0 && (
            <Notice tone="warning">
              Não foi possível ler {razao.indisponiveis.join(', ')} agora. O histórico abaixo
              está incompleto — o que falta pode conter movimentos deste produto.
            </Notice>
          )}

          {razao && razao.truncadas.length > 0 && (
            <Notice tone="neutral">
              Este produto tem histórico longo em {razao.truncadas.join(', ')}. A lista mostra
              os lançamentos mais recentes de cada origem.
            </Notice>
          )}

          {pendente && (
            <Notice tone="warning">
              A contagem de {quando(pendente.at)} apurou uma diferença de{' '}
              {inteiro.format(pendente.divergence ?? 0)} e não há ajuste enviado ao ERP depois
              dela. Enquanto o ajuste não for enviado, o estoque continua com o número antigo,
              mesmo com a contagem feita.

              {/* A ação fica dentro do próprio alerta: quem lê o problema resolve ali,
                  sem sair da tela e refazer o raciocínio em outro lugar. */}
              {rascunho && (
                <span className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <Button
                    size="sm"
                    onClick={enviarAjuste}
                    disabled={enviando || bloqueio !== null || alvo === undefined}
                  >
                    <Upload size={14} />
                    {enviando ? 'Enviando…' : `Enviar ajuste: o saldo passa a ser ${inteiro.format(rascunho.countedQuantity)}`}
                  </Button>
                  {bloqueio && (
                    <span className="text-xs leading-relaxed">{BLOCK_MESSAGE[bloqueio.code]}</span>
                  )}
                </span>
              )}
            </Notice>
          )}

          {/* Fora do alerta amarelo porque o resultado tem cor própria: deixá-lo
              dentro faria um sucesso aparecer pintado de aviso. */}
          {envio && (
            <Notice tone={envio.ok ? 'success' : 'danger'}>
              {envio.message}
              {!envio.ok && ' O ajuste fica registrado e pode ser reenviado pela tela de Integrações.'}
            </Notice>
          )}

          {razao && lancamentos.length === 0 && !erro && (
            <Notice tone="neutral">
              Nada registrado sobre este produto ainda. Ele aparece aqui assim que for contado,
              sincronizado, devolvido ou movimentado.
            </Notice>
          )}

          {lancamentos.length > 0 && (
            <Panel>
              <PanelSection>
                <p className="text-overline mb-1">Linha do tempo</p>
                <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                  Do mais recente para o mais antigo. Contar não altera o saldo: a contagem
                  apura a diferença e o ajuste ao ERP é um passo separado — por isso cada
                  linha diz o que fez.
                </p>

                <Table>
                  <Thead>
                    <Tr>
                      <Th>Quando</Th>
                      <Th>Origem</Th>
                      <Th>O que aconteceu</Th>
                      <Th className="text-right">Quantidade</Th>
                      <Th>Efeito no saldo</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {lancamentos.map(e => (
                      <LinhaDoRazao key={e.key} entry={e} />
                    ))}
                  </tbody>
                </Table>
              </PanelSection>
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

function LinhaDoRazao({ entry }: { entry: LedgerEntry }) {
  return (
    <Tr>
      <Td className="whitespace-nowrap text-fg-subtle">{quando(entry.at)}</Td>
      <Td className="whitespace-nowrap">{SOURCE_LABEL[entry.source]}</Td>
      <Td>
        <p className="text-fg">{entry.title}</p>
        {entry.detail && <p className="mt-0.5 text-xs text-fg-subtle">{entry.detail}</p>}
      </Td>
      <Td numeric>
        {entry.quantity === null ? (
          '—'
        ) : (
          <>
            <span>{inteiro.format(entry.quantity)}</span>
            {/* Rótulo embaixo, não ao lado: "somado ao saldo" ao lado do número quebra a
                coluna em três linhas e desalinha a leitura vertical dos valores. */}
            {entry.quantityLabel && (
              <p className="whitespace-nowrap text-xs font-normal text-fg-subtle">{entry.quantityLabel}</p>
            )}
          </>
        )}
        {entry.divergence !== null && entry.divergence !== 0 && (
          <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
            {entry.divergence > 0 ? '+' : ''}{inteiro.format(entry.divergence)} de diferença
          </p>
        )}
      </Td>
      <Td>
        <Badge variant={EFFECT_TONE[entry.effect]}>{EFFECT_LABEL[entry.effect]}</Badge>
      </Td>
    </Tr>
  );
}
