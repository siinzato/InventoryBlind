import { PRIVACY_VERSION, LEGAL_CONFIG } from '../../config/legal';
import { ContactBlock, LegalDocument, List, Section } from './legalUi';

const P = LEGAL_CONFIG.productName;

/**
 * Política de Privacidade — texto preliminar, escrito a partir do que o sistema
 * de fato faz. Nada aqui descreve funcionalidade inexistente, e nada promete
 * segurança ou disponibilidade absolutas.
 *
 * Auditoria que embasou a seção de armazenamento local: o projeto não tem
 * nenhum analytics, pixel de marketing ou cookie de terceiro (busca por gtag,
 * GTM, Meta, Hotjar, Mixpanel, PostHog, Segment, Clarity: nenhum resultado). Só
 * há localStorage/sessionStorage de funcionamento e a sessão do Supabase.
 */
export function PrivacyPolicy({ backHref }: { backHref?: string }) {
  return (
    <LegalDocument title="Política de Privacidade" version={PRIVACY_VERSION} backHref={backHref}>
      <Section title="1. A quem esta política se aplica">
        <p>
          O {P} é um sistema de gestão de inventário e estoque fornecido para empresas. Esta política
          explica como tratamos dados pessoais no funcionamento do sistema.
        </p>
        <p>
          Existem dois papéis distintos. A <strong>empresa cliente</strong> decide quais dados coloca
          no sistema, quem tem acesso e por quanto tempo — nessa relação, ela é a{' '}
          <strong>controladora</strong> e nós somos <strong>operador</strong>, tratando os dados
          conforme as instruções dela. Para um conjunto menor de dados, ligados à existência da
          própria conta e à segurança do serviço, decidimos nós, e aí atuamos como controladores.
        </p>
        <p>
          Se você é um usuário que acessa o {P} pela empresa onde trabalha, os pedidos sobre os dados
          da operação devem ser dirigidos primeiro a ela.
        </p>
      </Section>

      <Section title="2. Dados que tratamos">
        <List
          items={[
            <>
              <strong>Cadastro e autenticação:</strong> nome, e-mail, senha (armazenada de forma
              cifrada, nunca em texto legível), confirmação de e-mail e registros de acesso.
            </>,
            <>
              <strong>Informações profissionais:</strong> a empresa a que você pertence, seu papel no
              sistema (proprietário, administrador, gestor, líder, contador ou visualizador) e as
              permissões correspondentes.
            </>,
            <>
              <strong>Dados da empresa e da equipe:</strong> nome da empresa, membros vinculados e
              convites.
            </>,
            <>
              <strong>Dados da operação:</strong> produtos, localizações, inventários, contagens,
              conferências de notas fiscais, importações de planilhas, indicadores e histórico de
              operações. São dados da empresa cliente. Quando eles identificam quem executou uma
              ação, são também dados pessoais dos usuários.
            </>,
            <>
              <strong>Dados técnicos e de segurança:</strong> registros de auditoria com autor, ação,
              data e o registro afetado; informações do navegador ou dispositivo usadas para manter a
              sessão e investigar problemas.
            </>,
            <>
              <strong>Respostas ao diagnóstico da operação:</strong> se você optar por respondê-lo,
              as respostas ficam associadas à sua conta e servem para indicar o plano adequado.
            </>,
          ]}
        />
        <p>
          O {P} não foi projetado para receber dados pessoais sensíveis nem dados de crianças e
          adolescentes. Pedimos que a empresa cliente não insira esse tipo de informação nos campos
          da operação.
        </p>
      </Section>

      <Section title="3. Para que usamos">
        <List
          items={[
            'Criar e manter contas, autenticar acessos e aplicar as permissões definidas pela empresa.',
            'Fornecer as funcionalidades contratadas: inventários, contagens, conferências, importações, indicadores e relatórios.',
            'Manter registros de auditoria, para que a empresa saiba quem fez o quê.',
            'Proteger o serviço contra acesso indevido, uso abusivo e perda de dados.',
            'Atender solicitações de suporte.',
            'Cumprir obrigações legais e regulatórias e exercer direitos em processos.',
          ]}
        />
        <p>
          Não usamos os dados da operação da sua empresa para publicidade e não os vendemos.
        </p>
      </Section>

      <Section title="4. Bases legais">
        <p>
          Não usamos consentimento como justificativa genérica para o funcionamento do sistema — ele
          não seria uma base adequada, porque você não pode deixar de fornecer seus dados de cadastro
          e continuar usando o serviço.
        </p>
        <List
          items={[
            <>
              <strong>Execução de contrato</strong> (art. 7º, V da LGPD): fornecer o serviço
              contratado pela sua empresa, incluindo criação de conta, autenticação e as
              funcionalidades de operação.
            </>,
            <>
              <strong>Cumprimento de obrigação legal ou regulatória</strong> (art. 7º, II):
              conservação de registros exigidos por lei.
            </>,
            <>
              <strong>Legítimo interesse</strong> (art. 7º, IX): segurança do serviço, prevenção a
              fraude e abuso, registros de auditoria e melhoria do produto — sempre limitado ao
              necessário e sem prevalecer sobre seus direitos.
            </>,
            <>
              <strong>Exercício regular de direitos</strong> (art. 7º, VI): defesa em processos
              judiciais, administrativos ou arbitrais.
            </>,
            <>
              <strong>Consentimento</strong> (art. 7º, I): apenas para situações específicas e
              opcionais, sempre destacadas no momento da coleta. O diagnóstico da operação é um
              exemplo — responder é opcional.
            </>,
          ]}
        />
      </Section>

      <Section title="5. Com quem compartilhamos">
        <p>
          Não vendemos dados pessoais. Compartilhamos com fornecedores necessários para o
          funcionamento do sistema, que tratam os dados conforme nossas instruções:
        </p>
        <List
          items={[
            <>
              <strong>Supabase</strong> — banco de dados, autenticação, armazenamento de arquivos e
              funções de servidor. É onde os dados do sistema ficam hospedados.
            </>,
            <>
              <strong>Integrações que a empresa ativar</strong> — se sua empresa conectar um sistema
              de gestão externo (ERP) para sincronizar estoque, dados de produtos e saldos passam a
              ser trocados com esse sistema. Essa conexão só existe se a empresa a configurar, e o
              tratamento pelo outro sistema segue a política dele.
            </>,
            <>
              <strong>Provedor de hospedagem da aplicação</strong> — para servir a interface web.
            </>,
          ]}
        />
        <p>
          Também podemos compartilhar dados com autoridades quando houver requisição legal válida, e
          com assessores jurídicos e contábeis quando necessário.
        </p>
      </Section>

      <Section title="6. Transferência internacional">
        <p>
          Nossos fornecedores de infraestrutura podem operar servidores em diferentes países. Não
          afirmamos aqui uma localização específica porque a região de hospedagem pode mudar e não
          queremos declarar algo que você não possa conferir. Se houver transferência internacional,
          ela se apoia nas hipóteses do art. 33 da LGPD, especialmente cláusulas contratuais e a
          necessidade de execução do contrato. Você pode solicitar a informação atualizada sobre onde
          os dados estão hospedados pelo canal de contato.
        </p>
      </Section>

      <Section title="7. Segurança">
        <p>Medidas que existem hoje no sistema:</p>
        <List
          items={[
            'Senhas armazenadas de forma cifrada pelo provedor de autenticação, sem acesso ao valor original.',
            'Tráfego cifrado em trânsito (HTTPS).',
            'Isolamento por empresa aplicado no banco de dados, e não apenas na interface: as consultas são restringidas à empresa do usuário autenticado.',
            'Controle de acesso por papel, com operações sensíveis restritas a proprietários e administradores.',
            'Registros de auditoria de ações administrativas, com autor, data e valores anteriores quando aplicável.',
            'Operações críticas executadas no servidor, para que a interface não seja a única barreira.',
          ]}
        />
        <p>
          Nenhum sistema é completamente seguro, e não prometemos segurança absoluta. Trabalhamos
          para reduzir riscos e temos um procedimento interno de resposta a incidentes. Se ocorrer
          incidente com risco relevante, avaliaremos a comunicação à Autoridade Nacional de Proteção
          de Dados e aos titulares afetados, conforme o art. 48 da LGPD.
        </p>
      </Section>

      <Section title="8. Por quanto tempo guardamos">
        <p>
          Dados da operação são mantidos enquanto a conta da empresa estiver ativa, porque é o que
          permite o histórico de inventários funcionar. Registros de auditoria e de segurança são
          mantidos por período maior, já que a função deles é justamente permitir verificar o passado.
        </p>
        <p>
          O {P} usa <strong>exclusão lógica</strong> em históricos: quando uma contagem ou uma
          conferência é removida, ela sai das listas mas o registro continua guardado, com quem
          removeu e por quê. Isso é intencional — apagar de vez destruiria a prova da operação.
          Exclusão definitiva só é possível em rascunhos que nunca foram usados.
        </p>
        <p>
          Não prometemos exclusão imediata: quando houver obrigação legal de conservar, ou
          necessidade de defesa em processo, os dados são mantidos pelo prazo aplicável e depois
          eliminados ou anonimizados. Prazos específicos por categoria ainda estão sendo definidos e
          serão publicados nesta política quando houver decisão.
        </p>
      </Section>

      <Section title="9. Seus direitos">
        <p>A LGPD garante a você, entre outros direitos:</p>
        <List
          items={[
            'Confirmar se tratamos seus dados e acessá-los.',
            'Corrigir dados incompletos, inexatos ou desatualizados.',
            'Solicitar anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em desconformidade.',
            'Solicitar a portabilidade dos dados.',
            'Ser informado sobre com quem compartilhamos seus dados.',
            'Revogar consentimento, quando o tratamento se basear nele.',
            'Opor-se a tratamento fundado em legítimo interesse.',
          ]}
        />
        <p>
          Para exercer qualquer desses direitos, use o canal abaixo. Vamos confirmar sua identidade
          antes de atender, para não entregar dados a quem não é o titular. Se o pedido envolver
          dados que sua empresa controla, podemos precisar encaminhá-lo a ela, e nesse caso avisamos
          você.
        </p>
        <ContactBlock />
      </Section>

      <Section title="10. Cookies e armazenamento no seu navegador">
        <p>
          O {P} <strong>não usa cookies de publicidade, de analytics nem de terceiros</strong>. Não
          há ferramenta de medição de audiência, pixel de marketing ou rastreador instalado. O que
          usamos é estritamente necessário para o sistema funcionar, e por isso não depende do seu
          consentimento — mostramos apenas um aviso informativo na primeira visita.
        </p>
        <p>O que fica guardado no seu navegador:</p>
        <List
          items={[
            'Sessão de autenticação — mantém você conectado entre páginas e recarregamentos. Sem isso seria necessário fazer login a cada tela.',
            'Preferência de tema (claro ou escuro) e estado do menu lateral recolhido.',
            'Última novidade já visualizada no painel de atualizações, para não repetir o aviso.',
            'Lembrança da empresa selecionada, para quem tem acesso a mais de uma.',
            'Rascunho do diagnóstico da operação, para você poder continuar depois.',
            'Fila de contagens pendentes: se a conexão cair durante uma contagem física, os registros ficam no seu dispositivo e são enviados quando a rede voltar. Sem isso, o trabalho feito offline seria perdido.',
          ]}
        />
        <p>
          Você pode limpar esses dados nas configurações do navegador. Ao fazer isso, você será
          desconectado e as preferências voltam ao padrão; se houver contagens ainda não enviadas na
          fila offline, elas serão perdidas.
        </p>
      </Section>

      <Section title="11. Alterações nesta política">
        <p>
          Quando esta política mudar, publicamos uma nova versão com nova data de vigência. Em
          alterações relevantes, pediremos novo aceite ao entrar no sistema. Você pode consultar a
          versão vigente e a data do seu último aceite na área de Privacidade e Legal, dentro do
          sistema.
        </p>
      </Section>
    </LegalDocument>
  );
}
