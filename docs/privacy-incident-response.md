# Resposta a incidente de segurança com dados pessoais — InventoryBlind

Documento **interno**. Procedimento mínimo para a primeira etapa. Os papéis
abaixo estão marcados como **a definir** porque a estrutura de responsáveis
ainda não foi formalizada — preencher antes de considerar o procedimento válido.

## 0. Responsáveis

| Papel | Quem | Contato |
|---|---|---|
| Encarregado de dados (DPO, art. 41 da LGPD) | **A definir** | **A definir** |
| Responsável técnico pela contenção | **A definir** | **A definir** |
| Responsável pela comunicação externa | **A definir** | **A definir** |
| Apoio jurídico | **A definir** | **A definir** |

Enquanto não houver definição, qualquer incidente deve ser levado imediatamente
ao responsável pelo produto.

## 1. Identificar e registrar

Considere incidente qualquer evento que possa ter causado acesso não autorizado,
perda, alteração indevida, divulgação ou indisponibilidade de dados pessoais.
Exemplos concretos neste sistema:

- Falha de isolamento entre empresas: alguém enxergou dado de outra empresa.
- Credencial de usuário ou token de integração exposto ou vazado.
- Chave de serviço (`service_role`) exposta em log, repositório ou resposta.
- Escalada de privilégio: usuário executou ação restrita ao papel superior.
- Perda de dados sem backup recuperável.
- Acesso indevido à infraestrutura (Supabase, hospedagem).

**Registre imediatamente**, mesmo antes de entender a causa: data e hora da
descoberta, quem descobriu, como descobriu, o que foi observado, e quais telas,
tabelas ou empresas parecem envolvidas. Registro tardio é registro perdido.

## 2. Conter

Prioridade é parar o dano, sem destruir evidência.

1. Se houver credencial comprometida, revogue-a e gire o segredo.
2. Se houver falha de isolamento, desative o caminho afetado (feature flag,
   revogação de policy, remoção temporária da tela) em vez de tentar corrigir a
   lógica sob pressão.
3. Se houver acesso indevido em curso, encerre as sessões envolvidas.
4. **Não apague logs, tabelas ou registros** para "limpar" o problema.

## 3. Preservar evidências

Antes de corrigir, capture o estado:

- Exportação das linhas relevantes de `audit_logs` e `security_logs`.
- Logs da plataforma Supabase e do provedor de hospedagem, dentro da janela de
  retenção deles — que pode ser curta, então isto é urgente.
- Consultas usadas para confirmar o problema, com data e hora.
- Trecho de código e migration envolvidos, com o commit correspondente.

Guarde as evidências fora do sistema afetado.

## 4. Avaliar dados e titulares afetados

Determinar, com o mapa de dados (`docs/privacy-data-map.md`) em mãos:

- Quais categorias de dados foram atingidas.
- Quantas empresas e quantos usuários.
- Se houve dado sensível envolvido (o sistema não deveria conter, mas verificar).
- Se os dados eram legíveis ou estavam cifrados.
- Se há indício de exfiltração ou apenas exposição potencial.
- Qual o risco concreto para os titulares.

Documente também o que **não** foi afetado, e como se chegou a essa conclusão.

## 5. Comunicação interna

Comunicar imediatamente o encarregado e o responsável pelo produto. Manter um
único registro cronológico do incidente, com horários — versões paralelas em
conversas diferentes se perdem e depois não se sustentam.

## 6. Avaliar comunicação à ANPD e aos titulares

A LGPD (art. 48) exige comunicação à ANPD e aos titulares quando o incidente
puder acarretar **risco ou dano relevante**. A avaliação deve considerar a
natureza dos dados, a quantidade de titulares, a facilidade de identificação e a
possibilidade de dano.

Considerar as orientações e prazos vigentes da ANPD no momento do incidente —
eles mudam, então **consultar a norma atual em vez de confiar em prazo escrito
aqui**.

Se houver comunicação, ela deve conter: descrição dos dados, titulares
envolvidos, medidas técnicas de proteção adotadas, riscos, o motivo de eventual
demora na comunicação e as medidas de mitigação.

Quando o InventoryBlind for **operador** e o incidente envolver dados da operação
de uma empresa cliente, a empresa (controladora) deve ser comunicada sem demora,
porque a decisão sobre comunicar ANPD e titulares é dela.

## 7. Registrar decisões

Registrar, com justificativa: o que se concluiu sobre risco, se houve ou não
comunicação e por quê, quem decidiu, e quando. A decisão de **não** comunicar
também precisa estar registrada e fundamentada.

## 8. Revisão pós-incidente

Depois da contenção, e em prazo curto:

- Causa raiz, não sintoma.
- Por que os controles existentes não pegaram.
- Correção definitiva, com migration ou código, e teste que impeça a recorrência.
- Se o incidente foi de isolamento entre empresas, adicionar teste específico.
- Atualizar este documento e o mapa de dados com o que foi aprendido.

## Pendências deste procedimento

- [ ] Definir os responsáveis da seção 0 e publicar o contato do encarregado.
- [ ] Confirmar a janela de retenção de logs do Supabase e da hospedagem.
- [ ] Definir onde as evidências de incidente são armazenadas.
- [ ] Definir política de backup e teste de restauração — hoje não documentada.
