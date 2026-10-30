// Decompor o código de uma vaga em rua, módulo e nível.
//
// O código é compacto para caber na célula do mapa (`PP-A01-N1`), mas ninguém manda
// alguém até uma vaga falando assim: o que serve no chão é "Rua A, módulo 01, nível 1".
// A etiqueta impressa e o mapa precisam da MESMA leitura — por isso a regra mora aqui,
// e não copiada nos dois. Duas cópias de um regex divergem na primeira vez que o padrão
// de endereço mudar.

export interface ParsedBinCode {
  street: string;
  module: string;
  level: number;
}

export function parseBinCode(code: string): ParsedBinCode | null {
  const match = /^.+-([A-Za-z]+)(\d+)-N(\d+)$/.exec(code.trim());
  if (!match) return null;
  return { street: match[1].toUpperCase(), module: match[2], level: Number(match[3]) };
}
