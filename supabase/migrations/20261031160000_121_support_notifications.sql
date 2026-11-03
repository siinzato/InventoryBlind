/*
# 121 — Suporte: aviso no sino quando o chamado se mexe

Sem isto, descobrir que o chamado foi respondido depende de a pessoa lembrar de
voltar na tela — e quem abriu chamado já está ocupado com outra coisa.

## Quem é avisado

| Aconteceu | Avisa |
|---|---|
| chamado aberto | quem responde aquele canal |
| quem responde respondeu | quem abriu |
| quem abriu mandou mais informação | quem responde |
| resolvido | o outro lado |
| reaberto | o outro lado |

"Quem responde" depende do canal, e é a mesma regra da 119, não uma segunda
cópia dela: `interno` → owner/admin daquela empresa; `produto` → quem está em
`support_staff`. Staff continua sem alcançar chamado interno de cliente, aqui
inclusive — ninguém recebe aviso de conversa que não pode ler.

Quem agiu nunca é avisado da própria ação.

## Escrita

Sem policy de INSERT nem de UPDATE. As notificações nascem dentro das RPCs do
suporte, e marcar como lida passa por RPC própria. `task_notifications` deixa a
UPDATE aberta por `user_id = auth.uid()`, o que permite ao cliente reescrever a
mensagem da própria notificação; é inofensivo lá, mas não é motivo para repetir
aqui.

## SELECT sem recorte de empresa

Ao contrário de `task_notifications`, a policy NÃO exige
`company_id = get_my_company_id()`: o staff recebe aviso de chamado de outras
empresas, e esse recorte apagaria justamente esses.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tabela
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ticket_id  uuid REFERENCES public.support_tickets(id) ON DELETE SET NULL,
  kind       text NOT NULL CHECK (kind IN ('aberto', 'respondido', 'mensagem', 'resolvido', 'reaberto')),
  -- Para qual tela o clique leva: 'author' abre Meus chamados, 'answerers' abre
  -- a caixa de entrada. Guardado aqui porque o tipo sozinho não resolve —
  -- 'resolvido' e 'reaberto' caem nos dois lados, dependendo de quem agiu.
  audience   text NOT NULL CHECK (audience IN ('author', 'answerers')),
  message    text NOT NULL,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_notifications_user_idx
  ON public.support_notifications (user_id, created_at DESC);

ALTER TABLE public.support_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_notifications_select" ON public.support_notifications;
CREATE POLICY "support_notifications_select" ON public.support_notifications FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- Realtime: o aviso aparece sem recarregar, igual ao sino de tarefas. O filtro
-- do canal é conveniência de rede; a barreira é a policy acima.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'support_notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.support_notifications;
  END IF;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. support_notify — distribui o aviso para o público certo
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_notify(
  p_ticket_id uuid,
  p_audience  text,   -- 'author' | 'answerers'
  p_kind      text,
  p_message   text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t support_tickets;
BEGIN
  SELECT * INTO t FROM support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_audience = 'author' THEN
    -- Quem agiu não é avisado da própria ação.
    IF t.created_by <> auth.uid() THEN
      INSERT INTO support_notifications (user_id, ticket_id, kind, message, audience)
      VALUES (t.created_by, p_ticket_id, p_kind, p_message, 'author');
    END IF;
    RETURN;
  END IF;

  IF t.channel = 'produto' THEN
    INSERT INTO support_notifications (user_id, ticket_id, kind, message, audience)
    SELECT s.user_id, p_ticket_id, p_kind, p_message, 'answerers'
    FROM support_staff s
    WHERE s.user_id <> auth.uid();
  ELSE
    INSERT INTO support_notifications (user_id, ticket_id, kind, message, audience)
    SELECT p.id, p_ticket_id, p_kind, p_message, 'answerers'
    FROM profiles p
    WHERE p.company_id = t.company_id
      AND p.role IN ('owner', 'admin')
      AND p.id <> auth.uid();
  END IF;
END;
$$;

-- Nunca chamada pelo cliente: só pelas RPCs do suporte, que já rodam como dono.
REVOKE ALL ON FUNCTION public.support_notify(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Marcar como lida — por RPC, para a mensagem não ser reescrita pelo cliente
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_notifications_mark_read(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE support_notifications
  SET read_at = now()
  WHERE user_id = auth.uid() AND read_at IS NULL
    AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.support_notifications_mark_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_notifications_mark_read(uuid[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. As três RPCs do suporte passam a avisar
--    Corpos conferidos contra pg_get_functiondef da versão viva antes de
--    redeclarar (119 para open/set_status, 120 para reply). Só as chamadas a
--    support_notify foram acrescentadas.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_ticket_open(
  p_channel     text,
  p_category    text,
  p_subject     text,
  p_body        text,
  p_priority    text DEFAULT 'normal',
  p_context     jsonb DEFAULT '{}'::jsonb,
  p_attachments text[] DEFAULT '{}'::text[]
)
RETURNS support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company uuid;
  v_role    text;
  v_ticket  support_tickets;
  v_path    text;
BEGIN
  SELECT company_id, role INTO v_company, v_role FROM profiles WHERE id = auth.uid();
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Usuário sem empresa ativa.' USING ERRCODE = '42501';
  END IF;

  IF p_channel NOT IN ('produto', 'interno') THEN
    RAISE EXCEPTION 'Canal inválido.' USING ERRCODE = '22023';
  END IF;

  IF p_channel = 'produto' AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas proprietário ou administrador pode abrir chamado ao InventoryBlind.' USING ERRCODE = '42501';
  END IF;

  FOREACH v_path IN ARRAY coalesce(p_attachments, '{}'::text[]) LOOP
    IF v_path NOT LIKE v_company::text || '/%' THEN
      RAISE EXCEPTION 'Anexo fora da pasta da empresa.' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  INSERT INTO support_tickets (company_id, channel, created_by, subject, category, priority, context)
  VALUES (v_company, p_channel, auth.uid(), btrim(p_subject), p_category,
          coalesce(p_priority, 'normal'), coalesce(p_context, '{}'::jsonb))
  RETURNING * INTO v_ticket;

  INSERT INTO support_ticket_messages (ticket_id, author_id, body, attachments)
  VALUES (v_ticket.id, auth.uid(), btrim(p_body), coalesce(p_attachments, '{}'::text[]));

  PERFORM support_notify(v_ticket.id, 'answerers', 'aberto', 'Novo chamado: ' || v_ticket.subject);

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_open(text, text, text, text, text, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_open(text, text, text, text, text, jsonb, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_ticket_reply(
  p_ticket_id   uuid,
  p_body        text,
  p_attachments text[] DEFAULT '{}'::text[]
)
RETURNS support_ticket_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role    text;
  v_ticket  support_tickets;
  v_message support_ticket_messages;
  v_company uuid;
  v_path    text;
BEGIN
  v_role := support_my_role_on(p_ticket_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado ou sem acesso.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id;

  IF v_ticket.status = 'resolvido' THEN
    RAISE EXCEPTION 'Chamado resolvido. Reabra antes de responder.' USING ERRCODE = '22023';
  END IF;

  SELECT company_id INTO v_company FROM profiles WHERE id = auth.uid();

  FOREACH v_path IN ARRAY coalesce(p_attachments, '{}'::text[]) LOOP
    IF v_company IS NULL OR v_path NOT LIKE v_company::text || '/%' THEN
      RAISE EXCEPTION 'Anexo fora da pasta da empresa.' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  INSERT INTO support_ticket_messages (ticket_id, author_id, body, attachments)
  VALUES (p_ticket_id, auth.uid(), btrim(p_body), coalesce(p_attachments, '{}'::text[]))
  RETURNING * INTO v_message;

  UPDATE support_tickets SET
    status = CASE WHEN v_role = 'answerer' THEN 'respondido' ELSE 'em_analise' END,
    first_response_at = CASE
      WHEN v_role = 'answerer' AND first_response_at IS NULL THEN now()
      ELSE first_response_at
    END,
    updated_at = now()
  WHERE id = p_ticket_id;

  IF v_role = 'answerer' THEN
    PERFORM support_notify(p_ticket_id, 'author', 'respondido', 'Responderam seu chamado: ' || v_ticket.subject);
  ELSE
    PERFORM support_notify(p_ticket_id, 'answerers', 'mensagem', 'Nova mensagem no chamado: ' || v_ticket.subject);
  END IF;

  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_reply(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_reply(uuid, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.support_ticket_set_status(
  p_ticket_id uuid,
  p_status    text
)
RETURNS support_tickets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role     text;
  v_ticket   support_tickets;
  v_anterior text;
BEGIN
  v_role := support_my_role_on(p_ticket_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado ou sem acesso.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id;
  v_anterior := v_ticket.status;

  IF p_status = 'em_analise' THEN
    NULL;
  ELSIF p_status = 'resolvido' THEN
    IF v_ticket.status = 'resolvido' THEN
      RETURN v_ticket;
    END IF;
  ELSE
    RAISE EXCEPTION 'Status não pode ser definido diretamente.' USING ERRCODE = '22023';
  END IF;

  UPDATE support_tickets SET
    status      = p_status,
    resolved_at = CASE WHEN p_status = 'resolvido' THEN now() ELSE NULL END,
    resolved_by = CASE WHEN p_status = 'resolvido' THEN auth.uid() ELSE NULL END,
    updated_at  = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  -- Avisa sempre o OUTRO lado: quem agiu já sabe.
  IF p_status = 'resolvido' THEN
    IF v_role = 'author' THEN
      PERFORM support_notify(p_ticket_id, 'answerers', 'resolvido', 'Chamado confirmado como resolvido: ' || v_ticket.subject);
    ELSE
      PERFORM support_notify(p_ticket_id, 'author', 'resolvido', 'Seu chamado foi encerrado: ' || v_ticket.subject);
    END IF;
  -- Só é reabertura quando vinha de resolvido; sair de 'aberto' para
  -- 'em_analise' é alguém assumindo, e não vira aviso para ninguém.
  ELSIF v_anterior = 'resolvido' THEN
    IF v_role = 'author' THEN
      PERFORM support_notify(p_ticket_id, 'answerers', 'reaberto', 'Chamado reaberto: ' || v_ticket.subject);
    ELSE
      PERFORM support_notify(p_ticket_id, 'author', 'reaberto', 'Seu chamado foi reaberto: ' || v_ticket.subject);
    END IF;
  END IF;

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_set_status(uuid, text) TO authenticated;
