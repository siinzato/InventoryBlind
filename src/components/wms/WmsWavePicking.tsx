// A tela de quem separa. Celular na mão, coletor no cinto, carrinho no corredor.
//
// ── O que manda no desenho ────────────────────────────────────────────────────
// Quem usa está de pé, andando, às vezes com luva, quase sempre com uma das mãos
// ocupada. Isso decide tudo: um assunto por vez na tela, alvo de toque grande, zero
// dependência de mouse ou de passar o cursor por cima, e nunca rolagem horizontal.
//
// ── Leitura híbrida, porque o chão de galpão é híbrido ────────────────────────
// Coletor com leitor laser se comporta como teclado: ele digita o código e manda um
// Enter. Celular não tem leitor e usa a câmera. Os dois caminhos chegam no MESMO campo,
// e o campo fica pronto para receber leitura sem roubar o teclado de quem está digitando
// a quantidade — foco devolvido só quando o passo é de leitura.
//
// ── Cegueira de identidade ────────────────────────────────────────────────────
// A parada pendente mostra ENDEREÇO e QUANTIDADE. Nunca o SKU, nunca o nome, nunca o
// EAN. O operador bipa o que encontrou e o banco diz se é o certo — sem revelar qual
// era. Mostrar o SKU transformaria a conferência em "procure até achar o que a tela
// pediu", que é o contrário de conferir. O nome aparece DEPOIS da baixa, como recibo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Camera, Check, CircleSlash, Flag, Keyboard, Loader2, MapPin, PackageCheck,
} from 'lucide-react';
import { Badge, Button, Input, Modal, Notice, Panel, PanelSection } from '../ui';
import { plural } from '../../lib/formatPtBr';
import { WmsBinScanner } from './WmsBinScanner';
import {
  candidatosNaOnda, chaveDaTentativa, classificarQuantidade, enderecoConfere, etapaDaBipagem,
  progressoDaRota, type ItemBipavel,
} from '../../lib/wms/pickingScan';
import {
  concluirOnda, declararRuptura, detalheDaOnda, paradasPendentes, separarParada,
  type DetalheDaOnda, type ParadaDaOnda, type ResultadoDaBipagem,
} from '../../lib/wms/pickingService';

/** Mensagem que o operador lê depois de cada ação. */
interface Aviso {
  tom: 'success' | 'warning' | 'danger' | 'neutral';
  texto: string;
}

const AVISO_POR_DESFECHO: Record<string, Aviso> = {
  endereco_errado:        { tom: 'danger',  texto: 'Endereço errado. Confira a etiqueta da vaga.' },
  produto_errado:         { tom: 'danger',  texto: 'Este produto não é o desta parada. Devolva à prateleira.' },
  quantidade_divergente:  { tom: 'warning', texto: 'Quantidade acima do esperado nesta parada.' },
  duplicado:              { tom: 'neutral', texto: 'Esta leitura já tinha sido registrada.' },
  ambiguo:                { tom: 'warning', texto: 'Mais de um produto responde por este código.' },
};

