/*
# Backfill: empresa fiscal do workspace AZ

Aplica o CNPJ autorizado (10256416000129) ao workspace AZ, já identificado
por consulta somente-leitura antes desta migration:

  SELECT id, name, slug, owner_id FROM companies WHERE name = 'AZ';
  -> id = '00000000-0000-0000-0000-000000000001', name = 'AZ', slug = 'az',
     owner_id = NULL

Esse mesmo id já é o valor fixo usado pela seed original do workspace AZ em
`009_seed_az_company.sql` — não é uma suposição nova. Usa o id como literal
(nunca `WHERE name = 'AZ'`), e é idempotente: uma segunda execução não cria
linha nem grava novo evento de auditoria.

Razão social: não inventada — reaproveita `companies.name` ('AZ') como nome
de exibição provisório e marca `data_incomplete = true`, para que a razão
social definitiva seja preenchida depois via `fiscal_entities_update` (que já
zera `data_incomplete`).
*/

DO $$
DECLARE
  v_company_id constant uuid := '00000000-0000-0000-0000-000000000001';
  v_cnpj       constant text := '10256416000129';
  v_owner_id   uuid;
  v_existing   fiscal_entities;
  v_new_id     uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = v_company_id AND name = 'AZ') THEN
    RAISE NOTICE 'fiscal_entities_az_backfill: workspace AZ (%) não encontrado com esse id — nada foi feito.', v_company_id;
    RETURN;
  END IF;

  SELECT * INTO v_existing FROM fiscal_entities WHERE company_id = v_company_id AND cnpj = v_cnpj;
  IF v_existing.id IS NOT NULL THEN
    RAISE NOTICE 'fiscal_entities_az_backfill: já aplicado (fiscal_entities.id = %) — idempotente, nada foi feito.', v_existing.id;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM fiscal_entities WHERE company_id = v_company_id) THEN
    RAISE NOTICE 'fiscal_entities_az_backfill: workspace AZ já possui empresa fiscal com CNPJ diferente — conflito, backfill interrompido para revisão manual.';
    RETURN;
  END IF;

  IF NOT is_valid_cnpj(v_cnpj) THEN
    RAISE NOTICE 'fiscal_entities_az_backfill: CNPJ % não passou na validação de dígitos verificadores — nada foi feito.', v_cnpj;
    RETURN;
  END IF;

  SELECT owner_id INTO v_owner_id FROM companies WHERE id = v_company_id;

  INSERT INTO fiscal_entities (
    company_id, legal_name, cnpj, is_default, status, data_incomplete, created_by
  ) VALUES (
    v_company_id, 'AZ', v_cnpj, true, 'active', true, v_owner_id
  )
  RETURNING id INTO v_new_id;

  INSERT INTO audit_logs (company_id, user_id, user_email, action, resource_type, resource_id, description, metadata)
  VALUES (
    v_company_id, v_owner_id, '',
    'fiscal_entity.created', 'fiscal_entities', v_new_id::text,
    'Empresa fiscal aplicada via backfill administrativo.',
    jsonb_build_object('cnpj', v_cnpj, 'source', 'az_backfill')
  );
END;
$$;
