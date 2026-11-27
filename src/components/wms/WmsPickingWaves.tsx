// Pulmão -> Ondas. Montar a separação antes de alguém andar pelo galpão.
//
// ── O que esta tela decide, e o que ela não decide ────────────────────────────
// Ela monta a DEMANDA: que SKU, quantas caixas. Em que endereço buscar cada caixa é
// decisão do banco, no momento de reservar — FIFO sobre o disponível, com a reserva
// gravada no mesmo instante. Por isso o botão "Reservar" é a fronteira da tela: antes
// dele nada saiu do rascunho, depois dele o saldo está prometido e a demanda congela.
//
// ── Por que a prévia roda antes de qualquer ida ao banco ──────────────────────
// `interpretarLista` é pura. Colar 40 linhas e descobrir no servidor que a 7 estava
// torta é pagar uma viagem para receber um erro que já dava para ver — e, pior, deixar
// 6 itens gravados e 34 não. A conferência acontece na tela, com a linha recusada
// editável no lugar, e só vai para o banco o que já está de pé.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ClipboardPaste, FileText, Layers, Map, PlayCircle, Plug,
  Plus, RotateCcw, Table2, Trash2, X,
} from 'lucide-react';
import {
  Badge, Button, Input, Notice, Panel, PanelSection, SegmentedControl, Select, Stat, StatCell,
  StatRow, Table, Td, Th, Thead, Tr, Textarea, type SegmentedOption,
} from '../ui';
import { plural } from '../../lib/formatPtBr';
import {
  aplicarAjustes, lerPdf, lerPlanilha, linhasDaPlanilha, linhasDoPdf, PdfSemTexto,
  type OrigemDaColuna, type PlanilhaLida,
} from '../../lib/wms/pickingImport';
import { WmsWavePicking } from './WmsWavePicking';
import { searchProducts, type ProductOption } from '../../lib/wms/wmsService';
import {
  ROTULO_DO_ESTADO, adicionarItem, adicionarPorCodigo, cancelarOnda, criarOnda,
  detalheDaOnda, interpretarLista, listarOndas, removerItem, reservarOnda,
  type CandidatoDeProduto, type DetalheDaOnda, type EstadoDaOnda, type LinhaRecusada,
  type ListaInterpretada, type Onda, type ResumoDaReserva,
} from '../../lib/wms/pickingService';

/** Cor do estado. Semântica, nunca decorativa: só o que exige atenção fica colorido. */
const TOM_DO_ESTADO: Record<EstadoDaOnda, 'neutral' | 'accent' | 'success' | 'warning'> = {
  rascunho: 'neutral',
  reservada: 'accent',
  em_separacao: 'accent',
  concluida: 'success',
  parcial: 'warning',
  cancelada: 'neutral',
};

export type FonteDaLista = 'colar' | 'planilha' | 'pdf' | 'integracao';

/** As quatro portas do mesmo funil. A quarta está visível e desligada de propósito. */
const FONTES_DA_LISTA: SegmentedOption<FonteDaLista>[] = [
  { value: 'colar', label: 'Colar', icon: ClipboardPaste },
  { value: 'planilha', label: 'Planilha', icon: Table2 },
  { value: 'pdf', label: 'PDF', icon: FileText },
  { value: 'integracao', label: 'Em breve', icon: Plug },
];

const MOTIVO_DA_RECUSA: Record<LinhaRecusada['motivo'], string> = {
  sem_quantidade: 'Falta a quantidade',
  quantidade_invalida: 'Quantidade precisa ser um número inteiro de caixas',
  sem_codigo: 'Falta o código do produto',
  ambigua: 'Não dá para saber se o número do meio é parte do código ou a quantidade',
};

const dataCurta = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });

