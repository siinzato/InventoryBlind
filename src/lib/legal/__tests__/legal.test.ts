import { describe, expect, it } from 'vitest';
import {
  LEGAL_CONFIG,
  PRIVACY_VERSION,
  TERMS_VERSION,
  contactChannel,
  legalLaunchBlockers,
  legalPendingFields,
  privacyMailto,
  type LegalConfig,
} from '../../../config/legal';
import { LEGAL_ROUTES, matchLegalRoute } from '../legalRoutes';
import { CURRENT_VERSIONS, buildAcceptanceRpcArgs, needsAcceptance, mapAcceptance } from '../legalAcceptance';

const MIGRATIONS = import.meta.glob('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const M066 =
  MIGRATIONS[Object.keys(MIGRATIONS).find(p => p.includes('066_legal_acceptances')) ?? ''] ?? '';

const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** Código sem comentários. Necessário porque os comentários que EXPLICAM estas
 *  regras citam os próprios termos proibidos ("nunca renderiza [CNPJ]", "nada de
 *  fingerprint") e casariam com as asserções. Cobre `//`, `--` e blocos. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*--.*$/gm, '');
}

// ── Rotas públicas ───────────────────────────────────────────────────────────

describe('rotas legais', () => {
  it('reconhece /privacidade e /termos', () => {
    expect(matchLegalRoute('/privacidade')).toBe('privacy');
    expect(matchLegalRoute('/termos')).toBe('terms');
  });

  it('tolera barra final e caixa alta — senão /termos/ cairia no app', () => {
    expect(matchLegalRoute('/termos/')).toBe('terms');
    expect(matchLegalRoute('/Privacidade')).toBe('privacy');
  });

  it('não captura outras rotas', () => {
    for (const path of ['/', '/dashboard', '/privacidade-x', '/termosuso']) {
      expect(matchLegalRoute(path)).toBeNull();
    }
  });

  it('são resolvidas ANTES do AuthProvider, o que as torna públicas', () => {
    // É esta ordem que garante "acessível sem login". Se um dia o
    // AuthProvider passar a envolver as páginas legais, elas deixam de ser
    // públicas e este teste falha.
    const main = SOURCES['/src/main.tsx'] ?? '';
    expect(main).not.toBe('');
    const legalIndex = main.indexOf('legalRoute === ');
    const authIndex = main.indexOf('<AuthProvider>');
    expect(legalIndex).toBeGreaterThan(-1);
    expect(authIndex).toBeGreaterThan(-1);
    expect(legalIndex).toBeLessThan(authIndex);
  });
});

// ── Links legais na interface ────────────────────────────────────────────────

describe('links legais', () => {
  it('login e cadastro apontam para as rotas reais, não para href="#"', () => {
    const authPage = SOURCES['/src/components/AuthPage.tsx'] ?? '';
    expect(authPage).not.toBe('');
    expect(authPage).toContain('LEGAL_ROUTES.terms');
    expect(authPage).toContain('LEGAL_ROUTES.privacy');
    // O aviso passivo antigo tinha dois href="#" — não podem voltar.
    expect(authPage).not.toContain('className="underline hover:text-mist-100">Termos de Uso</a>');
  });

  it('o rodapé da landing tem os dois links', () => {
    const footer = SOURCES['/src/components/landing/Footer.tsx'] ?? '';
    expect(footer).toContain('LEGAL_ROUTES.terms');
    expect(footer).toContain('LEGAL_ROUTES.privacy');
  });

  it('a área autenticada existe e não fica em "Em breve"', () => {
    const app = SOURCES['/src/App.tsx'] ?? '';
    expect(app).toContain("id: 'legal'");
    expect(app).toContain('Privacidade e Legal');
    expect(app).toContain('<PrivacyLegalPage />');
  });
});

// ── Cadastro bloqueado sem aceite ────────────────────────────────────────────

describe('aceite no cadastro', () => {
  const authPage = SOURCES['/src/components/AuthPage.tsx'] ?? '';

  it('o checkbox nunca começa marcado', () => {
    expect(authPage).toContain('useState(false)');
    expect(authPage).toContain('const [acceptedTerms, setAcceptedTerms] = useState(false);');
  });

  it('a validação bloqueia o cadastro sem aceite', () => {
    // `validate()` devolve erro, e handleSignup retorna quando há erro.
    expect(authPage).toContain('if (!acceptedTerms) e.terms =');
    expect(authPage).toContain('if (Object.keys(errs).length) return;');
  });

  it('mostra erro acessível quando falta o aceite', () => {
    expect(authPage).toContain("aria-describedby={errors.terms ? 'signup-terms-error' : undefined}");
    expect(authPage).toContain('aria-invalid={Boolean(errors.terms)}');
  });
});

// ── Necessidade de aceite ────────────────────────────────────────────────────

describe('needsAcceptance', () => {
  const current = { termsVersion: '1.0.0', privacyVersion: '1.0.0' };

  it('usuário existente sem aceite é solicitado', () => {
    expect(needsAcceptance(null, current)).toBe(true);
  });

  it('quem aceitou as versões vigentes não é incomodado', () => {
    const latest = mapAcceptance({
      id: 'a1',
      user_id: 'u1',
      company_id: 'c1',
      terms_version: '1.0.0',
      privacy_version: '1.0.0',
      accepted_at: '2026-08-20T10:00:00Z',
    });
    expect(needsAcceptance(latest, current)).toBe(false);
  });

  it('versão nova de qualquer um dos dois documentos volta a pedir', () => {
    const base = {
      id: 'a1',
      user_id: 'u1',
      company_id: null,
      accepted_at: '2026-08-20T10:00:00Z',
    };
    expect(
      needsAcceptance(mapAcceptance({ ...base, terms_version: '0.9.0', privacy_version: '1.0.0' }), current)
    ).toBe(true);
    expect(
      needsAcceptance(mapAcceptance({ ...base, terms_version: '1.0.0', privacy_version: '0.9.0' }), current)
    ).toBe(true);
  });

  it('aceite sem empresa é válido — no cadastro novo a empresa ainda não existe', () => {
    const latest = mapAcceptance({
      id: 'a1',
      user_id: 'u1',
      company_id: null,
      terms_version: '1.0.0',
      privacy_version: '1.0.0',
      accepted_at: '2026-08-20T10:00:00Z',
    });
    expect(latest.companyId).toBeNull();
    expect(needsAcceptance(latest, current)).toBe(false);
  });
});

describe('buildAcceptanceRpcArgs', () => {
  it('envia só as duas versões — nunca usuário, empresa ou data', () => {
    const args = buildAcceptanceRpcArgs();
    expect(Object.keys(args).sort()).toEqual(['p_privacy_version', 'p_terms_version']);
    for (const forbidden of ['p_user_id', 'p_company_id', 'p_accepted_at', 'p_ip']) {
      expect((args as Record<string, unknown>)[forbidden]).toBeUndefined();
    }
  });

  it('as versões enviadas são as que a configuração publica', () => {
    expect(buildAcceptanceRpcArgs()).toEqual({
      p_terms_version: TERMS_VERSION.version,
      p_privacy_version: PRIVACY_VERSION.version,
    });
    expect(CURRENT_VERSIONS.termsVersion).toBe(TERMS_VERSION.version);
  });

  it('a versão publicada existe na lista que o banco reconhece', () => {
    // Se divergirem, a RPC recusa o aceite e ninguém entra no sistema.
    expect(M066).toContain(`('terms',   '${TERMS_VERSION.version}'`);
    expect(M066).toContain(`('privacy', '${PRIVACY_VERSION.version}'`);
  });
});

// ── Migration 066 ────────────────────────────────────────────────────────────

describe('migration 066', () => {
  it('data vem do banco, não do navegador', () => {
    expect(M066).toContain('accepted_at     timestamptz NOT NULL DEFAULT now()');
    // E a RPC não aceita data por parâmetro.
    expect(M066).toContain('legal_record_acceptance(\n  p_terms_version   text,\n  p_privacy_version text\n)');
  });

  it('não coleta IP, localização nem fingerprint', () => {
    const ddl = stripComments(M066);
    for (const forbidden of ['ip_address', 'user_agent', 'fingerprint', 'latitude', 'geo']) {
      expect(ddl).not.toContain(forbidden);
    }
  });

  it('usuário só vê os próprios aceites', () => {
    expect(M066).toContain('CREATE POLICY "legal_acceptances_select_own" ON legal_acceptances FOR SELECT');
    expect(M066).toContain('USING (user_id = auth.uid())');
  });

  it('administrador só vê os da própria empresa, e nunca aceite órfão', () => {
    expect(M066).toContain('company_id IS NOT NULL');
    expect(M066).toContain("company_id::text = get_my_company_id()");
    expect(M066).toContain("get_my_role() IN ('owner','admin')");
  });

  it('não existe policy de UPDATE, DELETE nem INSERT em legal_acceptances', () => {
    // Sem policy, `authenticated` não altera nem apaga um aceite. INSERT passa
    // só pela RPC, que valida a versão apresentada.
    const acceptancePolicies = M066.match(/CREATE POLICY[^;]*ON legal_acceptances[^;]*;/g) ?? [];
    expect(acceptancePolicies.length).toBeGreaterThan(0);
    for (const policy of acceptancePolicies) {
      expect(policy).toContain('FOR SELECT');
    }
  });

  it('a RPC valida a versão contra a lista do banco', () => {
    expect(M066).toContain('Versão dos Termos de Uso desconhecida');
    expect(M066).toContain('Versão da Política de Privacidade desconhecida');
  });

  it('a RPC resolve a empresa no servidor, sem receber do cliente', () => {
    expect(M066).toContain('SELECT company_id INTO v_company_id FROM profiles WHERE id = v_user_id;');
  });

  it('é idempotente — repetir a tentativa não duplica o aceite', () => {
    // É o que permite retomar quando a autenticação conclui mas o registro falha.
    expect(M066).toContain('IF v_existing IS NOT NULL THEN');
    expect(M066).toContain('RETURN v_existing;');
  });

  it('exige autenticação e é revogada de PUBLIC e anon', () => {
    expect(M066).toContain('IF v_user_id IS NULL THEN');
    expect(M066).toContain('REVOKE EXECUTE ON FUNCTION public.legal_record_acceptance(text, text) FROM PUBLIC;');
    expect(M066).toContain('REVOKE EXECUTE ON FUNCTION public.legal_record_acceptance(text, text) FROM anon;');
  });
});

// ── Falha no registro permite nova tentativa ─────────────────────────────────

describe('resiliência do aceite', () => {
  const gate = SOURCES['/src/components/legal/LegalAcceptanceGate.tsx'] ?? '';

  it('erro ao registrar mostra mensagem e mantém o botão disponível', () => {
    expect(gate).toContain('Não foi possível registrar seu aceite');
    // `saving` volta a false no finally, então o botão reabilita.
    expect(gate).toContain('finally {');
    expect(gate).toContain('setSaving(false);');
  });

  it('falha ao VERIFICAR libera o sistema em vez de prender numa tela sem saída', () => {
    expect(gate).toContain("if (result.status === 'unavailable')");
    expect(gate).toContain("setState('released');");
  });
});

// ── Configuração legal ───────────────────────────────────────────────────────

describe('configuração legal', () => {
  it('nem a configuração nem as páginas contêm placeholder ou dado inventado', () => {
    const files = [
      '/src/config/legal.ts',
      '/src/components/legal/legalUi.tsx',
      '/src/components/legal/PrivacyPolicy.tsx',
      '/src/components/legal/TermsOfUse.tsx',
    ];
    for (const path of files) {
      const code = stripComments(SOURCES[path] ?? '');
      expect(code, `${path} deveria existir`).not.toBe('');
      for (const forbidden of ['[CNPJ]', '[EMPRESA]', 'XX.XXX.XXX', 'example.com', 'lorem ipsum']) {
        expect(code, `${path} não deveria conter ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('campos jurídicos ausentes ficam null, não string vazia', () => {
    // String vazia renderizaria uma linha em branco na página pública.
    for (const field of ['legalEntityName', 'cnpj', 'address', 'jurisdiction'] as const) {
      const value = LEGAL_CONFIG[field];
      expect(value === null || (typeof value === 'string' && value.length > 0)).toBe(true);
    }
  });

  it('reporta as pendências em vez de escondê-las', () => {
    expect(legalPendingFields()).toContain('cnpj');
    expect(legalPendingFields()).toContain('legalEntityName');
  });

  it('a ausência de canal de contato é bloqueio de lançamento', () => {
    expect(legalLaunchBlockers()).toHaveLength(1);
    expect(legalLaunchBlockers()[0]).toContain('canal de contato');
  });

  it('sem canal configurado, não inventa mailto', () => {
    expect(contactChannel()).toBeNull();
    expect(privacyMailto('Assunto')).toBeNull();
  });

  it('com canal configurado, o mailto leva assunto útil', () => {
    const withEmail: LegalConfig = { ...LEGAL_CONFIG, privacyEmail: 'privacidade@dominio.com.br' };
    expect(legalLaunchBlockers(withEmail)).toHaveLength(0);
    expect(privacyMailto('Acesso aos meus dados', withEmail)).toBe(
      'mailto:privacidade@dominio.com.br?subject=Acesso%20aos%20meus%20dados'
    );
  });

  it('as rotas legais são as duas pedidas', () => {
    expect(LEGAL_ROUTES).toEqual({ privacy: '/privacidade', terms: '/termos' });
  });
});
