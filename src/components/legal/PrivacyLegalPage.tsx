import { useEffect, useState } from 'react';
import { ExternalLink, FileText, ShieldCheck } from 'lucide-react';
import { Page, PageHeader, Panel, PanelSection } from '../ui';
import {
  LEGAL_CONFIG,
  PRIVACY_VERSION,
  TERMS_VERSION,
  contactChannel,
  formatEffectiveDate,
  legalLaunchBlockers,
  privacyMailto,
} from '../../config/legal';
import { LEGAL_ROUTES } from '../../lib/legal/legalRoutes';
import { formatAcceptedAt, type LegalAcceptance } from '../../lib/legal/legalAcceptance';
import { loadAcceptanceState } from '../../lib/legal/legalService';

/** Área autenticada "Privacidade e Legal": onde estão os documentos, o que o
 *  usuário aceitou e como pedir acesso, correção, exportação ou exclusão. */
export function PrivacyLegalPage() {
  const [acceptance, setAcceptance] = useState<LegalAcceptance | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    void loadAcceptanceState().then(result => {
      if (result.status === 'unavailable') {
        setUnavailable(true);
        return;
      }
      setAcceptance(result.latest);
    });
  }, []);

  const email = contactChannel();
  const blockers = legalLaunchBlockers();

  return (
    <Page>
      <PageHeader
        eyebrow="Minha Conta"
        title="Privacidade e Legal"
        description="Documentos em vigor, seu aceite e como exercer seus direitos sobre dados pessoais."
      />

      <Panel>
        <PanelSection>
          <h2 className="text-sm font-semibold text-fg">Documentos em vigor</h2>
          <div className="mt-3 space-y-2">
            <DocumentLink
              href={LEGAL_ROUTES.privacy}
              icon={<ShieldCheck size={16} />}
              title="Política de Privacidade"
              detail={`Versão ${PRIVACY_VERSION.version} · desde ${formatEffectiveDate(PRIVACY_VERSION.effectiveDate)}`}
            />
            <DocumentLink
              href={LEGAL_ROUTES.terms}
              icon={<FileText size={16} />}
              title="Termos de Uso"
              detail={`Versão ${TERMS_VERSION.version} · desde ${formatEffectiveDate(TERMS_VERSION.effectiveDate)}`}
            />
          </div>
          <p className="mt-3 text-xs text-fg-subtle">
            Estes textos são preliminares e ainda passarão por revisão jurídica.
          </p>
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection>
          <h2 className="text-sm font-semibold text-fg">Seu aceite</h2>
          {unavailable ? (
            <p className="mt-2 text-sm text-fg-muted">
              Não foi possível consultar seu aceite agora. Tente novamente mais tarde.
            </p>
          ) : acceptance == null ? (
            <p className="mt-2 text-sm text-fg-muted">
              Nenhum aceite registrado para a sua conta ainda.
            </p>
          ) : (
            <dl className="mt-2 space-y-1 text-sm text-fg-muted">
              <div>
                <dt className="inline font-medium text-fg">Aceito em: </dt>
                <dd className="inline">{formatAcceptedAt(acceptance.acceptedAt)}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-fg">Termos de Uso: </dt>
                <dd className="inline">versão {acceptance.termsVersion}</dd>
              </div>
              <div>
                <dt className="inline font-medium text-fg">Política de Privacidade: </dt>
                <dd className="inline">versão {acceptance.privacyVersion}</dd>
              </div>
            </dl>
          )}
        </PanelSection>
      </Panel>

      <Panel>
        <PanelSection>
          <h2 className="text-sm font-semibold text-fg">Seus direitos sobre dados pessoais</h2>
          <p className="mt-2 text-sm text-fg-muted">
            Você pode solicitar confirmação de tratamento, acesso, correção, portabilidade,
            anonimização ou eliminação dos seus dados pessoais, além de informação sobre
            compartilhamentos. Vamos confirmar sua identidade antes de atender.
          </p>
          <p className="mt-2 text-sm text-fg-muted">
            Parte dos dados da operação é controlada pela empresa onde você trabalha. Nesses casos, o
            pedido pode precisar ser encaminhado a ela — se isso acontecer, avisamos você.
          </p>

          {email == null ? (
            <p className="mt-3 rounded-sheet border border-edge bg-surface-3 p-3 text-sm text-fg-muted">
              O canal de contato para privacidade ainda não foi publicado. Enquanto isso, use o canal
              de atendimento pelo qual sua empresa contratou o {LEGAL_CONFIG.productName}.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              <RequestLink
                subject={`[${LEGAL_CONFIG.productName}] Acesso aos meus dados pessoais`}
                label="Solicitar acesso aos meus dados"
              />
              <RequestLink
                subject={`[${LEGAL_CONFIG.productName}] Correção de dados pessoais`}
                label="Solicitar correção"
              />
              <RequestLink
                subject={`[${LEGAL_CONFIG.productName}] Exportação dos meus dados`}
                label="Solicitar exportação"
              />
              <RequestLink
                subject={`[${LEGAL_CONFIG.productName}] Exclusão de dados pessoais`}
                label="Solicitar exclusão"
              />
            </div>
          )}

          {blockers.length > 0 && (
            <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
              Configuração pendente: {blockers.join(' ')}
            </p>
          )}
        </PanelSection>
      </Panel>
    </Page>
  );
}

function DocumentLink({
  href,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex min-h-[44px] items-center gap-3 rounded-control border border-edge bg-surface-3 px-3 py-2 transition-colors hover:bg-edge"
    >
      <span className="text-fg-subtle">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="block text-xs text-fg-subtle">{detail}</span>
      </span>
      <ExternalLink size={14} className="shrink-0 text-fg-subtle" />
    </a>
  );
}

/** `mailto:` de verdade, com assunto útil. Sem formulário que só finge enviar —
 *  se não houver e-mail configurado, este bloco nem é renderizado. */
function RequestLink({ subject, label }: { subject: string; label: string }) {
  const href = privacyMailto(subject);
  if (href == null) return null;
  return (
    <a
      href={href}
      className="flex min-h-[44px] items-center rounded-control border border-edge px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-surface-3"
    >
      {label}
    </a>
  );
}