export function WmsPickingWaves({ onVerNoMapa }: {
  /**
   * Leva a rota da onda para o Mapa 3D.
   *
   * Prop, e não navegação interna: o mapa é uma seção IRMÃ desta, e nenhuma renderiza a
   * outra. Quem conhece as duas é a página do Pulmão, e é ela quem troca de seção.
   */
  onVerNoMapa?: (codigo: string, enderecos: string[]) => void;
} = {}) {
  const [ondas, setOndas] = useState<Onda[] | null>(null);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      setOndas(await listarOndas());
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);

  const criar = useCallback(async () => {
    setErro(null);
    try {
      setAbertaId(await criarOnda({ origem: 'manual' }));
      void carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [carregar]);

  if (abertaId) {
    return (
      <OndaAberta
        ondaId={abertaId}
        onVoltar={() => { setAbertaId(null); void carregar(); }}
        onVerNoMapa={onVerNoMapa}
      />
    );
  }

  return (
    <div className="space-y-4">
      {erro && <Notice tone="danger">{erro}</Notice>}

      <Panel>
        <PanelSection>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-headline">Ondas de separação</h2>
              <p className="mt-1 text-sm text-fg-muted">
                Uma onda junta o que precisa sair, reserva o saldo e vira a rota do separador.
              </p>
            </div>
            <Button onClick={() => void criar()}>
              <Plus aria-hidden className="h-4 w-4" />
              Nova onda
            </Button>
          </div>
        </PanelSection>

        {ondas === null ? (
          <PanelSection><p className="text-sm text-fg-subtle">Carregando…</p></PanelSection>
        ) : ondas.length === 0 ? (
          <PanelSection>
            <p className="text-sm text-fg-muted">
              Nenhuma onda ainda. Comece criando uma e colando a lista do que precisa sair.
            </p>
          </PanelSection>
        ) : (
          <PanelSection padding="sm">
            <Table>
              <Thead>
                <Tr>
                  <Th>Onda</Th>
                  <Th>Situação</Th>
                  <Th>Criada</Th>
                  <Th className="text-right">Abrir</Th>
                </Tr>
              </Thead>
              <tbody>
                {ondas.map(o => (
                  <Tr key={o.id}>
                    <Td><span className="text-code">{o.codigo}</span></Td>
                    <Td><Badge variant={TOM_DO_ESTADO[o.estado]}>{ROTULO_DO_ESTADO[o.estado]}</Badge></Td>
                    <Td className="text-fg-muted">{dataCurta(o.criadaEm)}</Td>
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => setAbertaId(o.id)}>Abrir</Button>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </PanelSection>
        )}
      </Panel>
    </div>
  );
}

// ── A onda aberta ─────────────────────────────────────────────────────────────

/** Uma linha da lista colada que casou com mais de um produto, esperando escolha. */
interface Ambigua {
  codigo: string;
  caixas: number;
  candidatos: CandidatoDeProduto[];
}

function OndaAberta({ ondaId, onVoltar, onVerNoMapa }: {
  ondaId: string;
  onVoltar: () => void;
  onVerNoMapa?: (codigo: string, enderecos: string[]) => void;
}) {
  const [detalhe, setDetalhe] = useState<DetalheDaOnda | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [texto, setTexto] = useState('');
  const [fila, setFila] = useState<Ambigua[]>([]);
  const [naoEncontrados, setNaoEncontrados] = useState<string[]>([]);
  const [resumo, setResumo] = useState<ResumoDaReserva | null>(null);
  const [separando, setSeparando] = useState(false);

  // ── De onde a lista vem ───────────────────────────────────────────────────
  //
  // A fonte muda só o começo. Depois dela, tudo é igual: a mesma prévia, a mesma
  // correção no lugar, a mesma fila de desambiguação de EAN e o mesmo bloqueio do
  // botão de reservar. Três validações para três fontes seriam três conjuntos de bugs.
  const [fonte, setFonte] = useState<FonteDaLista>('colar');
  const [planilha, setPlanilha] = useState<PlanilhaLida | null>(null);
  const [arquivoDaPlanilha, setArquivoDaPlanilha] = useState<File | null>(null);
  const [colunaDoCodigo, setColunaDoCodigo] = useState<number | null>(null);
  const [colunaDaQuantidade, setColunaDaQuantidade] = useState<number | null>(null);
  const [previaDoPdf, setPreviaDoPdf] = useState<ListaInterpretada | null>(null);
  const [pdfPronto, setPdfPronto] = useState<{ nome: string; linhas: number } | null>(null);
  const [lendoArquivo, setLendoArquivo] = useState(false);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);
  /** Correções digitadas sobre linhas recusadas, por número da linha de origem. */
  const [ajustes, setAjustes] = useState<Record<number, string>>({});


  const recarregar = useCallback(async () => {
    try {
      setDetalhe(await detalheDaOnda(ondaId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [ondaId]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  // Prévia pura, a cada tecla e a cada troca de coluna. Nada sai daqui até alguém
  // mandar — e é isso que impede gravação parcial de uma lista que ninguém conferiu.
  const previa = useMemo<ListaInterpretada>(() => {
    const bruta: ListaInterpretada =
      fonte === 'planilha'
        ? (planilha
            ? linhasDaPlanilha(planilha.grid, planilha.linhaDoCabecalho, colunaDoCodigo, colunaDaQuantidade)
            : { linhas: [], recusadas: [] })
        : fonte === 'pdf'
          ? (previaDoPdf ?? { linhas: [], recusadas: [] })
          : fonte === 'integracao'
            ? { linhas: [], recusadas: [] }
            : interpretarLista(texto);

    return aplicarAjustes(bruta, ajustes);
  }, [fonte, texto, planilha, colunaDoCodigo, colunaDaQuantidade, previaDoPdf, ajustes]);

  /**
   * Corrige UMA linha recusada.
   *
   * Na lista colada a correção reescreve o próprio texto — a fonte continua sendo uma
   * só. Em planilha e PDF não há texto para reescrever, então a correção entra como
   * ajuste por número de linha e é reaplicada sobre a leitura do arquivo.
   */
  const corrigirLinha = useCallback((numero: number, novo: string) => {
    if (fonte === 'colar') {
      setTexto(atual => {
        const linhas = atual.split(/\r?\n/);
        if (numero < 1 || numero > linhas.length) return atual;
        linhas[numero - 1] = novo;
        return linhas.join('\n');
      });
      return;
    }
    setAjustes(a => ({ ...a, [numero]: novo }));
  }, [fonte]);

  /** Lê o arquivo escolhido e joga o resultado no mesmo funil. */
  const receberArquivo = useCallback(async (arquivo: File, tipo: 'planilha' | 'pdf') => {
    setErroDoArquivo(null);
    setAjustes({});
    setLendoArquivo(true);
    try {
      if (tipo === 'planilha') {
        const lida = await lerPlanilha(arquivo);
        setArquivoDaPlanilha(arquivo);
        setPlanilha(lida);
        // Palpite já preenchido; a tela mostra de onde ele veio e pede conferência
        // quando não veio do cabeçalho.
        setColunaDoCodigo(lida.colunas.codigo);
        setColunaDaQuantidade(lida.colunas.quantidade);
        setPreviaDoPdf(null);
        setPdfPronto(null);
      } else {
        const fragmentos = await lerPdf(arquivo);
        const lida = linhasDoPdf(fragmentos);
        setPreviaDoPdf(lida);
        setPdfPronto({ nome: arquivo.name, linhas: lida.linhas.length + lida.recusadas.length });
        setPlanilha(null);
      }
    } catch (e) {
      // PDF escaneado tem mensagem própria: OCR está fora desta etapa, e deixar a
      // pessoa esperando uma prévia que nunca chega seria o pior dos silêncios.
      setErroDoArquivo(
        e instanceof PdfSemTexto ? e.message : e instanceof Error ? e.message : String(e),
      );
      if (tipo === 'planilha') setPlanilha(null); else { setPreviaDoPdf(null); setPdfPronto(null); }
    } finally {
      setLendoArquivo(false);
    }
  }, []);

  /** Troca de aba relê o arquivo: cada aba é uma grade diferente. */
  const trocarAba = useCallback(async (aba: string) => {
    if (!arquivoDaPlanilha) return;
    setLendoArquivo(true);
    setAjustes({});
    try {
      const lida = await lerPlanilha(arquivoDaPlanilha, aba);
      setPlanilha(lida);
      setColunaDoCodigo(lida.colunas.codigo);
      setColunaDaQuantidade(lida.colunas.quantidade);
    } catch (e) {
      setErroDoArquivo(e instanceof Error ? e.message : String(e));
    } finally {
      setLendoArquivo(false);
    }
  }, [arquivoDaPlanilha]);

  const importar = useCallback(async () => {
    if (previa.linhas.length === 0) return;
    setOcupado(true);
    setErro(null);
    const ambiguas: Ambigua[] = [];
    const semProduto: string[] = [];

    try {
      for (const linha of previa.linhas) {
        const r = await adicionarPorCodigo(ondaId, linha.codigo, linha.caixas);
        if (r.status === 'ambiguo') ambiguas.push({ ...linha, candidatos: r.candidatos });
        if (r.status === 'nao_encontrado') semProduto.push(linha.codigo);
      }

      setFila(f => [...f, ...ambiguas]);
      setNaoEncontrados(semProduto);
      // A FONTE FOI CONSUMIDA. O que entrou virou item; o que ficou pendente vira texto
      // para corrigir e reenviar, sem recomeçar a lista do zero.
      //
      // Limpar o arquivo aqui não é arrumação: a prévia dele ainda listaria as linhas já
      // importadas, e um segundo clique em "Adicionar" SOMARIA a mesma demanda ao item
      // que já existe — a onda pediria o dobro sem ninguém digitar nada.
      setTexto(previa.recusadas.map(r => r.texto).join('\n'));
      setAjustes({});
      setPlanilha(null);
      setArquivoDaPlanilha(null);
      setPreviaDoPdf(null);
      setPdfPronto(null);
      setFonte('colar');
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }, [previa, ondaId, recarregar]);

  const escolher = useCallback(async (indice: number, produtoId: string) => {
    const alvo = fila[indice];
    if (!alvo) return;
    setOcupado(true);
    try {
      await adicionarItem(ondaId, produtoId, alvo.caixas);
      setFila(f => f.filter((_, i) => i !== indice));
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }, [fila, ondaId, recarregar]);

  const excluirItem = useCallback(async (itemId: string) => {
    setOcupado(true);
    try {
      await removerItem(itemId);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }, [recarregar]);

  const reservar = useCallback(async () => {
    setOcupado(true);
    setErro(null);
    try {
      setResumo(await reservarOnda(ondaId));
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }, [ondaId, recarregar]);

  const cancelar = useCallback(async () => {
    const texto = 'Cancelar esta onda? O saldo reservado volta a ficar disponível. '
      + 'O que já foi separado NÃO volta para a prateleira.';
    if (!window.confirm(texto)) return;
    setOcupado(true);
    try {
      await cancelarOnda(ondaId);
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setOcupado(false);
    }
  }, [ondaId, recarregar]);

  if (separando) {
    // A separação é uma tela inteira, não um painel a mais: quem está no corredor
    // precisa de um assunto por vez, e o montador não deve ver os controles de edição
    // enquanto confere.
    return <WmsWavePicking ondaId={ondaId} onSair={() => { setSeparando(false); void recarregar(); }} />;
  }

  if (!detalhe) {
    return (
      <Panel>
        <PanelSection><p className="text-sm text-fg-subtle">Carregando a onda…</p></PanelSection>
      </Panel>
    );
  }

  const { onda, itens, rota } = detalhe;
  const rascunho = onda.estado === 'rascunho';
  const encerrada = onda.estado === 'concluida' || onda.estado === 'parcial' || onda.estado === 'cancelada';
  const totalDemandado = itens.reduce((s, i) => s + i.demandadas, 0);

  return (
    <div className="space-y-4">
      <Panel>
        <PanelSection>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={onVoltar}>
                <ArrowLeft aria-hidden className="h-4 w-4" />
                Ondas
              </Button>
              <span className="text-code text-lg font-medium text-fg">{onda.codigo}</span>
              <Badge variant={TOM_DO_ESTADO[onda.estado]}>{ROTULO_DO_ESTADO[onda.estado]}</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!encerrada && (
                <Button variant="secondary" size="sm" onClick={() => void cancelar()} disabled={ocupado}>
                  <X aria-hidden className="h-4 w-4" />
                  Cancelar onda
                </Button>
              )}
              {/* Duas paradas é o mínimo para haver CAMINHO: com uma, há um destino, e
                  para isso o mapa já tem a busca. */}
              {onVerNoMapa && rota.length > 1 && (
                <Button
                  variant="secondary"
                  onClick={() => onVerNoMapa(onda.codigo, rota.map(p => p.endereco))}
                >
                  <Map aria-hidden className="h-4 w-4" />
                  Ver no mapa 3D
                </Button>
              )}
              {!encerrada && !rascunho && rota.length > 0 && (
                <Button onClick={() => setSeparando(true)}>
                  <PlayCircle aria-hidden className="h-4 w-4" />
                  Separar
                </Button>
              )}
              {!encerrada && (
                <Button
                  variant={rascunho ? 'primary' : 'secondary'}
                  onClick={() => void reservar()}
                  disabled={ocupado || itens.length === 0 || fila.length > 0}
                  title={
                    itens.length === 0
                      ? 'Adicione itens antes de reservar'
                      : fila.length > 0
                        ? 'Resolva as escolhas pendentes antes de reservar'
                        : rascunho
                          ? 'Reserva o saldo e monta a rota'
                          : 'Tenta cobrir o que ficou descoberto'
                  }
                >
                  <Layers aria-hidden className="h-4 w-4" />
                  {rascunho ? 'Reservar' : 'Reservar o que faltou'}
                </Button>
              )}
            </div>
          </div>
        </PanelSection>

        {erro && <PanelSection><Notice tone="danger">{erro}</Notice></PanelSection>}

        {resumo && (
          <PanelSection>
            <StatRow>
              <StatCell><Stat label="Demandado" value={`${resumo.demandado}`} context="caixas" /></StatCell>
              <StatCell><Stat label="Reservado" value={`${resumo.alocado}`} context="caixas" /></StatCell>
              <StatCell><Stat label="Paradas" value={`${resumo.paradas}`} context="endereços a visitar" /></StatCell>
            </StatRow>

            {resumo.descoberto > 0 ? (
              <div className="mt-3">
                <Notice tone="warning">
                  <strong>{resumo.descoberto} {plural(resumo.descoberto, 'caixa', 'caixas')} sem saldo
                  disponível.</strong>{' '}
                  O galpão não tem essa quantidade livre agora — ou ela já está prometida a outra onda.
                  A separação pode começar com o que foi reservado; quando a mercadoria chegar, use
                  “Reservar o que faltou”.
                </Notice>
              </div>
            ) : (
              <div className="mt-3">
                <Notice tone="success">
                  Cobertura total: as {resumo.alocado} {plural(resumo.alocado, 'caixa', 'caixas')} estão
                  reservadas e a rota está pronta.
                </Notice>
              </div>
            )}
          </PanelSection>
        )}
      </Panel>

      {rascunho && (
        <>
          <CarregarLista
            fonte={fonte}
            texto={texto}
            previa={previa}
            ocupado={ocupado}
            planilha={planilha}
            colunas={{ codigo: colunaDoCodigo, quantidade: colunaDaQuantidade }}
            pdfPronto={pdfPronto}
            lendoArquivo={lendoArquivo}
            erroDoArquivo={erroDoArquivo}
            onFonte={setFonte}
            onTexto={setTexto}
            onCorrigir={corrigirLinha}
            onImportar={() => void importar()}
            onArquivo={(arquivo, tipo) => void receberArquivo(arquivo, tipo)}
            onColuna={(qual, i) => (qual === 'codigo' ? setColunaDoCodigo(i) : setColunaDaQuantidade(i))}
            onAba={aba => void trocarAba(aba)}
          />

          {naoEncontrados.length > 0 && (
            <Notice tone="warning">
              {naoEncontrados.length === 1
                ? 'Um código não existe no cadastro e ficou de fora: '
                : `${naoEncontrados.length} códigos não existem no cadastro e ficaram de fora: `}
              <span className="text-code">{naoEncontrados.join(', ')}</span>
            </Notice>
          )}

          {fila.length > 0 && (
            <FilaDeEscolha fila={fila} ocupado={ocupado} onEscolher={escolher}
              onDescartar={i => setFila(f => f.filter((_, k) => k !== i))} />
          )}
        </>
      )}

      <ItensDaOnda
        itens={itens}
        total={totalDemandado}
        editavel={rascunho}
        ocupado={ocupado}
        ondaId={ondaId}
        onMudou={() => void recarregar()}
        onErro={setErro}
        onRemover={excluirItem}
      />

      {rota.length > 0 && <RotaDaOnda rota={rota} />}
    </div>
  );
}

// ── Colar e conferir ──────────────────────────────────────────────────────────

function CarregarLista({
  fonte, texto, previa, ocupado, planilha, colunas, pdfPronto, lendoArquivo, erroDoArquivo,
  onFonte, onTexto, onCorrigir, onImportar, onArquivo, onColuna, onAba,
}: {
  fonte: FonteDaLista;
  texto: string;
  previa: ListaInterpretada;
  ocupado: boolean;
  planilha: PlanilhaLida | null;
  colunas: { codigo: number | null; quantidade: number | null };
  pdfPronto: { nome: string; linhas: number } | null;
  lendoArquivo: boolean;
  erroDoArquivo: string | null;
  onFonte: (f: FonteDaLista) => void;
  onTexto: (t: string) => void;
  onCorrigir: (numero: number, novo: string) => void;
  onImportar: () => void;
  onArquivo: (arquivo: File, tipo: 'planilha' | 'pdf') => void;
  onColuna: (qual: 'codigo' | 'quantidade', indice: number | null) => void;
  onAba: (aba: string) => void;
}) {
  const prontas = previa.linhas.length;
  const recusadas = previa.recusadas.length;

  return (
    <Panel>
      <PanelSection>
        <div className="flex items-center gap-2">
          <ClipboardPaste aria-hidden className="h-4 w-4 text-fg-subtle" />
          <h3 className="text-title">Carregar a lista</h3>
        </div>
        <p className="mt-1 text-sm text-fg-muted">
          De onde vier, a lista passa pela mesma conferência antes de virar item da onda.
        </p>

        <div className="mt-3">
          {/* Um funil, quatro portas. A fonte muda o que se vê aqui em cima e nada do
              que vem depois: a prévia, a correção no lugar e a escolha de produto são
              as mesmas para todas. */}
          <SegmentedControl
            label="Origem da lista"
            options={FONTES_DA_LISTA}
            value={fonte}
            onChange={onFonte}
          />
        </div>
      </PanelSection>

      {fonte === 'colar' && (
        <PanelSection>
          <label className="block text-sm font-medium text-fg">Cole aqui</label>
          <p className="mt-1 text-sm text-fg-muted">
            Uma linha por produto: código e quantidade de caixas —{' '}
            <span className="text-code">SKU 10</span>, <span className="text-code">SKU;10</span>,{' '}
            <span className="text-code">SKU,10</span>.
          </p>
          <Textarea
            className="mt-2 min-h-[8rem] font-mono text-sm"
            value={texto}
            onChange={e => onTexto(e.target.value)}
            placeholder={'TBGCM55-14 10\nGFGCM13-20;4'}
            spellCheck={false}
          />
        </PanelSection>
      )}

      {fonte === 'planilha' && (
        <PanelSection>
          <label className="block text-sm font-medium text-fg">Arquivo da planilha</label>
          <p className="mt-1 text-sm text-fg-muted">
            <span className="text-code">.xlsx</span>, <span className="text-code">.xls</span> ou{' '}
            <span className="text-code">.csv</span>. Nada é gravado até você conferir a prévia.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="mt-2 block w-full text-sm text-fg-muted file:mr-3 file:rounded-control file:border file:border-edge file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-2"
            onChange={e => { const f = e.target.files?.[0]; if (f) onArquivo(f, 'planilha'); }}
            disabled={lendoArquivo || ocupado}
          />

          {planilha && (
            <div className="mt-3 space-y-3">
              {planilha.abas.length > 1 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-fg-muted">Aba</label>
                  <Select value={planilha.abaAtiva} onChange={e => onAba(e.target.value)}>
                    {planilha.abas.map(a => <option key={a} value={a}>{a}</option>)}
                  </Select>
                </div>
              )}

              {/* Os seletores aparecem SEMPRE, já preenchidos. Planilha lida ao contrário
                  importa quantidade como código e vice-versa — e esse erro entra calado,
                  para só aparecer quando o separador já está no corredor. Conferir duas
                  caixas de seleção custa dois segundos. */}
              <div className="grid gap-3 sm:grid-cols-2">
                <SeletorDeColuna
                  rotulo="Coluna do código"
                  valor={colunas.codigo}
                  origem={planilha.colunas.origemDoCodigo}
                  planilha={planilha}
                  onChange={i => onColuna('codigo', i)}
                />
                <SeletorDeColuna
                  rotulo="Coluna da quantidade"
                  valor={colunas.quantidade}
                  origem={planilha.colunas.origemDaQuantidade}
                  planilha={planilha}
                  onChange={i => onColuna('quantidade', i)}
                />
              </div>

              {planilha.truncada && (
                <Notice tone="warning">
                  A planilha é muito grande e foi lida só em parte. Divida em arquivos menores.
                </Notice>
              )}
            </div>
          )}
        </PanelSection>
      )}

      {fonte === 'pdf' && (
        <PanelSection>
          <label className="block text-sm font-medium text-fg">Arquivo PDF</label>
          <p className="mt-1 text-sm text-fg-muted">
            O texto é lido na ordem da página — linha por linha, da esquerda para a direita.
          </p>
          <input
            type="file"
            accept=".pdf"
            className="mt-2 block w-full text-sm text-fg-muted file:mr-3 file:rounded-control file:border file:border-edge file:bg-surface-3 file:px-3 file:py-2 file:text-sm file:font-medium file:text-fg hover:file:bg-surface-2"
            onChange={e => { const f = e.target.files?.[0]; if (f) onArquivo(f, 'pdf'); }}
            disabled={lendoArquivo || ocupado}
          />
          {pdfPronto && (
            <p className="mt-2 text-sm text-fg-muted">
              <span className="text-code">{pdfPronto.nome}</span> — {pdfPronto.linhas}{' '}
              {plural(pdfPronto.linhas, 'linha lida', 'linhas lidas')}.
            </p>
          )}
        </PanelSection>
      )}

      {fonte === 'integracao' && (
        <PanelSection>
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-fg">Importação automática</h4>
            <Badge variant="neutral">Em breve</Badge>
          </div>
          {/* Opção visível e desligada, de propósito: ela diz onde a integração vai
              entrar sem prometer que já funciona. */}
          <p className="mt-1 text-sm text-fg-muted">
            A lista virá direto do sistema de pedidos, sem passar por arquivo. Ainda não está
            disponível — use colar, planilha ou PDF.
          </p>
        </PanelSection>
      )}

      {lendoArquivo && (
        <PanelSection><p className="text-sm text-fg-subtle">Lendo o arquivo…</p></PanelSection>
      )}

      {erroDoArquivo && (
        <PanelSection><Notice tone="warning">{erroDoArquivo}</Notice></PanelSection>
      )}

      {(prontas > 0 || recusadas > 0) && (
        <PanelSection>
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-fg-muted">
              <strong className="text-fg">{prontas}</strong>{' '}
              {plural(prontas, 'linha pronta', 'linhas prontas')}
              {recusadas > 0 && (
                <> · <strong className="text-fg">{recusadas}</strong>{' '}
                  {plural(recusadas, 'precisa', 'precisam')} de atenção</>
              )}
            </span>
            <Button size="sm" onClick={onImportar} disabled={ocupado || prontas === 0}>
              <Check aria-hidden className="h-4 w-4" />
              Adicionar {prontas > 0 ? `${prontas} ${plural(prontas, 'item', 'itens')}` : ''}
            </Button>
          </div>
        </PanelSection>
      )}

      {recusadas > 0 && (
        <PanelSection>
          <div className="flex items-center gap-2">
            <AlertTriangle aria-hidden className="h-4 w-4 text-amber-500" />
            <h4 className="text-sm font-semibold text-fg">Corrija aqui mesmo</h4>
          </div>
          {/* Vale para as três fontes. Quem subiu planilha não tem texto para corrigir,
              e mandar voltar ao Excel por causa de uma linha é o atrito que faz a
              importação ser abandonada no meio. O número é o da linha de ORIGEM. */}
          <ul className="mt-2 space-y-2">
            {previa.recusadas.map(r => (
              <li key={r.linha} className="flex flex-wrap items-center gap-2">
                <span className="text-code w-10 shrink-0 text-xs text-fg-subtle">{r.linha}</span>
                <Input
                  className="min-w-[12rem] flex-1 font-mono text-sm"
                  value={r.texto}
                  onChange={e => onCorrigir(r.linha, e.target.value)}
                  spellCheck={false}
                />
                <span className="text-xs text-fg-muted">{MOTIVO_DA_RECUSA[r.motivo]}</span>
              </li>
            ))}
          </ul>
        </PanelSection>
      )}
    </Panel>
  );
}

/** Uma coluna da planilha, com o palpite já escolhido e o aviso quando ele é só palpite. */
function SeletorDeColuna({
  rotulo, valor, origem, planilha, onChange,
}: {
  rotulo: string;
  valor: number | null;
  origem: OrigemDaColuna;
  planilha: PlanilhaLida;
  onChange: (indice: number | null) => void;
}) {
  const cabecalho = planilha.grid[planilha.linhaDoCabecalho] ?? [];
  const largura = planilha.grid.reduce((m, l) => Math.max(m, l?.length ?? 0), 0);
  const amostra = valor === null
    ? null
    : String(planilha.grid[planilha.linhaDoCabecalho + 1]?.[valor] ?? '').trim();

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <label className="text-xs font-medium text-fg-muted">{rotulo}</label>
        {origem !== 'cabecalho' && <Badge variant="warning">confira</Badge>}
      </div>
      <Select
        value={valor === null ? '' : String(valor)}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
      >
        <option value="">— escolher —</option>
        {Array.from({ length: largura }, (_, i) => {
          const titulo = String(cabecalho[i] ?? '').trim();
          return (
            <option key={i} value={i}>
              {titulo !== '' ? titulo : `Coluna ${i + 1}`}
            </option>
          );
        })}
      </Select>
      {amostra !== null && amostra !== '' && (
        // A primeira célula de dados é a prova de que a coluna certa foi escolhida —
        // mais útil que o nome do cabeçalho quando o cabeçalho é genérico.
        <p className="mt-1 truncate text-xs text-fg-subtle">
          1ª linha: <span className="text-code">{amostra}</span>
        </p>
      )}
    </div>
  );
}

// ── Escolha de produto ────────────────────────────────────────────────────────

function FilaDeEscolha({
  fila, ocupado, onEscolher, onDescartar,
}: {
  fila: Ambigua[];
  ocupado: boolean;
  onEscolher: (indice: number, produtoId: string) => void;
  onDescartar: (indice: number) => void;
}) {
  return (
    <Panel>
      <PanelSection>
        <h3 className="text-title">Qual é o produto?</h3>
        {/* O cadastro tem EANs repetidos entre produtos. Escolher o primeiro em
            silêncio seria separar o errado com a bênção do sistema. */}
        <p className="mt-1 text-sm text-fg-muted">
          {fila.length === 1 ? 'Um código casou' : `${fila.length} códigos casaram`} com mais de um
          produto do cadastro. Escolha qual entra na onda.
        </p>
      </PanelSection>

      {fila.map((a, i) => (
        <PanelSection key={`${a.codigo}-${i}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-fg">
              <span className="text-code">{a.codigo}</span> · {a.caixas}{' '}
              {plural(a.caixas, 'caixa', 'caixas')}
            </span>
            <Button variant="ghost" size="sm" onClick={() => onDescartar(i)} disabled={ocupado}>
              Deixar de fora
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            {a.candidatos.map(c => (
              <button
                key={c.produtoId}
                type="button"
                disabled={ocupado}
                onClick={() => onEscolher(i, c.produtoId)}
                className="flex w-full items-center gap-3 rounded-control px-2 py-2 text-left transition-colors hover:bg-surface-3 disabled:opacity-50"
              >
                <span className="text-code text-sm text-fg">{c.sku}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{c.nome}</span>
                {c.ean && <span className="text-code text-xs text-fg-subtle">{c.ean}</span>}
              </button>
            ))}
          </div>
        </PanelSection>
      ))}
    </Panel>
  );
}

// ── Itens ─────────────────────────────────────────────────────────────────────

function ItensDaOnda({
  itens, total, editavel, ocupado, ondaId, onMudou, onErro, onRemover,
}: {
  itens: DetalheDaOnda['itens'];
  total: number;
  editavel: boolean;
  ocupado: boolean;
  ondaId: string;
  onMudou: () => void;
  onErro: (m: string) => void;
  onRemover: (itemId: string) => void;
}) {
  const [busca, setBusca] = useState('');
  const [achados, setAchados] = useState<ProductOption[]>([]);
  const [escolhido, setEscolhido] = useState<ProductOption | null>(null);
  const [caixas, setCaixas] = useState('1');

  useEffect(() => {
    if (busca.trim().length < 2) { setAchados([]); return; }
    let cancelado = false;
    const t = setTimeout(() => {
      searchProducts(busca).then(r => { if (!cancelado) setAchados(r); }).catch(() => undefined);
    }, 250);
    return () => { cancelado = true; clearTimeout(t); };
  }, [busca]);

  const adicionar = useCallback(async () => {
    if (!escolhido) return;
    const n = Number(caixas);
    if (!Number.isInteger(n) || n <= 0) { onErro('Quantidade precisa ser um número inteiro de caixas.'); return; }
    try {
      await adicionarItem(ondaId, escolhido.id, n);
      setEscolhido(null); setBusca(''); setAchados([]); setCaixas('1');
      onMudou();
    } catch (e) {
      onErro(e instanceof Error ? e.message : String(e));
    }
  }, [escolhido, caixas, ondaId, onMudou, onErro]);

  return (
    <Panel>
      <PanelSection>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-title">O que sai</h3>
          <span className="text-sm text-fg-muted">
            <strong className="text-fg">{total}</strong> {plural(total, 'caixa', 'caixas')} em{' '}
            {itens.length} {plural(itens.length, 'item', 'itens')}
          </span>
        </div>
      </PanelSection>

      {itens.length === 0 ? (
        <PanelSection>
          <p className="text-sm text-fg-muted">
            Nenhum item ainda. Cole a lista acima ou busque o produto abaixo.
          </p>
        </PanelSection>
      ) : (
        <PanelSection padding="sm">
          <Table>
            <Thead>
              <Tr>
                <Th>SKU</Th>
                <Th className="text-right">Pedido</Th>
                <Th className="text-right">Reservado</Th>
                <Th className="text-right">Separado</Th>
                {editavel && <Th className="text-right">Remover</Th>}
              </Tr>
            </Thead>
            <tbody>
              {itens.map(i => (
                <Tr key={i.id}>
                  <Td><span className="text-code">{i.sku}</span></Td>
                  <Td className="text-right text-code">{i.demandadas}</Td>
                  <Td className="text-right text-code">
                    {i.alocadas}
                    {i.estado === 'sem_saldo' && (
                      <Badge variant="warning" className="ml-2">sem saldo</Badge>
                    )}
                    {i.estado === 'parcial' && i.alocadas < i.demandadas && (
                      <Badge variant="warning" className="ml-2">parcial</Badge>
                    )}
                  </Td>
                  <Td className="text-right text-code">{i.separadas}</Td>
                  {editavel && (
                    <Td className="text-right">
                      <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => onRemover(i.id)}>
                        <Trash2 aria-hidden className="h-4 w-4" />
                      </Button>
                    </Td>
                  )}
                </Tr>
              ))}
            </tbody>
          </Table>
        </PanelSection>
      )}

      {editavel && (
        <PanelSection>
          {/* Digitar três itens não pode exigir colar uma lista. */}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[14rem] flex-1">
              <label className="mb-1 block text-xs font-medium text-fg-muted">Buscar produto</label>
              <Input
                value={escolhido ? `${escolhido.sku} — ${escolhido.name}` : busca}
                onChange={e => { setEscolhido(null); setBusca(e.target.value); }}
                placeholder="SKU, nome ou EAN"
              />
            </div>
            <div className="w-24">
              <label className="mb-1 block text-xs font-medium text-fg-muted">Caixas</label>
              <Input value={caixas} inputMode="numeric" onChange={e => setCaixas(e.target.value)} />
            </div>
            <Button size="sm" onClick={() => void adicionar()} disabled={!escolhido || ocupado}>
              <Plus aria-hidden className="h-4 w-4" />
              Adicionar
            </Button>
          </div>

          {!escolhido && achados.length > 0 && (
            <ul className="mt-2 space-y-1">
              {achados.slice(0, 8).map(p => (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => { setEscolhido(p); setAchados([]); }}
                    className="flex w-full items-center gap-3 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-3"
                  >
                    <span className="text-code text-sm text-fg">{p.sku}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-fg-muted">{p.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      )}
    </Panel>
  );
}

// ── Rota ──────────────────────────────────────────────────────────────────────

function RotaDaOnda({ rota }: { rota: DetalheDaOnda['rota'] }) {
  const pendentes = rota.filter(p => p.estado === 'pendente' || p.estado === 'parcial').length;

  return (
    <Panel>
      <PanelSection>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-title">Rota</h3>
          <span className="text-sm text-fg-muted">
            {rota.length} {plural(rota.length, 'parada', 'paradas')} · {pendentes}{' '}
            {plural(pendentes, 'pendente', 'pendentes')}
          </span>
        </div>
        {/* A ordem vem do banco: rua, módulo, nível. Reordenar aqui desalinharia a lista
            do operador do traçado do mapa 3D. */}
        <p className="mt-1 text-sm text-fg-muted">
          Na ordem de caminhada do galpão — rua, módulo e nível.
        </p>
      </PanelSection>

      <PanelSection padding="sm">
        <Table>
          <Thead>
            <Tr>
              <Th className="w-12">#</Th>
              <Th>Endereço</Th>
              <Th>SKU</Th>
              <Th className="text-right">Pegar</Th>
              <Th className="text-right">Separado</Th>
              <Th>Situação</Th>
            </Tr>
          </Thead>
          <tbody>
            {rota.map(p => (
              <Tr key={p.alocacaoId}>
                <Td className="text-code text-fg-subtle">{p.sequencia}</Td>
                <Td>
                  <span className="text-code">{p.endereco}</span>
                  {p.enderecoBloqueado && <Badge variant="danger" className="ml-2">bloqueado</Badge>}
                </Td>
                <Td><span className="text-code">{p.sku}</span></Td>
                <Td className="text-right text-code">{p.caixas}</Td>
                <Td className="text-right text-code">{p.separadas}</Td>
                <Td>
                  {p.estado === 'ruptura' ? (
                    <Badge variant="warning">
                      <RotateCcw aria-hidden className="h-3 w-3" />
                      sem mercadoria
                    </Badge>
                  ) : p.estado === 'separado' ? (
                    <Badge variant="success">separado</Badge>
                  ) : p.estado === 'parcial' ? (
                    <Badge variant="accent">parcial</Badge>
                  ) : p.estado === 'cancelado' ? (
                    <Badge variant="neutral">cancelado</Badge>
                  ) : (
                    <Badge variant="neutral">a separar</Badge>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </PanelSection>
    </Panel>
  );
}
