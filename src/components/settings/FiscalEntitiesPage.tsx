import { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Star, Archive, ArchiveRestore, Pencil, Link2 } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input, Notice } from '../ui';
import {
  listFiscalEntities, createFiscalEntity, updateFiscalEntity,
  setDefaultFiscalEntity, archiveFiscalEntity, restoreFiscalEntity,
} from '../../lib/fiscalEntities/fiscalEntityService';
import { normalizeCnpj, isValidCnpjChecksum, formatCnpj, maskCnpjInput } from '../../lib/fiscalEntities/cnpjUtils';
import { CNPJ_CHANGE_CONFIRMATION_REQUIRED } from '../../lib/fiscalEntities/fiscalEntityTypes';
import type { FiscalEntity } from '../../lib/fiscalEntities/fiscalEntityTypes';
import { listConnections } from '../../lib/integrations/integrationService';
import { CONNECTION_STATUS_LABEL, CONNECTION_STATUS_VARIANT } from '../../lib/integrations/types';
import type { IntegrationConnection } from '../../lib/integrations/types';

interface FiscalEntitiesPageProps {
  companyId: string;
}

interface FormState {
  legalName: string;
  tradeName: string;
  cnpj: string;
  stateRegistration: string;
  setDefault: boolean;
}

const EMPTY_FORM: FormState = { legalName: '', tradeName: '', cnpj: '', stateRegistration: '', setDefault: false };

function friendlyError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message && err.message !== CNPJ_CHANGE_CONFIRMATION_REQUIRED) {
    return err.message;
  }
  return fallback;
}

