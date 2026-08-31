import { useEffect, useRef, useState } from 'react';
import { Building2, ImageUp, Plus } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Badge, Button, Modal, Input, Textarea } from '../ui';
import { updateWorkspaceProfile, uploadWorkspaceLogo, getWorkspaceLogoSignedUrl } from '../../lib/workspace/workspaceService';
import { logAuditEvent } from '../../lib/auditLogService';
import type { Company, CompanyMembership } from '../../lib/auth';

interface WorkspacesSettingsPageProps {
  company: Company;
  companies: CompanyMembership[];
  userId: string;
  userEmail: string | null;
  switchingCompany: boolean;
  onSwitchCompany: (companyId: string) => Promise<void>;
  onCreateWorkspace: (name: string) => Promise<void>;
  onRefresh: () => Promise<void>;
}

const PLAN_LABEL: Record<string, string> = {
  starter: 'Starter',
  professional: 'Profissional',
  enterprise: 'Enterprise',
};

interface ProfileForm {
  name: string;
  icon: string;
  description: string;
}

function formFromCompany(company: Company): ProfileForm {
  return { name: company.name, icon: company.icon ?? '', description: company.description ?? '' };
}

export function WorkspacesSettingsPage({
  company, companies, userId, userEmail, switchingCompany,
  onSwitchCompany, onCreateWorkspace, onRefresh,
}: WorkspacesSettingsPageProps) {
  const [form, setForm] = useState<ProfileForm>(() => formFromCompany(company));
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchingId, setSwitchingId] = useState<string | null>(null);

  const [logoUrls, setLogoUrls] = useState<Record<string, string>>({});
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Workspace ativo pode mudar por baixo (troca pelo seletor no header) — mantém o
  // formulário sempre refletindo o workspace realmente ativo, não um estado congelado.
  useEffect(() => {
    setForm(formFromCompany(company));
  }, [company]);

  // Bucket é privado — resolve uma URL assinada por workspace com logo cadastrado
  // (mesmo workspace ativo e os da lista "Seus workspaces" logo abaixo).
  useEffect(() => {
    let cancelled = false;
    const withLogo = [company, ...companies].filter((c, i, arr) => c.logoPath && arr.findIndex(x => x.id === c.id) === i);
    Promise.all(withLogo.map(async c => {
      const url = await getWorkspaceLogoSignedUrl(c.logoPath as string);
      return [c.id, url] as const;
    })).then(entries => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const [id, url] of entries) if (url) next[id] = url;
      setLogoUrls(next);
    });
    return () => { cancelled = true; };
  }, [company, companies]);

  function handlePickLogo() {
    setLogoError(null);
    logoInputRef.current?.click();
  }

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingLogo(true);
    setLogoError(null);
    try {
      await uploadWorkspaceLogo(company.id, file, userId, userEmail);
      await onRefresh();
    } catch (err) {
      setLogoError(err instanceof Error ? err.message : 'Não foi possível enviar a imagem.');
    } finally {
      setUploadingLogo(false);
    }
  }

  async function handleSaveProfile() {
    if (savingProfile) return;
    if (!form.name.trim()) {
      setProfileError('Informe o nome do workspace.');
      return;
    }
    setSavingProfile(true);
    setProfileError(null);
    try {
      await updateWorkspaceProfile({
        companyId: company.id,
        userId,
        userEmail,
        name: form.name.trim(),
        icon: form.icon.trim() || null,
        description: form.description.trim() || null,
      });
      await onRefresh();
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSavingProfile(false);
    }
  }

  function openCreate() {
    setCreateName('');
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (creating || !createName.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      await onCreateWorkspace(createName.trim());
      await logAuditEvent({
        companyId: company.id, userId, userEmail: userEmail ?? '',
        action: 'company.workspace_created',
        metadata: { name: createName.trim() },
      });
      setCreateOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Não foi possível criar o workspace.');
    } finally {
      setCreating(false);
    }
  }

  async function handleSwitch(targetId: string) {
    setSwitchError(null);
    setSwitchingId(targetId);
    try {
      await onSwitchCompany(targetId);
    } catch (err) {
      setSwitchError(err instanceof Error ? err.message : 'Não foi possível trocar de workspace.');
    } finally {
      setSwitchingId(null);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="Workspaces"
        description="Nome, ícone e descrição deste workspace, além da lista de workspaces em que você opera."
        actions={<Button onClick={openCreate}><Plus size={16} /> Criar workspace</Button>}
      />

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Perfil deste workspace</p></PanelSection>
        <PanelSection padding="lg">
          <div className="space-y-4 max-w-lg">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-xl bg-surface-3 flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
                {logoUrls[company.id] ? (
                  <img src={logoUrls[company.id]} alt="" className="w-full h-full object-cover" />
                ) : form.icon ? (
                  form.icon
                ) : (
                  <Building2 size={22} className="text-fg-subtle" />
                )}
              </div>
              <div>
                <label className="text-xs font-medium text-fg-muted mb-1.5 block">Foto do workspace</label>
                <input ref={logoInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleLogoChange} />
                <Button size="sm" variant="secondary" disabled={uploadingLogo} onClick={handlePickLogo}>
                  <ImageUp size={14} /> {uploadingLogo ? 'Enviando...' : 'Alterar foto'}
                </Button>
                <p className="text-xs text-fg-subtle mt-1">PNG ou JPEG, até 5 MB.</p>
                {logoError && <p className="text-xs text-red-600 dark:text-red-400 mt-1">{logoError}</p>}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted mb-1.5 block">Ícone (emoji, usado quando não há foto)</label>
              <Input
                value={form.icon}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                placeholder="🏢"
                maxLength={4}
                className="w-20 text-center text-lg"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted mb-1.5 block">Nome do workspace</label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Nome do workspace" />
            </div>
            <div>
              <label className="text-xs font-medium text-fg-muted mb-1.5 block">Descrição (opcional)</label>
              <Textarea
                value={form.description}
                onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                placeholder="Uma breve descrição deste workspace"
                rows={3}
              />
            </div>
            {profileError && <p className="text-xs text-red-600 dark:text-red-400">{profileError}</p>}
            <div className="flex justify-end">
              <Button size="sm" disabled={savingProfile || !form.name.trim()} onClick={handleSaveProfile}>
                {savingProfile ? 'Salvando...' : 'Salvar alterações'}
              </Button>
            </div>
          </div>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Seus workspaces ({companies.length})</p></PanelSection>
        {switchError && (
          <PanelSection padding="sm"><p className="text-xs text-red-600 dark:text-red-400">{switchError}</p></PanelSection>
        )}
        {companies.map(c => (
          <PanelSection key={c.id} padding="sm" className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-surface-3 flex items-center justify-center text-lg flex-shrink-0 overflow-hidden">
                {logoUrls[c.id] ? (
                  <img src={logoUrls[c.id]} alt="" className="w-full h-full object-cover" />
                ) : c.icon ? (
                  c.icon
                ) : (
                  <Building2 size={16} className="text-fg-subtle" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-fg truncate">{c.name}</p>
                <p className="text-xs text-fg-subtle">{PLAN_LABEL[c.plan] ?? c.plan}</p>
              </div>
            </div>
            {c.id === company.id ? (
              <Badge variant="accent">Ativo</Badge>
            ) : (
              <Button size="sm" variant="secondary" disabled={switchingCompany} onClick={() => handleSwitch(c.id)}>
                {switchingCompany && switchingId === c.id ? 'Trocando...' : 'Trocar'}
              </Button>
            )}
          </PanelSection>
        ))}
      </Panel>

      <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="Criar workspace">
        <div className="space-y-4">
          <p className="text-sm text-fg-muted">
            Um workspace novo começa vazio — sem produtos, contagens ou integrações. Use para separar operações,
            empresas ou times diferentes. Você será o proprietário do novo workspace e será levado para ele
            assim que for criado.
          </p>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Nome do novo workspace</label>
            <Input value={createName} onChange={e => setCreateName(e.target.value)} placeholder="Ex.: Minha Empresa 2" autoFocus />
          </div>
          {createError && <p className="text-xs text-red-600 dark:text-red-400">{createError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={creating} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={creating || !createName.trim()} onClick={handleCreate}>
              {creating ? 'Criando...' : 'Criar workspace'}
            </Button>
          </div>
        </div>
      </Modal>
    </Page>
  );
}

export default WorkspacesSettingsPage;
