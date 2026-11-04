import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Badge, Button, Notice, Page, PageHeader, Panel, PanelSection, SegmentedControl,
  Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
} from '../ui';
import {
  EXPIRY_STATUS_LABEL, buildExpiryLines, describeDays, summarizeExpiry,
  type ExpiryEntry, type ExpiryStatus,
} from '../../lib/lotControl/lotControlDomain';
import { listExpiring } from '../../lib/lotControl/lotControlService';

interface Props {
  companyId: string;
  /** Dias de antecedência configurados pela empresa. */
  alertDays: number;
}

const inteiro = new Intl.NumberFormat('pt-BR');
const data = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const TONE: Record<ExpiryStatus, 'danger' | 'warning' | 'neutral'> = {
  vencido: 'danger',
  critico: 'warning',
  ok: 'neutral',
};

type Filtro = 'risco' | 'todos';

/** Controle de validade — só leitura.
 *
 *  Lista o que foi recebido com data de validade, do mais urgente para o mais
 *  distante. A aba só existe quando a empresa ligou a chave de validade.
 *
 *  O que a tela mostra é o que ENTROU, não o que resta: o saldo por endereço não
 *  separa por lote, então uma linha aqui diz "esta remessa entrou neste endereço e
 *  vence nesta data", não "ainda existem tantas unidades deste lote". A tela diz
 *  isso com todas as letras em vez de deixar o número parecer um saldo. */
export function ExpiryPage({ companyId, alertDays }: Props) {
  const [entradas, setEntradas] = useState<ExpiryEntry[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>('risco');

  // Fixo por carga: recalcular a cada render faria um item mudar de faixa
  // enquanto alguém lê a lista, na virada do dia.
  const [hoje, setHoje] = useState(() => new Date());

  const load = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const momento = new Date();
      const rows = await listExpiring(companyId);
      setHoje(momento);
      setEntradas(rows);
    } catch (err) {
      console.error('[Validade] carregar', err);
      setErro('Não foi possível carregar os vencimentos agora.');
      setEntradas([]);
    } finally {
      setCarregando(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const linhas = useMemo(
    () => buildExpiryLines(entradas ?? [], hoje, alertDays),
    [entradas, hoje, alertDays]
  );
  const resumo = useMemo(() => summarizeExpiry(linhas), [linhas]);
  const visiveis = useMemo(
    () => (filtro === 'risco' ? linhas.filter(l => l.status !== 'ok') : linhas),
    [linhas, filtro]
  );

  return (
    <Page>
      <PageHeader
        eyebrow="Operações"
        title="Controle de validade"
        description={`O que foi recebido com data de validade, do mais urgente para o mais distante. Vence em breve = nos próximos ${alertDays} dias.`}
        actions={
          <Button variant="secondary" onClick={load} disabled={carregando}>
            <RefreshCw size={16} /> {carregando ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {erro && <Notice tone="danger">{erro}</Notice>}
      {entradas === null && !erro && <Notice tone="neutral">Carregando vencimentos…</Notice>}

      {entradas !== null && entradas.length === 0 && !erro && (
        <Notice tone="neutral">
          Nenhum recebimento com validade registrada ainda. As datas entram pelo
          endereçamento do recebimento, na conferência por NF-e.
        </Notice>
      )}

      {linhas.length > 0 && (
        <>
          <Panel>
            <PanelSection>
              <StatRow>
                <StatCell>
                  <Stat
                    label="Vencidos"
                    value={inteiro.format(resumo.vencidos)}
                    context="Exigem decisão hoje"
                    valueTone={resumo.vencidos > 0 ? 'critical' : 'positive'}
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Vencem em breve"
                    value={inteiro.format(resumo.criticos)}
                    context={`Nos próximos ${alertDays} dias`}
                    valueTone={resumo.criticos > 0 ? 'warning' : 'positive'}
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Unidades em risco"
                    value={inteiro.format(resumo.unidadesEmRisco)}
                    context="Somando vencidos e a vencer, como foram recebidos"
                  />
                </StatCell>
              </StatRow>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-overline mb-1">Vencimentos</p>
                  <p className="text-xs leading-relaxed text-fg-subtle">
                    Cada linha é uma entrada de recebimento, com a quantidade que chegou.
                    Não é saldo: o estoque por endereço não separa por lote, então o que
                    já saiu não é descontado daqui.
                  </p>
                </div>
                <SegmentedControl
                  label="Filtro"
                  value={filtro}
                  onChange={v => setFiltro(v as Filtro)}
                  options={[
                    { value: 'risco', label: 'Em risco' },
                    { value: 'todos', label: 'Todos' },
                  ]}
                />
              </div>

              {visiveis.length === 0 ? (
                <Notice tone="success">
                  Nada vencido nem perto de vencer. Há {inteiro.format(resumo.noPrazo)} entrada(s)
                  com validade no prazo.
                </Notice>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>Validade</Th>
                      <Th>Prazo</Th>
                      <Th>SKU</Th>
                      <Th>Produto</Th>
                      <Th>Lote</Th>
                      <Th>Endereço</Th>
                      <Th className="text-right">Recebido</Th>
                      <Th>Situação</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {visiveis.map(l => (
                      <Tr key={l.id}>
                        <Td className="whitespace-nowrap">
                          {(() => {
                            const d = new Date(`${l.expiryDate}T12:00:00`);
                            return Number.isNaN(d.getTime()) ? l.expiryDate : data.format(d);
                          })()}
                        </Td>
                        <Td className="whitespace-nowrap text-fg-subtle">{describeDays(l.days)}</Td>
                        <Td className="font-mono text-xs">{l.sku}</Td>
                        <Td>{l.productName}</Td>
                        <Td className="font-mono text-xs">{l.lotNumber ?? '—'}</Td>
                        <Td className="font-mono text-xs">{l.binCode}</Td>
                        <Td numeric>
                          {inteiro.format(l.units)}
                          {l.invoiceNumber && (
                            <p className="text-xs font-normal text-fg-subtle">NF-e {l.invoiceNumber}</p>
                          )}
                        </Td>
                        <Td>
                          <Badge variant={TONE[l.status]}>{EXPIRY_STATUS_LABEL[l.status]}</Badge>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </PanelSection>
          </Panel>
        </>
      )}
    </Page>
  );
}