export function FiscalEntitiesPage({ companyId }: FiscalEntitiesPageProps) {
  const [entities, setEntities] = useState<FiscalEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<FiscalEntity | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmCnpjChange, setConfirmCnpjChange] = useState(false);

  const [confirming, setConfirming] = useState<{ entity: FiscalEntity; action: 'archive' | 'restore' | 'default' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [linkedFor, setLinkedFor] = useState<FiscalEntity | null>(null);
  const [linkedConnections, setLinkedConnections] = useState<IntegrationConnection[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setEntities(await listFiscalEntities(companyId));
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar as empresas fiscais.');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setConfirmCnpjChange(false);
    setFormOpen(true);
  }

  function openEdit(entity: FiscalEntity) {
    setEditing(entity);
    setForm({
      legalName: entity.legalName,
      tradeName: entity.tradeName ?? '',
      cnpj: formatCnpj(entity.cnpj),
      stateRegistration: entity.stateRegistration ?? '',
      setDefault: entity.isDefault,
    });
    setFormError(null);
    setConfirmCnpjChange(false);
    setFormOpen(true);
  }

  async function handleSave(confirmChange = false) {
    if (saving) return;
    if (!form.legalName.trim()) {
      setFormError('Informe a razão social.');
      return;
    }
    if (!isValidCnpjChecksum(form.cnpj)) {
      setFormError('Informe um CNPJ válido.');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await updateFiscalEntity(editing.id, {
          legalName: form.legalName.trim(),
          tradeName: form.tradeName.trim() || null,
          cnpj: form.cnpj,
          stateRegistration: form.stateRegistration.trim() || null,
          confirmCnpjChange: confirmChange,
        });
      } else {
        await createFiscalEntity({
          legalName: form.legalName.trim(),
          tradeName: form.tradeName.trim() || null,
          cnpj: form.cnpj,
          stateRegistration: form.stateRegistration.trim() || null,
          setDefault: form.setDefault,
        });
      }
      setFormOpen(false);
      await load();
    } catch (err) {
      if (err instanceof Error && err.message === CNPJ_CHANGE_CONFIRMATION_REQUIRED) {
        setConfirmCnpjChange(true);
        return;
      }
      setFormError(friendlyError(err, editing ? 'Não foi possível salvar as alterações.' : 'Não foi possível cadastrar a empresa.'));
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmAction() {
    if (!confirming || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      if (confirming.action === 'archive') await archiveFiscalEntity(confirming.entity.id);
      else if (confirming.action === 'restore') await restoreFiscalEntity(confirming.entity.id);
      else await setDefaultFiscalEntity(confirming.entity.id);
      setConfirming(null);
      await load();
    } catch (err) {
      setActionError(friendlyError(err, 'Não foi possível concluir a ação.'));
    } finally {
      setBusy(false);
    }
  }

  async function openLinked(entity: FiscalEntity) {
    setLinkedFor(entity);
    setLinkedConnections(null);
    try {
      const all = await listConnections();
      setLinkedConnections(all.filter(c => c.fiscalEntityId === entity.id));
    } catch {
      setLinkedConnections([]);
    }
  }

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="Empresas e Dados Fiscais"
        description="As empresas (CNPJs) que operam neste workspace. Usadas para validar notas fiscais e conectar integrações de ERP à empresa correta."
        actions={<Button onClick={openCreate}><Plus size={16} /> Adicionar empresa</Button>}
      />

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Empresas ({entities.length})</p></PanelSection>
        {loading ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Carregando...</PanelSection>
        ) : loadError ? (
          <PanelSection padding="lg" className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={load}>Tentar de novo</Button>
          </PanelSection>
        ) : entities.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">
            Nenhuma empresa cadastrada ainda. Cadastre a primeira para habilitar recursos fiscais e integrações de ERP.
          </PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr><Th>Razão social</Th><Th>Nome fantasia</Th><Th>CNPJ</Th><Th>IE</Th><Th>Situação</Th><Th></Th></Tr>
              </Thead>
              <tbody>
                {entities.map(entity => (
                  <Tr key={entity.id}>
                    <Td className="font-medium text-fg">
                      {entity.legalName}
                      {entity.isDefault && <Badge variant="accent" className="ml-2"><Star size={11} /> Padrão</Badge>}
                      {entity.dataIncomplete && (
                        <span className="block text-xs font-normal text-amber-600 dark:text-amber-400 mt-0.5">
                          Dados cadastrais incompletos — edite para preencher a razão social definitiva.
                        </span>
                      )}
                    </Td>
                    <Td className="text-fg-muted">{entity.tradeName ?? '—'}</Td>
                    <Td className="font-mono text-xs text-fg-muted whitespace-nowrap">{formatCnpj(entity.cnpj)}</Td>
                    <Td className="text-fg-muted">{entity.stateRegistration ?? '—'}</Td>
                    <Td>
                      <Badge variant={entity.status === 'active' ? 'success' : 'neutral'}>
                        {entity.status === 'active' ? 'Ativa' : 'Arquivada'}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1 flex-wrap">
                        {entity.status === 'active' && (
                          <>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(entity)}>
                              <Pencil size={14} /> Editar
                            </Button>
                            {!entity.isDefault && (
                              <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setConfirming({ entity, action: 'default' }); }}>
                                <Star size={14} /> Definir padrão
                              </Button>
                            )}
                            <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setConfirming({ entity, action: 'archive' }); }}>
                              <Archive size={14} /> Arquivar
                            </Button>
                          </>
                        )}
                        {entity.status === 'archived' && (
                          <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setConfirming({ entity, action: 'restore' }); }}>
                            <ArchiveRestore size={14} /> Restaurar
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openLinked(entity)}>
                          <Link2 size={14} /> Integrações
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {/* ── Nova empresa / editar ────────────────────────────────────────────── */}
      <Modal open={formOpen} onClose={() => !saving && setFormOpen(false)} title={editing ? 'Editar empresa' : 'Adicionar empresa'}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Razão social</label>
            <Input value={form.legalName} onChange={e => setForm(f => ({ ...f, legalName: e.target.value }))} placeholder="Razão social da empresa" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Nome fantasia (opcional)</label>
            <Input value={form.tradeName} onChange={e => setForm(f => ({ ...f, tradeName: e.target.value }))} placeholder="Nome fantasia" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">CNPJ</label>
            <Input
              value={form.cnpj}
              onChange={e => setForm(f => ({ ...f, cnpj: maskCnpjInput(e.target.value) }))}
              placeholder="00.000.000/0000-00"
              inputMode="numeric"
              maxLength={18}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Inscrição estadual (opcional)</label>
            <Input value={form.stateRegistration} onChange={e => setForm(f => ({ ...f, stateRegistration: e.target.value }))} placeholder="Inscrição estadual" />
          </div>
          {!editing && (
            <label className="flex items-center gap-2 text-sm text-fg">
              <input type="checkbox" checked={form.setDefault} onChange={e => setForm(f => ({ ...f, setDefault: e.target.checked }))} />
              Definir como empresa padrão
            </label>
          )}

          {confirmCnpjChange && (
            <Notice tone="warning">
              <p>
                Você está alterando o CNPJ desta empresa (de {formatCnpj(editing?.cnpj ?? '')} para {formatCnpj(normalizeCnpj(form.cnpj))}).
                Essa troca fica registrada no histórico. Confirma?
              </p>
              <div className="flex justify-end gap-2 mt-2">
                <Button size="sm" variant="secondary" onClick={() => setConfirmCnpjChange(false)}>Cancelar</Button>
                <Button size="sm" disabled={saving} onClick={() => handleSave(true)}>Confirmar troca de CNPJ</Button>
              </div>
            </Notice>
          )}

          {formError && <p className="text-xs text-red-600 dark:text-red-400">{formError}</p>}

          {!confirmCnpjChange && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button size="sm" disabled={saving} onClick={() => handleSave(false)}>
                {saving ? 'Salvando...' : editing ? 'Salvar alterações' : 'Adicionar empresa'}
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* ── Confirmação: definir padrão / arquivar / restaurar ──────────────── */}
      <Modal
        open={!!confirming}
        onClose={() => !busy && setConfirming(null)}
        title={
          confirming?.action === 'archive' ? 'Arquivar empresa'
          : confirming?.action === 'restore' ? 'Restaurar empresa'
          : 'Definir empresa padrão'
        }
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              {confirming.action === 'archive' && (
                <>A empresa <span className="font-medium text-fg">{confirming.entity.legalName}</span> deixará de aparecer nos seletores fiscais e de integração. Documentos e integrações já existentes não são afetados.</>
              )}
              {confirming.action === 'restore' && (
                <>A empresa <span className="font-medium text-fg">{confirming.entity.legalName}</span> volta a ficar ativa e disponível para seleção.</>
              )}
              {confirming.action === 'default' && (
                <>A empresa <span className="font-medium text-fg">{confirming.entity.legalName}</span> passa a ser a empresa padrão deste workspace.</>
              )}
            </p>
            {actionError && <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</Button>
              <Button size="sm" disabled={busy} onClick={handleConfirmAction}>
                {busy ? 'Processando...' : 'Confirmar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Integrações vinculadas ───────────────────────────────────────────── */}
      <Modal open={!!linkedFor} onClose={() => setLinkedFor(null)} title={linkedFor ? `Integrações — ${linkedFor.legalName}` : 'Integrações'}>
        {linkedConnections === null ? (
          <p className="text-sm text-fg-subtle">Carregando...</p>
        ) : linkedConnections.length === 0 ? (
          <p className="text-sm text-fg-subtle">Nenhuma conexão de integração vinculada a esta empresa ainda.</p>
        ) : (
          <div className="space-y-2">
            {linkedConnections.map(conn => (
              <div key={conn.id} className="flex items-center justify-between border border-edge rounded-control px-3 py-2">
                <div className="flex items-center gap-2">
                  <Building2 size={14} className="text-fg-subtle" />
                  <span className="text-sm text-fg">{conn.displayName}</span>
                </div>
                <Badge variant={CONNECTION_STATUS_VARIANT[conn.status]}>{CONNECTION_STATUS_LABEL[conn.status]}</Badge>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default FiscalEntitiesPage;
