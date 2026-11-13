// Reconciliação entre o catálogo e a fonte de saldo — e o congelamento.
//
// Três listas, UM painel. A separação entre elas continua sendo a coisa mais
// importante da tela, porque a célula em branco da folha de contagem tem duas
// causas e tratá-las igual seria o erro caro:
//
//   "Sumiram da fonte"  — o produto JÁ veio da fonte e parou de vir. Fato
//                         observado. É a única lista com ação de congelar.
//   "Nunca encontrados" — nunca foi associado a nenhum registro da fonte. Pode
//                         ser exclusão no ERP, cadastro só do I.B., ou produto
//                         que o ERP nunca teve. O sistema não sabe qual, e
//                         oferecer congelamento em cima disso seria apagar
//                         cadastro por falta de informação.
//   "Congelados"        — o que já foi marcado, com o caminho de volta.
//
// O que mudou na segunda versão: eram três painéis empilhados, e com 1.771
// linhas numa delas a página virava uma rolagem sem fim que escondia o
// histórico de importações embaixo. A separação NÃO foi desfeita — ela virou um
// seletor, e só a lista escolhida ocupa espaço. A altura da tabela é limitada,
// então a página não cresce com o tamanho da lista, e a busca existe porque
// procurar um SKU entre 1.771 com a barra de rolagem não é procurar.
//
// Nada vem pré-selecionado. São potencialmente milhares de linhas: um botão que
// congela tudo de uma vez é meia hora de desfazer para quem só queria conferir.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Snowflake, RotateCcw, Search } from 'lucide-react';
import {
  Panel,
  PanelSection,
  Button,
  Input,
  Table,
  Thead,
  Tr,
  Th,
  Td,
  Notice,
  SegmentedControl,
} from '../ui';
import type { SegmentedOption } from '../ui';
import {
  loadSourceReconciliation,
  freezeProducts,
  unfreezeProducts,
  listFrozenProducts,
  type FrozenProduct,
} from '../../lib/productFreeze/productFreezeService';
import type { ReconciliationResult } from '../../lib/productFreeze/productFreezeRule';
import { int, plural } from '../../lib/formatPtBr';

interface ProductFreezePanelProps {
  connectionId: string;
  /** Avisa a página de cima que algo mudou, para ela recarregar os contadores. */
  onChanged?: () => void;
}

type Aba = 'sumiram' | 'nunca' | 'congelados';

/** Teto de linhas renderizadas por vez. Montar 1.771 linhas de tabela trava o
 *  navegador; montar 300 e CALAR sobre o resto faz a tela mentir. O total é
 *  sempre escrito, e a busca é o caminho para chegar ao que está fora. */
const LIMITE_VISIVEL = 300;

function diasLabel(dias: number | null): string {
  if (dias == null) return 'sem registro de quando';
  if (dias === 0) return 'hoje';
  return `há ${int(dias)} ${plural(dias, 'dia', 'dias')}`;
}

/** Uma linha, no formato que a tabela precisa — vem das três origens. */
interface LinhaExibida {
  productId: string;
  sku: string;
  name: string;
  detalhe: string;
}

