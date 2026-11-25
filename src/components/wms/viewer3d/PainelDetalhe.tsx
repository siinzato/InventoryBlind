// A gaveta de detalhe da vaga: situação, saldo, curva de giro e o que está guardado ali.
//
// Extraído de `Warehouse3DViewer.tsx` no fatiamento do módulo. A única mudança de
// comportamento é o CACHE do conteúdo, que vive em `cacheDeConteudo.ts`.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Package, ScanLine, ShieldAlert, X } from 'lucide-react';
import { Button, Panel, PanelSection } from '../../ui';
import { useTheme } from '../../../lib/useTheme';
import { int } from '../../../lib/formatPtBr';
import { listBinContents, type BinStockRow } from '../../../lib/wms/wmsService';
import { NIVEL_DE_PISO, type AbcDaVaga } from '../../../lib/wms/warehouse3dAbc';
import type { Slot, SlotStatus } from '../../../lib/wms/warehouse3dSlots';
import { COR_ALERTA_GIRO, COR_VAGA, ESCALA_ABC } from './aparencia';
import { conteudoGuardado, guardarConteudo } from './cacheDeConteudo';



/** Data curta para a grade. Formatada à mão, como no módulo de captura: o painel é
 *  lido no corredor e a data não pode mudar de formato conforme a locale da máquina. */
function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const doisDigitos = (n: number) => String(n).padStart(2, '0');
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const ROTULO_STATUS: Record<SlotStatus, string> = {
  occupied: 'Ocupada',
  empty: 'Livre',
  divergence: 'Acima da capacidade',
  blocked: 'Bloqueada',
};

