import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Plus, Copy, Check, Trash2 } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection, Table, Thead, Tr, Th, Td, Badge, Button, Modal, Input } from '../ui';
import { listApiKeys, createApiKey, revokeApiKey, type ApiKey, type CreatedApiKey } from '../../lib/settings/apiKeysService';

interface ApiKeysPageProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function ApiKeysPage({ companyId, userId, userEmail }: ApiKeysPageProps) {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<CreatedApiKey | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setKeys(await listApiKeys());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const created = await createApiKey(name.trim(), companyId, userId, userEmail);
      setJustCreated(created);
      setName('');
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível criar a chave.');
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(key: ApiKey) {
    if (!confirm(`Revogar a chave "${key.name}"? Qualquer sistema que a use vai parar de funcionar imediatamente.`)) return;
    setRevoking(key.id);
    try {
      await revokeApiKey(key.id, key.name, companyId, userId, userEmail);
      await load();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Não foi possível revogar a chave.');
    } finally {
      setRevoking(null);
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

  return (
    <Page>
      <PageHeader
        eyebrow="Configurações Avançadas"
        title="API"
        description="Chaves para autenticar chamadas externas ao InventoryBlind. O valor completo só aparece uma vez, na criação — guarde em local seguro."
        actions={<Button onClick={() => setCreateOpen(true)}><Plus size={16} /> Nova chave</Button>}
      />

      {justCreated && (
        <Panel className="mb-6 border-accent/40">
          <PanelSection padding="lg">
            <div className="flex items-start gap-3 mb-3">
              <KeyRound size={18} className="text-accent flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-fg">Chave "{justCreated.name}" criada</p>
                <p className="text-xs text-fg-muted mt-1">Copie agora — por segurança, este valor não será mostrado de novo.</p>
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
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => setJustCreated(null)}>Entendi, já copiei</Button>
          </PanelSection>
        </Panel>
      )}

      <Panel>
        <PanelSection padding="sm"><p className="text-section">Chaves ({keys.length})</p></PanelSection>
        {loading ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Carregando...</PanelSection>
        ) : keys.length === 0 ? (
          <PanelSection padding="lg" className="text-center text-fg-subtle">Nenhuma chave criada ainda.</PanelSection>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr><Th>Nome</Th><Th>Prefixo</Th><Th>Status</Th><Th>Criada em</Th><Th>Último uso</Th><Th></Th></Tr>
              </Thead>
              <tbody>
                {keys.map(key => (
                  <Tr key={key.id}>
                    <Td className="font-medium text-fg">{key.name}</Td>
                    <Td className="font-mono text-xs text-fg-muted">{key.key_prefix}…</Td>
                    <Td>{key.revoked_at ? <Badge variant="danger">Revogada</Badge> : <Badge variant="success">Ativa</Badge>}</Td>
                    <Td className="text-fg-subtle text-xs whitespace-nowrap">{formatDate(key.created_at)}</Td>
                    <Td className="text-fg-subtle text-xs whitespace-nowrap">{formatDate(key.last_used_at)}</Td>
                    <Td>
                      {!key.revoked_at && (
                        <Button size="sm" variant="ghost" disabled={revoking === key.id} onClick={() => handleRevoke(key)}>
                          <Trash2 size={14} /> Revogar
                        </Button>
                      )}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Panel>

      <Panel className="mt-6">
        <PanelSection padding="lg">
          <p className="text-section mb-2">Como autenticar</p>
          <p className="text-sm text-fg-muted mb-3">
            Envie a chave no cabeçalho <code className="bg-surface-3 px-1.5 py-0.5 rounded text-xs">Authorization: Bearer &lt;chave&gt;</code> ao consultar o saldo de um produto pelo SKU.
          </p>
          <pre className="bg-surface-3 border border-edge rounded-control p-3 text-xs font-mono text-fg-muted overflow-x-auto">
{`curl "https://SEU-PROJETO.supabase.co/functions/v1/public-api/stock?sku=ABC123" \\
  -H "Authorization: Bearer ibk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`}
          </pre>
        </PanelSection>
      </Panel>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nova chave de API">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-fg-muted mb-1.5 block">Nome (para identificar depois)</label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Integração com o site" autoFocus />
          </div>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button size="sm" disabled={!name.trim() || creating} onClick={handleCreate}>
              {creating ? 'Criando...' : 'Criar chave'}
            </Button>
          </div>
        </div>
      </Modal>
    </Page>
  );
}

export default ApiKeysPage;
