import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import {
  Badge, Button, Input, Notice, Page, PageHeader, Panel, PanelSection, SegmentedControl,
  Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
} from '../ui';
import { ABC_LABEL, type AbcBucket, type CoverageItem } from '../../lib/coverage/coverageDomain';
import { fetchCoverageItems } from '../../lib/coverage/coverageService';
import {
  CADENCE_MAX, CADENCE_MIN, CAPACITY_MAX, CAPACITY_MIN, DEFAULT_CYCLE_CONFIG, ORIGIN_LABEL,
  normalizeConfig, planDailyBatch, programStatus, type CycleProgramConfig,
} from '../../lib/coverage/cycleProgramDomain';
import {
  fetchCycleProgramConfig, saveCycleProgramConfig,
} from '../../lib/coverage/cycleProgramService';

interface CycleProgramPageProps {
  companyId: string;
  /** Owner/admin/manager — só quem manda altera a cadência, porque ela decide quanto
   *  trabalho de contagem entra na fila da equipe todo dia. */
  canManage: boolean;
}

const inteiro = new Intl.NumberFormat('pt-BR');
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const BUCKETS: AbcBucket[] = ['A', 'B', 'C', 'sem'];

/** Cobertura e programa discordam de propósito sobre o que é "atrasado": a Cobertura usa a
 *  cadência fixa do diagnóstico, e aqui vale a cadência que a empresa escolheu. */
