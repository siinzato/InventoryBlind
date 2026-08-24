// Coordenador mínimo para popovers do cabeçalho que devem ser mutuamente
// exclusivos — abrir o sino de tarefas fecha o painel de comunicados gerais
// e vice-versa. Cada botão mantém seu próprio estado local (aberto/fechado,
// contagem de não lidas); isto só avisa "outro painel abriu" para quem
// registrar interesse — não é um Context/Provider novo, nenhum dado de
// notificação passa por aqui.

type CloseListener = { id: string; close: () => void };

const listeners = new Set<CloseListener>();

export function notifyPanelOpened(id: string): void {
  listeners.forEach(l => { if (l.id !== id) l.close(); });
}

export function registerExclusivePanel(id: string, close: () => void): () => void {
  const entry: CloseListener = { id, close };
  listeners.add(entry);
  return () => { listeners.delete(entry); };
}
