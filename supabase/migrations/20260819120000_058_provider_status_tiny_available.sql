/*
# Catálogo de integrações — status real do Tiny

## Summary
`integration_providers.status` do Tiny ainda estava em 'planned', o valor de semeadura
da 042, apesar de o Tiny ser o único provider com connector implementado
(src/lib/integrations/providers/tiny), com sync, webhook e escrita de estoque em
produção desde a 042/043. O catálogo declarava como "planejado" a única integração que
de fato existe.

Só o status do Tiny muda. As `capabilities` dos demais providers NÃO são tocadas: a 043
documenta explicitamente aquela coluna como "o que a API do fornecedor oferece", que
gateia o que um connector poderá tentar *quando existir* — não como declaração de que
já construímos a integração. Quem separa "existe" de "não existe" é `status`, e a UI
(IntegrationsPage) já filtra pelos providers com connector registrado.

## Escopo
Somente dados. Nenhuma mudança de schema, policy, RLS, grant, função ou índice.
Reversível com um UPDATE simétrico.
*/

UPDATE public.integration_providers
   SET status = 'available'
 WHERE key = 'tiny'
   AND status <> 'available';
