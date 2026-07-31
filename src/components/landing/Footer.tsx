import { Logo } from './landingUi';

interface FooterProps {
  onLogin: () => void;
  onSignup: () => void;
}

const PLATFORM_LINKS = [
  { label: 'Produto', href: '#dashboard' },
  { label: 'Como Funciona', href: '#journey' },
  { label: 'Módulos', href: '#modules' },
  { label: 'Planos', href: '#plans' },
];

export function Footer({ onLogin, onSignup }: FooterProps) {
  const scrollTo = (href: string) => document.querySelector(href)?.scrollIntoView({ behavior: 'smooth' });

  return (
    <footer className="relative border-t border-ink-700 bg-ink-950 px-6 py-14">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-start justify-between gap-10">
        <div>
          <div className="flex items-center gap-2.5 mb-4">
            <Logo size={28} />
            <span className="font-semibold text-mist-100 tracking-tight">InventoryBlind</span>
          </div>
          <p className="text-sm text-mist-400 max-w-xs">
            Inventário sem pontos cegos — conferência, contagem e inteligência em uma única plataforma.
          </p>
        </div>

        <div className="flex flex-wrap gap-16">
          <div>
            <p className="text-xs font-semibold text-mist-100 uppercase tracking-wide mb-4">Plataforma</p>
            <ul className="space-y-2.5">
              {PLATFORM_LINKS.map(l => (
                <li key={l.label}>
                  <button onClick={() => scrollTo(l.href)} className="text-sm text-mist-400 hover:text-mist-100 transition-colors">
                    {l.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-mist-100 uppercase tracking-wide mb-4">Conta</p>
            <ul className="space-y-2.5">
              <li>
                <button onClick={onLogin} className="text-sm text-mist-400 hover:text-mist-100 transition-colors">
                  Entrar
                </button>
              </li>
              <li>
                <button onClick={onSignup} className="text-sm text-mist-400 hover:text-mist-100 transition-colors">
                  Criar Conta
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto mt-12 pt-6 border-t border-ink-700 text-xs text-mist-400">
        © {new Date().getFullYear()} InventoryBlind. Todos os direitos reservados.
      </div>
    </footer>
  );
}
