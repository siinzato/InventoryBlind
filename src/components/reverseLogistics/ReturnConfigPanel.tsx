import { useEffect, useState } from 'react';
import { Panel, PanelSection, Button, Input, Select, Badge } from '../ui';
import {
  listChecklistTemplates, listConditionGrades, listDestinationRules, getApprovalSettings,
  createConditionGrade, createDestinationRule, upsertApprovalSettings,
} from '../../lib/reverseLogistics/reverseLogisticsService';
import {
  RETURN_DESTINATION_LABEL,
  type ChecklistTemplate, type ConditionGrade, type DestinationRule, type ApprovalSettings, type ReturnDestination,
} from '../../lib/reverseLogistics/reverseLogisticsTypes';

interface ReturnConfigPanelProps {
  companyId: string;
  userId: string;
  userEmail: string;
}

const DEFAULT_SETTINGS = (companyId: string): ApprovalSettings => ({
  companyId, requireApprovalDiscard: false, requireApprovalRestock: false, highValueThreshold: null,
  requireApprovalHighValue: false, requireApprovalSerialMismatch: false, requireApprovalChecklistException: false,
  requireApprovalDestinationChange: false,
});

/** Configurações da Logística Reversa (Fase 2): checklists, grades de condição, regras de
 *  sugestão de destinação e aprovações — tudo como seções dentro de um só painel, sem rota
 *  nova (princípio de Economia: "evite novas telas quando uma seção contextual resolver"). */
