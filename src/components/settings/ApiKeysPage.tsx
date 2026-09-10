import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Copy, Check, Ban, Trash2, AlertTriangle } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input, Select, Textarea } from '../ui';
import {
  listApiKeys, createApiKey, revokeApiKey, deleteApiKey, apiKeyStatus,
  type ApiKey, type CreatedApiKey, type ApiKeyStatus,
} from '../../lib/settings/apiKeysService';
import {
  publicApiBaseUrl, PUBLIC_API_ENDPOINTS, AUTH_HEADER_EXAMPLE, ERROR_RESPONSE_EXAMPLE,
} from '../../lib/settings/publicApiDocs';

interface ApiKeysPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const STATUS_BADGE: Record<ApiKeyStatus, { variant: 'success' | 'warning' | 'danger'; label: string }> = {
  active: { variant: 'success', label: 'Ativa' },
  expired: { variant: 'warning', label: 'Expirada' },
  revoked: { variant: 'danger', label: 'Revogada' },
};

type ExpiryPreset = 'never' | '30' | '90' | '365' | 'custom';

const EXPIRY_OPTIONS: { value: ExpiryPreset; label: string }[] = [
  { value: 'never', label: 'Sem expiração' },
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '365', label: '1 ano' },
  { value: 'custom', label: 'Data personalizada' },
];

/** Traduz a escolha do formulário para o instante exato enviado ao servidor.
 *  Data personalizada expira no fim do dia escolhido — quem digita "31/12"
 *  espera que a chave funcione durante todo o dia 31. */
function resolveExpiry(preset: ExpiryPreset, customDate: string): string | null {
  if (preset === 'never') return null;
  if (preset === 'custom') {
    if (!customDate) return null;
    const end = new Date(`${customDate}T23:59:59`);
    return Number.isNaN(end.getTime()) ? null : end.toISOString();
  }
  const target = new Date();
  target.setDate(target.getDate() + Number(preset));
  return target.toISOString();
}

/** Bloco de código com botão Copiar — usado nos exemplos da documentação. */
function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível — o texto continua selecionável.
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        {label ? <span className="text-xs font-medium text-fg-muted">{label}</span> : <span />}
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-xs text-fg-subtle hover:text-fg transition-colors"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre className="bg-surface-3 border border-edge rounded-control p-3 text-xs font-mono text-fg-muted overflow-x-auto whitespace-pre">{code}</pre>
    </div>
  );
}

