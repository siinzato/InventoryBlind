// Documentação da Public API exibida em Configurações Avançadas > API.
//
// Só entra aqui endpoint que EXISTE de verdade em supabase/functions/public-api.
// Hoje é um só (consulta de saldo por SKU); a estrutura já está pronta para
// receber os próximos sem mexer na tela.
//
// A URL base vem da configuração real do ambiente (VITE_SUPABASE_URL) — nada
// de placeholder "SEU-PROJETO" para o cliente adivinhar.

export interface ApiEndpointParam {
  name: string;
  type: string;
  required: boolean;
  description: string;
}

export interface ApiEndpointStatus {
  code: number;
  description: string;
}

export interface ApiEndpointDoc {
  method: 'GET';
  path: string;
  summary: string;
  params: ApiEndpointParam[];
  requestExample: (baseUrl: string) => string;
  responseExample: string;
  statuses: ApiEndpointStatus[];
}

/** Raiz da Public API para esta instalação. Sem a variável de ambiente (build
 *  mal configurado) devolve null — a tela mostra o aviso em vez de um exemplo
 *  que não funcionaria. */
export function publicApiBaseUrl(): string | null {
  const raw = import.meta.env.VITE_SUPABASE_URL;
  if (!raw || typeof raw !== 'string') return null;
  return `${raw.replace(/\/+$/, '')}/functions/v1/public-api`;
}

export const AUTH_HEADER_EXAMPLE = 'Authorization: Bearer <sua_chave>';

export const PUBLIC_API_ENDPOINTS: ApiEndpointDoc[] = [
  {
    method: 'GET',
    path: '/stock',
    summary: 'Consulta o saldo e a localização de um produto pelo SKU.',
    params: [
      { name: 'sku', type: 'string', required: true, description: 'SKU exato do produto cadastrado na sua empresa.' },
    ],
    requestExample: baseUrl =>
      `curl "${baseUrl}/stock?sku=ABC123" \\\n  -H "Authorization: Bearer <sua_chave>"`,
    responseExample: `{
  "sku": "ABC123",
  "name": "Camiseta Básica P",
  "location": "A-01-03",
  "stock_quantity": 42
}`,
    statuses: [
      { code: 200, description: 'Produto encontrado.' },
      { code: 400, description: 'Parâmetro "sku" ausente.' },
      { code: 401, description: 'Chave ausente, inválida ou expirada.' },
      { code: 403, description: 'Chave revogada.' },
      { code: 404, description: 'Nenhum produto com esse SKU nesta empresa.' },
      { code: 500, description: 'Erro interno.' },
    ],
  },
];

/** Formato de erro comum a todos os endpoints. */
export const ERROR_RESPONSE_EXAMPLE = `{
  "error": "Chave de API inválida.",
  "code": "invalid_key"
}`;
