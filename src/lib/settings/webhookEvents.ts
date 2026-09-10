// Catálogo de eventos de webhook — fonte única no cliente.
//
// Espelha `company_webhook_allowed_events()` (migration 068). O servidor
// continua sendo a autoridade: `company_webhook_create/update` recusam
// qualquer id fora da lista dele. Este arquivo existe para que nenhum
// componente precise repetir strings de evento soltas.
//
// REGRA: um evento só entra aqui depois de existir um ponto de disparo real —
// uma RPC SECURITY DEFINER que resolve empresa/papel no servidor. Eventos sem
// fonte confiável ficam de fora em vez de virarem opções que nunca disparam.

export type WebhookEvent =
  | 'physical_count.started'
  | 'physical_count.finalized'
  | 'physical_count.approved'
  | 'physical_count.cancelled'
  | 'physical_count.divergence_detected';

export type WebhookEventCategory = 'inventario';

export interface WebhookEventDefinition {
  id: WebhookEvent;
  label: string;
  category: WebhookEventCategory;
  description: string;
}

export const WEBHOOK_EVENT_CATEGORY_LABEL: Record<WebhookEventCategory, string> = {
  inventario: 'Inventário',
};

export const WEBHOOK_EVENTS: WebhookEventDefinition[] = [
  {
    id: 'physical_count.started',
    label: 'Contagem física iniciada',
    category: 'inventario',
    description: 'Assim que a contagem sai de rascunho e o saldo do sistema é congelado.',
  },
  {
    id: 'physical_count.finalized',
    label: 'Contagem física finalizada',
    category: 'inventario',
    description: 'Quando todos os itens foram contados e a contagem é fechada.',
  },
  {
    id: 'physical_count.approved',
    label: 'Contagem física aprovada',
    category: 'inventario',
    description: 'Quando um gestor aprova o resultado de uma contagem já finalizada.',
  },
  {
    id: 'physical_count.cancelled',
    label: 'Contagem física cancelada',
    category: 'inventario',
    description: 'Quando a contagem é removida do histórico por quem administra a conta.',
  },
  {
    id: 'physical_count.divergence_detected',
    label: 'Divergência detectada',
    category: 'inventario',
    description: 'No fechamento de uma contagem que terminou com pelo menos um item divergente.',
  },
];

/** Categorias na ordem em que aparecem na tela, já com seus eventos. */
export const WEBHOOK_EVENT_GROUPS: { category: WebhookEventCategory; label: string; events: WebhookEventDefinition[] }[] =
  (Object.keys(WEBHOOK_EVENT_CATEGORY_LABEL) as WebhookEventCategory[]).map(category => ({
    category,
    label: WEBHOOK_EVENT_CATEGORY_LABEL[category],
    events: WEBHOOK_EVENTS.filter(e => e.category === category),
  }));

const BY_ID = new Map<string, WebhookEventDefinition>(WEBHOOK_EVENTS.map(e => [e.id, e]));

/** Rótulo amigável de um evento. Entregas antigas podem carregar um id que
 *  saiu do catálogo (ou `webhook.test`, que é do sistema e não é selecionável)
 *  — nesses casos o próprio id é a melhor informação disponível. */
export function webhookEventLabel(id: string): string {
  if (id === 'webhook.test') return 'Disparo de teste';
  return BY_ID.get(id)?.label ?? id;
}

export function isKnownWebhookEvent(id: string): id is WebhookEvent {
  return BY_ID.has(id);
}
