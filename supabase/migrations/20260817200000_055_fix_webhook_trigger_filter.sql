-- ─────────────────────────────────────────────────────────────────────────────
-- 055 — Corrige o filtro de gatilho do webhook de entrada
--
-- `automation_resolve_webhook` filtrava `trigger_type = 'webhook'`, e o registry
-- declara o gatilho como `webhook.received` — que é o valor gravado em
-- automations.trigger_type. Resultado: nenhuma automação era resolvida e toda
-- entrega, mesmo com assinatura válida, respondia 404 "Webhook não reconhecido".
--
-- É a MESMA classe de defeito que a 054 corrigiu no agendador: uma string literal de
-- tipo de gatilho fora de sincronia com o registry. Corrigi lá e deixei passar aqui,
-- no mesmo arquivo.
--
-- O invariante do módulo é: **o tipo do gatilho é uma única string, definida no
-- registry, e todo lugar que a compara usa exatamente ela**. Vale para o emissor
-- (054) e para qualquer filtro (055).
--
-- O teste em TypeScript cobre a metade do emissor; um filtro em SQL não é
-- alcançável de lá. A verificação executada após esta migration resolve uma
-- automação real e confere que o retorno não é vazio.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION automation_resolve_webhook(p_automation_id uuid)
RETURNS TABLE (automation_id uuid, company_id uuid, secret text, is_active boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT a.id, a.company_id, s.secret, (a.status = 'active')
    FROM automations a
    JOIN automation_webhook_secrets s ON s.automation_id = a.id
   WHERE a.id = p_automation_id
     -- Era 'webhook'. O valor gravado é a chave do registry.
     AND a.trigger_type = 'webhook.received';
$fn$;

REVOKE ALL ON FUNCTION automation_resolve_webhook(uuid) FROM PUBLIC, anon, authenticated;