export function WmsWavePicking({ ondaId, onSair }: { ondaId: string; onSair: () => void }) {
  const [detalhe, setDetalhe] = useState<DetalheDaOnda | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  // ── Estado da parada em curso ───────────────────────────────────────────────
  const [enderecoOk, setEnderecoOk] = useState(false);
  const [produtoOk, setProdutoOk] = useState<string | null>(null);
  const [leitura, setLeitura] = useState('');
  const [caixas, setCaixas] = useState('');
  const [tentativa, setTentativa] = useState(1);
  const [candidatos, setCandidatos] = useState<ItemBipavel[] | null>(null);
  const [camera, setCamera] = useState<'endereco' | 'produto' | null>(null);
  const [confirmandoRuptura, setConfirmandoRuptura] = useState(false);
  const [confirmandoFim, setConfirmandoFim] = useState(false);

  /**
   * Trava de reentrada.
   *
   * Não é só o botão desabilitado: o leitor laser dispara `Enter` sozinho e um bipe
   * duplo chega antes do React re-renderizar. O ref responde no mesmo tique.
   */
  const emVoo = useRef(false);
  const [ocupado, setOcupado] = useState(false);

  /**
   * O campo de leitura, pelo id.
   *
   * `Input` é primitivo compartilhado de toda a aplicação e não encaminha `ref`.
   * Ensiná-lo a encaminhar seria mexer numa peça usada em dezenas de telas por causa de
   * uma, e esta tela precisa de UMA coisa: devolver o foco ao campo depois de cada
   * leitura, para o próximo bipe do coletor cair no lugar certo.
   */
  const CAMPO_DE_LEITURA = 'wms-leitura-da-parada';
  const focarCampo = useCallback(() => {
    document.getElementById(CAMPO_DE_LEITURA)?.focus();
  }, []);

  const recarregar = useCallback(async () => {
    try {
      setDetalhe(await detalheDaOnda(ondaId));
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, [ondaId]);

  useEffect(() => { void recarregar(); }, [recarregar]);

  // Memo próprio: `?? []` cria um array novo a cada render, e os memos abaixo
  // recalculariam a rota inteira a cada tecla digitada na quantidade.
  const rota = useMemo(() => detalhe?.rota ?? [], [detalhe]);
  const pendentes = useMemo(() => paradasPendentes(rota), [rota]);
  const parada: ParadaDaOnda | null = pendentes[0] ?? null;
  const progresso = useMemo(() => progressoDaRota(rota), [rota]);

  /** O que pode ser bipado nesta onda — sem revelar o que é esperado AGORA. */
  const itensBipaveis = useMemo<ItemBipavel[]>(
    () => rota.map(p => ({ produtoId: p.produtoId, sku: p.sku, ean: p.ean })),
    [rota],
  );

  const etapa = etapaDaBipagem({ enderecoConfirmado: enderecoOk, produtoConfirmado: produtoOk });

  // Zera a conferência ao trocar de parada: endereço confirmado de uma vaga não vale
  // para a seguinte, e herdar isso daria baixa na vaga errada com um bipe só.
  const paradaId = parada?.alocacaoId ?? null;
  useEffect(() => {
    setEnderecoOk(false);
    setProdutoOk(null);
    setLeitura('');
    setCaixas('');
    setTentativa(1);
    setCandidatos(null);
  }, [paradaId]);

  // Foco de volta ao campo quando o passo é de LEITURA. Na etapa de quantidade o foco
  // fica onde o operador o colocou: roubá-lo no meio da digitação é como se perde o
  // número que já estava quase pronto.
  useEffect(() => {
    if (etapa !== 'quantidade' && !camera && !ocupado) focarCampo();
  }, [etapa, camera, ocupado, paradaId, focarCampo]);

  const enviar = useCallback(async (
    acao: 'separar' | 'ruptura',
    quantidade: number,
    codigo: string,
  ) => {
    if (!parada || emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    setErro(null);

    const chave = chaveDaTentativa(parada.alocacaoId, acao, quantidade, tentativa);

    try {
      const r: ResultadoDaBipagem = acao === 'ruptura'
        ? await declararRuptura({
            alocacaoId: parada.alocacaoId,
            enderecoBipado: parada.endereco,
            origem: 'manual',
            chaveDeIdempotencia: chave,
          })
        : await separarParada({
            alocacaoId: parada.alocacaoId,
            caixas: quantidade,
            enderecoBipado: parada.endereco,
            codigoBipado: codigo,
            origem: 'scanner',
            chaveDeIdempotencia: chave,
          });

      if (r.desfecho === 'ok') {
        const nome = parada.produto || parada.sku;
        setAviso({
          tom: 'success',
          texto: r.repetida
            ? 'Leitura repetida: já estava registrada, nada saiu duas vezes.'
            : `${quantidade} ${plural(quantidade, 'caixa', 'caixas')} de ${nome} — baixa registrada.`,
        });
      } else if (r.desfecho === 'ruptura') {
        setAviso({
          tom: 'warning',
          texto: r.realocado > 0
            ? `Falta registrada. ${r.realocado} ${plural(r.realocado, 'caixa foi realocada', 'caixas foram realocadas')} para outro endereço — a rota ganhou parada nova.`
            : 'Falta registrada. Não há outro endereço com saldo disponível para cobrir.',
        });
      } else {
        setAviso(
          r.mensagem
            ? { tom: r.desfecho === 'quantidade_divergente' ? 'warning' : 'danger', texto: r.mensagem }
            : AVISO_POR_DESFECHO[r.desfecho] ?? { tom: 'danger', texto: 'Leitura recusada.' },
        );
      }

      // Recusa não encerra a parada: o operador corrige e bipa de novo, e a próxima
      // tentativa precisa de chave nova — senão o banco devolveria o resultado da
      // anterior achando que é reenvio.
      setTentativa(t => t + 1);
      setProdutoOk(null);
      setLeitura('');
      setCaixas('');
      await recarregar();
    } catch (e) {
      // Falha de REDE, não recusa de negócio: a mesma ação pode ser reenviada com a
      // MESMA chave, e o banco reconhece. Por isso a tentativa não avança aqui.
      setErro(
        e instanceof Error
          ? `${e.message} — toque de novo: a leitura é reenviada sem risco de baixa dupla.`
          : String(e),
      );
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }, [parada, tentativa, recarregar]);

  /**
   * O produto bipado serve para ESTA parada?
   *
   * ── Por que a recusa é imediata, e não só no banco ─────────────────────────
   * A conferência de verdade continua sendo do banco — ele recusa e grava o evento. Mas
   * se a tela só descobrisse no "Confirmar", o operador contaria as caixas, digitaria a
   * quantidade e só então ouviria que pegou o produto errado. Quem está no corredor
   * desiste de conferir quando conferir custa isso.
   *
   * ── O que isto NÃO entrega ─────────────────────────────────────────────────
   * A recusa não diz qual era o produto certo, e a comparação usa o item da PARADA — a
   * mesma informação que a rota já traz para o cliente. A cegueira continua sendo de
   * tela, como está escrito em `pickingScan.ts`.
   */
  const aceitarProduto = useCallback((codigo: string) => {
    if (!parada) return;
    const daParada: ItemBipavel = { produtoId: parada.produtoId, sku: parada.sku, ean: parada.ean };

    if (candidatosNaOnda(codigo, [daParada]).length === 0) {
      setAviso({ tom: 'danger', texto: 'Este produto não é o desta parada. Devolva à prateleira.' });
      setLeitura('');
      return;
    }

    setProdutoOk(codigo);
    setLeitura('');
    // Parada de uma caixa: a quantidade é óbvia e digitá-la é só atrito.
    if (parada.restantes === 1) setCaixas('1');
  }, [parada]);

  /** Uma leitura chegou — do laser (com Enter), da câmera ou digitada. */
  const receberLeitura = useCallback((bruto: string) => {
    if (!parada) return;
    const valor = bruto.trim();
    if (valor === '') return;
    setAviso(null);

    if (etapa === 'endereco') {
      if (enderecoConfere(valor, parada.endereco)) {
        setEnderecoOk(true);
        setLeitura('');
        return;
      }
      // Não vai ao banco: a parada ativa é conhecida e o endereço errado não tem o que
      // conferir lá. O que o banco registra é a tentativa de BAIXA, e aqui não houve.
      setAviso({ tom: 'danger', texto: `A etiqueta lida não é a de ${parada.endereco}.` });
      setLeitura('');
      return;
    }

    if (etapa === 'produto') {
      const achados = candidatosNaOnda(valor, itensBipaveis);
      if (achados.length > 1) {
        // EAN repetido entre produtos da onda: pergunta em vez de escolher.
        setCandidatos(achados);
        return;
      }
      aceitarProduto(valor);
    }
  }, [parada, etapa, itensBipaveis, aceitarProduto]);

  const confirmarSeparacao = useCallback(() => {
    if (!parada || !produtoOk) return;
    const n = Number(caixas);
    if (classificarQuantidade(n, parada.restantes) === 'invalida') {
      setAviso({ tom: 'warning', texto: 'Informe um número inteiro de caixas.' });
      return;
    }
    void enviar('separar', n, produtoOk);
  }, [parada, produtoOk, caixas, enviar]);

  const finalizar = useCallback(async () => {
    setConfirmandoFim(false);
    if (emVoo.current) return;
    emVoo.current = true;
    setOcupado(true);
    try {
      const r = await concluirOnda(ondaId);
      setAviso({
        tom: r.estado === 'concluida' ? 'success' : 'warning',
        texto: r.estado === 'concluida'
          ? 'Onda concluída: tudo que foi pedido saiu.'
          : `Onda encerrada com falta de ${r.faltou} ${plural(r.faltou, 'caixa', 'caixas')}. O saldo reservado voltou a ficar disponível.`,
      });
      await recarregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      emVoo.current = false;
      setOcupado(false);
    }
  }, [ondaId, recarregar]);

  if (!detalhe) {
    return <Panel><PanelSection><p className="text-sm text-fg-subtle">Carregando a onda…</p></PanelSection></Panel>;
  }

  const { onda } = detalhe;
  const encerrada = onda.estado === 'concluida' || onda.estado === 'parcial' || onda.estado === 'cancelada';
  const faltaFechar = pendentes.length > 0 || progresso.caixasSeparadas < progresso.caixasPedidas;

  return (
    <div className="space-y-4">
      {/* ── Cabeçalho: onde estou e quanto falta ──────────────────────────── */}
      <Panel>
        <PanelSection>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={onSair}>
                <ArrowLeft aria-hidden className="h-4 w-4" />
                Sair
              </Button>
              <span className="text-code text-lg font-medium text-fg">{onda.codigo}</span>
            </div>
            <span className="text-sm text-fg-muted">
              <strong className="text-fg">{progresso.caixasSeparadas}</strong> de{' '}
              {progresso.caixasPedidas} {plural(progresso.caixasPedidas, 'caixa', 'caixas')} ·{' '}
              {progresso.paradasEncerradas}/{progresso.paradasTotais}{' '}
              {plural(progresso.paradasTotais, 'parada', 'paradas')}
            </span>
          </div>

          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{ width: `${progresso.percentual}%` }}
              role="progressbar"
              aria-valuenow={progresso.percentual}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progresso da separação"
            />
          </div>
        </PanelSection>
      </Panel>

      {erro && <Notice tone="danger">{erro}</Notice>}
      {aviso && <Notice tone={aviso.tom}>{aviso.texto}</Notice>}

      {/* ── A parada ativa ─────────────────────────────────────────────────── */}
      {parada ? (
        <Panel>
          <PanelSection>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-fg-subtle">
                  <MapPin aria-hidden className="h-4 w-4" />
                  <span className="text-label">Vá até</span>
                </div>
                {/* O endereço é o maior elemento da tela, e é para ser lido de longe,
                    com o aparelho na mão e o carrinho andando. */}
                <p className="text-code mt-1 break-all text-3xl font-semibold leading-tight text-fg sm:text-4xl">
                  {parada.endereco}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <span className="text-label">Pegue</span>
                <p className="text-code text-3xl font-semibold leading-tight text-fg sm:text-4xl">
                  {parada.restantes}
                </p>
                <span className="text-xs text-fg-muted">
                  {plural(parada.restantes, 'caixa', 'caixas')}
                  {parada.unidadesPorCaixa ? ` · ${parada.unidadesPorCaixa} un/cx` : ''}
                </span>
              </div>
            </div>

            {parada.separadas > 0 && (
              <p className="mt-2 text-sm text-fg-muted">
                Já separadas nesta parada: <strong className="text-fg">{parada.separadas}</strong> de{' '}
                {parada.caixas}.
              </p>
            )}
            {parada.enderecoBloqueado && (
              <div className="mt-3"><Notice tone="warning">Endereço bloqueado — retirar é permitido.</Notice></div>
            )}
          </PanelSection>

          {/* ── Passo a passo ────────────────────────────────────────────── */}
          <PanelSection>
            <Passos etapa={etapa} />

            {etapa !== 'quantidade' ? (
              <div className="mt-3 space-y-2">
                <label className="block text-sm font-medium text-fg">
                  {etapa === 'endereco' ? 'Bipe a etiqueta da vaga' : 'Bipe o código do produto'}
                </label>
                <div className="flex gap-2">
                  <Input
                    id={CAMPO_DE_LEITURA}
                    value={leitura}
                    onChange={e => setLeitura(e.target.value)}
                    onKeyDown={e => {
                      // O leitor laser do coletor "digita" e manda Enter. É o mesmo
                      // caminho de quem digita à mão — um fluxo, não dois.
                      if (e.key === 'Enter') { e.preventDefault(); receberLeitura(leitura); }
                    }}
                    placeholder={etapa === 'endereco' ? 'PP-A01-N1' : 'EAN ou SKU'}
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="h-12 flex-1 text-base"
                    disabled={ocupado}
                  />
                  <Button
                    variant="secondary"
                    className="h-12 px-4"
                    onClick={() => setCamera(etapa === 'endereco' ? 'endereco' : 'produto')}
                    disabled={ocupado}
                    aria-label="Ler com a câmera"
                  >
                    <Camera aria-hidden className="h-5 w-5" />
                  </Button>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
                  <Keyboard aria-hidden className="h-3.5 w-3.5" />
                  Leitor do coletor já funciona aqui: bipe e o campo recebe sozinho.
                </p>
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <label className="block text-sm font-medium text-fg">Quantas caixas você tirou?</label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    className="h-12 w-12 text-xl"
                    onClick={() => setCaixas(c => String(Math.max(1, (Number(c) || 0) - 1)))}
                    disabled={ocupado}
                    aria-label="Menos uma caixa"
                  >−</Button>
                  <Input
                    value={caixas}
                    onChange={e => setCaixas(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); confirmarSeparacao(); } }}
                    inputMode="numeric"
                    className="text-code h-12 w-20 text-center text-xl"
                    disabled={ocupado}
                  />
                  <Button
                    variant="secondary"
                    className="h-12 w-12 text-xl"
                    onClick={() => setCaixas(c => String(Math.min(parada.restantes, (Number(c) || 0) + 1)))}
                    disabled={ocupado}
                    aria-label="Mais uma caixa"
                  >+</Button>
                  <span className="text-sm text-fg-muted">de {parada.restantes}</span>
                </div>

                <Button className="h-12 w-full text-base" onClick={confirmarSeparacao} disabled={ocupado || caixas === ''}>
                  {ocupado
                    ? <Loader2 aria-hidden className="h-5 w-5 animate-spin" />
                    : <Check aria-hidden className="h-5 w-5" />}
                  Confirmar
                </Button>

                {Number(caixas) > 0 && Number(caixas) < parada.restantes && (
                  <p className="text-xs text-fg-muted">
                    Parcial: a parada continua aberta com{' '}
                    {parada.restantes - Number(caixas)}{' '}
                    {plural(parada.restantes - Number(caixas), 'caixa', 'caixas')} para depois.
                  </p>
                )}
              </div>
            )}
          </PanelSection>

          <PanelSection padding="sm">
            <Button
              variant="ghost"
              className="w-full justify-center text-fg-muted"
              onClick={() => setConfirmandoRuptura(true)}
              disabled={ocupado}
            >
              <CircleSlash aria-hidden className="h-4 w-4" />
              Não tem mercadoria aqui
            </Button>
          </PanelSection>
        </Panel>
      ) : (
        <Panel>
          <PanelSection>
            <div className="flex items-center gap-2">
              <PackageCheck aria-hidden className="h-5 w-5 text-emerald-500" />
              <h3 className="text-title">
                {encerrada ? 'Onda encerrada' : 'Nenhuma parada pendente'}
              </h3>
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              {encerrada
                ? 'Esta onda já foi fechada.'
                : 'Tudo que dava para separar foi separado. Feche a onda para liberar o que sobrou de reserva.'}
            </p>
          </PanelSection>
        </Panel>
      )}

      {/* ── Próximas paradas ───────────────────────────────────────────────── */}
      {pendentes.length > 1 && (
        <Panel>
          <PanelSection padding="sm">
            <span className="text-label">A seguir</span>
            {/* Só endereço e quantidade: a lista serve para planejar o caminho, e trazer
                o SKU aqui furaria a cegueira da próxima parada. */}
            <ul className="mt-2 space-y-1">
              {pendentes.slice(1, 5).map(p => (
                <li key={p.alocacaoId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-code text-fg-muted">{p.endereco}</span>
                  <span className="text-code text-fg-subtle">
                    {p.restantes} {plural(p.restantes, 'cx', 'cx')}
                  </span>
                </li>
              ))}
            </ul>
            {pendentes.length > 5 && (
              <p className="mt-2 text-xs text-fg-subtle">
                e mais {pendentes.length - 5} {plural(pendentes.length - 5, 'parada', 'paradas')}.
              </p>
            )}
          </PanelSection>
        </Panel>
      )}

      {!encerrada && (
        <Button
          variant="secondary"
          className="h-12 w-full"
          onClick={() => (faltaFechar ? setConfirmandoFim(true) : void finalizar())}
          disabled={ocupado}
        >
          <Flag aria-hidden className="h-4 w-4" />
          Encerrar a onda
        </Button>
      )}

      {/* ── Câmera ─────────────────────────────────────────────────────────── */}
      <WmsBinScanner
        open={camera !== null}
        modo={camera === 'produto' ? 'produto' : 'endereco'}
        title={camera === 'produto' ? 'Ler o código do produto' : 'Ler a etiqueta da vaga'}
        onClose={() => setCamera(null)}
        onDetected={code => { setCamera(null); receberLeitura(code); }}
      />

      {/* ── Escolha entre produtos com o mesmo código ───────────────────────── */}
      <Modal
        open={candidatos !== null}
        onClose={() => setCandidatos(null)}
        title="Qual produto você pegou?"
        maxWidth="max-w-md"
      >
        <p className="text-sm text-fg-muted">
          Este código responde por mais de um produto desta onda. Confira a embalagem.
        </p>
        <ul className="mt-3 space-y-2">
          {(candidatos ?? []).map(c => (
            <li key={c.produtoId}>
              <button
                type="button"
                onClick={() => { setCandidatos(null); aceitarProduto(c.sku); }}
                className="flex min-h-[3rem] w-full items-center gap-3 rounded-control border border-edge px-3 py-2 text-left transition-colors hover:bg-surface-3"
              >
                <span className="text-code text-sm text-fg">{c.sku}</span>
                {c.ean && <span className="text-code ml-auto text-xs text-fg-subtle">{c.ean}</span>}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <Button variant="ghost" className="w-full" onClick={() => setCandidatos(null)}>
            Nenhum destes
          </Button>
        </div>
      </Modal>

      {/* ── Confirmações que não podem ser acidentais ───────────────────────── */}
      <Modal
        open={confirmandoRuptura}
        onClose={() => setConfirmandoRuptura(false)}
        title="Declarar falta nesta parada?"
        maxWidth="max-w-md"
      >
        {/* Ruptura por toque errado tira saldo prometido de uma onda que ainda ia
            buscá-lo. Por isso a confirmação é explícita, e não um botão solto. */}
        <p className="text-sm text-fg-muted">
          Você está dizendo que <span className="text-code">{parada?.endereco}</span>{' '}
          não tem {plural(parada?.restantes ?? 0, 'a', 'as')} {parada?.restantes}{' '}
          {plural(parada?.restantes ?? 0, 'caixa', 'caixas')} desta parada.
          A reserva volta a ficar disponível e o sistema procura outro endereço.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirmandoRuptura(false)}>
            Voltar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            onClick={() => { setConfirmandoRuptura(false); void enviar('ruptura', 0, ''); }}
          >
            Confirmar falta
          </Button>
        </div>
      </Modal>

      <Modal
        open={confirmandoFim}
        onClose={() => setConfirmandoFim(false)}
        title="Encerrar com pendências?"
        maxWidth="max-w-md"
      >
        <p className="text-sm text-fg-muted">
          Ainda {pendentes.length === 1 ? 'há 1 parada pendente' : `há ${pendentes.length} paradas pendentes`} e{' '}
          {progresso.caixasPedidas - progresso.caixasSeparadas}{' '}
          {plural(progresso.caixasPedidas - progresso.caixasSeparadas, 'caixa', 'caixas')} sem separar.
          A onda será encerrada como <strong>concluída com falta</strong> e o saldo reservado volta a
          ficar disponível.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="ghost" className="flex-1" onClick={() => setConfirmandoFim(false)}>
            Continuar separando
          </Button>
          <Button variant="secondary" className="flex-1" onClick={() => void finalizar()}>
            Encerrar assim mesmo
          </Button>
        </div>
      </Modal>
    </div>
  );
}

/** Os três passos, sempre visíveis, para ninguém perder o lugar no meio do corredor. */
function Passos({ etapa }: { etapa: 'endereco' | 'produto' | 'quantidade' }) {
  const passos: { chave: typeof etapa; rotulo: string }[] = [
    { chave: 'endereco', rotulo: 'Vaga' },
    { chave: 'produto', rotulo: 'Produto' },
    { chave: 'quantidade', rotulo: 'Quantidade' },
  ];
  const indiceAtual = passos.findIndex(p => p.chave === etapa);

  return (
    <div className="flex items-center gap-2">
      {passos.map((p, i) => (
        <div key={p.chave} className="flex items-center gap-2">
          <Badge variant={i < indiceAtual ? 'success' : i === indiceAtual ? 'accent' : 'neutral'}>
            {i < indiceAtual && <Check aria-hidden className="h-3 w-3" />}
            {p.rotulo}
          </Badge>
          {i < passos.length - 1 && <span aria-hidden className="text-fg-subtle">›</span>}
        </div>
      ))}
    </div>
  );
}
