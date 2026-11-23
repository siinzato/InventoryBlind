// Persistência das peças montadas no Modo Edição do mapa 3D.
//
// O builder construía em estado local: o que a pessoa montava sumia ao sair da tela e
// ninguém mais da equipe via. Aqui isso vira linha no banco.
//
// ── O que esta tabela NÃO é ─────────────────────────────────────────────────────
// Não é fonte de endereço. Quem manda em vaga continua sendo `warehouse_storage_bins` e
// quem manda na planta publicada continua sendo `warehouse_cells`. A peça daqui é
// ESBOÇO: não cria vaga, não recebe mercadoria, não entra em contagem. Tratá-la como
// layout oficial seria criar a terceira verdade sobre o mesmo galpão.

import { supabase } from '../supabase';

export type TipoDaPeca = 'porta-pallets' | 'mesa' | 'doca';
export type VarianteDeEstante = 'simples' | 'duplo' | 'picking';

export interface PecaSalva {
  id: string;
  tipo: TipoDaPeca;
  estante: VarianteDeEstante;
  cor: string;
  /** Metros. */
  x: number;
  z: number;
  /** Radianos. */
  rotacaoY: number;
}

interface LinhaDoBanco {
  id: string;
  tipo: string;
  estante: string;
  cor: string;
  x: number | string;
  z: number | string;
  rotacao_y: number | string;
}

/**
 * `numeric` do Postgres chega como STRING no supabase-js quando o valor não cabe num
 * double seguro, e como number no resto. Normalizar na borda evita `x` virar texto no
 * meio de uma conta de posição — que não quebra, só desenha no lugar errado.
 */
const numero = (v: number | string): number => (typeof v === 'number' ? v : Number(v));

const daLinha = (l: LinhaDoBanco): PecaSalva => ({
  id: l.id,
  tipo: l.tipo as TipoDaPeca,
  estante: l.estante as VarianteDeEstante,
  cor: l.cor,
  x: numero(l.x),
  z: numero(l.z),
  rotacaoY: numero(l.rotacao_y),
});

/** As peças de um pavimento. Lista vazia quando não há nada salvo. */
export async function listarPecas(andar = 1): Promise<PecaSalva[]> {
  const { data, error } = await supabase
    .from('warehouse_builder_objects')
    .select('id, tipo, estante, cor, x, z, rotacao_y')
    .eq('andar', andar)
    .order('created_at');
  if (error) { console.error('[Builder] Erro ao ler as peças:', error); return []; }
  return (data as LinhaDoBanco[]).map(daLinha);
}

/**
 * Substitui as peças do pavimento pelas que estão na tela.
 *
 * Apaga e insere em vez de reconciliar peça a peça, e isso é escolha: o builder é uma
 * tela de desenho onde se coloca, gira e exclui à vontade, então o estado local JÁ é a
 * verdade do que se quer salvar. Reconciliar exigiria rastrear id local contra id do
 * banco a cada clique, e o primeiro bug seria peça fantasma que não some nunca.
 *
 * O delete vem antes do insert e o retorno só é `true` com os dois ok — se o insert
 * falhar depois do delete, quem chama precisa saber que o pavimento ficou vazio, em vez
 * de achar que salvou.
 */
export async function salvarPecas(pecas: PecaSalva[], andar = 1): Promise<{ ok: boolean; erro?: string }> {
  const { error: erroDelete } = await supabase
    .from('warehouse_builder_objects').delete().eq('andar', andar);
  if (erroDelete) {
    console.error('[Builder] Erro ao limpar as peças antigas:', erroDelete);
    return { ok: false, erro: 'Não foi possível substituir o que estava salvo.' };
  }

  if (pecas.length === 0) return { ok: true };

  const { error: erroInsert } = await supabase.from('warehouse_builder_objects').insert(
    pecas.map(p => ({
      andar,
      tipo: p.tipo,
      estante: p.estante,
      cor: p.cor,
      x: p.x,
      z: p.z,
      rotacao_y: p.rotacaoY,
    })),
  );
  if (erroInsert) {
    console.error('[Builder] Erro ao gravar as peças:', erroInsert);
    return { ok: false, erro: 'As peças antigas foram removidas, mas as novas não gravaram.' };
  }

  return { ok: true };
}
