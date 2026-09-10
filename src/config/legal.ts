// ─────────────────────────────────────────────────────────────────────────────
// CONFIGURAÇÃO LEGAL CENTRALIZADA
//
// Único lugar do código com dados jurídicos e institucionais. Nenhum componente
// deve escrever razão social, CNPJ, endereço, e-mail ou foro direto no JSX.
//
// ⚠️ CAMPOS `null` SÃO DADOS QUE AINDA NÃO EXISTEM, NÃO ERROS.
// Nada aqui foi inventado. Ao investigar o projeto (busca por CNPJ, razão
// social, e-mail de contato, termos e política) não se encontrou NENHUM dado
// jurídico da empresa que fornece o InventoryBlind — os CNPJ presentes no
// código são de fornecedores, extraídos do XML de NF-e, e não têm relação com
// isto. Preencher com placeholder ou chute apareceria como texto legal falso
// numa página pública, o que é pior do que a ausência.
//
// A interface OMITE a linha quando o valor é `null` (ver LEGAL_PENDING_FIELDS e
// os componentes em src/components/legal/). Nunca renderiza "[CNPJ]".
//
// ⚠️ ESTES TEXTOS NÃO PASSARAM POR REVISÃO JURÍDICA.
// São uma base técnica e uma redação preliminar, escritas a partir do que o
// sistema de fato faz. Precisam de revisão de advogado antes de publicação.
// ─────────────────────────────────────────────────────────────────────────────

export interface LegalConfig {
  /** Nome público do produto, como aparece na interface. */
  productName: string;
  /** Razão social da pessoa jurídica que fornece o serviço. */
  legalEntityName: string | null;
  cnpj: string | null;
  /** Endereço completo, em uma linha. */
  address: string | null;
  /** Canal para exercício de direitos do titular (LGPD, art. 18). */
  privacyEmail: string | null;
  supportEmail: string | null;
  /** URL pública do sistema, sem barra final. */
  publicUrl: string | null;
  /** Comarca/foro eleito. Só preencher se estiver juridicamente confirmado. */
  jurisdiction: string | null;
}

export interface DocumentVersion {
  /** Versão do documento. Registrada junto do aceite — mudar aqui passa a exigir novo aceite. */
  version: string;
  /** Data de vigência, ISO (YYYY-MM-DD). */
  effectiveDate: string;
}

export const LEGAL_CONFIG: LegalConfig = {
  productName: 'InventoryBlind',

  // ── A PREENCHER (ver o aviso no topo) ──────────────────────────────────────
  legalEntityName: null,
  cnpj: null,
  address: null,
  privacyEmail: null,
  supportEmail: null,
  publicUrl: null,
  jurisdiction: null,
};

/** Versão dos Termos de Uso. Ao alterar, todo usuário volta a ver o aceite. */
export const TERMS_VERSION: DocumentVersion = {
  version: '1.0.0-preliminar',
  effectiveDate: '2026-08-20',
};

/** Versão da Política de Privacidade. Mesma regra de versionamento. */
export const PRIVACY_VERSION: DocumentVersion = {
  version: '1.0.0-preliminar',
  effectiveDate: '2026-08-20',
};

// ── Pendências e bloqueios ───────────────────────────────────────────────────

/** Campos sem os quais os documentos ficam incompletos, mas que não impedem o
 *  produto de funcionar. A interface simplesmente omite a linha. */
export const LEGAL_OPTIONAL_FIELDS = [
  'legalEntityName',
  'cnpj',
  'address',
  'publicUrl',
  'jurisdiction',
] as const satisfies readonly (keyof LegalConfig)[];

/**
 * Bloqueio de lançamento: um canal de privacidade é o mínimo para publicar uma
 * política, porque sem ele o titular não tem como exercer nenhum direito. Se
 * esta lista não estiver vazia, os documentos NÃO estão prontos para produção —
 * e a própria página avisa isso, em vez de fingir um canal que não existe.
 */
export function legalLaunchBlockers(config: LegalConfig = LEGAL_CONFIG): string[] {
  const blockers: string[] = [];
  if (config.privacyEmail == null && config.supportEmail == null) {
    blockers.push(
      'Nenhum canal de contato (privacyEmail ou supportEmail) configurado — o titular não tem como exercer direitos.'
    );
  }
  return blockers;
}

/** Campos opcionais ausentes, para o relatório interno e a área autenticada. */
export function legalPendingFields(config: LegalConfig = LEGAL_CONFIG): string[] {
  return LEGAL_OPTIONAL_FIELDS.filter(field => config[field] == null);
}

/** O canal a usar de fato: privacidade quando existe, suporte como reserva.
 *  `null` quando nenhum foi configurado — e nesse caso a UI não inventa link. */
export function contactChannel(config: LegalConfig = LEGAL_CONFIG): string | null {
  return config.privacyEmail ?? config.supportEmail ?? null;
}

/** `mailto:` com assunto útil, ou `null` quando não há canal.
 *  Sem formulário que só simula envio: ou o link é real, ou não existe. */
export function privacyMailto(subject: string, config: LegalConfig = LEGAL_CONFIG): string | null {
  const email = contactChannel(config);
  if (email == null) return null;
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}

export function formatEffectiveDate(date: string): string {
  // `T00:00:00` evita o deslocamento de um dia que `new Date('YYYY-MM-DD')`
  // causa por ser interpretado como UTC.
  return new Date(`${date}T00:00:00`).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
