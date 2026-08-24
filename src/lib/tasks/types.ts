// Tipos do módulo de Tarefas ("Meu Trabalho"). Independente da agenda
// operacional do Full Manager — não compartilha tabela, tipo nem tela.

export type TaskType = 'personal' | 'corporate';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
// 'paused'/'blocked'/'validated' são novos (Central de Execução Operacional,
// migration 072) — os quatro valores originais nunca são removidos.
export type TaskStatus = 'todo' | 'in_progress' | 'paused' | 'blocked' | 'done' | 'validated' | 'cancelled';
export type AssigneeStatus = 'todo' | 'in_progress' | 'paused' | 'blocked' | 'done';

export type BlockReason =
  | 'falta_estoque' | 'produto_nao_localizado' | 'divergencia_sistema' | 'endereco_bloqueado'
  | 'material_avariado' | 'equipamento_indisponivel' | 'sistema_indisponivel' | 'aguardando_decisao'
  | 'dependencia_outra_equipe' | 'falta_informacao' | 'outro';

export const BLOCK_REASONS: { value: BlockReason; label: string }[] = [
  { value: 'falta_estoque', label: 'Falta de estoque' },
  { value: 'produto_nao_localizado', label: 'Produto não localizado' },
  { value: 'divergencia_sistema', label: 'Divergência de sistema' },
  { value: 'endereco_bloqueado', label: 'Endereço bloqueado' },
  { value: 'material_avariado', label: 'Material avariado' },
  { value: 'equipamento_indisponivel', label: 'Equipamento indisponível' },
  { value: 'sistema_indisponivel', label: 'Sistema indisponível' },
  { value: 'aguardando_decisao', label: 'Aguardando decisão' },
  { value: 'dependencia_outra_equipe', label: 'Dependência de outra equipe' },
  { value: 'falta_informacao', label: 'Falta de informação' },
  { value: 'outro', label: 'Outro' },
];

export const TASK_PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Baixa' },
  { value: 'medium', label: 'Normal' },
  { value: 'high', label: 'Alta' },
  { value: 'urgent', label: 'Crítica' },
];

export const TASK_CATEGORY_SUGGESTIONS = [
  'Reposição', 'Inventário', 'Conferência', 'Contagem', 'Ajustes', 'Outros',
];

export interface TaskAssignee {
  id: string;
  task_id: string;
  user_id: string;
  status: AssigneeStatus;
  assigned_at: string;
  assigned_by: string | null;
  started_at: string | null;
  completed_at: string | null;
  block_reason: BlockReason | null;
  block_note: string | null;
  blocked_at: string | null;
  blocked_by: string | null;
  expected_resolver_user_id: string | null;
  paused_at: string | null;
  // Preenchido no client a partir de profiles — não existe na linha do banco.
  user_name?: string | null;
  user_email?: string | null;
}

export type TimeSegmentType = 'active' | 'paused' | 'blocked';

/** Append-only — a duração de cada tipo é sempre soma(ended_at - started_at);
 *  `ended_at: null` é o segmento em aberto agora. */
export interface TaskTimeSegment {
  id: string;
  task_id: string;
  assignee_id: string;
  user_id: string;
  segment_type: TimeSegmentType;
  started_at: string;
  ended_at: string | null;
}

export interface TaskTemplateField {
  key: string;
  label: string;
  type: 'text' | 'number';
}

export interface TaskTemplate {
  id: string;
  key: string;
  name: string;
  operation_type: string;
  version: number;
  is_active: boolean;
  default_priority: TaskPriority;
  default_duration_minutes: number | null;
  requires_validation: boolean;
  evidence_required: boolean;
  checklist_template: string[];
  payload_schema: TaskTemplateField[];
  allowed_block_reasons: BlockReason[] | null;
  tool_key: string | null;
}

export interface TaskModuleSettings {
  company_id: string;
  due_soon_threshold_minutes: number;
  pause_note_required: boolean;
  updated_at: string;
}

export interface TaskChecklistItem {
  id: string;
  task_id: string;
  label: string;
  is_done: boolean;
  position: number;
  completed_by: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface TaskComment {
  id: string;
  task_id: string;
  user_id: string;
  body: string;
  created_at: string;
  user_name?: string | null;
}

export interface TaskAttachment {
  id: string;
  task_id: string;
  uploaded_by: string;
  file_name: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  created_at: string;
}

export type TaskActivityAction =
  | 'created' | 'edited' | 'assigned' | 'reassigned' | 'started' | 'completed'
  | 'cancelled' | 'commented' | 'attachment_added'
  | 'paused' | 'resumed' | 'blocked' | 'unblocked' | 'validated' | 'reopened' | 'priority_changed' | 'due_date_changed';

export interface TaskActivityLog {
  id: string;
  task_id: string;
  user_id: string | null;
  action: TaskActivityAction;
  details: Record<string, unknown>;
  created_at: string;
  user_name?: string | null;
}

export interface Task {
  id: string;
  company_id: string;
  type: TaskType;
  title: string;
  description: string | null;
  category: string | null;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  status: TaskStatus;
  created_by: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  // Contexto logístico e modelo operacional — todos opcionais, definidos pelo
  // modelo (ver TaskTemplate); nenhum é exigido de toda tarefa.
  template_key: string | null;
  template_version: number | null;
  payload: Record<string, unknown>;
  area: string | null;
  location_from: string | null;
  location_to: string | null;
  sku_or_line: string | null;
  planned_quantity: number | null;
  executed_quantity: number | null;
  quantity_unit: string | null;
  estimated_duration_minutes: number | null;
  requires_validation: boolean;
  tool_key: string | null;
  reopened_count: number;
  completion_note: string | null;
  result: Record<string, unknown>;
}

/** Tarefa + responsáveis já carregados — a forma que as telas realmente consomem. */
export interface TaskWithAssignees extends Task {
  assignees: TaskAssignee[];
  checklist?: TaskChecklistItem[];
  // Contagens agregadas para o card da listagem (indicador de checklist/evidência)
  // — buscadas em UMA consulta agrupada por task_id para a lista inteira, nunca
  // por card (evita N+1). Ausentes = não carregado nesta tela.
  checklistSummary?: { total: number; done: number };
  attachmentCount?: number;
}

export type TaskNotificationType =
  | 'assigned' | 'due_date_changed' | 'commented' | 'due_soon' | 'overdue'
  | 'blocked' | 'unblocked' | 'validation_pending' | 'reopened';

export interface TaskNotification {
  id: string;
  task_id: string | null;
  type: TaskNotificationType;
  title: string | null;
  message: string;
  reference_date: string | null;
  read_at: string | null;
  created_at: string;
}

export interface CreateTaskInput {
  type: TaskType;
  title: string;
  description: string | null;
  category: string | null;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  assigneeIds: string[];
  checklist: string[];
}

export interface UpdateTaskInput {
  title: string;
  description: string | null;
  category: string | null;
  priority: TaskPriority;
  due_date: string | null;
  due_time: string | null;
  assigneeIds?: string[];
}

export interface TeamMember {
  id: string;
  name: string | null;
  email: string | null;
  role: string;
}
