import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Panel, PanelSection, Button } from '../ui';
import { submitQuizAttempt, CourseWithQuiz } from '../../lib/academyService';

interface QuizViewProps {
  quiz: CourseWithQuiz;
  userId: string;
  userEmail: string;
  companyId: string;
}

export function QuizView({ quiz, userId, userEmail, companyId }: QuizViewProps) {
  const [answers, setAnswers] = useState<(number | null)[]>(quiz.questions.map(() => null));
  const [result, setResult] = useState<{ score_pct: number; passed: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const allAnswered = answers.every(a => a !== null);

  const handleSubmit = async () => {
    setSubmitting(true);
    const r = await submitQuizAttempt(userId, userEmail, companyId, quiz, answers as number[]);
    setResult(r);
    setSubmitting(false);
  };

  const handleRetry = () => {
    setAnswers(quiz.questions.map(() => null));
    setResult(null);
  };

  if (result) {
    return (
      <Panel>
        <PanelSection padding="lg" className="text-center space-y-3">
          {result.passed ? <CheckCircle2 size={40} className="text-emerald-500 mx-auto" /> : <XCircle size={40} className="text-red-500 mx-auto" />}
          <p className="text-lg font-semibold text-fg">{result.passed ? 'Aprovado!' : 'Não foi desta vez'}</p>
          <p className="text-sm text-fg-muted">Sua nota: {result.score_pct}% (mínimo: {quiz.min_pass_pct}%)</p>
          {!result.passed && <Button variant="secondary" onClick={handleRetry}>Tentar Novamente</Button>}
        </PanelSection>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelSection padding="lg" className="space-y-6">
        <p className="text-sm text-fg-muted">Nota mínima para aprovação: {quiz.min_pass_pct}%</p>
        {quiz.questions.map((q, qi) => (
          <div key={q.id}>
            <p className="font-medium text-fg mb-2">{qi + 1}. {q.question}</p>
            <div className="space-y-1.5">
              {q.options.map((opt, oi) => (
                <button
                  key={oi}
                  onClick={() => setAnswers(a => a.map((v, i) => (i === qi ? oi : v)))}
                  className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left text-sm border transition-colors ${
                    answers[qi] === oi ? 'bg-accent/10 border-accent text-fg' : 'border-edge text-fg-muted hover:bg-surface-3'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Button onClick={handleSubmit} disabled={!allAnswered || submitting}>
          {submitting ? 'Enviando...' : 'Enviar Respostas'}
        </Button>
      </PanelSection>
    </Panel>
  );
}
