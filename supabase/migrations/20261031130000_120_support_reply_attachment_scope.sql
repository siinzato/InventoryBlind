/*
# 120 — Suporte: anexo na resposta usa a pasta de quem envia

Correção de uma contradição introduzida na 119, encontrada ao ligar a tela:

- A policy de upload (`support_attachments_storage_insert`) exige que a pasta
  seja a de QUEM ENVIA: `(storage.foldername(name))[1] = get_my_company_id()`.
- `support_ticket_reply` exigia que fosse a do CHAMADO.

Para o autor dá no mesmo — ele é da empresa do chamado. Para o staff do
InventoryBlind respondendo um cliente, as duas condições se contradizem: a
policy só deixa gravar em `AZ/`, o RPC só aceita `<empresa-do-cliente>/`. O
anexo seria recusado sempre, e o staff nunca conseguiria mandar um print.

A pasta certa é a de quem envia. A pasta não controla leitura — a policy de
SELECT do bucket pergunta se o caminho aparece numa mensagem visível, não em
que pasta ele está. Então deixar cada um gravar na própria pasta não abre nada:
só faz o RPC concordar com a policy.

Nada mais da função muda. Comparado com `pg_get_functiondef` da versão viva
antes de escrever: só o bloco de validação do anexo.
*/

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

  -- A empresa de QUEM RESPONDE, não a do chamado: é o que a policy de upload
  -- do bucket exige, e as duas precisam dizer a mesma coisa.
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

  RETURN v_message;
END;
$$;

REVOKE ALL ON FUNCTION public.support_ticket_reply(uuid, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.support_ticket_reply(uuid, text, text[]) TO authenticated;