export function ProductFreezePanel({ connectionId, onChanged }: ProductFreezePanelProps) {
  const [dados, setDados] = useState<ReconciliationResult | null>(null);
  const [congelados, setCongelados] = useState<FrozenProduct[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  const [gravando, setGravando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>('sumiram');
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const [recon, lista] = await Promise.all([
        loadSourceReconciliation(connectionId),
        listFrozenProducts(),
      ]);
      setDados(recon);
      setCongelados(lista);
      setSelecionados(new Set());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível ler a reconciliação.');
    } finally {
      setCarregando(false);
    }
  }, [connectionId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const sumiram = useMemo(() => dados?.sumiramDaFonte ?? [], [dados]);
  const nuncaVieram = useMemo(() => dados?.nuncaVieram ?? [], [dados]);

  /** A lista da aba ativa, já no formato da tabela. */
  const linhas = useMemo<LinhaExibida[]>(() => {
    if (aba === 'sumiram') {
      return sumiram.map(l => ({
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        detalhe: diasLabel(l.diasSemFonte),
      }));
    }
    if (aba === 'nunca') {
      return nuncaVieram.map(l => ({
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        detalhe: '',
      }));
    }
    return congelados.map(p => ({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      detalhe: p.frozenReason === 'sem_fonte_de_saldo' ? 'Sumiu da fonte de saldo' : 'Manual',
    }));
  }, [aba, sumiram, nuncaVieram, congelados]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return linhas;
    return linhas.filter(
      l => l.sku.toLowerCase().includes(termo) || l.name.toLowerCase().includes(termo)
    );
  }, [linhas, busca]);

  const visiveis = useMemo(() => filtradas.slice(0, LIMITE_VISIVEL), [filtradas]);

  function trocarAba(proxima: Aba) {
    setAba(proxima);
    setBusca('');
    // A seleção pertence à lista em que foi feita. Mantê-la ao trocar de aba
    // deixaria o botão "Congelar 3" visível sobre linhas que não são aquelas.
    setSelecionados(new Set());
  }

  function alternar(productId: string) {
    setSelecionados(atual => {
      const proximo = new Set(atual);
      if (proximo.has(productId)) proximo.delete(productId);
      else proximo.add(productId);
      return proximo;
    });
  }

  async function congelarSelecionados() {
    if (selecionados.size === 0) return;
    setGravando(true);
    setAviso(null);
    try {
      const pedidos = selecionados.size;
      const quantos = await freezeProducts([...selecionados], 'sem_fonte_de_saldo');
      // Afirma o EFEITO, não a intenção: se o banco congelou menos do que foi
      // pedido, quem lê a tela precisa ver o número que de fato mudou.
      setAviso(
        quantos === pedidos
          ? `${int(quantos)} ${plural(quantos, 'produto congelado', 'produtos congelados')}.`
          : `${int(quantos)} de ${int(pedidos)} congelados — os demais já estavam.`
      );
      await carregar();
      onChanged?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível congelar.');
    } finally {
      setGravando(false);
    }
  }

  async function descongelar(productId: string) {
    setGravando(true);
    setAviso(null);
    try {
      await unfreezeProducts([productId]);
      await carregar();
      onChanged?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível descongelar.');
    } finally {
      setGravando(false);
    }
  }

  if (carregando) {
    return (
      <Panel>
        <PanelSection>
          <p className="text-sm text-fg-muted">Conferindo o catálogo contra a fonte…</p>
        </PanelSection>
      </Panel>
    );
  }

  const abas: SegmentedOption<Aba>[] = [
    { value: 'sumiram', label: `Sumiram da fonte · ${int(sumiram.length)}` },
    { value: 'nunca', label: `Nunca encontrados · ${int(nuncaVieram.length)}` },
    { value: 'congelados', label: `Congelados · ${int(congelados.length)}` },
  ];

  // A explicação muda com a aba porque a diferença entre as listas É a
  // informação: sem ela, "sumiu" e "nunca veio" viram a mesma coisa na cabeça
  // de quem lê, que é exatamente o engano que esta tela existe para evitar.
  const explicacao: Record<Aba, string> = {
    sumiram:
      'Já vieram do Tiny em uma importação anterior e não vieram na mais recente. Congelar tira o produto das folhas de contagem, da fila de recontagem e da lista de risco, sem apagar nada do histórico — e é reversível a qualquer momento.',
    nunca:
      'Nunca foram associados a nenhum registro do Tiny, nem na importação mais antiga. Isso não quer dizer que foram excluídos de lá: podem ser cadastro só do InventoryBlind, ou ter saído do ERP antes da primeira importação. Como o sistema não sabe qual é o caso, não há sugestão de congelamento aqui. São eles que aparecem com o saldo em branco na folha de contagem.',
    congelados:
      'Fora das folhas de contagem, da fila de recontagem e da lista de risco. O histórico de cada um segue intacto, e descongelar devolve o produto ao fluxo normal. Os indicadores de inventários já fechados não mudam — congelar vale daqui para frente.',
  };

  const vazio: Record<Aba, string> = {
    sumiram: 'Nenhum produto deixou de vir na última importação.',
    nunca: 'Todo o catálogo já foi encontrado na fonte ao menos uma vez.',
    congelados: 'Nenhum produto congelado.',
  };

  return (
    <>
      {erro && <Notice tone="danger">{erro}</Notice>}
      {aviso && <Notice tone="success">{aviso}</Notice>}

      <Panel>
        <PanelSection>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-fg">Catálogo × fonte de saldo</h3>
              <p className="mt-1 max-w-3xl text-sm text-fg-muted">{explicacao[aba]}</p>
            </div>
            {aba === 'sumiram' && selecionados.size > 0 && (
              <Button onClick={congelarSelecionados} disabled={gravando}>
                <Snowflake size={14} /> Congelar {int(selecionados.size)}
              </Button>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <SegmentedControl
              options={abas}
              value={aba}
              onChange={trocarAba}
              label="Lista exibida"
            />
            {linhas.length > 0 && (
              <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                <Search
                  size={14}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-subtle"
                />
                <Input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar SKU ou produto"
                  className="pl-9"
                  aria-label="Buscar nesta lista"
                />
              </div>
            )}
          </div>
        </PanelSection>

        {linhas.length === 0 ? (
          <PanelSection>
            <p className="text-sm text-fg-muted">{vazio[aba]}</p>
          </PanelSection>
        ) : (
          <PanelSection padding="sm">
            {/* Altura limitada: a página não pode crescer com o tamanho da lista,
                senão o histórico de importações volta para debaixo do fim do mundo. */}
            <div className="max-h-[22rem] overflow-auto">
              <Table>
                <Thead>
                  <tr>
                    {aba === 'sumiram' && <Th>{''}</Th>}
                    <Th>SKU</Th>
                    <Th>Produto</Th>
                    {aba !== 'nunca' && <Th>{aba === 'sumiram' ? 'Ausente desde' : 'Motivo'}</Th>}
                    {aba === 'congelados' && <Th>{''}</Th>}
                  </tr>
                </Thead>
                <tbody>
                  {visiveis.map(linha => (
                    <Tr key={linha.productId}>
                      {aba === 'sumiram' && (
                        <Td>
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-edge"
                            checked={selecionados.has(linha.productId)}
                            onChange={() => alternar(linha.productId)}
                            aria-label={`Selecionar ${linha.sku || linha.name}`}
                          />
                        </Td>
                      )}
                      <Td className="whitespace-nowrap font-mono">{linha.sku || '—'}</Td>
                      <Td>{linha.name || '—'}</Td>
                      {aba !== 'nunca' && (
                        <Td className="whitespace-nowrap text-fg-muted">{linha.detalhe}</Td>
                      )}
                      {aba === 'congelados' && (
                        <Td>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => descongelar(linha.productId)}
                            disabled={gravando}
                          >
                            <RotateCcw size={14} /> Descongelar
                          </Button>
                        </Td>
                      )}
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>

            <p className="mt-3 text-xs text-fg-subtle">
              {busca.trim()
                ? `${int(filtradas.length)} ${plural(filtradas.length, 'resultado', 'resultados')} para “${busca.trim()}”`
                : `${int(linhas.length)} ${plural(linhas.length, 'produto', 'produtos')} nesta lista`}
              {filtradas.length > LIMITE_VISIVEL &&
                ` · mostrando ${int(LIMITE_VISIVEL)} — use a busca para chegar aos demais`}
            </p>
          </PanelSection>
        )}
      </Panel>
    </>
  );
}
