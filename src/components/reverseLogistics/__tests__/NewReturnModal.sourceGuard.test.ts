// Guarda estático do fluxo "Nova Devolução → NF-e de devolução": sem um harness
// de render de componente no projeto (nenhuma dependência de testing-library
// instalada, e CLAUDE.md pede para não instalar dependências), este teste lê o
// código-fonte do componente realmente renderizado (import.meta.glob '?raw',
// mesmo padrão dos migrationGuards.test.ts) e afirma sobre ele estaticamente.
//
// Bug corrigido: a tela pedia para colar o XML inteiro (textarea + "Processar
// XML"), em vez de reaproveitar a consulta por chave de acesso que já existe
// no InventoryBlind (fetchNfeXmlByKey/nfeProviderFetch.ts, mesma Edge Function
// nfe-fetch-by-key usada pela Conferência por NF-e). Antes da correção, este
// teste falha porque o componente ainda continha os textos/estrutura antigos.

import { describe, expect, it } from 'vitest';

const FILES = import.meta.glob('/src/components/reverseLogistics/NewReturnModal.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const SOURCE = Object.values(FILES)[0] ?? '';

describe('NewReturnModal — fluxo "NF-e de devolução" usa a consulta por chave existente', () => {
  it('o arquivo foi lido com sucesso', () => {
    expect(SOURCE.length).toBeGreaterThan(0);
  });

  it('não existe mais textarea nem botão "Processar XML" nem pedido para colar XML', () => {
    expect(SOURCE).not.toMatch(/<Textarea[^>]*value=\{xmlContent\}/);
    expect(SOURCE).not.toContain('Processar XML');
    expect(SOURCE).not.toContain('Cole o XML completo');
    expect(SOURCE).not.toContain('Cole aqui o conteúdo XML');
    expect(SOURCE).not.toContain('xmlContent');
    expect(SOURCE).not.toContain('handleReadXml');
  });

  it('existe um único campo de chave de acesso e o botão "Consultar e preencher"', () => {
    expect(SOURCE).toContain('nfeAccessKey');
    expect(SOURCE).toContain('Consultar e preencher');
    expect(SOURCE).toContain('Chave de acesso (44 dígitos)');
  });

  it('reaproveita a função de consulta por chave já existente (nfeProviderFetch), sem duplicar', () => {
    expect(SOURCE).toContain("import { fetchNfeXmlByKey, isValidNfeAccessKey } from '../../lib/nfe/nfeProviderFetch'");
    expect(SOURCE).toContain('fetchNfeXmlByKey(');
  });

  it('valida a chave (44 dígitos) antes de consultar, com a mensagem pedida', () => {
    expect(SOURCE).toContain('Informe uma chave de acesso válida com 44 dígitos.');
    expect(SOURCE).toContain('isValidNfeAccessKey(key)');
  });

  it('impede chamada em duplicidade enquanto a consulta está em andamento', () => {
    expect(SOURCE).toMatch(/if \(xmlLookupBusy\) return;/);
  });

  it('bloqueia quando nenhum CNPJ do workspace corresponde à NF-e — nunca por nome', () => {
    expect(SOURCE).toContain('Esta NF-e não pertence às empresas do workspace.');
    expect(SOURCE).toMatch(/!fiscalEntity \|\| counterparty\.role === 'unknown'/);
  });

  it('usa as mensagens de erro objetivas pedidas, nunca erro bruto do backend', () => {
    expect(SOURCE).toContain('NF-e não localizada.');
    expect(SOURCE).toContain('A chave informada é inválida.');
    expect(SOURCE).toContain('Não foi possível consultar a NF-e. Tente novamente.');
  });

  it('mantém a ação de limpar e o resumo com lista de itens (múltiplos produtos)', () => {
    expect(SOURCE).toContain('onClick={clearXml}');
    expect(SOURCE).toContain('xmlItems.map(');
  });

  it('resolve o canal de origem por evidência da NF-e (idCadIntTran), reaproveitando o resolvedor puro — nunca por nome/produto/texto livre', () => {
    expect(SOURCE).toContain("from '../../lib/reverseLogistics/originChannelResolver'");
    expect(SOURCE).toContain('resolveOriginChannel(');
    expect(SOURCE).toContain('describeOriginChannel(');
    expect(SOURCE).toContain('Canal não identificado');
    expect(SOURCE).not.toMatch(/03\.?007\.?331/); // nenhum CNPJ de marketplace hardcoded
  });

  it('o campo de canal de origem continua editável mesmo depois de resolvido (select sempre presente, nunca travado)', () => {
    expect(SOURCE).toContain('setSelectedChannelConnectionId(e.target.value || null)');
  });

  it('oferece memorizar o mapeamento confirmado, sem sobrescrever um external_account_id já existente', () => {
    expect(SOURCE).toContain('Usar esta origem para futuras devoluções deste intermediador.');
    expect(SOURCE).toMatch(/!effectiveChannel\.connection\.externalAccountId/);
  });

  it('não preenche mais "Motivo declarado" a partir de informação complementar genérica da NF-e (infCpl/additionalInfo)', () => {
    expect(SOURCE).not.toContain('reasonSuggestedByXml');
    expect(SOURCE).not.toContain('Sugestão do XML');
    expect(SOURCE).not.toMatch(/setReason\(parsed\.additionalInfo\)/);
  });

  it('exibe referência externa (xPed) só como auditoria, nunca cria pedido interno', () => {
    expect(SOURCE).toContain('Referência externa');
    expect(SOURCE).not.toMatch(/CREATE TABLE|orders\.insert|sales_orders/i);
  });
});
