// Catálogo do Hub de Integrações — configuração central tipada, para não duplicar
// cards manualmente. O status REAL de uma integração (Tiny) vem de
// integrationService.ts em tempo de execução; aqui só fica o que é sempre
// estático: identidade do provedor e se ele já tem uma tela funcional.

export type IntegrationCategory = 'erp' | 'marketplace';

export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  category: IntegrationCategory;
  description: string;
  /** Caminho local em /public — nunca uma URL externa. Ausente quando nenhuma
   *  fonte oficial/confiável foi encontrada (ver relatório da tarefa); nesse
   *  caso o card mostra um placeholder neutro, nunca um logo inventado. */
  logoSrc?: string;
  /** Cor de fundo do tile do logo, só quando o branco padrão não serve — hoje
   *  só o Magalu, cujo único asset oficial encontrado é um traçado 100% branco
   *  (pensado para fundo escuro). Sempre uma cor oficial da própria marca
   *  (aqui, o theme-color de magazineluiza.com.br), nunca uma cor arbitrária. */
  logoBg?: string;
  /** Só integrações com tela própria funcionando têm isto preenchido. Hoje,
   *  apenas Tiny: o `providerKey` bate com integration_providers.key, usado para
   *  casar a conexão real do usuário com este card. */
  providerKey?: string;
}

export const INTEGRATION_CATALOG: IntegrationCatalogEntry[] = [
  // ── ERPs ─────────────────────────────────────────────────────────────────
  { id: 'tiny', name: 'Tiny ERP', category: 'erp', providerKey: 'tiny', logoSrc: '/integrations/logos/tiny.svg', description: 'Sincronize estoque, produtos e pedidos com o Tiny ERP.' },
  { id: 'bling', name: 'Bling', category: 'erp', logoSrc: '/integrations/logos/bling.svg', description: 'Integração com o ERP Bling.' },
  { id: 'sap', name: 'SAP', category: 'erp', logoSrc: '/integrations/logos/sap.svg', description: 'Integração com SAP.' },
  { id: 'totvs', name: 'TOTVS', category: 'erp', logoSrc: '/integrations/logos/totvs.svg', description: 'Integração com TOTVS.' },

  // ── Marketplaces ─────────────────────────────────────────────────────────
  { id: 'mercado-livre', name: 'Mercado Livre', category: 'marketplace', logoSrc: '/integrations/logos/mercado-livre.png', description: 'Sincronize anúncios, estoque e pedidos do Mercado Livre.' },
  { id: 'shopee', name: 'Shopee', category: 'marketplace', logoSrc: '/integrations/logos/shopee.svg', description: 'Sincronize anúncios e pedidos da Shopee.' },
  { id: 'amazon', name: 'Amazon', category: 'marketplace', logoSrc: '/integrations/logos/amazon.svg', description: 'Sincronize catálogo e pedidos da Amazon.' },
  { id: 'temu', name: 'Temu', category: 'marketplace', logoSrc: '/integrations/logos/temu.png', description: 'Sincronize anúncios e pedidos da Temu.' },
  { id: 'aliexpress', name: 'AliExpress', category: 'marketplace', logoSrc: '/integrations/logos/aliexpress.svg', description: 'Sincronize anúncios e pedidos do AliExpress.' },
  { id: 'shein', name: 'Shein', category: 'marketplace', logoSrc: '/integrations/logos/shein.png', description: 'Sincronize anúncios e pedidos da Shein.' },
  { id: 'magalu', name: 'Magalu', category: 'marketplace', logoSrc: '/integrations/logos/magalu.svg', logoBg: '#0086FF', description: 'Sincronize anúncios e pedidos do Magalu.' },
  { id: 'tiktok-shop', name: 'TikTok Shop', category: 'marketplace', logoSrc: '/integrations/logos/tiktok-shop.png', description: 'Sincronize anúncios e pedidos do TikTok Shop.' },
  { id: 'netshoes', name: 'Netshoes', category: 'marketplace', logoSrc: '/integrations/logos/netshoes.png', description: 'Sincronize anúncios e pedidos da Netshoes.' },
];