export function CycleProgramPage({ companyId, canManage }: CycleProgramPageProps) {
  const [itens, setItens] = useState<CoverageItem[] | null>(null);
  const [config, setConfig] = useState<CycleProgramConfig>(DEFAULT_CYCLE_CONFIG);
  const [rascunho, setRascunho] = useState<CycleProgramConfig>(DEFAULT_CYCLE_CONFIG);
  const [salvo, setSalvo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);

  // `agora` fixo por carga, como na Cobertura: recalcular a cada render faria um SKU entrar
  // ou sair do lote enquanto alguém lê a lista.
  const [agora, setAgora] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    setAviso(null);
    try {
      const [rows, carregada] = await Promise.all([
        fetchCoverageItems(companyId),
        // A configuração é secundária: se a tabela ainda não existe no banco, o programa
        // roda com os padrões em vez de a tela inteira falhar.
        fetchCycleProgramConfig(companyId).catch(err => {
          console.error('[Ciclagem] config', err);
          return { config: DEFAULT_CYCLE_CONFIG, saved: false };
        }),
      ]);
      setAgora(new Date());
      setItens(rows);
      setConfig(carregada.config);
      setRascunho(carregada.config);
      setSalvo(carregada.saved);
    } catch (err) {
      console.error('[Ciclagem] load', err);
      setErro('Não foi possível carregar o programa agora. Tente atualizar em instantes.');
      setItens([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const lista = useMemo(() => itens ?? [], [itens]);

  // O lote segue o RASCUNHO, não a configuração salva: quem está escolhendo a cadência
  // precisa ver o efeito dela no trabalho de amanhã antes de assumir o compromisso —
  // "180 dias para a classe C" não diz nada; "isso coloca 40 itens na fila de hoje" diz.
  // Enquanto houver diferença, a tela avisa que está mostrando prévia.
  const status = useMemo(() => programStatus(lista, rascunho, agora), [lista, rascunho, agora]);
  const lote = useMemo(() => planDailyBatch(lista, rascunho, agora), [lista, rascunho, agora]);

  const alterado = useMemo(
    () => JSON.stringify(normalizeConfig(rascunho)) !== JSON.stringify(normalizeConfig(config)),
    [rascunho, config]
  );

  const setCadencia = (bucket: AbcBucket, valor: string) => {
    const numero = Number(valor);
    setRascunho(atual => ({
      ...atual,
      // Campo vazio vira NaN; guardar NaN aqui deixaria o input editável e `normalizeConfig`
      // cuida de devolver o padrão na hora de salvar.
      cadenceDays: { ...atual.cadenceDays, [bucket]: Number.isFinite(numero) ? numero : Number.NaN },
    }));
  };

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const gravada = await saveCycleProgramConfig(companyId, rascunho);
      setConfig(gravada);
      setRascunho(gravada);
      setSalvo(true);
      // Valor ajustado pelos limites precisa ser dito: salvar 500 e ver 200 na tela sem
      // explicação parece defeito.
      if (JSON.stringify(gravada) !== JSON.stringify(normalizeConfig(rascunho))) {
        setAviso('Programa salvo. Alguns valores foram ajustados para os limites permitidos.');
      } else {
        setAviso('Programa salvo.');
      }
    } catch (err) {
      console.error('[Ciclagem] salvar', err);
      setErro('Não foi possível salvar o programa. Verifique se você tem permissão de gestão.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Page>
      <PageHeader
        eyebrow="Contagens"
        title="Programa de ciclagem"
        description="Define com que frequência cada classe da curva ABC é recontada e quantos SKUs cabem no dia — e mostra a lista do dia de hoje."
        actions={
          <Button variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw size={16} /> {loading ? 'Atualizando…' : 'Atualizar'}
          </Button>
        }
      />

      {erro && <Notice tone="danger">{erro}</Notice>}
      {aviso && <Notice tone="success">{aviso}</Notice>}
      {itens === null && !erro && <Notice tone="neutral">Carregando catálogo e histórico de contagens…</Notice>}

      {itens !== null && lista.length === 0 && !erro && (
        <Notice tone="neutral">
          Nenhum produto no catálogo ainda. Importe os produtos para programar a ciclagem.
        </Notice>
      )}

      {lista.length > 0 && (
        <>
          {!config.enabled && (
            <Notice tone="warning">
              O programa está desligado. A lista abaixo já mostra o que seria contado hoje, mas
              nada é cobrado da equipe enquanto você não ligar.
            </Notice>
          )}

          {alterado && (
            <Notice tone="neutral">
              Prévia: os números abaixo usam a cadência que você está editando, ainda não salva.
            </Notice>
          )}

          <Panel>
            <PanelSection>
              <StatRow>
                <StatCell>
                  <Stat
                    label="Lote de hoje"
                    value={inteiro.format(lote.entries.length)}
                    context={`${inteiro.format(lote.dueTaken)} por cadência vencida, ${inteiro.format(lote.backlogTaken)} do backlog`}
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Cadência vencida"
                    value={inteiro.format(status.vencidos)}
                    context={
                      lote.dueTotal > lote.dueTaken
                        ? `${inteiro.format(lote.dueTotal - lote.dueTaken)} não cabem hoje`
                        : 'Todos cabem no lote de hoje'
                    }
                    valueTone={lote.dueTotal > lote.capacity ? 'critical' : status.vencidos > 0 ? 'warning' : 'positive'}
                  />
                </StatCell>
                <StatCell>
                  <Stat
                    label="Nunca contados"
                    value={inteiro.format(status.nunca)}
                    context={
                      lote.backlogDaysToClear === null
                        ? 'Parado: a capacidade do dia é toda consumida pelas recontagens'
                        : lote.backlogDaysToClear === 0
                          ? 'Catálogo inteiro já passou por contagem'
                          : `Zera em ~${inteiro.format(lote.backlogDaysToClear)} dias no ritmo atual`
                    }
                    valueTone={status.nunca > 0 ? 'warning' : 'positive'}
                  />
                </StatCell>
              </StatRow>
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection>
              <p className="text-overline mb-1">Configuração</p>
              <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                {salvo
                  ? 'Cadência e lote diário desta empresa.'
                  : 'Esta empresa ainda não configurou o programa — os valores abaixo são os padrões sugeridos.'}
                {' '}Classes de maior valor movimentado merecem recontagem mais frequente; o lote
                precisa caber num turno, ou a contagem é aberta e abandonada.
              </p>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
                {BUCKETS.map(bucket => (
                  <label key={bucket} className="block">
                    <span className="mb-1.5 block text-xs text-fg-subtle">{ABC_LABEL[bucket]}</span>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={CADENCE_MIN}
                      max={CADENCE_MAX}
                      disabled={!canManage}
                      value={Number.isFinite(rascunho.cadenceDays[bucket]) ? rascunho.cadenceDays[bucket] : ''}
                      onChange={e => setCadencia(bucket, e.target.value)}
                    />
                    <span className="mt-1 block text-xs text-fg-subtle">dias entre contagens</span>
                  </label>
                ))}

                <label className="block">
                  <span className="mb-1.5 block text-xs text-fg-subtle">Lote diário</span>
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={CAPACITY_MIN}
                    max={CAPACITY_MAX}
                    disabled={!canManage}
                    value={Number.isFinite(rascunho.dailyCapacity) ? rascunho.dailyCapacity : ''}
                    onChange={e => {
                      const numero = Number(e.target.value);
                      setRascunho(atual => ({ ...atual, dailyCapacity: Number.isFinite(numero) ? numero : Number.NaN }));
                    }}
                  />
                  <span className="mt-1 block text-xs text-fg-subtle">SKUs por dia</span>
                </label>
              </div>

              {canManage && (
                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <SegmentedControl
                    label="Programa"
                    value={rascunho.enabled ? 'on' : 'off'}
                    onChange={v => setRascunho(atual => ({ ...atual, enabled: v === 'on' }))}
                    options={[
                      { value: 'off', label: 'Desligado' },
                      { value: 'on', label: 'Ligado' },
                    ]}
                  />
                  <Button onClick={salvar} disabled={salvando || !alterado}>
                    <Save size={16} /> {salvando ? 'Salvando…' : 'Salvar programa'}
                  </Button>
                </div>
              )}

              {!canManage && (
                <p className="mt-4 text-xs leading-relaxed text-fg-subtle">
                  Só quem tem permissão de gestão altera a cadência. Você continua vendo a lista do dia.
                </p>
              )}
            </PanelSection>
          </Panel>

          <Panel>
            <PanelSection>
              <p className="text-overline mb-1">O que contar hoje</p>
              <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                A recontagem de quem já venceu a cadência entra primeiro — é o ciclo funcionando. O
                que sobrar do lote é preenchido com os nunca contados, do mais caro para o mais
                barato. A lista não muda ao longo do dia.
              </p>

              {lote.entries.length === 0 ? (
                <Notice tone="success">
                  Nada a contar hoje. Toda a cadência configurada está em dia e não há produto sem contagem.
                </Notice>
              ) : (
                <Table>
                  <Thead>
                    <Tr>
                      <Th>SKU</Th>
                      <Th>Produto</Th>
                      <Th>Local</Th>
                      <Th>Classe</Th>
                      <Th>Motivo</Th>
                      <Th className="text-right">Sem contagem</Th>
                      <Th className="text-right">Valor parado</Th>
                    </Tr>
                  </Thead>
                  <tbody>
                    {lote.entries.map(e => (
                      <Tr key={e.productId}>
                        <Td className="font-mono text-xs">{e.sku}</Td>
                        <Td>{e.name}</Td>
                        <Td className="text-fg-subtle">{e.location || '—'}</Td>
                        <Td>{e.bucket === 'sem' ? '—' : e.bucket}</Td>
                        <Td>
                          <Badge variant={e.origin === 'vencido' ? 'warning' : 'danger'}>
                            {ORIGIN_LABEL[e.origin]}
                          </Badge>
                        </Td>
                        <Td numeric>
                          {e.dias === null ? '—' : `${inteiro.format(e.dias)} d / ${inteiro.format(e.cadenceDays)} d`}
                        </Td>
                        <Td numeric>{e.value > 0 ? moeda.format(e.value) : '—'}</Td>
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
