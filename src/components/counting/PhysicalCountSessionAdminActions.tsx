import { useEffect, useId, useState } from 'react';
import { ArchiveRestore, Pencil, Trash, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Modal, Textarea } from '../ui';
import { AdminRecordSummary, AdminReasonModal } from '../admin/AdminReasonModal';
import { RecordAdminMenu, type RecordAdminAction } from '../admin/RecordAdminMenu';
import {
  DRAFT_SESSION_STATUSES,
  hasSessionAdminChanges,
  normalizeSessionAdminFields,
  type SessionAdminFields,
} from '../../lib/physicalCount/physicalCountAdmin';
import {
  deleteSessionAdmin,
  hardDeleteDraftSessionAdmin,
  restoreSessionAdmin,
  updateSessionAdmin,
} from '../../lib/physicalCount/physicalCountService';
import type { PhysicalCountSession } from '../../lib/physicalCount/physicalCountTypes';

interface PhysicalCountSessionAdminActionsProps {
  session: PhysicalCountSession;
  /** Rótulo já traduzido do status, para o modal não redeclarar o mapa da tabela. */
  statusLabel: string;
  /** Na área de Arquivados a única ação possível é restaurar. */
  mode?: 'active' | 'archived';
  /** Chamado depois de uma operação bem-sucedida: o pai recarrega e confirma. */
  onDone: (message: string) => void;
}

type OpenModal = 'edit' | 'archive' | 'restore' | 'purge' | null;

/**
 * Ações administrativas de uma sessão de contagem.
 *
 * Só é renderizado para owner/admin (o pai decide), mas isso é UX: quem manda é
 * o banco — as RPCs pc_admin_* recusam qualquer outro papel, empresa diferente e
 * sessão em estado incompatível.
 */
export function PhysicalCountSessionAdminActions({
  session,
  statusLabel,
  mode = 'active',
  onDone,
}: PhysicalCountSessionAdminActionsProps) {
  const [open, setOpen] = useState<OpenModal>(null);

  const summaryFields = [
    { label: 'Faixa', value: `${session.streetFrom} → ${session.streetTo}` },
    { label: 'Depósito', value: session.warehouse ?? '—' },
    { label: 'Contagem', value: `${session.countNumber}ª contagem` },
    { label: 'Itens', value: <span className="tabular-nums">{session.totalItems}</span> },
    { label: 'Status', value: <Badge variant="neutral">{statusLabel}</Badge> },
  ];

  const isDraft = (DRAFT_SESSION_STATUSES as readonly string[]).includes(session.status);

  const actions: RecordAdminAction[] =
    mode === 'archived'
      ? [
          {
            key: 'restore',
            label: 'Restaurar',
            icon: <ArchiveRestore size={14} />,
            onSelect: () => setOpen('restore'),
          },
        ]
      : [
          { key: 'edit', label: 'Editar sessão', icon: <Pencil size={14} />, onSelect: () => setOpen('edit') },
          {
            key: 'archive',
            label: 'Remover do histórico',
            icon: <Trash2 size={14} />,
            tone: 'danger',
            onSelect: () => setOpen('archive'),
          },
          // Só para rascunho. O banco ainda confere ausência de contagens,
          // recontagens filhas e eventos de ERP — aqui é só para não oferecer um
          // botão que já se sabe que vai falhar.
          ...(isDraft
            ? [
                {
                  key: 'purge',
                  label: 'Excluir definitivamente',
                  icon: <Trash size={14} />,
                  tone: 'danger' as const,
                  onSelect: () => setOpen('purge'),
                },
              ]
            : []),
        ];

  const close = () => setOpen(null);

  return (
    <>
      <RecordAdminMenu actions={actions} label="Ações administrativas desta sessão" />

      <EditSessionModal
        open={open === 'edit'}
        session={session}
        onClose={close}
        onSaved={() => {
          close();
          onDone('Informações da sessão atualizadas.');
        }}
      />

      <AdminReasonModal
        open={open === 'archive'}
        title="Remover do histórico"
        summary={<AdminRecordSummary fields={summaryFields} />}
        consequence="Esta sessão deixará de aparecer no histórico e não poderá mais ser aberta, continuada ou aprovada. As contagens registradas, os eventos e as recontagens não são apagados — ficam guardados no registro de auditoria, com o seu nome e a justificativa abaixo. Você pode restaurá-la depois em Arquivados."
        confirmLabel="Remover do histórico"
        acknowledgeLabel="Confirmo a remoção desta sessão do histórico."
        reasonPlaceholder="Ex.: sessão criada por engano na faixa errada"
        onClose={close}
        onConfirm={async reason => {
          await deleteSessionAdmin(session.id, reason);
          close();
          onDone('Sessão removida do histórico.');
        }}
      />

      <AdminReasonModal
        open={open === 'restore'}
        title="Restaurar sessão"
        summary={<AdminRecordSummary fields={summaryFields} />}
        consequence="A sessão volta a aparecer no histórico e a aceitar as operações compatíveis com o status dela. A remoção anterior e esta restauração ficam registradas na auditoria."
        confirmLabel="Restaurar"
        acknowledgeLabel="Confirmo a restauração desta sessão."
        variant="primary"
        reasonPlaceholder="Ex.: removida por engano, contagem é válida"
        onClose={close}
        onConfirm={async reason => {
          await restoreSessionAdmin(session.id, reason);
          close();
          onDone('Sessão restaurada.');
        }}
      />

      <AdminReasonModal
        open={open === 'purge'}
        title="Excluir definitivamente"
        summary={<AdminRecordSummary fields={summaryFields} />}
        consequence="Esta exclusão NÃO tem volta: a sessão e os itens dela saem do banco de dados. Só é permitida porque é um rascunho que nunca foi contado — se houver qualquer contagem registrada, recontagem vinculada ou histórico de ERP, o sistema vai recusar. O registro do que foi excluído fica na auditoria."
        confirmLabel="Excluir definitivamente"
        acknowledgeLabel="Entendo que esta exclusão é permanente e não pode ser desfeita."
        reasonPlaceholder="Ex.: rascunho duplicado, criado duas vezes por engano"
        onClose={close}
        onConfirm={async reason => {
          await hardDeleteDraftSessionAdmin(session.id, reason);
          close();
          onDone('Rascunho excluído definitivamente.');
        }}
      />
    </>
  );
}