export function ReturnConfigPanel({ companyId, userId, userEmail }: ReturnConfigPanelProps) {
  const [templates, setTemplates] = useState<ChecklistTemplate[]>([]);
  const [grades, setGrades] = useState<ConditionGrade[]>([]);
  const [rules, setRules] = useState<DestinationRule[]>([]);
  const [settings, setSettings] = useState<ApprovalSettings>(DEFAULT_SETTINGS(companyId));
  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  const [newGradeCode, setNewGradeCode] = useState('');
  const [newGradeLabel, setNewGradeLabel] = useState('');

  const [newRuleDestination, setNewRuleDestination] = useState<ReturnDestination>('quarantine');
  const [newRulePriority, setNewRulePriority] = useState('0');

  const load = async () => {
    setLoading(true);
    try {
      const [t, g, r, s] = await Promise.all([
        listChecklistTemplates(companyId), listConditionGrades(companyId), listDestinationRules(companyId), getApprovalSettings(companyId),
      ]);
      setTemplates(t);
      setGrades(g);
      setRules(r);
      setSettings(s ?? DEFAULT_SETTINGS(companyId));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      const saved = await upsertApprovalSettings(settings, userId);
      setSettings(saved);
    } finally {
      setSavingSettings(false);
    }
  };

  const addGrade = async () => {
    if (!newGradeCode.trim() || !newGradeLabel.trim()) return;
    await createConditionGrade({
      companyId, code: newGradeCode.trim().toUpperCase(), label: newGradeLabel.trim(), description: null,
      criteria: [], sortOrder: grades.length,
    }, userId, userEmail);
    setNewGradeCode('');
    setNewGradeLabel('');
    await load();
  };

  const addRule = async () => {
    await createDestinationRule({
      companyId, priority: Number(newRulePriority) || 0, active: true, conditionGradeId: null, category: null,
      reason: null, minValue: null, maxValue: null, requiresWarranty: null, requiresAccessories: null,
      defectReported: null, suggestedDestination: newRuleDestination,
    }, userId, userEmail);
    await load();
  };

  if (loading) return <Panel><PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Carregando configurações...</PanelSection></Panel>;

  return (
    <>
      <Panel>
        <PanelSection padding="md"><p className="text-title">Aprovações</p><p className="text-caption text-fg-subtle">Quando ativado, a destinação correspondente fica bloqueada até um owner/admin/manager aprovar.</p></PanelSection>
        <PanelSection padding="md" className="space-y-3 text-sm">
          {([
            ['requireApprovalDiscard', 'Exigir aprovação para descarte'],
            ['requireApprovalRestock', 'Exigir aprovação para retorno ao estoque vendável'],
            ['requireApprovalSerialMismatch', 'Exigir aprovação em divergência de serial'],
            ['requireApprovalChecklistException', 'Exigir aprovação em exceção de checklist'],
            ['requireApprovalDestinationChange', 'Exigir aprovação quando a decisão diverge da sugestão'],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-fg">
              <input type="checkbox" checked={settings[key]} onChange={e => setSettings(prev => ({ ...prev, [key]: e.target.checked }))} className="h-4 w-4 rounded border-edge" />
              {label}
            </label>
          ))}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-fg">
              <input type="checkbox" checked={settings.requireApprovalHighValue} onChange={e => setSettings(prev => ({ ...prev, requireApprovalHighValue: e.target.checked }))} className="h-4 w-4 rounded border-edge" />
              Exigir aprovação para item de alto valor, a partir de
            </label>
            <Input
              value={settings.highValueThreshold ?? ''} placeholder="R$"
              onChange={e => setSettings(prev => ({ ...prev, highValueThreshold: e.target.value ? Number(e.target.value) : null }))}
              className="w-32 font-mono"
            />
          </div>
          <Button size="sm" onClick={saveSettings} disabled={savingSettings}>Salvar configurações de aprovação</Button>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md"><p className="text-title">Grades de condição ({grades.length})</p></PanelSection>
        {grades.map(g => (
          <PanelSection key={g.id} padding="sm" className="flex items-center gap-2 text-sm">
            <Badge variant="neutral">{g.code}</Badge><span className="text-fg">{g.label}</span>
          </PanelSection>
        ))}
        <PanelSection padding="md" className="flex flex-wrap gap-2">
          <Input placeholder="Código (ex.: A)" value={newGradeCode} onChange={e => setNewGradeCode(e.target.value)} className="w-32" />
          <Input placeholder="Rótulo (ex.: Apto para revenda)" value={newGradeLabel} onChange={e => setNewGradeLabel(e.target.value)} className="flex-1 min-w-[200px]" />
          <Button size="sm" variant="secondary" onClick={addGrade}>Adicionar grade</Button>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md">
          <p className="text-title">Regras de sugestão de destinação ({rules.length})</p>
          <p className="text-caption text-fg-subtle">A regra só sugere — a decisão final continua manual e auditável na tela de cada devolução.</p>
        </PanelSection>
        {rules.map(r => (
          <PanelSection key={r.id} padding="sm" className="flex items-center gap-2 text-sm">
            <Badge variant="neutral">Prioridade {r.priority}</Badge>
            <span className="text-fg">→ {RETURN_DESTINATION_LABEL[r.suggestedDestination]}</span>
          </PanelSection>
        ))}
        <PanelSection padding="md" className="flex flex-wrap gap-2">
          <Input placeholder="Prioridade" value={newRulePriority} onChange={e => setNewRulePriority(e.target.value)} className="w-24 font-mono" />
          <Select value={newRuleDestination} onChange={e => setNewRuleDestination(e.target.value as ReturnDestination)} className="w-64">
            {(Object.keys(RETURN_DESTINATION_LABEL) as ReturnDestination[]).map(d => <option key={d} value={d}>{RETURN_DESTINATION_LABEL[d]}</option>)}
          </Select>
          <Button size="sm" variant="secondary" onClick={addRule}>Adicionar regra</Button>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection padding="md"><p className="text-title">Checklists configuráveis ({templates.length})</p></PanelSection>
        {templates.length === 0 && <PanelSection padding="lg" className="text-center text-sm text-fg-subtle">Nenhum template configurado — o checklist fixo padrão continua sendo usado.</PanelSection>}
        {templates.map(t => (
          <PanelSection key={t.id} padding="sm" className="flex items-center gap-2 text-sm">
            <span className="text-fg">{t.name}</span>
            <span className="text-xs text-fg-subtle">v{t.version}{t.category ? ` · ${t.category}` : ''}{t.reason ? ` · ${t.reason}` : ''}</span>
          </PanelSection>
        ))}
      </Panel>
    </>
  );
}
