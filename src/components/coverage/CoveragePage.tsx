import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  Badge, Button, Notice, Page, PageHeader, Panel, PanelSection, SegmentedControl,
  Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
} from '../ui';
import {
  ABC_HINT, ABC_LABEL, breakdownByClass, coverageWithin, mostOverdue, STATUS_LABEL,
  type CoverageItem, type CoverageStatus,
} from '../../lib/coverage/coverageDomain';
import { fetchCoverageItems } from '../../lib/coverage/coverageService';
import { plural } from '../../lib/formatPtBr';

interface CoveragePageProps {
  companyId: string;
}

const JANELAS = [30, 90, 180] as const;
type Janela = (typeof JANELAS)[number];

const inteiro = new Intl.NumberFormat('pt-BR');
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
const umaCasa = (n: number) => `${n.toFixed(1).replace('.', ',')}%`;

/** Semáforo da cobertura. Os cortes são de leitura, não regra de negócio: servem só para
 *  a tela não pintar de verde um número que ninguém chamaria de bom. */
function tone(pct: number): 'positive' | 'warning' | 'critical' {
  if (pct >= 80) return 'positive';
  if (pct >= 40) return 'warning';
  return 'critical';
}

/** Cobertura de contagem — quanto do estoque foi contado e há quanto tempo.
 *
 *  Tela só de leitura. É a linha de base da ciclagem programada: sem ela, um programa de
 *  contagens recorrentes entra no ar sem ninguém conseguir dizer se melhorou alguma
 *  coisa. Nada é gravado aqui. */
