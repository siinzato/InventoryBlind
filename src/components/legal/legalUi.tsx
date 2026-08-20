import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { LEGAL_CONFIG, formatEffectiveDate, type DocumentVersion } from '../../config/legal';

/** Cabeçalho + corpo de um documento legal, em HTML semântico.
 *
 *  `backHref` é um link de verdade (`<a href>`), não navegação por estado: estas
 *  páginas precisam funcionar por URL direta e após F5, e o projeto não tem
 *  router. Recarregar é aceitável aqui e elimina toda a máquina de estado. */
export function LegalDocument({
  title,
  version,
  backHref = '/',
  backLabel = 'Voltar',
  children,
}: {
  title: string;
  version: DocumentVersion;
  backHref?: string;
  backLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-surface">
      <header className="sticky top-0 z-10 border-b border-edge bg-surface pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3 sm:px-6">
          <a
            href={backHref}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-control text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg [@media(pointer:fine)]:min-h-[36px] [@media(pointer:fine)]:min-w-[36px]"
            aria-label={backLabel}
          >
            <ArrowLeft size={18} />
          </a>
          <span className="text-sm font-semibold text-fg">{LEGAL_CONFIG.productName}</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-8 sm:px-6">
        <article>
          <h1 className="text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            Versão {version.version} · Em vigor desde {formatEffectiveDate(version.effectiveDate)}
          </p>

          <PreliminaryNotice />

          <div className="mt-8 space-y-8">{children}</div>

          <Identification />
        </article>
      </main>
    </div>
  );
}

/** Aviso honesto de que o texto ainda não passou por advogado. Preferível a
 *  publicar um documento preliminar como se fosse definitivo. */
function PreliminaryNotice() {
  return (
    <aside className="mt-6 rounded-sheet border border-edge bg-surface-3 p-4">
      <p className="text-sm text-fg-muted">
        Esta é uma versão preliminar, redigida a partir do funcionamento real do sistema e ainda
        sujeita a revisão jurídica. Alterações relevantes serão publicadas com nova versão e nova
        data de vigência.
      </p>
    </aside>
  );
}

/** Identificação do fornecedor. Cada linha só aparece se o dado existir —
 *  nenhum placeholder do tipo "[CNPJ]" chega à tela. Ver src/config/legal.ts. */
function Identification() {
  const { legalEntityName, cnpj, address } = LEGAL_CONFIG;
  if (legalEntityName == null && cnpj == null && address == null) return null;
  return (
    <section className="mt-12 border-t border-edge pt-6">
      <h2 className="text-sm font-semibold text-fg">Identificação</h2>
      <dl className="mt-2 space-y-1 text-sm text-fg-muted">
        {legalEntityName && (
          <div>
            <dt className="inline font-medium text-fg">Razão social: </dt>
            <dd className="inline">{legalEntityName}</dd>
          </div>
        )}
        {cnpj && (
          <div>
            <dt className="inline font-medium text-fg">CNPJ: </dt>
            <dd className="inline">{cnpj}</dd>
          </div>
        )}
        {address && (
          <div>
            <dt className="inline font-medium text-fg">Endereço: </dt>
            <dd className="inline">{address}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-semibold text-fg">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-fg-muted">{children}</div>
    </section>
  );
}

export function List({ items }: { items: ReactNode[] }) {
  return (
    <ul className="ml-5 list-disc space-y-1.5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** Bloco de contato. Quando não há canal configurado, diz isso em vez de
 *  oferecer um `mailto:` vazio ou um formulário que só finge enviar. */
export function ContactBlock() {
  const email = LEGAL_CONFIG.privacyEmail ?? LEGAL_CONFIG.supportEmail;
  if (email == null) {
    return (
      <p className="text-sm text-fg-muted">
        O canal de contato para questões de privacidade ainda não foi publicado. Enquanto isso, use o
        canal de atendimento pelo qual você contratou o {LEGAL_CONFIG.productName}.
      </p>
    );
  }
  return (
    <p className="text-sm text-fg-muted">
      Fale com a gente em{' '}
      <a href={`mailto:${email}`} className="font-medium text-accent underline">
        {email}
      </a>
      .
    </p>
  );
}
