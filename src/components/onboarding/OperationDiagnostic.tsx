// Diagnóstico da operação — uma etapa por vez, dentro da área autenticada.
//
// Usa só o design system das telas internas (Page/PageHeader/Panel/Button/Badge) e
// os tokens de tema, então claro e escuro saem de graça e a tela pertence ao mesmo
// produto que o resto do app.
//
// Nenhuma regra mora aqui: perguntas, pesos e recomendação vêm de
// lib/operationDiagnostic.ts. Este arquivo escolhe o que mostrar e nada mais.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw } from 'lucide-react';
import { Badge, Button, Notice, Page, PageHeader, Panel, PanelSection } from '../ui';
import { WHATSAPP_PLANS_URL } from '../landing/landingUi';
import {
  DIAGNOSTIC_STEPS,
  findOptionLabel,
  isStepComplete,
  recommendPlan,
  type DiagnosticAnswers,
  type DiagnosticQuestion,
} from '../../lib/operationDiagnostic';
// `clearDraft` não entra aqui: saveCompleted já descarta o rascunho ao gravar.
import { readDraft, saveCompleted, writeDraft, type DiagnosticRecord } from '../../lib/operationDiagnosticStorage';

interface Props {
  /** Respostas já gravadas, quando o usuário está refazendo o diagnóstico. */
  initial?: DiagnosticRecord | null;
  onClose: () => void;
  /** Chamado depois de gravar, para o chamador atualizar o próprio estado. */
  onCompleted?: (record: DiagnosticRecord) => void;
}

type Phase = 'steps' | 'review' | 'result';

