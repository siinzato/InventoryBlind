/*
# Corrige search_path mutável no trigger de canal de origem

O advisor de segurança apontou que returns_check_origin_channel_connection
(091) foi criada sem SET search_path — mesmo achado e mesma correção já
aplicados a integration_connections_check_fiscal_entity na migration 089.
Correção pontual, mesmo comportamento, sem mudar nenhuma regra de negócio.
*/

CREATE OR REPLACE FUNCTION public.returns_check_origin_channel_connection()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.origin_channel_connection_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM integration_connections
    WHERE id = NEW.origin_channel_connection_id AND company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'A conta de canal informada não pertence a esta empresa.';
  END IF;
  RETURN NEW;
END;
$$;
