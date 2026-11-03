/*
# Corrige leitura do logo do workspace fora do workspace ativo

## Bug
A policy `workspace_logos_select` (migration 101) restringia SELECT ao
workspace ATIVO via `get_my_company_id()` (retorna só profiles.company_id).
Isso é certo para INSERT/UPDATE/DELETE (só o workspace ativo pode gravar o
próprio logo), mas errado para leitura: o seletor de workspace e o dropdown
de troca (App.tsx, WorkspaceSelectorScreen.tsx) precisam mostrar o logo de
TODOS os workspaces do usuário ao mesmo tempo, não só do que está ativo no
momento — por isso o logo de um workspace não-ativo nunca aparecia (a URL
assinada falhava silenciosamente, sem erro visível para o usuário).

Mesmo padrão já usado em `companies_select_via_membership` (migration 022):
a tabela companies já tem uma policy adicional permissiva por membership,
além da policy por workspace ativo — aqui é a mesma ideia aplicada ao
Storage. Policies permissivas se combinam com OR, então isso amplia o
acesso de leitura sem tirar nada que já funcionava.

INSERT/UPDATE/DELETE continuam exigindo workspace ativo + owner/admin —
sem mudança nesta migration.
*/

DROP POLICY IF EXISTS "workspace_logos_select" ON storage.objects;
CREATE POLICY "workspace_logos_select" ON storage.objects FOR SELECT
  TO authenticated USING (
    bucket_id = 'workspace-logos'
    AND (storage.foldername(name))[1] = ANY (
      SELECT company_id::text FROM company_members WHERE user_id = auth.uid()
    )
  );
