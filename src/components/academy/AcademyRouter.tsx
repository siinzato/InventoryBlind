import { useState } from 'react';
import { GraduationCap, BookOpen, LayoutGrid, Route, Library, HelpCircle, Target } from 'lucide-react';
import { Page, PageHeader } from '../ui';
import { AcademyHome } from './AcademyHome';
import { MetodoIBPage } from './MetodoIBPage';
import { PilaresIndexPage } from './PilaresIndexPage';
import { PilarPage } from './PilarPage';
import { TrilhasIndexPage } from './TrilhasIndexPage';
import { TrackDetailPage } from './TrackDetailPage';
import { CoursePlayer } from './CoursePlayer';
import { BibliotecaPage } from './BibliotecaPage';
import { CentralConhecimentoPage } from './CentralConhecimentoPage';
import { PDIPage } from './PDIPage';
import type { PilarKey } from '../../lib/academyContent';

interface AcademyRouterProps {
  userId: string;
  userEmail: string;
  userName: string;
  companyId: string;
  role: string | undefined;
}

type AcademyView = 'home' | 'metodo' | 'pilares' | 'pilar' | 'trilhas' | 'track' | 'course' | 'biblioteca' | 'central' | 'pdi';

const NAV_ITEMS: { id: AcademyView; label: string; icon: typeof GraduationCap }[] = [
  { id: 'home', label: 'Início', icon: GraduationCap },
  { id: 'metodo', label: 'Método I.B.', icon: BookOpen },
  { id: 'pilares', label: 'Pilares', icon: LayoutGrid },
  { id: 'trilhas', label: 'Trilhas', icon: Route },
  { id: 'biblioteca', label: 'Biblioteca', icon: Library },
  { id: 'central', label: 'Central de Conhecimento', icon: HelpCircle },
  { id: 'pdi', label: 'Minha PDI', icon: Target },
];

/** Owns Academy's internal sub-navigation, same spirit as ProductivityTab's `mode` state —
 *  App.tsx only ever renders <AcademyRouter/> for activeTab==='academy', everything below
 *  this component is Academy-internal and doesn't touch App.tsx's activeTab machinery. */
export function AcademyRouter({ userId, userEmail, userName, companyId, role }: AcademyRouterProps) {
  const [view, setView] = useState<AcademyView>('home');
  const [selectedPilarKey, setSelectedPilarKey] = useState<PilarKey | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);

  const goToPilar = (key: PilarKey) => { setSelectedPilarKey(key); setView('pilar'); };
  const goToTrack = (trackId: string) => { setSelectedTrackId(trackId); setView('track'); };
  const goToCourse = (courseId: string) => { setSelectedCourseId(courseId); setView('course'); };

  const activeNav: AcademyView =
    view === 'pilar' ? 'pilares' : view === 'track' || view === 'course' ? 'trilhas' : view;

  return (
    <Page>
      <PageHeader title="I.B Academy" description="A plataforma oficial de capacitação em gestão de estoques e inventário inteligente." />

      <div className="flex flex-wrap gap-2">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            onClick={() => setView(item.id)}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
              activeNav === item.id ? 'bg-accent text-white border-accent' : 'bg-surface-2 text-fg-muted border-edge hover:text-fg'
            }`}
          >
            <item.icon size={15} /> {item.label}
          </button>
        ))}
      </div>

      {view === 'home' && (
        <AcademyHome
          userId={userId}
          companyId={companyId}
          onNavigateMetodo={() => setView('metodo')}
          onNavigatePilares={() => setView('pilares')}
          onNavigateTrilhas={() => setView('trilhas')}
          onNavigateBiblioteca={() => setView('biblioteca')}
          onNavigateCentral={() => setView('central')}
        />
      )}
      {view === 'metodo' && <MetodoIBPage />}
      {view === 'pilares' && <PilaresIndexPage onSelectPilar={goToPilar} />}
      {view === 'pilar' && selectedPilarKey && (
        <PilarPage pilarKey={selectedPilarKey} userId={userId} companyId={companyId} onBack={() => setView('pilares')} />
      )}
      {view === 'trilhas' && <TrilhasIndexPage userId={userId} onSelectTrack={goToTrack} />}
      {view === 'track' && selectedTrackId && (
        <TrackDetailPage
          trackId={selectedTrackId}
          userId={userId}
          userEmail={userEmail}
          userName={userName}
          companyId={companyId}
          onBack={() => setView('trilhas')}
          onSelectCourse={goToCourse}
        />
      )}
      {view === 'course' && selectedCourseId && selectedTrackId && (
        <CoursePlayer
          courseId={selectedCourseId}
          trackId={selectedTrackId}
          userId={userId}
          userEmail={userEmail}
          companyId={companyId}
          onBack={() => setView('track')}
        />
      )}
      {view === 'biblioteca' && <BibliotecaPage />}
      {view === 'central' && <CentralConhecimentoPage />}
      {view === 'pdi' && <PDIPage userId={userId} companyId={companyId} role={role} />}
    </Page>
  );
}