export function ApiKeysPage({ companyId, userId, userEmail }: ApiKeysPageProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [expiryPreset, setExpiryPreset] = useState<ExpiryPreset>('never');
  const [customDate, setCustomDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);

  const [confirming, setConfirming] = useState<{ key: ApiKey; action: 'revoke' | 'delete' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const baseUrl = publicApiBaseUrl();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setKeys(await listApiKeys());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Não foi possível carregar as chaves.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setName('');
    setDescription('');
    setExpiryPreset('never');
    setCustomDate('');
    setError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    if (!name.trim() || creating) return;
    if (expiryPreset === 'custom' && !customDate) {
      setError('Escolha a data de expiração.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const created = await createApiKey(
        { name: name.trim(), description: description.trim() || null, expiresAt: resolveExpiry(expiryPreset, customDate) },
        companyId, userId, userEmail
      );
      setCreateOpen(false);
      setJustCreated(created);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a chave.');
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirm() {
    if (!confirming || busy) return;
    setBusy(true);
    setActionError(null);
    const { key, action } = confirming;
    try {
      if (action === 'revoke') {
        await revokeApiKey(key.id, key.name, companyId, userId, userEmail);
      } else {
        await deleteApiKey(key.id, key.name, companyId, userId, userEmail);
      }
      setConfirming(null);
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  }

  async function copyKey(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard indisponível — o valor continua selecionável no campo.
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="API"
        description="Chaves para autenticar chamadas externas ao InventoryBlind. O valor completo só aparece uma vez, na criação — guarde em local seguro."
        actions={<Button onClick={openCreate}><Plus size={16} /> Nova chave</Button>}
      />

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Chaves ({keys.length})</p></PanelSection>
        {loading ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Carregando...</PanelSection>
        ) : loadError ? (
          <PanelSection padding="lg" className="text-center">
            <p className="text-sm text-red-600 dark:text-red-400 mb-3">{loadError}</p>
            <Button size="sm" variant="secondary" onClick={load}>Tentar de novo</Button>
          </PanelSection>
        ) : keys.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma chave criada ainda.</PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr><Th>Nome</Th><Th>Prefixo</Th><Th>Status</Th><Th>Criada em</Th><Th>Expira em</Th><Th>Último uso</Th><Th></Th></Tr>
              </Thead>
              <tbody>
                {keys.map(key => {
                  const status = apiKeyStatus(key);
                  return (
                    <Tr key={key.id}>
                      <Td className="font-medium text-fg">
                        {key.name}
                        {key.description && <span className="block text-xs font-normal text-fg-subtle mt-0.5">{key.description}</span>}
                      </Td>
                      <Td className="font-mono text-xs text-fg-muted whitespace-nowrap">{key.key_prefix}…</Td>
                      <Td><Badge variant={STATUS_BADGE[status].variant}>{STATUS_BADGE[status].label}</Badge></Td>
                      <Td className="text-fg-subtle text-xs whitespace-nowrap">{formatDate(key.created_at)}</Td>
                      <Td className="text-fg-subtle text-xs whitespace-nowrap">{key.expires_at ? formatDate(key.expires_at) : 'Nunca'}</Td>
                      <Td className="text-fg-subtle text-xs whitespace-nowrap">{formatDate(key.last_used_at)}</Td>
                      <Td>
                        <div className="flex items-center gap-1 flex-wrap">
                          {!key.revoked_at && (
                            <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setConfirming({ key, action: 'revoke' }); }}>
                              <Ban size={14} /> Revogar
                            </Button>
                          )}
                          {key.revoked_at && (
                            <Button size="sm" variant="ghost" onClick={() => { setActionError(null); setConfirming({ key, action: 'delete' }); }}>
                              <Trash2 size={14} /> Excluir
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      {/* ── Documentação ──────────────────────────────────────────────────── */}
      <Panel className="mt-6">
        <PanelSection padding="sm"><p className="text-section">Documentação da API</p></PanelSection>

        <PanelSection padding="lg">
          <p className="text-sm font-semibold text-fg mb-2">URL base</p>
          {baseUrl ? (
            <CodeBlock code={baseUrl} />
          ) : (
            <p className="text-sm text-fg-muted">
              A URL base não pôde ser determinada nesta instalação. Fale com o suporte antes de integrar.
            </p>
          )}
        </PanelSection>

        <PanelSection padding="lg">
          <p className="text-sm font-semibold text-fg mb-2">Autenticação</p>
          <p className="text-sm text-fg-muted mb-3">
            Toda chamada precisa da chave no cabeçalho <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">Authorization</code>.
            A chave é da empresa: ela só enxerga dados desta conta.
          </p>
          <CodeBlock code={AUTH_HEADER_EXAMPLE} />
        </PanelSection>

        <PanelSection padding="lg">
          <p className="text-sm font-semibold text-fg mb-3">Endpoints disponíveis</p>
          <div className="space-y-6">
            {PUBLIC_API_ENDPOINTS.map(endpoint => (
              <div key={`${endpoint.method} ${endpoint.path}`}>
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <Badge variant="accent">{endpoint.method}</Badge>
                  <code className="font-mono text-sm text-fg">{endpoint.path}</code>
                </div>
                <p className="text-sm text-fg-muted mb-3">{endpoint.summary}</p>

                <p className="text-xs font-medium text-fg-muted mb-1.5">Parâmetros</p>
                <div className="overflow-x-auto mb-4">
                  <Table>
                    <Thead><Tr><Th>Nome</Th><Th>Tipo</Th><Th>Obrigatório</Th><Th>Descrição</Th></Tr></Thead>
                    <tbody>
                      {endpoint.params.map(param => (
                        <Tr key={param.name}>
                          <Td className="font-mono text-xs text-fg">{param.name}</Td>
                          <Td className="text-xs text-fg-subtle">{param.type}</Td>
                          <Td className="text-xs text-fg-subtle">{param.required ? 'Sim' : 'Não'}</Td>
                          <Td className="text-xs text-fg-subtle">{param.description}</Td>
                        </Tr>
                      ))}
                    </tbody>
                  </Table>
                </div>

                <div className="space-y-4">
                  <CodeBlock label="Exemplo de requisição" code={endpoint.requestExample(baseUrl ?? '<url_base>')} />
                  <CodeBlock label="Exemplo de resposta (200)" code={endpoint.responseExample} />
                </div>

                <p className="text-xs font-medium text-fg-muted mt-4 mb-1.5">Códigos de resposta</p>
                <ul className="space-y-1">
                  {endpoint.statuses.map(status => (
                    <li key={status.code} className="text-xs text-fg-subtle">
                      <span className="font-mono text-fg-muted">{status.code}</span> — {status.description}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </PanelSection>

        <PanelSection padding="lg">
          <p className="text-sm font-semibold text-fg mb-2">Formato de erro</p>
          <p className="text-sm text-fg-muted mb-3">
            Qualquer erro devolve o mesmo formato. Use <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">code</code> para tratar em código
            e <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">error</code> para exibir.
          </p>
          <CodeBlock code={ERROR_RESPONSE_EXAMPLE} />
        </PanelSection>
      </Panel>

      {/* ── Nova chave ────────────────────────────────────────────────────── */}
      <Modal open={createOpen} onClose={() => !creating && setCreateOpen(false)} title="Nova chave de API">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Nome da chave</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Integração com o site" autoFocus />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Descrição (opcional)</label>
            <Textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Para que esta chave será usada" />
          </div>
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Expiração</label>
            <Select className="w-full" value={expiryPreset} onChange={e => setExpiryPreset(e.target.value as ExpiryPreset)}>
              {EXPIRY_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
            </Select>
          </div>
          {expiryPreset === 'custom' && (
            <div>
              <label className="text-xs font-medium text-fg-muted mb-1.5 block">Expira em</label>
              <Input type="date" min={today} value={customDate} onChange={e => setCustomDate(e.target.value)} />
            </div>
          )}
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" disabled={creating} onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={!name.trim() || creating} onClick={handleCreate}>
              {creating ? 'Criando...' : 'Criar chave'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Chave criada: única exibição do valor completo ─────────────────── */}
      <Modal open={!!justCreated} onClose={() => setJustCreated(null)} title="Chave criada com sucesso">
        {justCreated && (
          <div className="space-y-4">
            <div className="flex items-start gap-3">
              <KeyRound size={18} className="text-accent flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-fg">{justCreated.name}</p>
                <p className="text-xs text-fg-muted mt-1">
                  {justCreated.expires_at ? `Expira em ${formatDate(justCreated.expires_at)}.` : 'Esta chave não expira.'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <code className="flex-1 min-w-0 truncate bg-surface-3 border border-edge rounded-control px-3 py-2 text-xs font-mono text-fg">
                {justCreated.plaintext_key}
              </code>
              <Button size="sm" variant="secondary" onClick={() => copyKey(justCreated.plaintext_key)}>
                {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copiado' : 'Copiar'}
              </Button>
            </div>

            <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
              <p>Copie agora: por segurança, guardamos apenas uma marca da chave — este valor não poderá ser visualizado de novo.</p>
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={() => setJustCreated(null)}>Concluir</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Confirmação de revogar/excluir ─────────────────────────────────── */}
      <Modal
        open={!!confirming}
        onClose={() => !busy && setConfirming(null)}
        title={confirming?.action === 'delete' ? 'Excluir chave' : 'Revogar chave'}
      >
        {confirming && (
          <div className="space-y-4">
            <p className="text-sm text-fg-muted">
              {confirming.action === 'delete'
                ? <>A chave <span className="font-medium text-fg">"{confirming.key.name}"</span> sairá desta lista. Ela já está revogada e não volta a funcionar.</>
                : <>A chave <span className="font-medium text-fg">"{confirming.key.name}"</span> deixará de funcionar imediatamente. Qualquer sistema que a utilize vai parar de receber respostas. Esta ação não pode ser desfeita.</>}
            </p>
            {actionError && <p className="text-xs text-red-600 dark:text-red-400">{actionError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</Button>
              <Button variant="danger" size="sm" disabled={busy} onClick={handleConfirm}>
                {busy ? 'Processando...' : confirming.action === 'delete' ? 'Excluir' : 'Revogar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </Page>
  );
}

export default ApiKeysPage;
