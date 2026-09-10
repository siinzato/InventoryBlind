import { BookOpen, LayoutGrid, Route, Library, HelpCircle, ArrowRight } from 'lucide-react';
import { Panel, PanelSection } from '../ui';
import { RecommendedCoursesCard } from './RecommendedCoursesCard';
import { AcademyHero } from './AcademyHero';

interface AcademyHomeProps {
  userId: string;
  companyId: string;
  onNavigateMetodo: () => void;
  onNavigatePilares: () => void;
  onNavigateTrilhas: () => void;
  onNavigateBiblioteca: () => void;
  onNavigateCentral: () => void;
}

export function AcademyHome({ userId, companyId, onNavigateMetodo, onNavigatePilares, onNavigateTrilhas, onNavigateBiblioteca, onNavigateCentral }: AcademyHomeProps) {
  const navCards = [
    { title: 'O que é o Método I.B.', description: 'Entenda a metodologia oficial InventoryBlind.', icon: BookOpen, onClick: onNavigateMetodo },
    { title: 'Os 7 Pilares', description: 'Organização, Endereçamento, Padronização, Preparação, Inventário Cego, Validação e Inteligência.', icon: LayoutGrid, onClick: onNavigatePilares },
    { title: 'Trilhas de Aprendizagem', description: 'Operador de Estoque, Líder Operacional, Gestor e Owner.', icon: Route, onClick: onNavigateTrilhas },
    { title: 'Biblioteca', description: 'POPs, checklists e templates.', icon: Library, onClick: onNavigateBiblioteca },
    { title: 'Central de Conhecimento', description: 'FAQ, glossário, boas práticas e artigos.', icon: HelpCircle, onClick: onNavigateCentral },
  ];

  return (
    <div className="space-y-6">
      <AcademyHero />

      <RecommendedCoursesCard userId={userId} companyId={companyId} />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {navCards.map(card => (
          <button key={card.title} onClick={card.onClick} className="text-left">
            <Panel className="h-full hover:border-accent/50 transition-colors">
              <PanelSection padding="md" className="space-y-2">
                <card.icon size={20} className="text-accent" />
                <p className="font-semibold text-fg">{card.title}</p>
                <p className="text-xs text-fg-muted">{card.description}</p>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                  Acessar <ArrowRight size={12} />
                </span>
              </PanelSection>
            </Panel>
          </button>
        ))}
      </div>
    </div>
  );
}
