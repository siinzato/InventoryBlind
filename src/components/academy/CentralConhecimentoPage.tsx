import { useState } from 'react';
import { Panel, PanelSection } from '../ui';
import {
  KNOWLEDGE_FAQ,
  KNOWLEDGE_GLOSSARIO,
  KNOWLEDGE_BOAS_PRATICAS,
  KNOWLEDGE_ARTIGOS,
  KNOWLEDGE_ESTUDOS_CASO,
  KnowledgeEntry,
} from '../../lib/academyContent';

const SECTIONS: { id: string; label: string; entries: KnowledgeEntry[] }[] = [
  { id: 'faq', label: 'FAQ', entries: KNOWLEDGE_FAQ },
  { id: 'glossario', label: 'Glossário', entries: KNOWLEDGE_GLOSSARIO },
  { id: 'boas_praticas', label: 'Boas Práticas', entries: KNOWLEDGE_BOAS_PRATICAS },
  { id: 'artigos', label: 'Artigos', entries: KNOWLEDGE_ARTIGOS },
  { id: 'estudos_caso', label: 'Estudos de Caso', entries: KNOWLEDGE_ESTUDOS_CASO },
];

export function CentralConhecimentoPage() {
  const [activeSection, setActiveSection] = useState('faq');
  const section = SECTIONS.find(s => s.id === activeSection) ?? SECTIONS[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SECTIONS.map(s => (
          <button
            key={s.id}
            onClick={() => setActiveSection(s.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              activeSection === s.id ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      <Panel>
        {section.entries.map(entry => (
          <PanelSection key={entry.title} padding="md">
            <p className="font-semibold text-fg text-sm">{entry.title}</p>
            <p className="text-xs text-fg-muted mt-1">{entry.body}</p>
          </PanelSection>
        ))}
      </Panel>
    </div>
  );
}
