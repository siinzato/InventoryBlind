-- ─────────────────────────────────────────────────────────────────────────────
-- 054 — Alinha o tipo de evento do agendador com o do gatilho
--
-- A 053 emitia `schedule.tick`, e o registry declara o gatilho como `schedule`. O
-- despacho do engine casa `automations.trigger_type = automation_events.event_type`,
-- então a automação agendada nunca seria encontrada: o evento entraria na fila, o
-- worker não acharia interessado, e o usuário veria uma automação ativa que nunca
-- roda — sem erro em lugar nenhum.
--
-- Este é o invariante do módulo: **o tipo do gatilho e o tipo do evento são a mesma
-- string**. Vale para todos os outros gatilhos (count.item_counted,
-- count.session_finalized, stock.discrepancy_detected, webhook.received); só o
-- agendador tinha saído da regra. Coberto agora por teste em
-- src/lib/automation/__tests__/automation.test.ts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION automation_emit_due_schedules()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_row     record;
  v_emitted integer := 0;
BEGIN
  FOR v_row IN
    SELECT id, company_id, name, schedule_kind, schedule_minutes, schedule_hour,
           schedule_minute, schedule_weekday, schedule_timezone
      FROM automations
     WHERE status = 'active'
       AND trigger_type = 'schedule'
       AND schedule_next_run_at IS NOT NULL
       AND schedule_next_run_at <= now()
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM automation_emit_event(
      v_row.company_id,
      -- Era 'schedule.tick'. Igual ao trigger_type, senão o despacho não casa.
      'schedule',
      jsonb_build_object(
        'schedule', jsonb_build_object(
          'automationId', v_row.id,
          'automationName', v_row.name,
          'kind', v_row.schedule_kind,
          'firedAt', now(),
          'timezone', v_row.schedule_timezone
        )
      ),
      'automations',
      v_row.id
    );

    UPDATE automations
       SET schedule_next_run_at = automation_next_schedule_run(
             v_row.schedule_kind, v_row.schedule_minutes, v_row.schedule_hour,
             v_row.schedule_minute, v_row.schedule_weekday, v_row.schedule_timezone, now()
           )
     WHERE id = v_row.id;

    v_emitted := v_emitted + 1;
  END LOOP;

  RETURN v_emitted;
END;
$fn$;

REVOKE ALL ON FUNCTION automation_emit_due_schedules() FROM PUBLIC, anon, authenticated;

-- Nenhum evento 'schedule.tick' existe em produção (o agendador nunca teve automação
-- para disparar), então não há dado a migrar. Se houvesse, ficaria pendente para
-- sempre sem interessado — por isso a limpeza abaixo, que é barata e idempotente.
UPDATE automation_events
   SET status = 'skipped', processed_at = now()
 WHERE event_type = 'schedule.tick' AND status = 'pending';
