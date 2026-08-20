import { useState } from 'react';
import { ArchiveRestore, Trash, Trash2 } from 'lucide-react';
import { AdminRecordSummary, AdminReasonModal } from '../admin/AdminReasonModal';
import { RecordAdminMenu, type RecordAdminAction } from '../admin/RecordAdminMenu';
import { canHardDeleteInvoice } from '../../lib/nfe/nfeAdmin';
import {
  archiveInvoiceAdmin,
  hardDeleteDraftInvoiceAdmin,
  restoreInvoiceAdmin,
} from '../../lib/nfe/nfeService';
import { INVOICE_STATUS_LABEL, type NfeInvoice } from '../../lib/nfe/nfeTypes';

interface NfeInvoiceAdminActionsProps {
  invoice: NfeInvoice;
  /** Na área de Arquivados a única ação possível é restaurar. */
  mode?: 'active' | 'archived';
  onDone: (message: string) => void;
}

type OpenModal = 'archive' | 'restore' | 'purge' | null;

/** Os 8 primeiros dígitos da chave bastam para conferir que é a nota certa sem
 *  jogar 44 caracteres dentro de um resumo de modal. */
function shortKey(invoiceKey: string): string {
  return `${invoiceKey.slice(0, 8)}…${invoiceKey.slice(-4)}`;
}

/**
 * Ações administrativas de uma conferência de NF-e.
 *
 * NÃO existe "editar nota": chave, número, série, emitente, valores e XML são
 * documento fiscal e permanecem imutáveis. O que existe é arquivar, restaurar e
 * — só para nota nunca conferida — excluir. Correção de quantidade conferida é
 * outra ação, por item, e gera evento novo em vez de sobrescrever o log.
 */
export function NfeInvoiceAdminActions({ invoice, mode = 'active', onDone }: NfeInvoiceAdminActionsProps) {
  const [open, setOpen] = useState<OpenModal>(null);

  const summaryFields = [
    { label: 'Nota', value: `NF ${invoice.invoice_number ?? '—'}${invoice.invoice_series ? ` / ${invoice.invoice_series}` : ''}` },
    { label: 'Chave', value: <span className="font-mono text-xs">{shortKey(invoice.invoice_key)}</span> },
    { label: 'Fornecedor', value: invoice.supplier_name ?? '—' },
    { label: 'Itens', value: <span className="tabular-nums">{invoice.total_items}</span> },
    { label: 'Status', value: INVOICE_STATUS_LABEL[invoice.status] },
  ];

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
          {
            key: 'archive',
            label: 'Remover do histórico',
            icon: <Trash2 size={14} />,
            tone: 'danger',
            onSelect: () => setOpen('archive'),
          },
          ...(canHardDeleteInvoice(invoice)
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
      <RecordAdminMenu actions={actions} label="Ações administrativas desta nota" />

      <AdminReasonModal
        open={open === 'archive'}
        title="Remover do histórico"
        summary={<AdminRecordSummary fields={summaryFields} />}
        consequence="Esta nota deixará de aparecer na lista e não aceitará mais nenhuma alteração — nem contagem, nem vínculo de produto, nem reabertura. O XML, os itens e os eventos de contagem não são apagados. Você pode restaurá-la depois em Arquivados."
        confirmLabel="Remover do histórico"
        acknowledgeLabel="Confirmo a remoção desta nota do histórico."
        reasonPlaceholder="Ex.: nota importada em duplicidade"
        onClose={close}
        onConfirm={async reason => {
          await archiveInvoiceAdmin(invoice.id, reason);
          close();
          onDone('Nota removida do histórico.');
        }}
      />

      <AdminReasonModal
        open={open === 'restore'}
        title="Restaurar nota"
        summary={<AdminRecordSummary fields={summaryFields} />}
        consequence="A nota volta a aparecer na lista e a aceitar as operações compatíveis com o status dela. A remoção anterior e esta restauração ficam registradas na auditoria."
        confirmLabel="Restaurar"
        acknowledgeLabel="Confirmo a restauração desta nota."
        variant="primary"
        reasonPlaceholder="Ex.: removida por engano, conferência é válida"
        onClose={close}
        onConfirm={async reason => {
          await restoreInvoiceAdmin(invoice.id, reason);
          close();
          onDone('Nota restaurada.');
        }}
      />

      <AdminReasonModal
        open={open === 'purge'}
        title="Excluir definitivamente"
        summary={<AdminRecordSummary fields={summaryFields} />}
        consequence="Esta exclusão NÃO tem volta: a nota, os itens e o XML saem do banco de dados. Só é permitida porque esta nota nunca foi conferida — se houver qualquer contagem registrada, o sistema vai recusar. Fica na auditoria o registro de qual nota foi excluída, por quem e por quê."
        confirmLabel="Excluir definitivamente"
        acknowledgeLabel="Entendo que esta exclusão é permanente e leva o XML junto."
        reasonPlaceholder="Ex.: XML importado da empresa errada"
        onClose={close}
        onConfirm={async reason => {
          await hardDeleteDraftInvoiceAdmin(invoice.id, reason);
          close();
          onDone('Nota excluída definitivamente.');
        }}
      />
    </>
  );
}
