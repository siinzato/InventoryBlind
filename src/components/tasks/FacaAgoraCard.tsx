import React from 'react';
import { Zap, Sun } from 'lucide-react';
import { TaskWithAssignees, AssigneeStatus, BlockReason } from '../../lib/tasks/types';
import { recommendNextTask, RECOMMENDATION_REASON_LABEL } from '../../lib/tasks/taskDomain';
import { TaskCard } from './TaskCard';

interface FacaAgoraCardProps {
  tasks: TaskWithAssignees[];
  currentUserId: string;
  nowMs: number;
  dueSoonThresholdMinutes: number;
  onOpenTask: (id: string) => void;
  onChangeMyStatus: (taskId: string, status: AssigneeStatus) => void;
  onPause: (taskId: string, note?: string) => void;
  onResume: (taskId: string) => void;
  onBlock: (taskId: string, reason: BlockReason, note?: string) => void;
  onUnblock: (taskId: string) => void;
}

/**
 * Algoritmo determinístico em recommendNextTask (taskDomain.ts) — não é uma
 * IA opaca: cada critério é uma função pura, testada isoladamente. O sistema
 * recomenda, o operador decide (pode sempre abrir e trabalhar em outra).
 */
export const FacaAgoraCard: React.FC<FacaAgoraCardProps> = ({
  tasks, currentUserId, nowMs, dueSoonThresholdMinutes, onOpenTask, onChangeMyStatus, onPause, onResume, onBlock, onUnblock,
}) => {
  const recommendation = recommendNextTask(tasks, currentUserId, nowMs, dueSoonThresholdMinutes);

  return (
    <div className="bg-surface-2 rounded-xl border-2 border-accent/30 p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 bg-accent rounded-lg"><Zap size={14} className="text-white" /></div>
        <h2 className="font-bold text-sm text-fg uppercase tracking-wide">Faça agora</h2>
      </div>

      {recommendation ? (
        <div className="space-y-2">
          <p className="text-xs text-fg-subtle">{RECOMMENDATION_REASON_LABEL[recommendation.reason]}</p>
          <TaskCard
            task={recommendation.task}
            currentUserId={currentUserId}
            onOpen={() => onOpenTask(recommendation.task.id)}
            onChangeMyStatus={s => onChangeMyStatus(recommendation.task.id, s)}
            onPause={note => onPause(recommendation.task.id, note)}
            onResume={() => onResume(recommendation.task.id)}
            onBlock={(reason, note) => onBlock(recommendation.task.id, reason, note)}
            onUnblock={() => onUnblock(recommendation.task.id)}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-6 text-fg-subtle text-center">
          <Sun size={28} className="mb-2 opacity-30" />
          <p className="text-sm">Nenhuma tarefa pendente para recomendar agora.</p>
        </div>
      )}
    </div>
  );
};

export default FacaAgoraCard;