export function CoveragePage({ companyId }: CoveragePageProps) {
  const [itens, setItens] = useState<CoverageItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [janela, setJanela] = useState<Janela>(90);

  // `agora` fixo por carga: recalcular com `new Date()` a cada render faria um SKU mudar
  // de "em dia" para "atrasado" no meio da leitura da tela.
  const [agora, setAgora] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    try {
      const rows = await fetchCoverageItems(companyId);
      setAgora(new Date());
      setItens(rows);
    } catch (err) {
      console.error('[Coverage] load', err);
      setErro('Não foi possível carregar a cobertura agora. Tente atualizar em instantes.');
      setItens([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  // Memoizado, e não `itens ?? []` solto: o fallback criaria um array novo a cada render
  // e os memos abaixo recalculariam a cobertura do catálogo inteiro a cada toque na tela.
  const lista = useMemo(() => itens ?? [], [itens]);
  const totais = useMemo(() => coverageWithin(lista, janela, agora), [lista, janela, agora]);
  const classes = useMemo(() => breakdownByClass(lista, agora), [lista, agora]);
  const fila = useMemo(() => mostOverdue(lista, 25, agora), [lista, agora]);
  const nunca = useMemo(() => lista.filter(i => !i.lastCountedAt).length, [lista]);
  const daFonte = useMemo(() => lista.filter(i => i.balanceFrom === 'fonte_de_saldo').length, [lista]);

  const statusTone = (status: CoverageStatus) => (status === 'nunca' ? 'danger' : 'warning');

  return (
    <Page>
      <PageHeader
        eyebrow="Contagens"
        title="Cobertura de contagem"
        description="Quanto do estoque foi efetivamente contado, e há quanto tempo. É a linha de base para programar a ciclagem."
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> {loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {erro && <Notice tone="danger">{erro}</Notice>}
      {itens === null && !erro && <Notice tone="neutral">Carregando catálogo e histórico de contagens…</Notice>}

      {itens !== null && lista.length === 0 && !erro && (
        <Notice tone="neutral">
          Nenhum produto no catálogo ainda. Importe os produtos para acompanhar a cobertura.
        </Notice>
      )}

      {lista.length > 0 && (
        <>
          <SegmentedControl
            label="Janela"
            value={String(janela)}
            onChange={v => setJanela(Number(v) as Janela)}
            options={JANELAS.map(d => ({ value: String(d), label: `${d} ${plural(d, 'dia', 'dias')}` }))}
          />

          <Panel>
            <PanelSection>
              <StatRow>
                <StatCell>
                  <Stat
                    label={`SKUs contados em ${janela} ${plural(janela, 'dia', 'dias')}`}
                    value={umaCasa(totais.skusPct)}
                    context={`${inteiro.format(totais.skusCobertos)} de ${inteiro.format(totais.skus)}`}
                    valueTone={tone(totais.skusPct)}
                  />
                </StatCell>
                <StatCell>
                  {/* Cobertura por VALOR costuma contar outra história que a cobertura por
                      SKU: metade do catálogo em dia e quase nenhum item caro contado é o
                      caso comum. Por isso as duas aparecem lado a lado, nunca uma só.
                      Onde o catálogo está zerado, o saldo vem da Fonte de Saldo — a foto
                      da última importação de estoque, que a Fonte não grava no catálogo.
                      Sem saldo em origem nenhuma o total é zero, e aí 0% seria uma nota
                      vermelha sobre um dado que não existe — a tela diz isso em vez de
                      fingir que mediu. */}
                  {totais.valor > 0 ? (
                    <Stat
                      label={`Valor coberto em ${janela} ${plural(janela, 'dia', 'dias')}`}
                      value={umaCasa(totais.valorPct)}
                      context={`${moeda.format(totais.valorCoberto)} de ${moeda.format(totais.valor)}`}
                      valueTone={tone(totais.valorPct)}
                    />
                  ) : (
                    <Stat
                      label={`Valor coberto em ${janela} ${plural(janela, 'dia', 'dias')}`}
                      value="—"
                      context="Sem saldo no catálogo nem na Fonte de Saldo, e sem saldo não há valor a medir"
                    />
                  )}
                </StatCell>
                <StatCell>
                  <Stat
                    label="Nunca contados"
                    value={inteiro.format(nunca)}
                    context={nunca > 0 ? 'Sem nenhuma contagem registrada' : 'Todo o catálogo já passou por contagem'}
                    valueTone={nunca > 0 ? 'warning' : 'positive'}
                  />
                </StatCell>
              </StatRow>

              {/* Procedência explícita: o saldo da Fonte é a foto da última importação,
                  não o saldo canônico do catálogo. Apresentar os dois com a mesma cara
                  faria uma estimativa passar por dado oficial. */}
              {daFonte > 0 && (
                <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
                  {daFonte === 1
                    ? 'O valor de 1 produto vem do saldo da Fonte de Saldo'
                    : `O valor de ${inteiro.format(daFonte)} ${plural(daFonte, 'produto', 'produtos')} vem do saldo da Fonte de Saldo`}
                  {' '}— a última importação de estoque — porque esses itens estão sem quantidade no catálogo.
                </p>
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection>
              <p className="text-overline mb-1">Por classe da curva ABC</p>
              <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                Cada classe tem a sua própria cadência. Um SKU A parado há 45 dias está atrasado; um C, não.
              </p>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Classe</Th>
                    <Th>Cadência</Th>
                    <Th className="text-right">SKUs</Th>
                    <Th className="text-right">Em dia</Th>
                    <Th className="text-right">Atrasados</Th>
                    <Th className="text-right">Nunca</Th>
                    <Th className="text-right">% em dia</Th>
                  </Tr>
                </Thead>
                <tbody>
                  {classes.map(linha => (
                    <Tr key={linha.bucket}>
                      <Td>
                        <span className="font-medium">{ABC_LABEL[linha.bucket]}</span>
                        <span className="block text-xs text-fg-subtle">{ABC_HINT[linha.bucket]}</span>
                      </Td>
                      <Td>a cada {linha.cadenceDays} {plural(linha.cadenceDays, 'dia', 'dias')}</Td>
                      <Td numeric>{inteiro.format(linha.total)}</Td>
                      <Td numeric>{inteiro.format(linha.emDia)}</Td>
                      <Td numeric>{inteiro.format(linha.atrasado)}</Td>
                      <Td numeric>{inteiro.format(linha.nunca)}</Td>
                      <Td numeric>{umaCasa(linha.emDiaPct)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </PanelSection>

            <PanelSection>
              <p className="text-overline mb-1">Fila de prioridade</p>
              <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                Ordenada por quanto cada SKU estourou a cadência da própria classe — não pela data mais
                antiga. Nunca contado vem primeiro, do mais caro para o mais barato.
              </p>
              {fila.length === 0 ? (
                <Notice tone="success">Nenhum SKU atrasado. Toda a cadência por classe está em dia.</Notice>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>SKU</Th>
                      <Th>Produto</Th>
                      <Th>Local</Th>
                      <Th>Classe</Th>
                      <Th>Situação</Th>
                      <Th className="text-right">Sem contagem</Th>
                      {/* Coluna inteira de R$ 0 é ruído: só aparece quando há valor. */}
                      {totais.valor > 0 && <Th className="text-right">Valor parado</Th>}
                    </Tr>
                  </Thead>
                  <tbody>
                    {fila.map(e => (
                      <Tr key={e.productId}>
                        <Td className="font-mono text-xs">{e.sku}</Td>
                        <Td>{e.name}</Td>
                        <Td className="text-fg-subtle">{e.location || '—'}</Td>
                        <Td>{e.abc ?? '—'}</Td>
                        <Td><Badge variant={statusTone(e.status)}>{STATUS_LABEL[e.status]}</Badge></Td>
                        <Td numeric>{e.dias === null ? '—' : `${inteiro.format(e.dias)} d`}</Td>
                        {totais.valor > 0 && <Td numeric>{moeda.format(e.value)}</Td>}
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
