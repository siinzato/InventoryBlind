// Aceite de Termos e Política — acesso ao Supabase.

import { supabase } from '../supabase';
import {
  CURRENT_VERSIONS,
  buildAcceptanceRpcArgs,
  mapAcceptance,
  type AcceptedVersions,
  type LegalAcceptance,
} from './legalAcceptance';

/**
 * Registra o aceite das versões vigentes.
 *
 * Idempotente pelo lado do banco: chamar de novo com as mesmas versões devolve o
 * aceite já gravado, sem empilhar linha nem mexer na data. É o que permite
 * repetir a tentativa quando a autenticação conclui mas o registro falha (rede
 * caiu, por exemplo) sem risco de duplicar.
 */
export async function recordAcceptance(
  current: AcceptedVersions = CURRENT_VERSIONS
): Promise<string> {
  const { data, error } = await supabase.rpc('legal_record_acceptance', buildAcceptanceRpcArgs(current));
  if (error) throw error;
  return String(data);
}

/**
 * O aceite mais recente do usuário autenticado, distinguindo "nunca aceitou" de
 * "não foi possível verificar".
 *
 * A diferença importa: no primeiro caso o pedido de aceite deve aparecer; no
 * segundo, NÃO. Se a tabela ainda não existe (migration 066 não aplicada) ou a
 * leitura falha, mostrar um aceite obrigatório que vai falhar ao salvar deixaria
 * a pessoa presa numa tela sem saída. Falha de infraestrutura no aceite não pode
 * impedir ninguém de trabalhar — o pedido volta na próxima sessão.
 *
 * A RLS garante que só vêm aceites do próprio usuário, então não há filtro por
 * user_id aqui: a policy legal_acceptances_select_own é a barreira.
 */
export async function loadAcceptanceState(): Promise<
  { status: 'ok'; latest: LegalAcceptance | null } | { status: 'unavailable' }
> {
  const { data, error } = await supabase
    .from('legal_acceptances')
    .select('id, user_id, company_id, terms_version, privacy_version, accepted_at')
    .order('accepted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { status: 'unavailable' };
  return { status: 'ok', latest: data ? mapAcceptance(data as Record<string, unknown>) : null };
}
