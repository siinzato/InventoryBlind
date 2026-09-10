import { LEGAL_CONFIG, TERMS_VERSION } from '../../config/legal';
import { ContactBlock, LegalDocument, List, Section } from './legalUi';

const P = LEGAL_CONFIG.productName;

/**
 * Termos de Uso — texto preliminar. Descreve apenas o que o sistema já faz.
 * Não menciona API pública, webhooks ou SLA, que não existem como produto
 * disponível nesta etapa.
 *
 * A cláusula de foro só aparece se LEGAL_CONFIG.jurisdiction estiver preenchido,
 * porque eleger foro sem informação jurídica confirmada seria inventar.
 */
export function TermsOfUse({ backHref }: { backHref?: string }) {
  return (
    <LegalDocument title="Termos de Uso" version={TERMS_VERSION} backHref={backHref}>
      <Section title="1. Aceitação">
        <p>
          Estes Termos regulam o uso do {P}. Ao criar uma conta ou usar o sistema, você declara ter
          lido e aceito estes Termos e ter tido acesso à Política de Privacidade. Se você acessa em
          nome de uma empresa, declara ter autorização para fazê-lo.
        </p>
        <p>
          Se você não concorda com estes Termos, não use o sistema.
        </p>
      </Section>

      <Section title="2. Contas e elegibilidade">
        <p>
          É necessário ter capacidade civil e fornecer informações verdadeiras no cadastro. Cada
          conta é pessoal e vinculada a um endereço de e-mail. Contas são criadas dentro de uma
          empresa, e o acesso de cada pessoa é definido pelo papel atribuído a ela: proprietário,
          administrador, gestor, líder, contador ou visualizador.
        </p>
      </Section>

      <Section title="3. Credenciais">
        <p>
          Você é responsável por manter sua senha em sigilo e por tudo que for feito com suas
          credenciais. Não compartilhe acessos. Se suspeitar de uso indevido, troque a senha e avise
          o responsável pela conta da sua empresa imediatamente.
        </p>
      </Section>

      <Section title="4. O que o serviço faz">
        <p>
          O {P} oferece funcionalidades de gestão de inventário e estoque, entre elas: contagem
          física digital com contagem cega e recontagens, conferência cega de notas fiscais a partir
          de XML, importação de produtos por planilha, classificação e indicadores de estoque,
          análise de causa de divergências, registros de auditoria e integração com sistemas de
          gestão externos quando configurada pela empresa.
        </p>
        <p>
          Funcionalidades podem variar conforme o plano contratado. Recursos em desenvolvimento são
          identificados como tal na interface e não fazem parte do serviço até que sejam liberados.
        </p>
      </Section>

      <Section title="5. Responsabilidades da empresa cliente e dos usuários">
        <List
          items={[
            'Definir quem tem acesso ao sistema e com qual papel, e revisar esses acessos periodicamente.',
            'Garantir que possui base legal para inserir no sistema os dados que insere, inclusive dados de pessoas.',
            'Não inserir dados pessoais sensíveis nem dados de crianças e adolescentes, para os quais o sistema não foi projetado.',
            'Conferir os resultados antes de tomar decisões operacionais ou contábeis com base neles.',
            'Manter as credenciais de integração com sistemas externos sob sua responsabilidade.',
          ]}
        />
      </Section>

      <Section title="6. Uso aceitável">
        <p>É proibido:</p>
        <List
          items={[
            'Tentar acessar dados de outra empresa ou de outro usuário.',
            'Contornar controles de permissão, autenticação ou limites do plano.',
            'Fazer engenharia reversa, copiar ou redistribuir o sistema.',
            'Usar o sistema para atividade ilícita, ou para armazenar conteúdo ilícito.',
            'Sobrecarregar a infraestrutura de forma deliberada, incluindo automações abusivas.',
            'Inserir código malicioso ou arquivos que comprometam o serviço ou outros usuários.',
            'Usar o serviço para desenvolver produto concorrente a partir do acesso concedido.',
          ]}
        />
      </Section>

      <Section title="7. Propriedade dos dados">
        <p>
          Os dados que a empresa cliente insere no sistema — produtos, inventários, contagens,
          conferências, importações e o que deles deriva — <strong>continuam sendo dela</strong>. Não
          adquirimos propriedade sobre eles. Nós os tratamos para fornecer o serviço, conforme a
          Política de Privacidade.
        </p>
      </Section>

      <Section title={`8. Propriedade intelectual do ${P}`}>
        <p>
          O software, a interface, a marca, a documentação, a estrutura do banco de dados e os
          algoritmos do {P} são de titularidade do fornecedor e protegidos por lei. Estes Termos
          concedem apenas um direito de uso, limitado, não exclusivo, não transferível e revogável,
          durante a vigência da contratação. Nada aqui transfere propriedade intelectual.
        </p>
      </Section>

      <Section title="9. Importações e qualidade dos dados">
        <p>
          O sistema processa os arquivos e valores que você envia. Ele não corrige nem valida a
          veracidade dos dados de origem: SKU errado na planilha, unidade trocada, localização
          desatualizada ou XML de nota incorreto vão produzir resultado igualmente incorreto. A
          conferência dos dados enviados é responsabilidade de quem os envia.
        </p>
        <p>
          Quando uma integração com sistema externo estiver ativa, ajustes de estoque podem ser
          enviados para esse sistema. Esses envios seguem a configuração feita pela empresa e exigem
          aprovação prevista no fluxo do sistema.
        </p>
      </Section>

      <Section title="10. Disponibilidade e alterações">
        <p>
          Trabalhamos para manter o serviço disponível, mas <strong>não garantimos operação
          ininterrupta ou livre de erros</strong>. Pode haver indisponibilidade por manutenção,
          atualização, falha de fornecedor de infraestrutura ou causas fora do nosso controle. Não há
          acordo de nível de serviço (SLA) nesta etapa; se houver, será contratado separadamente.
        </p>
        <p>
          Podemos alterar, adicionar ou descontinuar funcionalidades. Em mudanças relevantes que
          reduzam funcionalidade contratada, avisaremos com antecedência razoável pelos canais de
          contato da conta.
        </p>
      </Section>

      <Section title="11. Suspensão e encerramento">
        <p>
          Podemos suspender ou encerrar o acesso em caso de violação destes Termos, de risco à
          segurança do serviço ou de inadimplência, quando aplicável. Sempre que for razoável,
          avisaremos antes e daremos oportunidade de correção. Em situações de risco imediato à
          segurança, a suspensão pode ser imediata.
        </p>
        <p>A empresa cliente pode encerrar o uso a qualquer momento pelos canais de atendimento.</p>
      </Section>

      <Section title="12. Exportação e exclusão de dados">
        <p>
          O sistema permite exportar dados de diversas telas, em planilha ou PDF. Para solicitações
          mais amplas de exportação ou de exclusão, use o canal de contato — as condições e prazos
          seguem a Política de Privacidade e as obrigações legais de conservação.
        </p>
        <p>
          Registros de auditoria e históricos removidos por ação administrativa continuam armazenados
          por sua função de prova, conforme explicado na Política de Privacidade.
        </p>
      </Section>

      <Section title="13. Limitação de responsabilidade">
        <p>
          O {P} é uma ferramenta de apoio. As decisões operacionais, contábeis, fiscais e de negócio
          tomadas a partir das informações do sistema são de responsabilidade da empresa cliente.
        </p>
        <p>
          Na máxima extensão permitida pela lei aplicável, não respondemos por lucros cessantes,
          perda de oportunidade, danos indiretos ou danos decorrentes de dados incorretos fornecidos
          pela própria empresa, de uso em desacordo com estes Termos, ou de falhas em sistemas de
          terceiros integrados por escolha da empresa.
        </p>
        <p>
          Nada nesta cláusula afasta responsabilidades que não possam ser limitadas por lei,
          incluindo as decorrentes de dolo, e as previstas no Código de Defesa do Consumidor quando
          aplicável.
        </p>
      </Section>

      <Section title="14. Privacidade">
        <p>
          O tratamento de dados pessoais está descrito na{' '}
          <a href="/privacidade" className="font-medium text-accent underline">
            Política de Privacidade
          </a>
          , que integra estes Termos.
        </p>
      </Section>

      <Section title="15. Alterações destes Termos">
        <p>
          Podemos alterar estes Termos. A versão em vigor é sempre a publicada nesta página, com sua
          data de vigência. Em alterações relevantes, pediremos novo aceite ao entrar no sistema. O
          uso continuado após a vigência de uma nova versão significa concordância com ela.
        </p>
      </Section>

      <Section title="16. Contato">
        <ContactBlock />
      </Section>

      {LEGAL_CONFIG.jurisdiction != null && (
        <Section title="17. Lei aplicável e foro">
          <p>
            Estes Termos são regidos pelas leis da República Federativa do Brasil. Fica eleito o foro
            da comarca de {LEGAL_CONFIG.jurisdiction} para dirimir controvérsias, ressalvada a
            competência de foro definida por norma de ordem pública, inclusive a do domicílio do
            consumidor quando aplicável.
          </p>
        </Section>
      )}
    </LegalDocument>
  );
}
