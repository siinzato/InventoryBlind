import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Short uppercase kicker above the title — the module this screen belongs to
   *  ("Inventário", "Auditoria"). Gives the page a place in the product instead
   *  of a bare heading. */
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
}

/** The masthead every authenticated screen opens with.
 *
 *  Previously a 20px `text-xl` heading with a 14px line under it — in an app
 *  where body text is already 14px, that is barely a step up, so no screen had
 *  a visual entry point. Now the title carries real weight (`.text-display`,
 *  30px, display face) and sits over a hairline that separates chrome from
 *  content, so the eye lands on the page name first and the panels below read
 *  as the body of a document rather than a wall of equal-weight boxes. */
export function PageHeader({ title, description, eyebrow, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`mb-8 border-b border-edge/70 pb-6 ${className}`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="text-overline mb-2">{eyebrow}</p>}
          <h1 className="text-display">{title}</h1>
          {description && (
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
