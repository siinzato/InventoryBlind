// Fonte ÚNICA dos atalhos do usuário para as duas superfícies que os mostram: a
// faixa "Acesso rápido" do dashboard e a seção da sidebar.
//
// Por que um estado só, e não um por tela: com duas listas carregadas em paralelo,
// adicionar um favorito no dashboard deixaria a sidebar exibindo a lista antiga até
// alguém recarregar a página. O bug nao apareceria no desenvolvimento, onde se recarrega
// a toda hora, e apareceria para quem usa o app o dia inteiro sem recarregar.
//
// Mora em `lib/shortcuts` junto do serviço que ele consome, e não em `hooks/`, porque
// o projeto agrupa por domínio.

import { useCallback, useEffect, useState } from 'react';
import { listShortcuts, type UserShortcut } from './shortcutService';

export interface EstadoDosAtalhos {
  atalhos: UserShortcut[];
  carregando: boolean;
  /** Relê do banco. Chamado depois de adicionar, remover ou reordenar. */
  recarregar: () => void;
}

export function useShortcuts(companyId: string, userId: string): EstadoDosAtalhos {
  const [atalhos, setAtalhos] = useState<UserShortcut[]>([]);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    if (!companyId || !userId) {
      setAtalhos([]);
      setCarregando(false);
      return;
    }
    let vivo = true;
    setCarregando(true);
    listShortcuts(companyId, userId)
      .then(linhas => {
        if (vivo) setAtalhos(linhas);
      })
      .catch((erro: unknown) => {
        // Falhar aqui NÃO pode derrubar a navegação: o menu principal continua
        // inteiro, só a seção de favoritos fica vazia. Atalho é conveniência.
        console.error('Erro ao carregar atalhos:', erro);
        if (vivo) setAtalhos([]);
      })
      .finally(() => {
        if (vivo) setCarregando(false);
      });
    return () => {
      vivo = false;
    };
  }, [companyId, userId]);

  useEffect(() => {
    const cancelar = carregar();
    return cancelar;
  }, [carregar]);

  return { atalhos, carregando, recarregar: carregar };
}
