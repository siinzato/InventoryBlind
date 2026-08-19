import { useRef, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { motion, AnimatePresence, useReducedMotion, MagneticButton } from './landingMotion';
import { useGSAP, ScrollTrigger } from './landingScroll';
import { Logo } from './landingUi';

interface NavbarProps {
  onLogin: () => void;
  onSignup: () => void;
}

const LINKS = [
  { label: 'Produto', href: '#dashboard' },
  { label: 'Como Funciona', href: '#journey' },
  { label: 'Módulos', href: '#modules' },
  { label: 'Planos', href: '#plans' },
];

export function Navbar({ onLogin, onSignup }: NavbarProps) {
  const navRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();

  useGSAP(
    () => {
      const nav = navRef.current;
      if (!nav) return;
      nav.style.transition = 'background-color 0.4s ease, border-color 0.4s ease, backdrop-filter 0.4s ease';
      const st = ScrollTrigger.create({
        start: 0,
        onUpdate: self => {
          const scrolled = self.scroll() > 32;
          nav.style.backgroundColor = scrolled ? 'rgba(11,13,18,0.72)' : 'rgba(11,13,18,0)';
          nav.style.borderBottomColor = scrolled ? 'rgba(42,47,59,0.7)' : 'transparent';
          nav.style.backdropFilter = scrolled ? 'blur(16px)' : 'blur(0px)';
        },
      });
      return () => st.kill();
    },
    { scope: navRef }
  );

  const scrollTo = (href: string) => {
    setOpen(false);
    document.querySelector(href)?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <nav ref={navRef} className="safe-top fixed top-0 inset-x-0 z-50 border-b border-transparent">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <button onClick={() => scrollTo('#top')} className="flex items-center gap-2.5">
          <Logo size={28} />
          <span className="font-semibold text-mist-100 tracking-tight">InventoryBlind</span>
        </button>

        <div className="hidden lg:flex items-center gap-1">
          {LINKS.map(link => (
            <motion.button
              key={link.href}
              onClick={() => scrollTo(link.href)}
              whileHover={reduce ? undefined : { y: -2 }}
              className="relative px-4 py-2 text-sm text-mist-400 hover:text-mist-100 transition-colors"
            >
              {link.label}
            </motion.button>
          ))}
        </div>

        <div className="hidden lg:flex items-center gap-3">
          <button onClick={onLogin} className="text-sm font-medium text-mist-400 hover:text-mist-100 transition-colors px-4 py-2">
            Entrar
          </button>
          <MagneticButton onClick={onSignup} className="px-5 py-2.5 rounded-full text-sm font-semibold">
            Começar Gratuitamente
          </MagneticButton>
        </div>

        <button
          onClick={() => setOpen(v => !v)}
          className="lg:hidden text-mist-100 p-2"
          aria-expanded={open}
          aria-label="Menu"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.3 }}
            className="lg:hidden bg-ink-950/95 backdrop-blur border-b border-ink-700 overflow-hidden"
          >
            <div className="px-6 py-4 flex flex-col gap-1">
              {LINKS.map(link => (
                <button key={link.href} onClick={() => scrollTo(link.href)} className="text-left py-2.5 text-mist-400 hover:text-mist-100 transition-colors">
                  {link.label}
                </button>
              ))}
              <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-ink-700">
                <button onClick={onLogin} className="py-2.5 text-mist-400 hover:text-mist-100 transition-colors text-left">
                  Entrar
                </button>
                <MagneticButton onClick={onSignup} className="w-full justify-center py-3 rounded-xl text-sm font-semibold">
                  Começar Gratuitamente
                </MagneticButton>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}
