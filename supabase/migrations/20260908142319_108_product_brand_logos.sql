/*
# Logo da marca — product_brands.logo_path

## Summary
O logo da marca passa a ser configurável no Gerenciamento de Marcas (Produtos → Linhas e
Marcas), que já é company-scoped. Uma coluna aditiva, nada além disso no schema de domínio.

1. Changes
- product_brands.logo_path (text, NULL) — CAMINHO no Storage, nunca URL assinada (a URL
  expira; persistir uma deixaria o banco com dado inválido). Mesmo padrão de
  companies.logo_path (migration 101) e warehouse_layouts.background_image_path (032).
- product_lines NÃO recebe logo: uma linha usa o logo da marca-mãe (brand_id), sem duplicar.

2. Storage
- Nenhum bucket novo: o bucket privado `brand-logos` criado na migration 107 já é
  apropriado e já tem as policies certas — SELECT para membro do workspace ativo,
  escrita só para owner/admin, tudo comparando a PRIMEIRA PASTA do caminho com
  get_my_company_id(). O caminho da marca (`<company_id>/brands/<brand_id>/<arquivo>`)
  mantém o company_id como primeira pasta, então continua coberto pelas mesmas policies.

3. Security
- Sem mudança de RLS, policy, grant ou RPC. A coluna herda as policies de product_brands
  (migration 075), que já restringem tudo a company_id = get_my_company_id().
*/

ALTER TABLE product_brands ADD COLUMN IF NOT EXISTS logo_path text;
