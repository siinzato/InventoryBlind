/*
# Meus Atalhos — dashboard

## Summary
Atalhos configuráveis por usuário+workspace para a nova seção "Meus Atalhos" do
dashboard, que substitui o espaço antes ocupado condicionalmente pelo convite ao
diagnóstico (o diagnóstico passa a ser um aviso separado, sem espaço fixo).
Aditivo — nenhuma tabela de plano/permissão/produto é alterada.

1. New Table
- user_shortcuts — route_key vem do próprio registro de navegação (SidebarNavGroup),
  nunca de URL digitada; o rótulo/ícone são sempre lidos ao vivo desse registro, não
  duplicados aqui, então uma mudança de permissão/plano simplesmente faz o atalho
  parar de aparecer (a linha continua existindo, pronta para voltar a aparecer se a
  função for liberada de novo).
- UNIQUE (user_id, company_id, route_key): idempotente — adicionar a mesma função
  duas vezes não duplica.
- Trigger BEFORE INSERT aplica o limite de 5 atalhos por usuário+workspace no
  banco, não só na tela — a mesma regra que a interface já respeita.

2. Security
- user_id = auth.uid() (nunca aceito do cliente) + company_id uuid (padrão recente:
  nfe_invoices/purchase_orders/product_brands). RLS restringe cada leitura/escrita
  ao próprio usuário DENTRO do próprio workspace — nunca aparece para outro usuário
  nem para outro workspace do mesmo usuário.
*/

CREATE TABLE IF NOT EXISTS user_shortcuts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  company_id   uuid NOT NULL DEFAULT get_my_company_id()::uuid REFERENCES companies(id) ON DELETE CASCADE,
  route_key    text NOT NULL,
  order_index  integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id, route_key)
);

CREATE INDEX IF NOT EXISTS user_shortcuts_user_company_idx ON user_shortcuts (user_id, company_id, order_index);

CREATE OR REPLACE FUNCTION public.enforce_user_shortcuts_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF (SELECT count(*) FROM user_shortcuts WHERE user_id = NEW.user_id AND company_id = NEW.company_id) >= 5 THEN
    RAISE EXCEPTION 'Limite de 5 atalhos por workspace atingido.' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS user_shortcuts_limit_trg ON user_shortcuts;
CREATE TRIGGER user_shortcuts_limit_trg
  BEFORE INSERT ON user_shortcuts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_shortcuts_limit();

ALTER TABLE user_shortcuts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_shortcuts_select" ON user_shortcuts;
CREATE POLICY "user_shortcuts_select" ON user_shortcuts FOR SELECT
  TO authenticated USING (user_id = auth.uid() AND company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "user_shortcuts_insert" ON user_shortcuts;
CREATE POLICY "user_shortcuts_insert" ON user_shortcuts FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid() AND company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "user_shortcuts_update" ON user_shortcuts;
CREATE POLICY "user_shortcuts_update" ON user_shortcuts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() AND company_id::text = get_my_company_id())
  WITH CHECK (user_id = auth.uid() AND company_id::text = get_my_company_id());

DROP POLICY IF EXISTS "user_shortcuts_delete" ON user_shortcuts;
CREATE POLICY "user_shortcuts_delete" ON user_shortcuts FOR DELETE
  TO authenticated USING (user_id = auth.uid() AND company_id::text = get_my_company_id());