export function PainelDetalhe({
  slot,
  abc,
  onFechar,
  onScanRequest,
  onOperate,
  onProcurarSku,
}: {
  slot: Slot;
  /** Classificação de giro desta vaga. `undefined` = nenhum SKU daqui está na análise. */
  abc?: AbcDaVaga;
  onFechar: () => void;
  onScanRequest?: (slot: Slot) => void;
  onOperate?: (slot: Slot) => void;
  /**
   * Procura um SKU no armazém inteiro, acendendo todos os endereços que o têm.
   *
   * Existe porque a pergunta que nasce ao abrir uma vaga é "onde MAIS tem isto" — e até
   * agora ela obrigava a fechar o painel e redigitar o código na busca.
   */
  onProcurarSku?: (sku: string) => void;
}) {
  // Hook em vez de prop: a especificação pede para NÃO mexer na interface do
  // componente, e o tema é exatamente o tipo de contexto que não deve virar prop só
  // para pintar um quadradinho.
  const { theme } = useTheme();
  const [conteudo, setConteudo] = useState<BinStockRow[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  /** Curva por SKU, para marcar cada linha do conteúdo. A cor do cubo diz a classe que
   *  DOMINA a vaga; aqui é preciso dizer de qual produto ela veio, senão numa vaga
   *  misturada a pessoa desce o pallet errado. */
  const curvaPorSku = useMemo(
    () => new Map((abc?.itens ?? []).map(i => [i.sku, i.classe])),
    [abc],
  );

  const altoGiroElevado = abc?.classe === 'A' && slot.nivel > NIVEL_DE_PISO;

  /**
   * Blocos da grade técnica.
   *
   * Montados numa lista, e não escritos no JSX, porque QUASE TODOS são condicionais:
   * sem produto não há unidades nem data de entrada, sem análise publicada não há
   * curva. Célula com travessão ocupa o mesmo espaço de uma com dado e não diz nada.
   *
   * O que NÃO está aqui, e por quê: a especificação pedia `LOTE / VALIDADE` e
   * `ÚLTIMA AUDITORIA`. Conferido no banco — não existe coluna de lote, validade nem
   * carimbo de auditoria em `warehouse_bin_stock`, `warehouse_storage_bins`,
   * `warehouse_bin_movements` nem `products`. O controle de lote da 125 vive no fluxo
   * de NF-e (`lot_control_settings`, `nfe_putaway_assignments`), não no saldo do
   * pulmão. No lugar deles entra ENTRADA, que é real e é a data que manda na coleta:
   * `first_stored_at` é o critério FIFO que a busca já usa para ordenar.
   */
  const blocos = useMemo(() => {
    const lista: { rotulo: string; valor: ReactNode }[] = [
      {
        rotulo: 'Situação',
        valor: (
          <>
            {/* Mesmo quadradinho da legenda do mapa: o painel repete o código visual da
                cena em vez de inventar um segundo. */}
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={
                slot.status === 'empty'
                  ? { border: `1px solid ${COR_VAGA[theme].empty}` }
                  : { backgroundColor: COR_VAGA[theme][slot.status] }
              }
            />
            <span className="truncate text-xs">{ROTULO_STATUS[slot.status]}</span>
          </>
        ),
      },
      {
        rotulo: 'Caixas',
        valor: (
          <span className="text-code">
            {/* Sem capacidade cadastrada mostra só a contagem. Exibir "18/—" sugeriria
                um limite que ninguém definiu. */}
            {slot.capacidade !== null ? `${slot.caixas}/${slot.capacidade}` : slot.caixas}
          </span>
        ),
      },
    ];

    const linhas = conteudo ?? [];
    if (linhas.length > 0) {
      const unidades = linhas.reduce((total, l) => total + l.units, 0);
      lista.push({ rotulo: 'Unidades', valor: <span className="text-code">{int(unidades)}</span> });

      const maisAntiga = linhas.reduce(
        (menor, l) => (l.firstStoredAt < menor ? l.firstStoredAt : menor),
        linhas[0].firstStoredAt,
      );
      lista.push({ rotulo: 'Entrada', valor: <span className="text-code">{dataCurta(maisAntiga)}</span> });
    }

    if (abc) {
      lista.push({
        rotulo: 'Curva de giro',
        valor: (
          <>
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: ESCALA_ABC[theme][abc.classe] }}
            />
            <span className="text-code">{abc.classe}</span>
          </>
        ),
      });
    }

    // Endereço misturado é digno de nota: muda o que o operador vai encontrar lá.
    if (linhas.length > 1) {
      lista.push({ rotulo: 'SKUs na vaga', valor: <span className="text-code">{linhas.length}</span> });
    }

    return lista;
  }, [slot, conteudo, abc, theme]);

  useEffect(() => {
    let vivo = true;
    setErro(null);

    // Com cache, a gaveta abre JÁ com o conteúdo e não pisca "Lendo…" — e o `return`
    // evita a ida ao banco por completo. Sem ele, cachear não economizaria consulta
    // nenhuma: só esconderia a espera.
    const guardado = conteudoGuardado(slot.id);
    if (guardado) {
      setConteudo(guardado);
      return;
    }

    setConteudo(null);
    listBinContents(slot.id)
      .then(linhas => {
        // Grava mesmo se a gaveta já fechou: o próximo clique na mesma vaga aproveita.
        guardarConteudo(slot.id, linhas);
        if (vivo) setConteudo(linhas);
      })
      .catch((e: unknown) => {
        if (vivo) setErro(e instanceof Error ? e.message : String(e));
      });
    return () => {
      vivo = false;
    };
  }, [slot.id]);

  return (
    <Panel className="pointer-events-auto absolute right-3 top-3 flex max-h-[calc(100%-1.5rem)] w-[19rem] max-w-[calc(100%-1.5rem)] flex-col">
      {/* Cabeçalho: o endereço é o assunto, então ele é o maior elemento do painel. O
          fechar virou ícone — a palavra "Fechar" competia em peso com o código da vaga
          que a pessoa veio ler. */}
      <PanelSection padding="sm" className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-code truncate text-base font-semibold tracking-tight text-fg">{slot.id}</p>
          <p className="mt-0.5 text-[11px] uppercase tracking-wider text-fg-subtle">
            Rua {slot.ruaCodigo} · Mód <span className="text-code">{slot.modulo}</span> · Nív{' '}
            <span className="text-code">{slot.nivel}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar detalhe da vaga"
          className="-mr-1 -mt-1 shrink-0 rounded-control p-1.5 text-fg-subtle transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </PanelSection>

      {/* Grade técnica. Substitui as linhas rótulo-à-esquerda/valor-à-direita: em duas
          colunas o olho varre os VALORES numa coluna só, que é como se lê terminal. Os
          blocos sem dado não entram — célula com travessão é ruído com aparência de
          informação. */}
      <PanelSection padding="sm">
        <dl className="grid grid-cols-2 gap-1.5">
          {blocos.map(bloco => (
            <div key={bloco.rotulo} className="rounded-control border border-edge bg-surface-2 px-2.5 py-2">
              <dt className="text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
                {bloco.rotulo}
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 text-sm text-fg">{bloco.valor}</dd>
            </div>
          ))}
        </dl>
      </PanelSection>

      {/* O alerta é dito por extenso, não só pelo losango na cena. Filete à esquerda em
          vez de balão preenchido: o painel inteiro cabe em uma tela, e um bloco de cor
          sólida no meio dele rouba a atenção do conteúdo da vaga, que é o assunto.
          O vermelho é o MESMO do marcador 3D — antes este aviso saía âmbar enquanto o
          losango sobre a vaga era vermelho, dois tons para um alerta só. */}
      {altoGiroElevado && (
        <PanelSection padding="sm">
          <div className="flex gap-2.5 border-l-2 pl-2.5" style={{ borderColor: COR_ALERTA_GIRO }}>
            <ShieldAlert
              aria-hidden
              className="mt-0.5 h-3.5 w-3.5 shrink-0"
              style={{ color: COR_ALERTA_GIRO }}
            />
            <p className="text-xs leading-relaxed text-fg-muted">
              Alto giro no nível <span className="text-code text-fg">{slot.nivel}</span>. Cada
              retirada exige ciclo de elevação — descer para a face de piso reduz o tempo de
              separação.
            </p>
          </div>
        </PanelSection>
      )}

      <PanelSection padding="sm" className="min-h-0 flex-1 overflow-auto">
        <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle">
          <Package aria-hidden className="h-3 w-3 shrink-0" />
          Conteúdo
        </p>
        {erro !== null ? (
          <p className="text-xs leading-relaxed text-danger">Não foi possível ler o conteúdo desta vaga.</p>
        ) : conteudo === null ? (
          <p className="text-xs text-fg-muted">Lendo…</p>
        ) : conteudo.length === 0 ? (
          <p className="text-xs text-fg-muted">Nenhum produto armazenado aqui.</p>
        ) : (
          <ul className="space-y-2">
            {conteudo.map(linha => (
              <li key={linha.productId} className="border-t border-edge pt-2 first:border-t-0 first:pt-0">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-code text-xs font-medium text-fg">{linha.sku}</p>
                  {/* Só quando há classe. "—" em todas as linhas de quem nunca publicou
                      análise seria uma coluna de nada ocupando a largura do painel.
                      Quadrado, não pílula: aqui ele é um MARCADOR de uma letra, e a
                      pílula o faria concorrer em peso com o SKU ao lado. */}
                  {curvaPorSku.get(linha.sku) && (
                    <span
                      className="text-code shrink-0 rounded-[3px] px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                      style={{ backgroundColor: ESCALA_ABC[theme][curvaPorSku.get(linha.sku)!] }}
                      title={`Curva de giro ${curvaPorSku.get(linha.sku)}`}
                    >
                      {curvaPorSku.get(linha.sku)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-fg-muted">{linha.productName}</p>
                {/* Por LINHA, e não um botão no rodapé: a vaga pode ter mais de um
                    produto, e um botão só teria que escolher qual procurar — ou
                    escolheria errado, ou pediria mais um clique para desambiguar. */}
                {onProcurarSku && (
                  <button
                    type="button"
                    className="mt-1 text-xs text-accent underline-offset-2 hover:underline"
                    onClick={() => onProcurarSku(linha.sku)}
                  >
                    Ver onde mais tem este produto
                  </button>
                )}
                <p className="mt-0.5 text-xs text-fg-muted">
                  <span className="text-code">{linha.boxes}</span> cx ·{' '}
                  <span className="text-code">{linha.units}</span> un
                </p>
              </li>
            ))}
          </ul>
        )}
      </PanelSection>

      {/* Os botões só existem quando há quem os atenda. Botão que não faz o que o
          rótulo diz é pior que botão nenhum: o operador confia nele. Em particular,
          "Ler QR Code" só aparece para quem de fato abre um leitor — ligá-lo a
          qualquer outra coisa seria um rótulo mentindo. */}
      {(onOperate || onScanRequest) && (
        <PanelSection padding="sm" className="space-y-2">
          {onOperate && (
            <Button variant="secondary" size="sm" className="w-full" onClick={() => onOperate(slot)}>
              Movimentar esta vaga
            </Button>
          )}
          {/* Ação principal do painel: é a leitura que confirma fisicamente o endereço.
              `primary` em vez de `secondary` — com os dois botões no mesmo peso, nada
              indicava por onde começar. */}
          {onScanRequest && (
            <Button variant="primary" size="sm" className="w-full" onClick={() => onScanRequest(slot)}>
              <ScanLine aria-hidden className="h-3.5 w-3.5 shrink-0" />
              Ler QR Code
            </Button>
          )}
        </PanelSection>
      )}
    </Panel>
  );
}
