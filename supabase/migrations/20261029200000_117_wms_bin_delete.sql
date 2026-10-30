/*
  # 117 — WMS: permitir apagar endereço criado por engano

  A 116 nasceu sem policy de DELETE em `warehouse_storage_bins`, com a regra "endereço
  não se apaga, se bloqueia". A regra está certa para endereço COM histórico — apagar
  levaria junto a rastreabilidade do que passou por ali.

  Mas ela ignorou o caso banal e inevitável: criar endereço errado. A criação é em lote
  (um formulário gera dezenas de códigos de uma vez), então errar o padrão e produzir 60
  endereços quando se queria 2 não é exceção, é o primeiro uso. Sem DELETE, a única saída
  era bloquear os 60 — que ficariam na lista para sempre, sujando a operação.

  ## Por que não precisa de guarda no corpo da policy

  As FKs de `warehouse_bin_stock` e `warehouse_bin_movements` para `warehouse_storage_bins`
  são ON DELETE RESTRICT (116). Isso já faz o banco recusar o DELETE de qualquer endereço
  que tenha saldo ou histórico — a proteção é estrutural e não depende de ninguém lembrar
  de checar. A policy só decide QUEM pode tentar; o RESTRICT decide o que é possível.

  Resultado: endereço recém-criado e nunca usado sai; endereço que já recebeu mercadoria
  fica, e a tentativa falha com erro de integridade.
*/

DROP POLICY IF EXISTS "wms_bins_delete" ON warehouse_storage_bins;
CREATE POLICY "wms_bins_delete" ON warehouse_storage_bins FOR DELETE
  TO authenticated USING (
    company_id = get_my_company_id() AND get_my_role() = ANY(ARRAY['owner','admin','manager'])
  );

COMMENT ON POLICY "wms_bins_delete" ON warehouse_storage_bins IS
  'Permite remover endereço criado por engano. Endereço com saldo ou histórico é barrado pelas FKs ON DELETE RESTRICT (migration 117).';
