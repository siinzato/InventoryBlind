/*
# 123 — Ciclagem: o dia programado chegou e o lote ainda não saiu

A 122 guardou a cadência; a fatia seguinte fez o lote virar contagem física com
um clique. Faltava a parte que decide se isso acontece todo dia: hoje, lembrar
de gerar a contagem depende de alguém lembrar de abrir a tela.

## O que é agendado: o lembrete, não a geração

A rotina daqui NÃO cria contagem nenhuma. Ela percebe que o dia programado
chegou e que a contagem de hoje ainda não existe, e avisa quem pode agir.

Isso é deliberado. O lote do dia é calculado na aplicação, cruzando catálogo,
curva ABC, última contagem (de duas origens) e o saldo da Fonte de Saldo. Para o
banco gerar sozinho, essa regra teria de ser reescrita aqui em SQL — e duas
implementações da mesma regra divergem em silêncio. O dia em que a tela
mostrasse um lote e esta rotina criasse outro, ninguém descobriria até alguém
comparar os dois. Lembrar é barato e não tem esse risco; gerar sozinho só vale
com UMA implementação da regra, e esse caminho (reusar o mesmo módulo numa Edge
Function) continua aberto sem desfazer nada daqui.

## Os dois avisos

| Situação no dia programado | Aviso |
|---|---|
| contagem de ciclagem de um dia anterior ainda aberta | `contagem_atrasada` |
| nenhuma contagem de ciclagem criada para hoje | `lote_pendente` |
| contagem de hoje já existe (aberta ou concluída) | nada |

A ordem importa: uma contagem de ontem ainda aberta vence o lote de hoje. Ela é
o problema mais caro — a tela de hoje recalcula o lote e não mostra a sessão de
ontem, então é exatamente o caso que passa despercebido. Gerar a de hoje por
cima dividiria a equipe em duas listas.

## Quem recebe

Todo mundo que pode gerar ou executar a contagem: owner, admin, manager, lead e
counter — a mesma lista que tem `inventory.write` na aplicação. Viewer não
recebe: avisar quem não pode agir é o começo do sino ignorado.

## Como a marca do dia é reconhecida

A sessão gerada pela ciclagem é marcada em `street_from = 'Ciclagem'` e
`street_to = 'DD/MM/YYYY'` (ver `cycleSessionRange` em cycleProgramDomain.ts).
Este é um contrato entre os dois lados: mudar o formato do rótulo na aplicação
sem mudar o `to_char` daqui faz a rotina deixar de enxergar a contagem do dia e
passar a avisar todo dia que o lote não saiu. Há teste travando os dois lados.

## Duplicidade

`UNIQUE (user_id, reference_date)`: no máximo um aviso de ciclagem por pessoa
por dia, qualquer que seja o motivo. Isso é o que torna a rotina idempotente —
ela roda de hora em hora e a segunda passagem não escreve nada. Também é por
isso que a condição de hora é `>=` e não `=`: se o agendador atrasar, o aviso
do dia ainda sai, e não sai duas vezes.

## Escrita

Sem policy de INSERT nem de UPDATE, como em `support_notifications` (121): os
avisos nascem na rotina e marcar como lido passa por RPC própria. Nem a
mensagem do próprio aviso pode ser reescrita pelo cliente.

## Compatibilidade

Aditiva. As colunas novas em `cycle_program_settings` nascem com o agendamento
DESLIGADO, então nenhuma empresa existente começa a receber aviso por causa
desta migration. Nenhuma função, policy ou tabela existente foi alterada.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Agendamento na configuração do programa
--
-- Colunas e não jsonb, pelo mesmo motivo da 122: o CHECK recusa no banco
-- exatamente o que o formulário recusa na tela, e as duas regras não podem
-- divergir com o tempo.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE cycle_program_settings
  -- Separado de `enabled`: ter o programa configurado e não querer ser cobrado
  -- todo dia é uma posição legítima. Nasce desligado.
  ADD COLUMN IF NOT EXISTS schedule_enabled boolean NOT NULL DEFAULT false,

  -- 0 = domingo, igual a EXTRACT(DOW) e a Date.getDay() na aplicação. Padrão de
  -- segunda a sexta: contagem cíclica acompanha o turno, e aviso de sábado só
  -- chega para ninguém ler.
  ADD COLUMN IF NOT EXISTS schedule_weekdays smallint[] NOT NULL DEFAULT '{1,2,3,4,5}'::smallint[],

  -- Hora local a partir da qual o aviso do dia vale.
  ADD COLUMN IF NOT EXISTS schedule_hour smallint NOT NULL DEFAULT 8,

  -- Fuso por empresa, mesmo padrão do agendador de automações (053). Em UTC,
  -- "às 08:00" chegaria às 5h da manhã para um cliente brasileiro.
  ADD COLUMN IF NOT EXISTS schedule_timezone text NOT NULL DEFAULT 'America/Sao_Paulo';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cycle_program_settings_schedule_hour_check'
  ) THEN
    ALTER TABLE cycle_program_settings
      ADD CONSTRAINT cycle_program_settings_schedule_hour_check
      CHECK (schedule_hour BETWEEN 0 AND 23);
  END IF;

  -- Pelo menos um dia, e todos entre 0 e 6. Lista vazia é o estado perigoso:
  -- um agendamento LIGADO que nunca dispara parece configurado e não é.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cycle_program_settings_schedule_weekdays_check'
  ) THEN
    ALTER TABLE cycle_program_settings
      ADD CONSTRAINT cycle_program_settings_schedule_weekdays_check
      CHECK (
        array_length(schedule_weekdays, 1) BETWEEN 1 AND 7
        AND schedule_weekdays <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
      );
  END IF;
END $$;

COMMENT ON COLUMN cycle_program_settings.schedule_weekdays IS
  'Dias da semana em que a contagem cíclica é esperada. 0 = domingo, igual a EXTRACT(DOW).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Canal de avisos
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.cycle_program_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('lote_pendente', 'contagem_atrasada')),
  message    text NOT NULL,

  -- O dia a que o aviso se refere, no fuso da empresa — não a data em que a
  -- linha foi escrita. É o que torna a rotina idempotente.
  reference_date date NOT NULL,

  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- No máximo um aviso de ciclagem por pessoa por dia, qualquer que seja o
  -- motivo. Dois avisos no mesmo dia seriam ruído sobre o mesmo assunto.
  CONSTRAINT cycle_program_notifications_one_per_day UNIQUE (user_id, reference_date)
);

CREATE INDEX IF NOT EXISTS cycle_program_notifications_user_idx
  ON public.cycle_program_notifications (user_id, created_at DESC);

ALTER TABLE public.cycle_program_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cycle_program_notifications_select" ON public.cycle_program_notifications;
CREATE POLICY "cycle_program_notifications_select" ON public.cycle_program_notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- Sem policy de INSERT/UPDATE/DELETE: a rotina escreve, a RPC marca como lido.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
      AND tablename = 'cycle_program_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cycle_program_notifications;
  END IF;
END $$;

COMMENT ON TABLE public.cycle_program_notifications IS
  'Avisos do programa de ciclagem no sino pessoal. Escritos pela rotina cycle_program_generate_reminders; o cliente só lê e marca como lido.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Marcar como lido (p_ids NULL = todas as minhas não lidas)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cycle_program_notifications_mark_read(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE cycle_program_notifications
  SET read_at = now()
  WHERE user_id = auth.uid() AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cycle_program_notifications_mark_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cycle_program_notifications_mark_read(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. A rotina
--
-- Roda de hora em hora e não escreve nada fora do dia programado. Não cria
-- contagem, não lê catálogo, não calcula lote: tudo o que ela sabe sobre o lote
-- é se a sessão do dia existe ou não.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cycle_program_generate_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_empresa      record;
  v_local        timestamp;
  v_hoje         date;
  v_rotulo       text;
  v_rotulo_velho text;
  v_kind         text;
  v_message      text;
BEGIN
  FOR v_empresa IN
    SELECT company_id, schedule_weekdays, schedule_hour, schedule_timezone
      FROM cycle_program_settings
     WHERE enabled AND schedule_enabled
  LOOP
    -- "Hoje" e "que horas são" no fuso da empresa, não no do servidor.
    v_local := now() AT TIME ZONE coalesce(nullif(v_empresa.schedule_timezone, ''), 'America/Sao_Paulo');
    v_hoje  := v_local::date;

    CONTINUE WHEN NOT (EXTRACT(DOW FROM v_hoje)::smallint = ANY (v_empresa.schedule_weekdays));
    -- `>=`: uma passagem atrasada do agendador ainda entrega o aviso do dia. A
    -- unicidade por (user_id, reference_date) impede que entregue duas vezes.
    CONTINUE WHEN EXTRACT(HOUR FROM v_local)::smallint < v_empresa.schedule_hour;

    v_rotulo := to_char(v_hoje, 'DD/MM/YYYY');

    -- Contagem de ciclagem de OUTRO dia ainda aberta. A mais antiga primeiro:
    -- é a que está parada há mais tempo.
    SELECT s.street_to INTO v_rotulo_velho
      FROM physical_count_sessions s
     WHERE s.company_id = v_empresa.company_id
       AND s.street_from = 'Ciclagem'
       AND s.street_to <> v_rotulo
       AND s.deleted_at IS NULL
       AND s.status IN ('draft', 'in_progress')
     ORDER BY s.created_at ASC
     LIMIT 1;

    IF v_rotulo_velho IS NOT NULL THEN
      v_kind := 'contagem_atrasada';
      v_message := 'A contagem de ciclagem de ' || v_rotulo_velho ||
                   ' ainda está aberta. Conclua antes de gerar o lote de hoje.';
    ELSIF NOT EXISTS (
      -- Qualquer status serve: se a contagem de hoje já foi criada e até
      -- concluída, o lote do dia saiu e não há o que lembrar.
      SELECT 1 FROM physical_count_sessions s
       WHERE s.company_id = v_empresa.company_id
         AND s.street_from = 'Ciclagem'
         AND s.street_to = v_rotulo
         AND s.deleted_at IS NULL
    ) THEN
      v_kind := 'lote_pendente';
      v_message := 'Hoje é dia de contagem cíclica e o lote ainda não foi gerado.';
    ELSE
      CONTINUE;
    END IF;

    INSERT INTO cycle_program_notifications (company_id, user_id, kind, message, reference_date)
    SELECT v_empresa.company_id, p.id, v_kind, v_message, v_hoje
      FROM profiles p
     WHERE p.company_id = v_empresa.company_id
       AND p.role IN ('owner', 'admin', 'manager', 'lead', 'counter')
    ON CONFLICT ON CONSTRAINT cycle_program_notifications_one_per_day DO NOTHING;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.cycle_program_generate_reminders() FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Agendamento
--
-- De hora em hora, no minuto 0: a hora escolhida pela empresa é lida no fuso
-- dela, então a granularidade de hora é exatamente a que a configuração oferece.
-- Mesmo padrão dos crons de tarefas (070/071).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('cycle-program-reminders')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cycle-program-reminders');
    PERFORM cron.schedule('cycle-program-reminders', '0 * * * *',
      $cron$SELECT public.cycle_program_generate_reminders();$cron$);
  END IF;
END $$;
