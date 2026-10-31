/*
# 119 — Suporte: chamados em dois canais separados

Dois canais que NÃO se misturam, e a separação é a razão de ser desta migration:

- `produto`  — a empresa cliente fala com o InventoryBlind. Só quem está em
               `support_staff` lê. Nem o owner da própria empresa do autor vê.
- `interno`  — o funcionário fala com o gestor DELE. Owner/admin daquela empresa
               leem. `support_staff` NÃO lê: chamado interno de um cliente é
               assunto privado do cliente, e isso é garantido por policy, não por
               promessa.

## O ponto mais sensível: support_staff

É a única tabela do sistema que concede leitura atravessando empresas. Por isso
ela não tem policy de INSERT, UPDATE nem DELETE — nenhuma, para nenhum papel.
Pelo PostgREST é impossível escrever nela, mesmo sendo owner, mesmo com token
válido. Só pelo console do banco (service_role ignora RLS).

Se um dia houver policy de escrita aqui, qualquer um que consiga inserir a si
mesmo passa a ler os chamados ao produto de TODAS as empresas. É a porta de trás
do isolamento multi-tenant, e ela fica trancada por ausência de fechadura.

O SELECT devolve só a própria linha: o usuário pode saber que ELE é staff (a UI
precisa disso para decidir se mostra a caixa de entrada), e não quem mais é.

## Escrita

Nenhuma das três tabelas tem policy de INSERT/UPDATE/DELETE. Todo o fluxo passa
por RPC SECURITY DEFINER — mesmo padrão de `returns_transition_status` (083) e
`task_create` (070). A máquina de estados fica no banco, não no cliente.

## Quem fecha

`resolvido` pode ser marcado pelo autor (confirmando) ou por quem respondeu
(encerrando). `resolved_by` registra qual dos dois foi, para a tela dizer a
verdade em vez de exibir "resolvido" sem dono. O autor sempre pode reabrir.

Sem fechamento automático por inatividade: exigiria job agendado e o volume
ainda não justifica.
*/

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. support_staff — lista fechada, sem escrita por nenhuma policy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_staff (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_staff_self_select" ON public.support_staff;
CREATE POLICY "support_staff_self_select" ON public.support_staff FOR SELECT
  TO authenticated USING (user_id = auth.uid());

-- Intencionalmente sem policy de INSERT/UPDATE/DELETE. Veja o cabeçalho.

CREATE OR REPLACE FUNCTION public.is_support_staff()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM support_staff WHERE user_id = auth.uid())
$$;

REVOKE ALL ON FUNCTION public.is_support_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_support_staff() TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. support_tickets
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  channel     text NOT NULL CHECK (channel IN ('produto', 'interno')),
  created_by  uuid NOT NULL REFERENCES auth.users(id),
  subject     text NOT NULL CHECK (char_length(btrim(subject)) BETWEEN 3 AND 160),
  category    text NOT NULL CHECK (category IN ('erro', 'duvida', 'sugestao', 'acesso', 'outro')),
  priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('baixa', 'normal', 'alta')),
  status      text NOT NULL DEFAULT 'aberto' CHECK (status IN ('aberto', 'em_analise', 'respondido', 'resolvido')),
  -- Contexto capturado pela tela (rota, papel, versão do app, navegador). É o que
  -- evita o vai-e-volta de "em que tela foi?".
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  first_response_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS support_tickets_company_idx ON public.support_tickets (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS support_tickets_author_idx  ON public.support_tickets (created_by, created_at DESC);
-- A caixa de entrada do produto varre todas as empresas: índice próprio.
CREATE INDEX IF NOT EXISTS support_tickets_produto_idx ON public.support_tickets (created_at DESC) WHERE channel = 'produto';

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "support_tickets_select" ON public.support_tickets;
CREATE POLICY "support_tickets_select" ON public.support_tickets FOR SELECT
  TO authenticated USING (
    -- O autor sempre lê o que abriu.
    created_by = auth.uid()
    -- Interno: gestão da própria empresa. `channel = 'interno'` é o que impede um
    -- owner de ler o chamado que o funcionário dele mandou ao InventoryBlind.
    OR (
      channel = 'interno'
      AND company_id::text = get_my_company_id()
      AND get_my_role() IN ('owner', 'admin')
    )
    -- Produto: só staff, e só produto.
    OR (channel = 'produto' AND is_support_staff())
  );

-- Sem policy de escrita: só as RPCs abaixo.

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. support_ticket_messages
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id   uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES auth.users(id),
  body        text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000),
  -- Caminhos no bucket support-attachments, sempre sob <company_id>/.
  attachments text[] NOT NULL DEFAULT '{}'::text[] CHECK (coalesce(array_length(attachments, 1), 0) <= 3),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx ON public.support_ticket_messages (ticket_id, created_at);
-- A policy de leitura do bucket procura o caminho dentro de `attachments`.
CREATE INDEX IF NOT EXISTS support_ticket_messages_attachments_idx ON public.support_ticket_messages USING GIN (attachments);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

-- Quem enxerga o chamado enxerga a conversa: o EXISTS abaixo passa pela RLS de
-- support_tickets, então a regra de visibilidade mora num lugar só.
DROP POLICY IF EXISTS "support_ticket_messages_select" ON public.support_ticket_messages;
CREATE POLICY "support_ticket_messages_select" ON public.support_ticket_messages FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM public.support_tickets t WHERE t.id = ticket_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Storage — bucket support-attachments
--    Caminho <company_id>/<...>, igual a return-attachments (083). Tipos e
--    limite definidos na criação, lição da 037: bucket sem allowed_mime_types
--    aceita qualquer coisa quando o frontend é contornado.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
VALUES ('support-attachments', 'support-attachments', false,
        ARRAY['image/png', 'image/jpeg', 'image/webp'], 10485760)
