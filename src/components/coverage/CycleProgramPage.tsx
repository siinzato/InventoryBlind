import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardList, RefreshCw, Save } from 'lucide-react';
import {
  Badge, Button, Input, Notice, Page, PageHeader, Panel, PanelSection, SegmentedControl,
  Stat, StatCell, StatRow, Table, Td, Th, Thead, Tr,
} from '../ui';
import { ABC_LABEL, type AbcBucket, type CoverageItem } from '../../lib/coverage/coverageDomain';
import { fetchCoverageItems } from '../../lib/coverage/coverageService';
import {
  CADENCE_MAX, CADENCE_MIN, CAPACITY_MAX, CAPACITY_MIN, DEFAULT_CYCLE_CONFIG, ORIGIN_LABEL,
  SCHEDULE_HOUR_MAX, SCHEDULE_HOUR_MIN, WEEKDAY_LABEL, WEEKDAY_SHORT,
  describeSchedule, normalizeConfig, planDailyBatch, programStatus,
  type CycleProgramConfig, type CycleSchedule, type Weekday,
} from '../../lib/coverage/cycleProgramDomain';
import {
  createCycleSession, fetchCycleProgramConfig, findOpenCycleSession, saveCycleProgramConfig,
  type OpenCycleSession,
} from '../../lib/coverage/cycleProgramService';

interface CycleProgramPageProps {
  companyId: string;
  /** Owner/admin/manager — só quem manda altera a cadência, porque ela decide quanto
   *  trabalho de contagem entra na fila da equipe todo dia. */
  canManage: boolean;
  /** Quem pode criar uma contagem a partir do lote. Mesma capacidade de escrita de estoque
   *  que a tela de Contagens exige para abrir uma contagem na mão — a RPC do banco só valida
   *  a empresa dos produtos, então este gate é de produto, não de segurança. */
  canCount: boolean;
  /** Leva para a tela de Contagens, onde a contagem gerada é iniciada e preenchida. Mesmo
   *  contrato de `onNavigateToCount` já usado por CBC, Risco e Slotting. */
  onNavigateToCount: () => void;
}

const inteiro = new Intl.NumberFormat('pt-BR');
const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

const BUCKETS: AbcBucket[] = ['A', 'B', 'C', 'sem'];

/** Segunda primeiro: a semana de trabalho começa na segunda, e domingo no fim é onde
 *  quem olha espera encontrá-lo. A numeração continua a de `Date.getDay()`. */
const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** Cobertura e programa discordam de propósito sobre o que é "atrasado": a Cobertura usa a
 *  cadência fixa do diagnóstico, e aqui vale a cadência que a empresa escolheu. */
