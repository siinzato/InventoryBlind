/*
  # 118 — WMS: capacidade não pode ficar abaixo do que já está guardado

  A 116 já impede ENTRAR mercadoria acima da capacidade: `wms_bin_putaway` e
  `wms_bin_transfer` conferem a ocupação antes de gravar. Mas havia o caminho inverso,
  sem guarda nenhuma: baixar a capacidade de um endereço que já está cheio.

  Um endereço com 12 caixas e capacidade reduzida para 5 passa a mentir — a ocupação
  marca 240%, o mapa pinta como lotado, e qualquer conta de espaço disponível devolve
  número negativo. Nada disso é recuperável lendo o dado depois: a inconsistência entra
  no banco e fica.

  ## Por que trigger e não validação na tela

  A capacidade é alterada por UPDATE direto na tabela (a policy de UPDATE da 116 já
  permite para owner/admin/manager), não por RPC. Checar só no formulário deixaria a
  regra fora do banco — qualquer outro caminho até a tabela a contornaria. O trigger é o
  único lugar onde a garantia vale para todos os caminhos.

  SECURITY INVOKER de propósito (o padrão): quem altera a capacidade é dono da empresa do
  endereço, e a policy de SELECT de `warehouse_bin_stock` já deixa essa pessoa ler o
  próprio saldo. Não há motivo para elevar privilégio aqui.

  Capacidade nula continua significando "sem limite declarado" e passa direto.
*/

CREATE OR REPLACE FUNCTION public.wms_guard_bin_capacity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_ocupado integer;
BEGIN
  -- Sem limite declarado: nada a conferir.
  IF NEW.capacity_boxes IS NULL THEN
    RETURN NEW;
  END IF;

  -- `UPDATE OF capacity_boxes` dispara quando a coluna está no SET, mesmo que o valor
  -- seja o mesmo. Sem esta saída, salvar o formulário sem mexer na capacidade de um
  -- endereço já lotado seria recusado.
  IF NEW.capacity_boxes IS NOT DISTINCT FROM OLD.capacity_boxes THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(sum(boxes), 0) INTO v_ocupado
  FROM warehouse_bin_stock
  WHERE bin_id = NEW.id;

  IF NEW.capacity_boxes < v_ocupado THEN
    RAISE EXCEPTION
      'Capacidade % é menor que as % caixa(s) já guardadas em %. Retire mercadoria antes de reduzir.',
      NEW.capacity_boxes, v_ocupado, NEW.code;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS warehouse_storage_bins_capacity_guard ON warehouse_storage_bins;
CREATE TRIGGER warehouse_storage_bins_capacity_guard
  BEFORE UPDATE OF capacity_boxes ON warehouse_storage_bins
  FOR EACH ROW EXECUTE FUNCTION wms_guard_bin_capacity();

-- Função de trigger não é RPC: ninguém a chama pela Data API. O PostgreSQL confere
-- EXECUTE na criação do trigger, não a cada disparo, então revogar não o quebra.
REVOKE EXECUTE ON FUNCTION public.wms_guard_bin_capacity() FROM PUBLIC, anon;

COMMENT ON FUNCTION public.wms_guard_bin_capacity() IS
  'Impede reduzir a capacidade de um endereço abaixo das caixas já guardadas nele (migration 118).';