ON CONFLICT (id) DO NOTHING;

-- Leitura amarrada à mensagem, não à pasta. Duas razões:
--
--  - `pasta = minha empresa` deixaria qualquer conferente ler o print que o owner
--    anexou num chamado ao produto que ele nem enxerga.
--  - `OR is_support_staff()` deixaria o staff ler anexo de chamado INTERNO de
--    cliente — justamente o que a tabela promete não acontecer.
--
-- O EXISTS abaixo atravessa a RLS de support_ticket_messages, que atravessa a de
-- support_tickets: quem não enxerga o chamado não enxerga o anexo dele, e a regra
-- continua morando num lugar só. Arquivo órfão (upload abandonado antes de enviar)
-- fica ilegível para todos, que é o correto.
DROP POLICY IF EXISTS "support_attachments_storage_select" ON storage.objects;
CREATE POLICY "support_attachments_storage_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'support-attachments'
    AND EXISTS (
      SELECT 1 FROM public.support_ticket_messages m
      WHERE m.attachments @> ARRAY[storage.objects.name]
    )
  );

DROP POLICY IF EXISTS "support_attachments_storage_insert" ON storage.objects;
CREATE POLICY "support_attachments_storage_insert" ON storage.objects FOR INSERT
  TO authenticated WITH CHECK (
    bucket_id = 'support-attachments'
    AND (storage.foldername(name))[1] = get_my_company_id()
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Papel do usuário atual num chamado: 'author', 'answerer' ou NULL
--    As RPCs abaixo são SECURITY DEFINER e portanto ignoram RLS — a permissão
--    precisa ser verificada à mão, e num lugar só.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.support_my_role_on(p_ticket_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  t support_tickets;
BEGIN
  SELECT * INTO t FROM support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF t.created_by = auth.uid() THEN RETURN 'author'; END IF;

  IF t.channel = 'produto' AND is_support_staff() THEN RETURN 'answerer'; END IF;

  IF t.channel = 'interno'
     AND t.company_id::text = get_my_company_id()
     AND get_my_role() IN ('owner', 'admin') THEN
    RETURN 'answerer';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.support_my_role_on(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_my_role_on(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. support_ticket_open — cria o chamado e a primeira mensagem, atômico
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

  -- Chamado ao InventoryBlind passa pelo gestor da empresa: sem isso a caixa do
  -- produto vira help desk de primeiro nível dos clientes, por cima do chefe deles.
  IF p_channel = 'produto' AND v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Apenas proprietário ou administrador pode abrir chamado ao InventoryBlind.' USING ERRCODE = '42501';
  END IF;

  -- Anexo de outra empresa não entra: o caminho é a única coisa que o cliente manda.
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

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_open(text, text, text, text, text, jsonb, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_open(text, text, text, text, text, jsonb, text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. support_ticket_reply — resposta move o estado sozinha
--    Quem responde devolve a bola. Não existe "respondido" sem alguém ter
--    respondido de fato, e não existe resposta do autor que deixe o chamado
--    parado em "respondido" esperando ele mesmo.
-- ─────────────────────────────────────────────────────────────────────────────
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

  FOREACH v_path IN ARRAY coalesce(p_attachments, '{}'::text[]) LOOP
    IF v_path NOT LIKE v_ticket.company_id::text || '/%' THEN
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

  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_reply(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_reply(uuid, text, text[]) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. support_ticket_set_status — resolver e reabrir
-- ─────────────────────────────────────────────────────────────────────────────
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
  v_role   text;
  v_ticket support_tickets;
BEGIN
  v_role := support_my_role_on(p_ticket_id);
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Chamado não encontrado ou sem acesso.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ticket FROM support_tickets WHERE id = p_ticket_id;

  IF p_status = 'em_analise' THEN
    -- Também é o caminho de reabrir: sai de 'resolvido' e volta para a fila.
    NULL;
  ELSIF p_status = 'resolvido' THEN
    IF v_ticket.status = 'resolvido' THEN
      RETURN v_ticket;
    END IF;
  ELSE
    -- 'aberto' e 'respondido' são consequência de uma ação, nunca escolha de tela.
    RAISE EXCEPTION 'Status não pode ser definido diretamente.' USING ERRCODE = '22023';
  END IF;

  UPDATE support_tickets SET
    status      = p_status,
    resolved_at = CASE WHEN p_status = 'resolvido' THEN now() ELSE NULL END,
    resolved_by = CASE WHEN p_status = 'resolvido' THEN auth.uid() ELSE NULL END,
    updated_at  = now()
  WHERE id = p_ticket_id
  RETURNING * INTO v_ticket;

  RETURN v_ticket;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_set_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_set_status(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. O único staff: victor@azbuy.com.br
--    Por subselect e não por uuid colado, para o arquivo dizer QUEM é. Falha
--    alto se o e-mail não existir — staff silenciosamente vazio seria uma caixa
--    de entrada que nunca recebe nada, sem erro nenhum para denunciar.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM profiles WHERE lower(email) = 'victor@azbuy.com.br' LIMIT 1;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'Perfil victor@azbuy.com.br não encontrado — staff de suporte ficaria vazio.';
  END IF;
  INSERT INTO support_staff (user_id, note)
  VALUES (v_id, 'Proprietário do InventoryBlind — atende os chamados do canal produto.')
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;
