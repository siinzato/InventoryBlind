import { supabase } from '../supabase';
import { logAuditEvent } from '../auditLogService';

const LOGO_BUCKET = 'workspace-logos';
const LOGO_ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const LOGO_MAX_SIZE_BYTES = 5 * 1024 * 1024;

export interface UpdateWorkspaceProfileInput {
  companyId: string;
  userId: string;
  userEmail: string | null;
  name: string;
  icon: string | null;
  description: string | null;
}

/** Edita nome/ícone/descrição do workspace ATIVO. RLS (companies_update)
 *  já restringe isso a owner/admin do workspace atual — mesma checagem que
 *  já gate-keeps o grupo "Configurações Avançadas" no Sidebar. */
export async function updateWorkspaceProfile(input: UpdateWorkspaceProfileInput): Promise<void> {
  const { companyId, userId, userEmail, name, icon, description } = input;

  const { error } = await supabase
    .from('companies')
    .update({ name, icon, description })
    .eq('id', companyId);
  if (error) throw error;

  await logAuditEvent({
    companyId, userId, userEmail: userEmail ?? '',
    action: 'company.profile_updated',
    resourceType: 'companies', resourceId: companyId,
    metadata: { name, icon },
  });
}

/** Sobe o logo para o Storage privado (pasta por empresa) e salva o caminho em
 *  companies.logo_path — mesmo padrão de uploadFloorPlanImage (slottingLayoutService.ts):
 *  bucket privado, caminho salvo no banco, URL assinada gerada sob demanda. */
export async function uploadWorkspaceLogo(
  companyId: string, file: File, userId: string, userEmail: string | null,
): Promise<string> {
  if (!LOGO_ALLOWED_TYPES.includes(file.type)) {
    throw new Error('Envie uma imagem PNG ou JPEG.');
  }
  if (file.size > LOGO_MAX_SIZE_BYTES) {
    throw new Error('A imagem deve ter no máximo 5 MB.');
  }

  const ext = file.name.split('.').pop() || 'png';
  const path = `${companyId}/logo-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(path, file, { upsert: true });
  if (uploadError) throw uploadError;

  const { error: updateError } = await supabase.from('companies').update({ logo_path: path }).eq('id', companyId);
  if (updateError) throw updateError;

  await logAuditEvent({
    companyId, userId, userEmail: userEmail ?? '',
    action: 'company.profile_updated',
    resourceType: 'companies', resourceId: companyId,
    metadata: { event: 'logo_uploaded' },
  });

  return path;
}

/** Bucket é privado — a URL de exibição precisa ser assinada e expira, então é
 *  gerada sob demanda em vez de guardada junto com o path (mesmo padrão de
 *  getFloorPlanSignedUrl). */
export async function getWorkspaceLogoSignedUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from(LOGO_BUCKET).createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
