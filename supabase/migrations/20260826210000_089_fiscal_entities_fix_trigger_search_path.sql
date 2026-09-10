/*
# Corrige search_path mutável no trigger de vínculo empresa fiscal ↔ conexão

O advisor de segurança do Supabase apontou que
`integration_connections_check_fiscal_entity` (migration 087) foi criada sem
`SET search_path`, deixando a resolução de `fiscal_entities` sujeita ao
search_path da sessão que dispara o trigger — mesmo risco que todas as
outras funções deste projeto já fixam com `SET search_path`. Correção
pontual, mesmo comportamento, sem mudar nenhuma regra de negócio.
*/

CREATE OR REPLACE FUNCTION public.integration_connections_check_fiscal_entity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.fiscal_entity_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM fiscal_entities fe
      WHERE fe.id = NEW.fiscal_entity_id AND fe.company_id = NEW.company_id
    ) THEN
      RAISE EXCEPTION 'A empresa fiscal selecionada não pertence a este workspace.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