export function CycleProgramPage({ companyId, canManage, canCount, onNavigateToCount }: CycleProgramPageProps) {
  const [itens, setItens] = useState<CoverageItem[] | null>(null);
  const [config, setConfig] = useState<CycleProgramConfig>(DEFAULT_CYCLE_CONFIG);
  const [rascunho, setRascunho] = useState<CycleProgramConfig>(DEFAULT_CYCLE_CONFIG);
  const [salvo, setSalvo] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [gerando, setGerando] = useState(false);
  // A contagem de ciclagem de hoje que já existe e ainda está aberta. Carregada junto do
  // resto para o botão nascer sabendo o que oferecer, em vez de descobrir só no clique.
  const [aberta, setAberta] = useState<OpenCycleSession | null>(null);

  // `agora` fixo por carga, como na Cobertura: recalcular a cada render faria um SKU entrar
  // ou sair do lote enquanto alguém lê a lista.
  const [agora, setAgora] = useState(() => new Date());

  const load = useCallback(async () => {
    setLoading(true);
    setErro(null);
    setAviso(null);
    try {
      // `agora` precisa ser o mesmo relógio usado para procurar a contagem de hoje: a marca
      // da sessão é o rótulo do dia, e deixar a busca usar outro `new Date()` faria a
      // virada de meia-noite procurar o dia errado.
      const momento = new Date();
      const [rows, carregada, existente] = await Promise.all([
        fetchCoverageItems(companyId),
        // A configuração é secundária: se a tabela ainda não existe no banco, o programa
        // roda com os padrões em vez de a tela inteira falhar.
        fetchCycleProgramConfig(companyId).catch(err => {
          console.error('[Ciclagem] config', err);
          return { config: DEFAULT_CYCLE_CONFIG, saved: false };
        }),
        // Idem: não achar a contagem de hoje degrada o botão, não derruba a tela.
        findOpenCycleSession(companyId, momento).catch(err => {
          console.error('[Ciclagem] contagem de hoje', err);
          return null;
        }),
      ]);
      setAgora(momento);
      setItens(rows);
      setConfig(carregada.config);
      setRascunho(carregada.config);
      setSalvo(carregada.saved);
      setAberta(existente);
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

  const setAgendamento = (mudanca: Partial<CycleSchedule>) =>
    setRascunho(atual => ({ ...atual, schedule: { ...atual.schedule, ...mudanca } }));

  /** Dia vazio é permitido no rascunho e barrado no Salvar: desmarcar o último dia para
   *  marcar outro é um gesto normal, e impedir o estado intermediário tornaria a edição
   *  dependente da ordem dos cliques. */
  const alternarDia = (dia: Weekday) =>
    setRascunho(atual => {
      const atuais = atual.schedule.weekdays;
      const proximos = atuais.includes(dia)
        ? atuais.filter(d => d !== dia)
        : [...atuais, dia].sort((a, b) => a - b);
      return { ...atual, schedule: { ...atual.schedule, weekdays: proximos } };
    });

  const semDia = rascunho.schedule.weekdays.length === 0;

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

  /** Materializa o lote numa contagem física.
   *
   *  Reconsulta a contagem de hoje antes de criar, em vez de confiar no estado carregado: a
   *  tela pode estar aberta desde cedo e outra pessoa ter gerado o lote nesse meio-tempo. É
   *  uma verificação, não uma garantia — duas pessoas clicando no mesmo segundo ainda criam
   *  duas contagens, e o banco não tem como impedir isso sem uma restrição que a Contagem
   *  Física não tem hoje. O caso real que isto cobre é o segundo clique e a manhã dividida.
   */
  const gerar = async () => {
    setGerando(true);
    setErro(null);
    setAviso(null);
    try {
      const jaExiste = await findOpenCycleSession(companyId, agora);
      if (jaExiste) {
        setAberta(jaExiste);
        setErro(
          `Já existe uma contagem de ciclagem aberta para hoje, com ${inteiro.format(jaExiste.totalItems)} item(ns). ` +
          'Conclua ou remova essa contagem antes de gerar outra — duas listas do mesmo dia dividiriam a contagem da equipe.'
        );
        return;
      }

      const criada = await createCycleSession(lote, agora);
      setAberta({ id: criada.sessionId, totalItems: criada.totalItems, status: 'draft' });
      setAviso(
        `Contagem criada com ${inteiro.format(criada.totalItems)} item(ns), como rascunho. ` +
        'Ela aparece em Contagens e começa a valer quando a equipe iniciar a contagem por lá.'
      );
    } catch (err) {
      console.error('[Ciclagem] gerar contagem', err);
      setErro('Não foi possível gerar a contagem do dia. Tente novamente em instantes.');
    } finally {
      setGerando(false);
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

              <div className="mt-6 border-t border-edge pt-5">
                <p className="text-overline mb-1">Lembrete</p>
                <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                  Nos dias marcados, quem pode gerar ou executar a contagem recebe um aviso no
                  sino — quando o lote do dia ainda não saiu, ou quando uma contagem de ciclagem
                  anterior continua aberta. O lembrete não gera a contagem sozinho: a lista do dia
                  continua sendo criada aqui, por uma pessoa.
                </p>

                {canManage ? (
                  <div className="flex flex-wrap items-end gap-4">
                    <div>
                      <span className="mb-1.5 block text-xs text-fg-subtle">Lembrete</span>
                      <SegmentedControl
                        label="Lembrete"
                        value={rascunho.schedule.enabled ? 'on' : 'off'}
                        onChange={v => setAgendamento({ enabled: v === 'on' })}
                        options={[
                          { value: 'off', label: 'Desligado' },
                          { value: 'on', label: 'Ligado' },
                        ]}
                      />
                    </div>

                    <div>
                      <span className="mb-1.5 block text-xs text-fg-subtle">Dias de contagem</span>
                      {/* Mesma gramática do SegmentedControl: uma trilha com borda e segmentos
                          sem borda. Sete caixinhas lado a lado leriam como sete controles. */}
                      <div
                        role="group"
                        aria-label="Dias da semana em que a contagem é esperada"
                        className="inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-control border border-edge bg-surface-3 p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                      >
                        {WEEKDAYS.map(dia => {
                          const marcado = rascunho.schedule.weekdays.includes(dia);
                          return (
                            <button
                              key={dia}
                              type="button"
                              onClick={() => alternarDia(dia)}
                              aria-pressed={marcado}
                              aria-label={WEEKDAY_LABEL[dia]}
                              className={`flex min-h-[36px] flex-shrink-0 items-center justify-center whitespace-nowrap rounded-control px-3 text-xs font-medium transition-colors [@media(pointer:coarse)]:min-h-[44px] ${
                                marcado ? 'bg-surface text-fg shadow-control' : 'text-fg-muted hover:text-fg'
                              }`}
                            >
                              {WEEKDAY_SHORT[dia]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sem legenda abaixo do campo, ao contrário da grade de cadência: aqui ela
                        desalinharia o campo dos dois controles ao lado. A unidade aparece na
                        linha de resumo logo abaixo, já formatada como hora. */}
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-fg-subtle">Hora de início</span>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={SCHEDULE_HOUR_MIN}
                        max={SCHEDULE_HOUR_MAX}
                        className="w-24"
                        value={Number.isFinite(rascunho.schedule.hour) ? rascunho.schedule.hour : ''}
                        onChange={e => {
                          const numero = Number(e.target.value);
                          setAgendamento({ hour: Number.isFinite(numero) ? numero : Number.NaN });
                        }}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-fg-subtle">
                    {rascunho.schedule.enabled
                      ? `Lembrete ligado: ${describeSchedule(rascunho.schedule).toLowerCase()}.`
                      : 'O lembrete está desligado para esta empresa.'}
                  </p>
                )}

                {canManage && (
                  <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
                    {semDia
                      ? 'Marque pelo menos um dia da semana — um lembrete ligado sem dia nenhum nunca avisaria.'
                      : rascunho.schedule.enabled
                        ? `${describeSchedule(rascunho.schedule)}, no fuso de ${rascunho.schedule.timezone.replace('_', ' ')}.`
                        : `Se ligado: ${describeSchedule(rascunho.schedule).toLowerCase()}.`}
                  </p>
                )}
              </div>

              {canManage && (
                <div className="mt-5 flex flex-wrap items-end gap-3">
                  {/* A legenda deixou de ser dispensável quando o lembrete ganhou um
                      interruptor idêntico logo acima: dois "Desligado/Ligado" na mesma
                      tela precisam dizer cada um do que são. */}
                  <div>
                    <span className="mb-1.5 block text-xs text-fg-subtle">Programa</span>
                    <SegmentedControl
                      label="Programa"
                      value={rascunho.enabled ? 'on' : 'off'}
                      onChange={v => setRascunho(atual => ({ ...atual, enabled: v === 'on' }))}
                      options={[
                        { value: 'off', label: 'Desligado' },
                        { value: 'on', label: 'Ligado' },
                      ]}
                    />
                  </div>
                  <Button onClick={salvar} disabled={salvando || !alterado || semDia}>
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
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-overline mb-1">O que contar hoje</p>
                  <p className="text-xs leading-relaxed text-fg-subtle">
                    A recontagem de quem já venceu a cadência entra primeiro — é o ciclo funcionando. O
                    que sobrar do lote é preenchido com os nunca contados, do mais caro para o mais
                    barato. A lista não muda ao longo do dia.
                  </p>
                </div>

                {canCount && (
                  aberta ? (
                    <Button variant="secondary" onClick={onNavigateToCount}>
                      <ClipboardList size={16} /> Abrir em Contagens
                    </Button>
                  ) : (
                    <Button onClick={gerar} disabled={gerando || lote.entries.length === 0}>
                      <ClipboardList size={16} /> {gerando ? 'Gerando…' : 'Gerar contagem do dia'}
                    </Button>
                  )
                )}
              </div>

              {aberta && (
                <Notice tone="neutral">
                  A contagem de hoje já existe, com {inteiro.format(aberta.totalItems)} item(ns)
                  {aberta.status === 'draft'
                    ? ' e ainda não foi iniciada pela equipe.'
                    : ' e já está em andamento.'}
                  {' '}Enquanto ela estiver aberta, a lista abaixo continua mostrando o lote
                  calculado agora — os itens só saem da fila depois de contados.
                </Notice>
              )}

              {!canCount && (
                <p className="mb-4 text-xs leading-relaxed text-fg-subtle">
                  Gerar a contagem do dia exige permissão para movimentar estoque. A lista abaixo
                  continua disponível para consulta e conferência.
                </p>
              )}

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
