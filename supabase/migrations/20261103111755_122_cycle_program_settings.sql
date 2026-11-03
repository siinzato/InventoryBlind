-- ─────────────────────────────────────────────────────────────────────────────
-- 122 — Programa de ciclagem: cadência por classe e lote diário, por empresa
--
-- A tela "Cobertura de Contagem" (só leitura) mostra o atraso usando uma cadência
-- fixa no código: A 30 dias, B 90, C 180. Funciona para diagnosticar, mas não
-- para programar: a frequência certa depende do giro, do tamanho da equipe e do
-- turno de cada operação. Esta migration guarda essa configuração.
--
-- ── O que NÃO foi criado, de propósito ──────────────────────────────────────
-- Nenhuma tabela de "lote do dia". O lote é DERIVADO do catálogo, da curva ABC e
-- da data da última contagem — três coisas que o banco já guarda. Materializá-lo
-- criaria uma quarta fonte de verdade que precisaria ser invalidada toda vez que
-- alguém contasse um item, e um lote gravado de ontem apareceria hoje pedindo a
-- contagem de um SKU já contado.
--
-- Quando o lote virar uma sessão de contagem de verdade (a fatia seguinte), ele
-- vira `physical_count_sessions` — que já existe, já tem recontagem, aprovação e
-- histórico. Não haverá tabela nova para isso também.
--
-- Nada de coluna `products.last_counted_at`: a data da última contagem é lida das
-- duas origens que já a gravam (inventário por SKU e contagem física). Uma coluna
-- nova precisaria de gatilho em dois fluxos para não nascer desatualizada.
--
-- ── Por que colunas e não um jsonb de cadências ─────────────────────────────
-- Um `jsonb` guardaria as quatro cadências em menos linhas, e aceitaria calado
-- uma cadência zero, negativa ou com a classe escrita errada. Em coluna, o CHECK
-- recusa no banco exatamente o que o formulário recusa na tela, e as duas regras
-- não podem divergir com o tempo.
--
-- ── Compatibilidade ─────────────────────────────────────────────────────────
-- Aditiva. Nenhuma tabela, função ou policy existente foi alterada. Empresa sem
-- linha aqui continua com o comportamento de hoje: a aplicação usa os padrões e
-- o programa nasce DESLIGADO — gerar trabalho para a equipe sozinho é decisão de
-- quem gere, não efeito colateral de uma atualização.
--
-- Segue o padrão de tabela de configuração do próprio projeto (049
-- physical_count_recount_settings / rca_settings): chave é company_id, leitura
-- para a empresa inteira, escrita só para quem manda.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS cycle_program_settings (
  company_id uuid PRIMARY KEY DEFAULT get_my_company_id()::uuid
    REFERENCES companies(id) ON DELETE CASCADE,

  enabled boolean NOT NULL DEFAULT false,

  -- Cadência em dias por classe da curva ABC. Os limites são de sanidade, não de
  -- negócio: 1 dia é o menor intervalo que ainda significa alguma coisa, e 3650
  -- (dez anos) é mais do que qualquer política real de ciclagem.
  cadence_days_a integer NOT NULL DEFAULT 30 CHECK (cadence_days_a BETWEEN 1 AND 3650),
  cadence_days_b integer NOT NULL DEFAULT 90 CHECK (cadence_days_b BETWEEN 1 AND 3650),
  cadence_days_c integer NOT NULL DEFAULT 180 CHECK (cadence_days_c BETWEEN 1 AND 3650),

  -- Produto sem curva apurada. Coluna própria, e não "usa a de C": são situações
  -- diferentes — C é "giro baixo, medido", sem classificação é "não medimos" —
  -- e juntá-las esconderia quantos itens estão sem base para decidir frequência.
  cadence_days_unclassified integer NOT NULL DEFAULT 180
    CHECK (cadence_days_unclassified BETWEEN 1 AND 3650),

  -- Quantos SKUs a equipe conta por dia. O teto de 200 não é capricho: lote que
  -- não termina no turno não vira contagem, vira sessão aberta para sempre.
  daily_capacity integer NOT NULL DEFAULT 30 CHECK (daily_capacity BETWEEN 1 AND 200),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cycle_program_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Leitura para a empresa inteira: quem conta precisa ver com que frequência o
  -- próprio trabalho é esperado, e não há segredo nenhum numa cadência.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cycle_program_settings' AND policyname = 'cycle_program_settings_select'
  ) THEN
    CREATE POLICY cycle_program_settings_select ON cycle_program_settings
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  -- Escrita só para quem manda: esta configuração decide quanto trabalho de
  -- contagem o sistema coloca na fila da equipe todo dia.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cycle_program_settings' AND policyname = 'cycle_program_settings_insert'
  ) THEN
    CREATE POLICY cycle_program_settings_insert ON cycle_program_settings
      FOR INSERT TO authenticated
      WITH CHECK (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cycle_program_settings' AND policyname = 'cycle_program_settings_update'
  ) THEN
    CREATE POLICY cycle_program_settings_update ON cycle_program_settings
      FOR UPDATE TO authenticated
      USING (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      )
      WITH CHECK (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      );
  END IF;
END $$;

-- Sem policy de DELETE: apagar a configuração não é uma operação com significado
-- — quem quer parar o programa desliga `enabled`, o que preserva a cadência
-- escolhida para quando religar. Sem policy, o DELETE é negado pelo RLS.

DROP TRIGGER IF EXISTS cycle_program_settings_updated_at ON cycle_program_settings;
CREATE TRIGGER cycle_program_settings_updated_at
  BEFORE UPDATE ON cycle_program_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE cycle_program_settings IS
  'Programa de ciclagem por empresa: cadência de recontagem por classe ABC e tamanho do lote diário. O lote em si nunca é gravado — é derivado do catálogo, da curva e da última contagem.';
