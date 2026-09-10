/*
# Fonte de Saldo por planilha — "Tiny — Estoque diário"

## Summary
Migration SOMENTE DE DADOS. Nenhuma tabela, coluna, índice, policy, RLS, grant,
função ou trigger é criada ou alterada. O único efeito é uma linha nova no
catálogo `integration_providers`.

A 042 estabeleceu que provider é DADO, não union type no código: "adding Bling or
TikTok Shop later is an INSERT, not a code change". Uma Fonte de Saldo alimentada
por upload de planilha usa exatamente o mesmo modelo persistido das demais —
`integration_connections` (a fonte, company-scoped, sob RLS),
`integration_entity_links` (mapeamento e âncora de idempotência),
`integration_stock_levels` (saldo normalizado, UNIQUE que faz da reimportação uma
substituição e nunca uma soma), `integration_sync_runs` + `integration_sync_items`
(histórico e trilha de auditoria). Por isso não há infraestrutura nova aqui: só
o registro do provider que faltava.

## Por que uma key própria e não `provider_key = 'tiny'`
A conexão do Tiny por API existe e é gerenciada em Integrações → Tiny: tem
credencial, connector, cursor e sincronização. Uma fonte por planilha não tem
nenhuma dessas coisas. Reaproveitar a key 'tiny' faria a fonte aparecer naquela
tela como uma conexão de API aguardando credencial, com botão de sincronizar que
falharia — e colidiria no índice
`integration_connections_account_unique_idx (company_id, provider_key,
COALESCE(external_account_id,''))` com a conexão de API existente.

## Capabilities
Apenas `read_stock`. A fonte informa um saldo por produto e nada mais: não lê
produto, não lê depósito, não escreve nada no Tiny, não tem webhook. Declarar
qualquer outra capability permitiria ao motor tentar uma operação que não existe
aqui — a 043 documenta essa coluna exatamente como esse gate.

## Status
'available': diferente dos providers 'planned', esta fonte tem tela funcionando
(Produtos → Fonte de Saldo). Mesmo critério que a 058 usou para o Tiny.

## Reversível
DELETE FROM integration_providers WHERE key = 'tiny_stock_sheet';
(o DELETE só passa se nenhuma conexão referenciar a key — o FK protege o dado
do cliente, que é o comportamento correto.)
*/

INSERT INTO public.integration_providers (key, name, kind, status, capabilities, docs_url)
VALUES (
  'tiny_stock_sheet',
  'Tiny — Estoque diário',
  'erp',
  'available',
  '{"read_stock":true}',
  NULL
)
ON CONFLICT (key) DO NOTHING;