export function OperationDiagnostic({ initial, onClose, onCompleted }: Props) {
  const draft = useMemo(() => (initial == null ? readDraft() : null), [initial]);

  const [answers, setAnswers] = useState<DiagnosticAnswers>(initial?.answers ?? draft?.answers ?? {});
  const [stepIndex, setStepIndex] = useState(draft?.stepIndex ?? 0);
  const [phase, setPhase] = useState<Phase>('steps');
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [record, setRecord] = useState<DiagnosticRecord | null>(null);

  const step = DIAGNOSTIC_STEPS[stepIndex];
  const isLastStep = stepIndex === DIAGNOSTIC_STEPS.length - 1;
  const complete = isStepComplete(step, answers);

  // Rascunho a cada resposta: fechar a aba no meio não perde o que já foi marcado.
  useEffect(() => {
    if (phase === 'steps') writeDraft({ answers, stepIndex });
  }, [answers, stepIndex, phase]);

  const toggle = useCallback((question: DiagnosticQuestion, value: string) => {
    setAnswers(current => {
      const selected = current[question.id] ?? [];
      if (question.kind === 'single') {
        return { ...current, [question.id]: [value] };
      }
      return {
        ...current,
        [question.id]: selected.includes(value)
          ? selected.filter(v => v !== value)
          : [...selected, value],
      };
    });
  }, []);

  async function finish() {
    setSaving(true);
    setSaveFailed(false);
    const built: DiagnosticRecord = {
      answers,
      recommendedPlan: recommendPlan(answers).plan.key,
      completedAt: new Date().toISOString(),
    };
    const ok = await saveCompleted(built);
    setRecord(built);
    setSaveFailed(!ok);
    setSaving(false);
    setPhase('result');
    if (ok) onCompleted?.(built);
  }

  // ── Resultado ─────────────────────────────────────────────────────────────
  if (phase === 'result' && record != null) {
    return (
      <ResultView
        answers={record.answers}
        saveFailed={saveFailed}
        onRedo={() => {
          setPhase('steps');
          setStepIndex(0);
          setRecord(null);
        }}
        onReview={() => setPhase('review')}
        onClose={onClose}
      />
    );
  }

  // ── Revisão ───────────────────────────────────────────────────────────────
  if (phase === 'review') {
    return (
      <Page>
        <PageHeader
          eyebrow="Diagnóstico da operação"
          title="Revisar respostas"
          description="Confira o que foi informado antes de ver o plano recomendado."
          actions={
            <Button variant="ghost" onClick={onClose}>
              <ArrowLeft size={14} />
              Sair
            </Button>
          }
        />

        {DIAGNOSTIC_STEPS.map((reviewStep, index) => (
          <Panel key={reviewStep.id}>
            <PanelSection className="flex items-center justify-between gap-3">
              <h3 className="text-section">{reviewStep.title}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setStepIndex(index);
                  setPhase('steps');
                }}
              >
                Editar
              </Button>
            </PanelSection>
            <PanelSection className="space-y-3">
              {reviewStep.questions.map(question => {
                const selected = answers[question.id] ?? [];
                return (
                  <div key={question.id} className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6">
                    <p className="text-sm text-fg-muted sm:max-w-sm">{question.label}</p>
                    <p className="text-sm font-medium text-fg sm:text-right">
                      {selected.length > 0
                        ? selected.map(v => findOptionLabel(question.id, v)).join(', ')
                        : 'Sem resposta'}
                    </p>
                  </div>
                );
              })}
            </PanelSection>
          </Panel>
        ))}

        <Panel>
          <PanelSection className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void finish()} disabled={saving}>
              {saving && <Loader2 size={14} className="animate-spin" />}
              Ver plano recomendado
            </Button>
            <Button variant="ghost" onClick={() => setPhase('steps')}>
              Voltar às etapas
            </Button>
          </PanelSection>
        </Panel>
      </Page>
    );
  }

  // ── Etapas ────────────────────────────────────────────────────────────────
  const progress = Math.round(((stepIndex + 1) / DIAGNOSTIC_STEPS.length) * 100);

  return (
    <Page>
      <PageHeader
        eyebrow="Diagnóstico da operação"
        title={step.title}
        description={step.description}
        actions={
          <Button variant="ghost" onClick={onClose}>
            Salvar e continuar depois
          </Button>
        }
      />

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-fg-subtle">
          <span>
            Etapa {stepIndex + 1} de {DIAGNOSTIC_STEPS.length}
          </span>
          <span>{progress}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-3"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Etapa ${stepIndex + 1} de ${DIAGNOSTIC_STEPS.length}`}
        >
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {step.questions.map(question => (
        <Panel key={question.id}>
          <PanelSection>
            <fieldset>
              <legend className="text-section">{question.label}</legend>
              {question.hint && (
                <p id={`${question.id}-hint`} className="mt-1 text-sm text-fg-muted">
                  {question.hint}
                </p>
              )}

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {question.options.map(option => {
                  const selected = (answers[question.id] ?? []).includes(option.value);
                  return (
                    <button
                      key={option.value}
                      type="button"
                      role={question.kind === 'single' ? 'radio' : 'checkbox'}
                      aria-checked={selected}
                      aria-describedby={question.hint ? `${question.id}-hint` : undefined}
                      onClick={() => toggle(question, option.value)}
                      className={`flex min-h-[44px] items-center gap-3 rounded-control border px-4 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                        selected
                          ? 'border-accent bg-accent/10 text-fg'
                          : 'border-edge bg-surface-3 text-fg-muted hover:border-accent/40 hover:text-fg'
                      }`}
                    >
                      {/* O marcador não é decorativo: sem ele a seleção dependeria só
                          da cor, que não é acessível a todo mundo. */}
                      <span
                        className={`flex h-4 w-4 flex-shrink-0 items-center justify-center border ${
                          question.kind === 'single' ? 'rounded-full' : 'rounded-[4px]'
                        } ${selected ? 'border-accent bg-accent text-white' : 'border-edge bg-surface'}`}
                        aria-hidden
                      >
                        {selected && <Check size={11} strokeWidth={3} />}
                      </span>
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          </PanelSection>
        </Panel>
      ))}

      <Panel>
        <PanelSection className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setStepIndex(i => Math.max(0, i - 1))}
            disabled={stepIndex === 0}
          >
            <ArrowLeft size={14} />
            Voltar
          </Button>

          {isLastStep ? (
            <Button onClick={() => setPhase('review')} disabled={!complete}>
              Revisar respostas
              <ArrowRight size={14} />
            </Button>
          ) : (
            <Button onClick={() => setStepIndex(i => i + 1)} disabled={!complete}>
              Continuar
              <ArrowRight size={14} />
            </Button>
          )}

          {!complete && (
            <p className="text-xs text-fg-subtle">Responda as perguntas desta etapa para continuar.</p>
          )}
        </PanelSection>
      </Panel>
    </Page>
  );
}

// ── Resultado ───────────────────────────────────────────────────────────────

function ResultView({
  answers,
  saveFailed,
  onRedo,
  onReview,
  onClose,
}: {
  answers: DiagnosticAnswers;
  saveFailed: boolean;
  onRedo: () => void;
  onReview: () => void;
  onClose: () => void;
}) {
  const result = useMemo(() => recommendPlan(answers), [answers]);
  const { plan, previous } = result;
  const isFree = plan.key === 'free';

  return (
    <Page>
      <PageHeader
        eyebrow="Diagnóstico da operação"
        title="Plano recomendado"
        description={result.profileSummary}
        actions={
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        }
      />

      {saveFailed && (
        <Notice tone="warning">
          Não foi possível salvar as respostas agora. A recomendação abaixo continua
          válida, e você pode refazer o diagnóstico depois.
        </Notice>
      )}

      <Panel>
        <PanelSection className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-title">{plan.name}</h2>
              <Badge variant="accent">Recomendado</Badge>
            </div>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-fg-muted">{plan.desc}</p>
          </div>
          <p className="text-numeric text-2xl font-semibold text-fg">
            {plan.price}
            {plan.period && <span className="text-sm font-normal text-fg-subtle">{plan.period}</span>}
          </p>
        </PanelSection>

        {result.reasons.length > 0 && (
          <PanelSection>
            <h3 className="text-section">Por que recomendamos este plano</h3>
            <ul className="mt-3 space-y-2">
              {result.reasons.map(reason => (
                <li key={reason} className="flex items-start gap-2 text-sm leading-relaxed text-fg-muted">
                  <Check size={14} className="mt-0.5 flex-shrink-0 text-accent" />
                  {reason}
                </li>
              ))}
            </ul>
            {result.unknownCount > 0 && (
              <p className="mt-3 text-xs leading-relaxed text-fg-subtle">
                {result.unknownCount}{' '}
                {result.unknownCount === 1 ? 'pergunta ficou' : 'perguntas ficaram'} sem
                resposta definida e não influenciaram o resultado.
              </p>
            )}
          </PanelSection>
        )}

        <PanelSection>
          <h3 className="text-section">O que está incluído</h3>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {plan.features.map(feature => (
              <li key={feature} className="flex items-start gap-2 text-sm text-fg-muted">
                <Check size={14} className="mt-0.5 flex-shrink-0 text-fg-subtle" />
                {feature}
              </li>
            ))}
          </ul>
        </PanelSection>

        {previous && !isFree && (
          <PanelSection>
            <p className="text-sm leading-relaxed text-fg-muted">
              Em relação ao {previous.name} ({previous.price}
              {previous.period ?? ''}), o {plan.name} acrescenta:{' '}
              <span className="text-fg">
                {plan.features.filter(f => !previous.features.includes(f)).join(' · ')}
              </span>
              .
            </p>
          </PanelSection>
        )}
      </Panel>

      <Panel>
        <PanelSection className="flex flex-wrap items-center gap-2">
          {isFree ? (
            <Button onClick={onClose}>Continuar no Free</Button>
          ) : (
            <>
              {/* Único caminho comercial que existe hoje — não há checkout no produto. */}
              <Button onClick={() => window.open(WHATSAPP_PLANS_URL, '_blank', 'noopener,noreferrer')}>
                Falar sobre o {plan.name}
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Continuar no Free
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onReview}>
            Revisar respostas
          </Button>
          <Button variant="ghost" onClick={onRedo}>
            <RotateCcw size={14} />
            Refazer diagnóstico
          </Button>
        </PanelSection>
        <PanelSection>
          <p className="text-xs leading-relaxed text-fg-subtle">
            Você pode continuar no Free e mudar de plano quando quiser. O diagnóstico fica
            disponível em Minha Conta para ser refeito.
          </p>
        </PanelSection>
      </Panel>
    </Page>
  );
}

/** Convite ao diagnóstico — some depois de respondido ou dispensado.
 *
 *  Painel comum na mesma linguagem do dashboard, não um modal: bloquear a entrada
 *  com um questionário é exatamente o que o fluxo não pode fazer. */
export function DiagnosticInvite({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <Panel>
      <PanelSection className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-2xl">
          <h3 className="text-section">Diagnóstico da operação</h3>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Cinco etapas curtas sobre volume, sistemas e situação do estoque. Ao final
            indicamos o plano mais adequado para esta operação.
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button onClick={onStart}>Iniciar</Button>
          <Button variant="ghost" onClick={onDismiss}>
            Agora não
          </Button>
        </div>
      </PanelSection>
    </Panel>
  );
}
