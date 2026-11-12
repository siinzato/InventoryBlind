-- ─────────────────────────────────────────────────────────────────────────────
-- 126 — Meta de acuracidade (IRA) por empresa
--
-- A meta de 95% estava fixa no código e escrita na tela como se fosse do produto.
-- Não é: 95% é a meta que a AZ estabeleceu para a própria operação. Outra empresa
-- opera com outro número, e uma meta que não é da empresa não serve para decidir
-- nada — vira um rótulo que todo mundo aprende a ignorar.
--
-- ── Por que duas colunas e não só a meta ────────────────────────────────────
-- A régua tem dois cortes, não um: acima da meta é verde, abaixo do piso é
-- vermelho, e entre os dois é atenção. Guardar só a meta obrigaria a derivar o
-- piso por alguma fórmula arbitrária (meta menos 15?), e uma empresa que
-- baixasse a meta para 75 herdaria um piso de 80 — maior que a própria meta,
-- deixando a faixa de atenção vazia. O CHECK abaixo torna isso impossível.
--
-- ── Por que o CHECK repete a validação da tela ──────────────────────────────
-- O formulário já recusa piso >= meta. O banco recusa de novo porque as duas
-- regras não podem divergir com o tempo, e porque a tela não é o único caminho
-- de escrita possível. Mesmo motivo dos CHECKs de 122.
--
-- ── Compatibilidade ─────────────────────────────────────────────────────────
-- Aditiva. Nenhuma tabela, função ou policy existente foi alterada. Empresa sem
-- linha aqui vale 95/80, exatamente o comportamento de hoje — inclusive a AZ,
-- até alguém configurar. Nenhum número muda por efeito desta migration.
--
-- Segue o padrão de tabela de configuração do projeto (049
-- physical_count_recount_settings, 122 cycle_program_settings): chave é
-- company_id, leitura para a empresa inteira, escrita só para quem manda.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS accuracy_target_settings (
  company_id uuid PRIMARY KEY DEFAULT get_my_company_id()::uuid
    REFERENCES companies(id) ON DELETE CASCADE,

  -- A partir daqui a acuracidade está dentro da meta. numeric(5,2) porque metas
  -- de IRA maduras usam decimal (99,5%), e arredondar para inteiro apagaria a
  -- diferença entre 99% e 99,5% — que em catálogo grande são centenas de peças.
  target_pct numeric(5,2) NOT NULL DEFAULT 95
    CHECK (target_pct >= 0 AND target_pct <= 100),

  -- Abaixo daqui é crítico. Entre o piso e a meta é atenção.
  warning_floor_pct numeric(5,2) NOT NULL DEFAULT 80
    CHECK (warning_floor_pct >= 0 AND warning_floor_pct <= 100),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT accuracy_floor_below_target CHECK (warning_floor_pct < target_pct)
);

ALTER TABLE accuracy_target_settings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Leitura para a empresa inteira: a meta aparece em todas as telas de
  -- acuracidade, e quem conta precisa saber contra o que está sendo medido.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accuracy_target_settings' AND policyname = 'accuracy_target_settings_select'
  ) THEN
    CREATE POLICY accuracy_target_settings_select ON accuracy_target_settings
      FOR SELECT TO authenticated
      USING ((company_id)::text = get_my_company_id());
  END IF;

  -- Escrita só para quem manda: mudar a meta muda a leitura de verde/vermelho em
  -- toda a operação de uma vez.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accuracy_target_settings' AND policyname = 'accuracy_target_settings_insert'
  ) THEN
    CREATE POLICY accuracy_target_settings_insert ON accuracy_target_settings
      FOR INSERT TO authenticated
      WITH CHECK (
        (company_id)::text = get_my_company_id()
        AND get_my_role() = ANY (ARRAY['owner', 'admin', 'manager'])
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'accuracy_target_settings' AND policyname = 'accuracy_target_settings_update'
  ) THEN
    CREATE POLICY accuracy_target_settings_update ON accuracy_target_settings
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

-- Sem policy de DELETE: apagar a linha não é uma operação com significado — quem
-- quer voltar ao padrão grava 95/80. Sem policy, o DELETE é negado pelo RLS.

DROP TRIGGER IF EXISTS accuracy_target_settings_updated_at ON accuracy_target_settings;
CREATE TRIGGER accuracy_target_settings_updated_at
  BEFORE UPDATE ON accuracy_target_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE accuracy_target_settings IS
  'Meta de acuracidade (IRA) por empresa: a partir de target_pct está dentro da meta, abaixo de warning_floor_pct e critico. Empresa sem linha vale 95/80. A meta nunca foi do produto — e de cada operacao.';