// ── Editar sessão ─────────────────────────────────────────────────────────────

interface EditSessionModalProps {
  open: boolean;
  session: PhysicalCountSession;
  onClose: () => void;
  onSaved: () => void;
}

function EditSessionModal({ open, session, onClose, onSaved }: EditSessionModalProps) {
  const [warehouse, setWarehouse] = useState('');
  const [area, setArea] = useState('');
  const [observation, setObservation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  // Recarrega os valores atuais a cada abertura: se a sessão foi alterada por
  // outra pessoa desde a última vez, o formulário mostra o estado de agora.
  useEffect(() => {
    if (!open) return;
    setWarehouse(session.warehouse ?? '');
    setArea(session.area ?? '');
    setObservation(session.observation ?? '');
    setError(null);
    setSaving(false);
  }, [open, session.warehouse, session.area, session.observation]);

  // Escape fecha. Tratado aqui, e não no `Modal` compartilhado, porque passar a
  // fechar com Escape mudaria o comportamento de todos os modais do sistema.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, saving, onClose]);

  const current: SessionAdminFields = normalizeSessionAdminFields({
    warehouse: session.warehouse,
    area: session.area,
    observation: session.observation,
  });
  const next = normalizeSessionAdminFields({ warehouse, area, observation });
  const changed = hasSessionAdminChanges(current, next);

  const handleSave = async () => {
    if (saving || !changed) return;
    setSaving(true);
    setError(null);
    try {
      await updateSessionAdmin(session.id, next);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar as alterações.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={saving ? () => {} : onClose} title="Editar sessão">
      <div className="space-y-4">
        <p className="text-sm text-fg-muted">
          Só as informações administrativas podem ser alteradas. Faixa, número da contagem, status,
          quantidades contadas, saldo do ERP, datas e aprovação continuam como foram registrados.
        </p>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-warehouse`} className="block text-xs font-semibold text-fg-muted">
            Depósito
          </label>
          <Input
            id={`${fieldId}-warehouse`}
            // Foco na abertura sem ref: `Input` é um componente de função sem
            // forwardRef, e transformá-lo em forwardRef mexeria num componente
            // usado em todas as telas do sistema.
            autoFocus
            value={warehouse}
            onChange={e => setWarehouse(e.target.value)}
            disabled={saving}
            placeholder="Não informado"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-area`} className="block text-xs font-semibold text-fg-muted">
            Área
          </label>
          <Input
            id={`${fieldId}-area`}
            value={area}
            onChange={e => setArea(e.target.value)}
            disabled={saving}
            placeholder="Não informada"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor={`${fieldId}-observation`} className="block text-xs font-semibold text-fg-muted">
            Observação
          </label>
          <Textarea
            id={`${fieldId}-observation`}
            value={observation}
            onChange={e => setObservation(e.target.value)}
            disabled={saving}
            rows={3}
            placeholder="Sem observação"
          />
        </div>

        <div aria-live="polite">
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !changed}>
            {saving ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
