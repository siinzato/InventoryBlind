// O que a câmera lê -> o código do endereço.
//
// A etiqueta da vaga carrega uma URL (`https://host/?v=PP-A01-N1`), porque é isso que
// faz a câmera NATIVA do celular abrir o sistema direto. Mas o leitor interno recebe o
// texto cru, e precisa devolver só o código — do mesmo jeito que alguém digitaria.
//
// Essa é a razão de esta função ser pura e morar aqui, longe de câmera e de React: é a
// única parte da leitura que dá para testar sem aparelho.
//
// Nada do que sai daqui é tratado como verdade. O código segue exatamente o caminho do
// que foi digitado à mão, e quem decide se o endereço existe, está livre e comporta a
// carga continua sendo o banco, dentro das RPCs `wms_bin_*`.

import { BIN_SCAN_PARAM } from '../appRoutes';

/** Letra, número e hífen. É a forma que o gerador de endereços produz (`PP-A01-N1`),
 *  e serve de peneira contra QR de produto, nota fiscal ou adesivo de outra origem. */
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9-]{0,39}$/;

export function binCodeFromScan(raw: string): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  let candidate = text;

  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    // URL sem o parâmetro da vaga é outro QR qualquer. Cair para o texto cru aqui
    // jogaria o endereço do site inteiro dentro do campo de endereço.
    const param = url.searchParams.get(BIN_SCAN_PARAM);
    if (!param) return null;
    candidate = param;
  }

  const code = candidate.trim().toUpperCase();
  return CODE_SHAPE.test(code) ? code : null;
}
