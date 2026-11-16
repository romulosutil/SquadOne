// Colinha de atendimento do PRUMO (08/10/2026): o que dizer em cada momento da
// conversa com um lead, para o Rômulo atender com a resposta pronta na mão.
// Conteúdo estático e versionado, como fluxos.ts; PURO (sem Vue, sem fetch).
// Fonte: o plano "PRUMO 30 dias" de 08/10/2026, seções 2 a 5
// (https://claude.ai/artifact/4vPw5U3EX4Cz6RutAMkVee), e a hierarquia de
// serviços de 09/10/2026 (repositório prumo, 00-contexto/decisoes.md e a seção
// "A oferta — ver, arrumar, manter" de negocio.md), que manda no cardápio: ao
// mudar o cardápio ou uma mensagem lá, mude aqui também.
//
// As mensagens da esteira automática (segunda mensagem e follow-ups) NÃO são
// copiadas: vêm de server/site-mensagem.ts, o espelho do que o n8n manda. Mudou
// lá, a colinha mostra o texto novo sem editar este arquivo.
//
// Os únicos "R$" daqui são os preços do cardápio (o teste confere): nada de
// finanças pessoais entra no CRM (RULES 24).

import {
  DEMO_DEPOIS_DO_RAIO_X, FOLLOWUP, FOLLOWUP_COM_LINK, FOLLOWUP_RAIO_X, SEGUNDA, SEGUNDA_RAIO_X, SEGUNDA_RAIO_X_SEM_DEMO, artigoDe, raioXAvulso,
} from '../../server/site-mensagem.ts'
import { FOLLOWUP_PRUMO, SEGUNDA_PRUMO } from '../../server/prumo-mensagem.ts'
import type { CrmEtapa, CrmProduto, CrmSinal, CrmTipoDeResposta } from './types'
import { textoDasFaixasIris } from './precos-iris'
export { PRECOS_CANONICOS_IRIS, FAIXAS_PRECIFICACAO_IRIS, ORIGEM_DOS_PRECOS_IRIS, mensalidadeIrisCentavos, detalharMensalidadeIris, textoDasFaixasIris } from './precos-iris'

// ------------------------------------------------------------------ tipos

export type IdDoServico = 'raio-x' | 'mapa' | 'encontrado' | 'respondido' | 'anuncios' | 'redes' | 'fonte' | 'fonte-em-dia'

/** As três etapas da oferta, nesta ordem (09/10/2026): ver o problema, arrumar, manter arrumado. */
export type EtapaDaOferta = 'ver' | 'arrumar' | 'manter'
export const ETAPAS_DA_OFERTA: EtapaDaOferta[] = ['ver', 'arrumar', 'manter']
export const ROTULO_DA_ETAPA: Record<EtapaDaOferta, string> = { ver: 'Ver', arrumar: 'Arrumar', manter: 'Manter' }

/**
 * Cada oferta é de um tipo só: diagnóstico (grátis, o PRUMO faz e entrega um
 * documento), produto (escopo fixo, implantação + mensalidade), projeto (sob
 * medida, o tamanho vem do diagnóstico suficiente) ou mensalidade (mantém uma construção).
 */
export type TipoDeOferta = 'diagnostico' | 'produto' | 'projeto' | 'mensalidade'
export const ROTULO_DO_TIPO: Record<TipoDeOferta, string> = { diagnostico: 'diagnóstico', produto: 'produto', projeto: 'projeto', mensalidade: 'mensalidade' }

export interface ServicoDoCardapio {
  id: IdDoServico
  nome: string
  etapa: EtapaDaOferta
  tipo: TipoDeOferta
  /** O que o cliente recebe, dito como o Rômulo diria. */
  entrega: string
  /** "grátis", "R$ 690", "R$ 190/mês"… Nos serviços sob proposta é a base interna, nunca dita no frio. */
  preco: string
  /**
   * Para o cliente o preço é "sob proposta" (decisão de 08/10/2026): o valor sai
   * por escrito, depois do diagnóstico, ao lado do que ele encontrou. `preco` e
   * `mensal` continuam aqui como base da proposta, só para o Rômulo.
   */
  sobProposta?: true
  /** "R$ 39/mês" quando há mensalidade. */
  mensal?: string
  /** "paga só depois de ver no ar", "escopo confirmado"… */
  condicao?: string
  /** Para quem oferecer (e quando). */
  paraQuem: string
}

/** Um texto pronto. `texto` vai para o lead; `dica` é só para o Rômulo. */
export interface Trecho {
  id: string
  titulo: string
  /** Mensagem para mandar; {NOME}, {ARTIGO}, {O_A}, {URL} e {RAIO_X} são preenchidos com o lead. */
  texto: string
  dica?: string
  /** Vem da esteira automática (server/site-mensagem.ts): o n8n manda o mesmo texto. */
  esteira?: boolean
  /**
   * Site antes da venda: `true` só para quem recebeu a variação C (o raio-x), `false` só para
   * quem não recebeu; ausente, para todos. Quem pediu o raio-x não pode receber o texto do site.
   */
  raioX?: boolean
  /**
   * Quem recebeu a C, pelo lugar do demo (demo sob pedido, 14/10/2026): `junto` = o Raio-X dentro do demo (antes de
   * 14/10); `sem` = o Raio-X avulso, ainda sem demo; `depois` = o avulso e o demo feito pelo botão "Gerar demo".
   * Ausente, para todos.
   */
  demo?: 'junto' | 'sem' | 'depois'
  /** Para quais produtos do CRM o trecho serve. */
  produtos: CrmProduto[]
}

export type Momento = 'primeiro-contato' | 'pode-mandar' | 'followup' | 'convite-mapa' | 'mapa' | 'conversa' | 'proposta' | 'fechamento'

export interface PassoDoRoteiro {
  momento: Momento
  titulo: string
  /** O que este momento precisa conseguir, numa frase. */
  objetivo: string
  trechos: Trecho[]
  /** Roteiro falado (a conversa de 20 min, a devolutiva do Mapa): perguntas, não mensagens. */
  perguntas?: string[]
  /** O serviço do cardápio que este momento vende. */
  servico?: IdDoServico
}

export type IdDaObjecao = 'ja-tem-site' | 'ja-tem-agencia' | 'quanto-custa' | 'pode-apagar' | 'ver-com-socio' | 'ta-caro' | 'mapa-e-pago' | 'sem-tempo'

export interface Objecao {
  id: IdDaObjecao
  /** Como o lead costuma dizer ("já temos site"). */
  fala: string
  /** Pedaços de texto (minúsculos, sem acento) que reconhecem a objeção na resposta do lead. */
  sinais: string[]
  resposta: Trecho
  /** O serviço para onde a resposta leva a conversa. */
  levaPara?: IdDoServico
}

// ------------------------------------------------------------------ conteúdo

// Hierarquia de 09/10/2026: ver → arrumar → manter, na ordem do array (a tela
// mostra nesta ordem e o teste confere). Desde 16/11, diagnósticos são opcionais.
// Método e condições contratadas permanecem. Mudou o preço canônico, atualizar
// o cardápio e PRECOS_DO_CARDAPIO juntos.
export const CARDAPIO: ServicoDoCardapio[] = [
  {
    id: 'raio-x',
    nome: 'Raio-X',
    etapa: 'ver',
    tipo: 'diagnostico',
    entrega: 'Uma página feita pelo Prumo, só com dados públicos: como a empresa aparece no Google, o que já está bom, até 3 coisas que mandam cliente para o concorrente (só as que o dado confirma) e, quando faz sentido, a demonstração do site. O dono não preenche nada.',
    preco: 'grátis',
    paraQuem: 'Quando uma análise da presença pública ajuda a decidir o que fazer. Opcional, inclusive para quem já tem site; não autoriza contato.',
  },
  {
    id: 'mapa',
    nome: 'Mapa',
    etapa: 'ver',
    tipo: 'diagnostico',
    entrega: 'O Raio-X mostra a empresa por fora; o Mapa, por dentro. O dono responde 16 perguntas (uns 10 minutos, com números aproximados informados pelo dono, sem extratos nem senhas) e recebe um documento: Índice do Prumo X/18, os 6 blocos, o que passa pelo dono, onde a informação mora, as travas estimadas e o que fazer primeiro. Mais uma conversa de 45 minutos sobre o resultado. O documento é do dono, contrate ou não.',
    preco: 'grátis',
    paraQuem: 'Empresa com equipe e problema de regras ou rotina que justifique investigação. Opcional, com aceite do interessado; porte não garante retorno.',
  },
  {
    id: 'encontrado',
    nome: 'Encontrado',
    etapa: 'arrumar',
    tipo: 'produto',
    entrega: 'Site no ar com o endereço da empresa, perfil do Google revisado e botão de WhatsApp. A mensalidade cobre domínio, hospedagem e um ajuste por mês.',
    preco: 'R$ 690',
    mensal: 'R$ 39/mês',
    condicao: 'paga só depois de ver no ar',
    paraQuem: 'Quem confirma necessidade de apresentar serviços, trabalhos e contato em um site. Ausência de URL pública não comprova essa necessidade.',
  },
  {
    id: 'respondido',
    nome: 'Respondido e Acompanhado',
    etapa: 'arrumar',
    tipo: 'produto',
    // A contagem do WhatsApp (o que era um diagnóstico pago até 08/10) virou a
    // prova do produto: medida antes de ligar e de novo em 30 dias, sem preço à parte.
    entrega: 'WhatsApp que responde na hora, faz as primeiras perguntas e marca horário; retorno automático de orçamento parado; painel simples de quem chamou e de quem fechou. Antes e depois medidos: contamos o WhatsApp antes de ligar e mostramos a diferença em 30 dias.',
    preco: 'R$ 2.400',
    mensal: 'R$ 290/mês',
    condicao: 'só depois de uma conversa, nunca no WhatsApp frio',
    sobProposta: true,
    paraQuem: 'Quem demonstra problema no atendimento ou acompanhamento de demandas recebidas. Ter site não é requisito nem prova de necessidade.',
  },
  {
    id: 'anuncios',
    nome: 'Anúncios',
    etapa: 'arrumar',
    tipo: 'produto',
    entrega: 'Criamos e cuidamos dos anúncios no Google ou no Instagram, e todo mês mostramos quantas pessoas chamaram por causa deles. A verba do anúncio vai direto para a plataforma, sem passar pelo Prumo.',
    preco: 'R$ 590/mês',
    condicao: 'Google ou Instagram; R$ 390 a mais pelos dois; mínimo de 3 meses',
    paraQuem: 'Quem confirma necessidade de aquisição, capacidade de atendimento e orçamento de mídia. Fora da aquisição ampla desta rodada; avaliar por demanda específica.',
  },
  {
    id: 'redes',
    nome: 'Redes sociais',
    etapa: 'arrumar',
    tipo: 'produto',
    entrega: 'Instagram e Facebook em dia: 8 posts por mês e stories toda semana, feitos com as fotos e os serviços da empresa e publicados depois da aprovação do dono.',
    preco: 'R$ 790/mês',
    condicao: 'mínimo de 3 meses; depois, cancela quando quiser',
    paraQuem: 'Quem confirma necessidade de manter conteúdo e dispõe de material e aprovação. Fora da aquisição ampla desta rodada; perfil parado não comprova perda de vendas.',
  },
  {
    id: 'fonte',
    nome: 'Fonte',
    etapa: 'arrumar',
    tipo: 'projeto',
    entrega: 'A construção, em cerca de 2 semanas depois da conversa sobre as regras. Na primeira, conferimos o diagnóstico suficiente com o time, usando o Mapa quando pertinente; depois, as regras da casa (como a empresa vende, compra, entrega e cobra, e quem faz o quê) saem da cabeça do dono para uma pasta no Google Drive, manual no Notion, caderno no Gemini, robô no WhatsApp ou chat próprio, conforme o escopo. Até 6 assuntos e 15 pessoas. O uso de IA e a assinatura da plataforma, quando aplicáveis, ficam à parte; a liberação do número do WhatsApp depende da Meta e pode levar até 20 dias.',
    preco: 'R$ 1.500',
    condicao: 'a partir de, 50/50, escopo confirmado',
    sobProposta: true,
    paraQuem: 'Empresa com equipe e necessidade demonstrada de regras consultáveis. Diagnóstico suficiente para definir o escopo; Mapa prévio não é obrigatório.',
  },
  {
    id: 'fonte-em-dia',
    nome: 'Manutenção da Fonte',
    etapa: 'manter',
    tipo: 'mensalidade',
    entrega: 'Incluir, mudar ou tirar regras e dados da Fonte: até 10 mudanças por mês, pedidas pelo WhatsApp e feitas em até 2 dias úteis. Começa depois dos 30 dias de ajustes; cancela quando quiser. Assunto novo inteiro tem condição própria na tabela.',
    preco: 'R$ 190/mês',
    condicao: 'opcional, até 10 mudanças por mês, depois dos 30 dias de ajustes',
    sobProposta: true,
    paraQuem: 'Quem construiu a Fonte e quer mantê-la em dia. Opcional: nunca condição para fechar a Fonte.',
  },
]

/** O preço de um serviço sob proposta, no cardápio (como o "grátis" do Raio-X). */
export const SOB_PROPOSTA = 'sob proposta'

/** Explicação de escopo variável; perguntas de preço recebem a base vigente da oferta. */
export const FRASE_SOB_PROPOSTA = 'O valor depende do escopo. Posso informar a base vigente e o que ela inclui; o valor fechado vai por escrito antes de começar, sem exigir Raio-X ou Mapa. Combinamos o prazo de envio depois de conferir as informações e o compromisso possível.'

/** A resposta ao "isso é pago?" sobre o Mapa (09/10/2026): sem número, porque o Mapa não tem preço. */
export const FRASE_MAPA_E_GRATIS = 'Não cobramos pelo Mapa. Cobramos se vocês quiserem construir a Fonte depois.'

/** Valor + mensalidade + condição, como está na tabela. Num serviço sob proposta, é só para o Rômulo. */
export function precoDaTabela(s: ServicoDoCardapio): string {
  return [s.preco, s.mensal && `+ ${s.mensal}`, s.condicao && `(${s.condicao})`].filter(Boolean).join(' ')
}

/** O preço como se diz ao cliente: sob proposta, sem número; os outros, como na tabela. */
export function precoParaOCliente(s: ServicoDoCardapio): string {
  return s.sobProposta ? SOB_PROPOSTA : precoDaTabela(s)
}

// Sem cliente fundador (08/10/2026): o preço é o da tabela para todo cliente,
// nada de desconto em troca de depoimento. O PRUMO é consultoria e não pede
// favor ao cliente.

/** Todo "R$" que a colinha pode mostrar. Fora desta lista, o teste falha. */
export const PRECOS_DO_CARDAPIO: string[] = ['R$ 690', 'R$ 39', 'R$ 2.400', 'R$ 290', 'R$ 590', 'R$ 390', 'R$ 790', 'R$ 1.500', 'R$ 190']

const SITE: CrmProduto[] = ['site']
const PRUMO: CrmProduto[] = ['prumo']
const TODOS: CrmProduto[] = ['site', 'prumo']

// Os textos com fonte no plano (primeira B e C, primeiro contato pela CDL,
// objeções "já temos site", "já temos agência", "pode apagar", CDL) estão
// literais; o resto segue o mesmo tom. Colchetes ([nota], [nome da CDL]…) o
// Rômulo completa à mão: só {NOME}, {ARTIGO}, {O_A}, {URL} e {RAIO_X} são preenchidos
// pela colinha.
// A ordem é a da conversa: ver (Raio-X, Mapa) antes de arrumar (conversa,
// proposta, fechamento).
export const ROTEIRO: PassoDoRoteiro[] = [
  {
    momento: 'primeiro-contato',
    titulo: 'Primeiro contato · referência histórica',
    objetivo: 'Referência das mensagens antigas para interpretar o histórico. Primeiros contatos automáticos bloqueados; este roteiro não autoriza nova abordagem.',
    trechos: [
      {
        id: 'primeira-b',
        titulo: 'Primeira mensagem · B · observação concreta',
        texto:
          'Oi! Sou o Rômulo, do Prumo, e trabalho com criação de sites. Vi {O_A} {NOME} no Google: nota [nota] em [avaliações] avaliações. Preparei uma demonstração independente de site com as fotos e avaliações públicas de vocês e acesso ao WhatsApp.\n\nPosso te mostrar como ficou?',
        dica: 'Texto histórico. Demonstração e avaliações não autorizam contato nem comprovam necessidade. Não deduza ausência de site ou perda de clientes.',
        produtos: SITE,
      },
      {
        id: 'primeira-c',
        titulo: 'Primeira mensagem · C · Raio-X',
        texto:
          'Oi! Sou o Rômulo, do Prumo, e trabalho com sites para empresas. Analisei como {O_A} {NOME} aparece no Google e encontrei [N] pontos que podem dificultar o contato de novos clientes.\n\nPosso te enviar essa análise gratuita de uma página?',
        dica: 'Texto histórico, sem autorização vigente de abordagem. [N] exige observação real; material publicado não autoriza envio.',
        produtos: SITE,
      },
      {
        id: 'primeira-cdl',
        titulo: 'CDL · primeiro contato com o associado',
        texto:
          'Oi [nome]! Sou o Rômulo, do Prumo, parceiro da [nome da CDL]. Ajudo empresas de [segmento] a organizar regras de orçamento para a equipe consultar no dia a dia.\n\nPosso te mostrar um exemplo ilustrativo de como essas regras ficam organizadas?',
        dica: 'Texto histórico. Só use "parceiro" com parceria confirmada e contato elegível; Mapa opcional conforme a necessidade, nunca apenas pelo porte.',
        produtos: PRUMO,
      },
    ],
  },
  {
    momento: 'pode-mandar',
    titulo: 'Depois do "pode mandar"',
    objetivo: 'Entregar somente o material solicitado no canal permitido. Continuar a conversa não confirma necessidade, proposta ou compra.',
    servico: 'encontrado',
    trechos: [
      {
        id: 'segunda-prumo',
        titulo: 'PRUMO · o Raio-X (empresa que já tem site)',
        texto: SEGUNDA_PRUMO,
        dica: 'Usar somente se esse material foi solicitado e está disponível. Responder preço diretamente quando perguntado; ter equipe não impõe Mapa.',
        produtos: PRUMO,
      },
      {
        id: 'segunda-raio-x',
        titulo: '2ª mensagem · recebeu a C: o raio-x e o demo',
        texto: SEGUNDA_RAIO_X,
        esteira: true,
        dica: 'Pediu o raio-x, então ele vai primeiro; o demo vem junto, já com o preço. Não mande só o link do site: não foi o que ele aceitou receber.',
        produtos: SITE,
        raioX: true,
        demo: 'junto',
      },
      {
        id: 'segunda-raio-x-sem-demo',
        titulo: '2ª mensagem · recebeu a C: o raio-x (o demo ainda não existe)',
        texto: SEGUNDA_RAIO_X_SEM_DEMO,
        esteira: true,
        dica: 'Demo sob pedido: o raio-x vai sozinho e oferece a demonstração, sem preço. Se ele quiser ver o site, toque "Gerar demo" na ficha: sai em uns 20 a 40 minutos e o aviso chega no WhatsApp.',
        produtos: SITE,
        raioX: true,
        demo: 'sem',
      },
      {
        id: 'demo-depois-do-raio-x',
        titulo: 'Depois do raio-x: o demo pedido',
        texto: DEMO_DEPOIS_DO_RAIO_X,
        esteira: true,
        dica: 'O demo que você pediu pelo botão já está no ar. Este texto leva o preço do Encontrado.',
        produtos: SITE,
        raioX: true,
        demo: 'depois',
      },
      {
        id: 'segunda',
        titulo: '2ª mensagem (a da esteira)',
        texto: SEGUNDA,
        esteira: true,
        dica: 'Já leva o preço do Encontrado.',
        produtos: SITE,
        raioX: false,
      },
      {
        id: 'segunda-preco',
        titulo: 'Preço do Encontrado (para juntar à segunda)',
        texto:
          'Se gostarem, coloco no ar com o endereço de vocês. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e um ajuste por mês incluídos. Vocês só pagam depois de ver o site funcionando.',
        dica: 'Informe as condições vigentes quando perguntado ou quando pertinentes ao pedido. Perguntar preço não comprova compra.',
        produtos: SITE,
      },
    ],
  },
  {
    momento: 'followup',
    titulo: 'Follow-up do 3º dia · referência histórica',
    objetivo: 'Referência histórica de acompanhamento. Passagem do tempo não autoriza contato: conferir permissão, conversa atual e próximo passo combinado.',
    trechos: [
      {
        id: 'followup-sem-link',
        titulo: 'Ainda sem link',
        texto: FOLLOWUP,
        esteira: true,
        dica: 'Mensagem da esteira legada; conferir histórico e elegibilidade. Não presume automação ativa nem autoriza nova tentativa.',
        produtos: SITE,
        raioX: false,
      },
      {
        id: 'followup-raio-x',
        titulo: 'Recebeu a C: lembra o raio-x',
        texto: FOLLOWUP_RAIO_X,
        esteira: true,
        dica: 'Quem recebeu a C foi convidado para o raio-x, não para o site: o lembrete é do raio-x.',
        produtos: SITE,
        raioX: true,
      },
      {
        id: 'followup-com-link',
        titulo: 'Link já enviado',
        texto: FOLLOWUP_COM_LINK,
        esteira: true,
        dica: 'Um follow-up só. Sem resposta depois dele, deixe quieto.',
        produtos: SITE,
        raioX: false,
      },
      {
        id: 'followup-prumo',
        titulo: 'PRUMO · sem resposta',
        texto:
          'Oi [nome], é o Rômulo de novo, do Prumo. Ainda faz sentido a gente conversar 20 minutos sobre responder orçamento no mesmo dia? Se não for o momento, é só dizer.',
        dica: 'Texto histórico; usar somente em acompanhamento elegível e combinado. Silêncio não autoriza insistência.',
        produtos: PRUMO,
      },
      {
        id: 'followup-prumo-raio-x',
        titulo: 'PRUMO · Raio-X já enviado',
        texto: FOLLOWUP_PRUMO,
        dica: 'Um só, 3 dias depois do Raio-X. Sem resposta, deixe quieto.',
        produtos: PRUMO,
      },
    ],
  },
  {
    // Investigação opcional da rotina, quando ajuda a definir o escopo.
    momento: 'convite-mapa',
    titulo: 'Investigação opcional da rotina · convite para o Mapa',
    objetivo: 'Oferecer investigação opcional quando a rotina da equipe exige entendimento adicional e o interessado aceita. São 16 perguntas, cerca de 10 minutos, sem extratos nem senhas.',
    servico: 'mapa',
    trechos: [
      {
        id: 'mapa-convite',
        titulo: 'Convite para o Mapa',
        // Uma linha por ideia e o link sozinho numa linha: no WhatsApp ele fica tocável e não se mistura ao texto.
        texto: [
          'Oi, [nome]. Aqui é o Rômulo, do Prumo. Para entender a rotina {ARTIGO} {NOME}, podemos usar o Mapa se essa investigação ajudar vocês.',
          'O Mapa mostra o de dentro: o que hoje só anda com você, onde a informação mora e o que arrumar primeiro. Vocês recebem um documento e uma conversa de 45 minutos sobre ele, sem custo.',
          'São 16 perguntas, uns 10 minutos, com números aproximados informados pelo dono, sem extratos nem senhas:',
          '[link das 16 perguntas]',
          'Consegue responder até [dia]?',
        ].join('\n'),
        dica: 'Confirmar problema da equipe, utilidade da investigação e aceite. Não exige Raio-X nem porte mínimo; o Mapa é gratuito e não obriga contratação. Combinar prazo compatível com a entrega.',
        produtos: PRUMO,
      },
    ],
  },
  {
    momento: 'mapa',
    titulo: 'Mapa · a devolutiva (45 min)',
    objetivo: 'Entregar o documento, conferir com o dono o que mais pesa e sair com o próximo passo: a Fonte, se a empresa tem time para usar, ou o produto que resolve.',
    servico: 'mapa',
    trechos: [
      {
        id: 'mapa-pronto',
        titulo: 'O Mapa ficou pronto',
        texto:
          'Oi [nome], aqui é o Rômulo, do Prumo. O Mapa {ARTIGO} {NOME} ficou pronto: Índice do Prumo [X] de 18. O que mais pesa hoje: [o que só anda com você]. Podemos conversar 45 minutos [dia] para eu te mostrar o documento inteiro e o que fazer primeiro?',
        dica: 'Até 3 dias úteis depois das 16 perguntas. Abra com o Índice e o maior achado. O documento é do dono, contrate ou não; nenhum preço nesta mensagem.',
        produtos: PRUMO,
      },
    ],
    // A devolutiva confere o documento com o dono; o fechamento leva à Fonte só
    // se houver time para usá-la (senão, encerra bem e aponta o produto).
    perguntas: [
      'Comece pelo Índice: "[X] de 18; o bloco mais fraco é [bloco]." Isso bate com o que você sente no dia a dia?',
      'Se você sumisse duas semanas sem celular, o que quebraria primeiro?',
      '"Isto só anda com você: [o que passa pelo dono]." Quem do time poderia decidir isso, se a regra estivesse escrita?',
      '"A informação de [assunto] mora em [onde]." Uma pessoa nova acha sozinha?',
      '"Pelas respostas, essas travas custam algo como [valor estimado] por mês." Faz sentido para você?',
      'Para combinar o próximo passo: "O problema que confirmamos é [problema]. Se quiserem uma proposta, vamos conferir o escopo e combinar uma data." Fonte somente quando a equipe precisar e puder adotar; não indicar outro produto automaticamente.',
    ],
  },
  {
    momento: 'conversa',
    titulo: 'Conversa de 20 minutos · Respondido e Acompanhado',
    objetivo: 'Entender, em números, o que acontece depois que o cliente chama: é o "antes" que o Respondido mede, e o número que faz o dono decidir.',
    servico: 'respondido',
    trechos: [
      {
        id: 'conversa-convite',
        titulo: 'Convite para a conversa',
        texto:
          'Para definir o escopo, quero entender um caso recente do atendimento de vocês e o que precisa melhorar. Podemos conversar por aqui ou, se preferir, por telefone ou vídeo. Qual formato funciona melhor?',
        dica: 'Só depois de um sim ou de uma pergunta do dono, nunca no WhatsApp frio. Anote cada número: é o "antes" da medição, e a diferença em 30 dias é a prova do Respondido.',
        produtos: TODOS,
      },
    ],
    // Cada pergunta leva a um número: é o número que faz o dono decidir, e cada
    // um aponta para um produto (Encontrado ou Respondido).
    perguntas: [
      'Numa semana normal, quantas pessoas chamam vocês no WhatsApp ou ligam pedindo informação ou orçamento?',
      'Quando alguém chama, quanto tempo leva até a primeira resposta? E quem responde?',
      'E fora do horário, à noite ou no fim de semana: quem responde? Quantas mensagens chegam assim por semana?',
      'De cada 10 que pedem orçamento, quantos somem sem responder? Alguém volta a chamar essas pessoas?',
      'De cada 10 que chamam, quantos viram cliente?',
      'Quanto vale um cliente para vocês, em média, num serviço?',
      'De cada 10 clientes novos, quantos chegam pelo Google? Quem procura vocês lá, acha?',
      'Para combinar o próximo passo: "Pelo caso que vocês descreveram, precisamos melhorar [processo]. Vamos confirmar o escopo e como medir a mudança?" Distinguir estimativas de dados observados; não prometer clientes recuperados ou proposta antes de ter contexto suficiente.',
    ],
  },
  {
    momento: 'proposta',
    titulo: 'Proposta',
    objetivo: 'Preparar proposta quando necessidade, processo de decisão e escopo forem suficientes: o que entra, quanto custa e quando começa. Combinar a data; um gostei isolado não basta.',
    trechos: [
      {
        id: 'proposta-encontrado',
        titulo: 'Encontrado (escopo confirmado)',
        texto:
          'Que bom que gostaram! Fica assim: coloco o site no ar com o endereço de vocês, reviso o perfil do Google e ponho o botão de WhatsApp. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e um ajuste por mês incluídos. Vocês só pagam depois de ver o site funcionando. Posso começar?',
        dica: 'Confirmar escopo e condições antes de propor. Mudança combinada no demo entra na conferência; pagamento só depois de ver funcionando.',
        produtos: SITE,
      },
      {
        id: 'proposta-respondido',
        titulo: 'Respondido e Acompanhado (depois de uma conversa)',
        texto:
          'Como conversamos: hoje [o maior vazamento, com o número]. A proposta: o WhatsApp de vocês passa a responder na hora, até fora do horário, faz as primeiras perguntas e marca horário; quem pediu orçamento e sumiu recebe retorno sem vocês precisarem lembrar; e vocês veem num painel simples quem chamou e quem fechou. Antes de ligar, contamos como o WhatsApp está hoje e, em 30 dias, mostramos a diferença. O valor parte de R$ 2.400 para montar, mais R$ 290 por mês, e fecha por escrito antes de começar. Se fizer sentido, começo [dia].',
        dica: 'Só depois de uma conversa, nunca no WhatsApp frio. O "antes" são os números da conversa de 20 minutos; confira de novo antes de ligar.',
        produtos: TODOS,
      },
      {
        id: 'proposta-fonte',
        titulo: 'Fonte (diagnóstico suficiente)',
        texto:
          'Como conversamos: hoje [problema confirmado]. A proposta: na primeira semana conferimos as regras com o time; depois escrevemos junto como a {NOME} vende, compra, entrega e cobra, e quem faz o quê, num Notion ou num agente com IA que o time consulta. O objetivo é que o time encontre a regra combinada sem depender de você para cada consulta. O projeto parte de R$ 1.500 (Drive, Notion ou caderno no Gemini; R$ 2.400 se for robô no WhatsApp ou chat próprio), metade para começar e metade na entrega. Se fizer sentido, começo [dia].',
        dica: 'Somente com necessidade e escopo confirmados; Mapa é opcional. A manutenção da Fonte (R$ 190/mês, opcional, até 10 mudanças por mês) entra no fim como opção, nunca como condição.',
        produtos: PRUMO,
      },
    ],
  },
  {
    momento: 'fechamento',
    titulo: 'Fechamento',
    objetivo: 'Pedir a decisão com clareza e, fechado, combinar quando começa, o que preciso deles e quando pagam.',
    trechos: [
      {
        id: 'fechamento-decisao',
        titulo: 'Pedir a decisão',
        texto:
          'Oi [nome], conseguiu olhar a proposta? Se fizer sentido, já reservo [dia] para começar. Se não for o momento, pode me dizer, sem problema: prefiro um não claro a ficar te cobrando.',
        dica: 'Acompanhar na data combinada e no canal permitido; silêncio não autoriza uma nova cadência.',
        produtos: TODOS,
      },
      {
        id: 'fechamento-encontrado',
        titulo: 'Ganho: o Encontrado',
        texto:
          'Fechado, obrigado pela confiança! Para colocar no ar preciso só de duas coisas: o endereço que vocês querem (por exemplo, nomedaempresa.com.br) e acesso ao perfil do Google, me adicionando como administrador. Em [dias] está no ar; vocês conferem e só então pagam.',
        dica: 'Pagamento só depois de ver no ar, pelo preço da proposta. Nada de desconto em troca de depoimento.',
        produtos: SITE,
      },
      {
        id: 'fechamento-projeto',
        titulo: 'Ganho: o Respondido ou a Fonte',
        texto:
          'Fechado, obrigado pela confiança! Para começar, marco com vocês [dia e hora] e preciso de acesso de leitura ao WhatsApp e às planilhas. Te mando por aqui o que entra em cada semana, para vocês acompanharem.',
        dica: 'Combine forma e data do pagamento por escrito, pelo preço da proposta (a Fonte é 50/50). No Respondido, a contagem de antes acontece agora, antes de ligar.',
        produtos: TODOS,
      },
    ],
  },
]

// Sinais em frase, não em palavra solta: "caro" casaria "caro amigo", "temos site"
// casaria "não temos site", "vou ver com" casaria "vou ver com calma".
export const OBJECOES: Objecao[] = [
  {
    id: 'ja-tem-site',
    fala: 'já temos site',
    sinais: ['ja temos site', 'ja temos um site', 'ja tem site', 'ja tem um site', 'ja tenho site', 'ja tenho um site', 'ja possuimos site', 'ja possuimos um site', 'ja temos nosso site'],
    resposta: {
      id: 'objecao-ja-tem-site',
      titulo: '"Já temos site"',
      texto: 'Entendido, vocês já têm site. Não vou insistir em outro. Se houver algo específico que você queira resolver, pode me dizer.',
      dica: 'Não trocar automaticamente a oferta por automação. Respeitar recusa; investigar outro problema somente se a pessoa o trouxer.',
      produtos: TODOS,
    },
  },
  {
    id: 'ja-tem-agencia',
    fala: 'já temos agência',
    sinais: ['ja temos agencia', 'ja temos uma agencia', 'ja tem agencia', 'ja tem uma agencia', 'ja tenho agencia', 'ja tenho uma agencia', 'trabalhamos com agencia', 'trabalhamos com uma agencia', 'nossa agencia'],
    resposta: {
      id: 'objecao-ja-tem-agencia',
      titulo: '"Já temos agência"',
      texto: 'Entendido, vocês já contam com uma agência. Obrigado por esclarecer; não vou insistir em outra oferta.',
      dica: 'Não dispute com a agência: deixe a porta aberta e não insista.',
      produtos: TODOS,
    },
  },
  {
    id: 'quanto-custa',
    fala: 'quanto custa?',
    sinais: ['quanto custa', 'quanto fica', 'quanto sai', 'quanto cobra', 'quanto voce cobra', 'quanto vc cobra', 'qual o valor', 'qual valor', 'qual seria o valor', 'qual o preco', 'qual preco', 'qual seria o preco'],
    levaPara: 'encontrado',
    resposta: {
      id: 'objecao-quanto-custa',
      titulo: '"Quanto custa?"',
      texto:
        'Para colocar o site no ar com o endereço de vocês: R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e um ajuste por mês incluídos. Vocês só pagam depois de ver o site funcionando. Quer que eu coloque?',
      dica: 'Diga a base e as condições vigentes da oferta perguntada, sem exigir reunião ou diagnóstico. Valor fechado por escrito antes de começar. Se a pergunta é sobre o Mapa, esclareça que ele é gratuito.',
      produtos: TODOS,
    },
  },
  {
    id: 'pode-apagar',
    fala: 'pode apagar',
    sinais: ['pode apagar', 'pode excluir', 'pode remover', 'pode deletar', 'nao tenho interesse', 'nao temos interesse', 'sem interesse', 'nao me interessa', 'nao nos interessa', 'nao quero nao'],
    resposta: {
      id: 'objecao-pode-apagar',
      titulo: '"Pode apagar"',
      texto: 'Apagado. Obrigado pelo retorno e bom trabalho!',
      dica: 'Apague mesmo, no mesmo dia.',
      produtos: TODOS,
    },
  },
  {
    id: 'ver-com-socio',
    fala: 'vou ver com o sócio',
    sinais: ['meu socio', 'minha socia', 'meus socios', 'nosso socio', 'nossa socia', 'com o socio', 'com a socia', 'com os socios', 'meu marido', 'minha esposa', 'minha mulher'],
    resposta: {
      id: 'objecao-ver-com-socio',
      titulo: '"Vou ver com o sócio"',
      texto:
        'Claro, decisão assim é bom tomar junto. Duas opções: a gente marca 20 minutos com vocês dois e eu tiro as dúvidas na hora, ou te mando um resumo curto para você repassar. Qual fica melhor? E posso te chamar [dia] para saber o que decidiram?',
      dica: 'Saia sempre com uma data de retorno combinada: sem data, a proposta esfria.',
      produtos: TODOS,
    },
  },
  {
    id: 'ta-caro',
    fala: 'tá caro',
    sinais: ['ta caro', 'esta caro', 'muito caro', 'meio caro', 'bem caro', 'caro demais', 'achei caro', 'salgado', 'muito alto', 'sem verba', 'sem orcamento', 'fora do orcamento', 'orcamento apertado', 'mes apertado'],
    resposta: {
      id: 'objecao-ta-caro',
      titulo: '"Tá caro"',
      texto:
        'Entendo. O valor cobre o site no ar com o endereço de vocês, o perfil do Google revisado e o botão do WhatsApp, com domínio, hospedagem e um ajuste por mês incluídos. E vocês só pagam depois de ver tudo funcionando. Se agora não for o momento, dá para começar por uma parte menor ou retomar mais para frente. O que faz mais sentido para vocês?',
      dica: 'O preço não muda: nada de desconto em troca de depoimento ou de favor, o PRUMO é consultoria e não pede ajuda. No Respondido ou na Fonte, troque a primeira frase pelo que entra no projeto e ofereça um trecho menor (só o Encontrado; na Fonte, começar pelo bloco do Mapa que mais trava). Se escolherem mais tarde, combine a data e anote na Ficha. Nada de prazo inventado para pressionar.',
      produtos: TODOS,
    },
  },
  // As duas do convite para o Mapa (09/10/2026). Só PRUMO: o Mapa é para empresa
  // com equipe, que chega pelo Raio-X do PRUMO ou pela CDL.
  {
    id: 'mapa-e-pago',
    fala: 'isso é pago?',
    sinais: ['isso e pago', 'e pago mesmo', 'tem custo', 'tem algum custo', 'tem algum valor', 'vou ter que pagar', 'preciso pagar', 'e gratis', 'e de graca', 'e gratuito', 'cobra por isso', 'cobram por isso', 'cobram pelo mapa'],
    levaPara: 'mapa',
    resposta: {
      id: 'objecao-mapa-e-pago',
      titulo: '"Isso é pago?"',
      texto: `${FRASE_MAPA_E_GRATIS} O documento fica com vocês de qualquer jeito, contratando ou não. Consegue responder as 16 perguntas até [dia]?`,
      dica: 'O Mapa é gratuito; não confundir com a Fonte. Se perguntarem pela Fonte, informar a base vigente e esclarecer o escopo, sem impor Mapa prévio.',
      produtos: PRUMO,
    },
  },
  {
    id: 'sem-tempo',
    fala: 'não tenho tempo',
    sinais: ['nao tenho tempo', 'sem tempo', 'falta de tempo', 'muito corrido', 'ta corrido', 'esta corrido', 'correria', 'agora nao da', 'agora nao consigo'],
    levaPara: 'mapa',
    resposta: {
      id: 'objecao-sem-tempo',
      titulo: '"Não tenho tempo"',
      texto: 'Entendo, e é justamente disso que o Mapa trata: o que hoje só anda com você. São uns 10 minutos, de marcar, e dá para responder pelo celular numa brecha. Se esta semana não der, te chamo de novo em [dia]. Pode ser?',
      dica: 'Uma tentativa só: combine a data, anote na Ficha e não insista além disso.',
      produtos: PRUMO,
    },
  },
]

/** O que mandar à CDL (por ela o associado pode entrar direto no Mapa) e ao associado que vier dela. */
export const CDL: Trecho[] = [
  {
    id: 'cdl-conversa',
    titulo: 'CDL · pedir uma conversa',
    texto:
      'Olá! Sou o Rômulo, fundador do Prumo, aqui do Espírito Santo. Quero oferecer aos associados uma análise gratuita de como a empresa aparece no Google, com pontos para facilitar o contato dos clientes. Nós preparamos tudo com dados públicos.\n\nQuem cuida de ações para os associados na CDL?',
    dica: 'O raio-x grátis é o que a CDL ganha para oferecer; você ganha o selo de confiança e a lista de associados.',
    produtos: PRUMO,
  },
  {
    id: 'cdl-depois-do-sim',
    titulo: 'CDL · depois do sim',
    texto:
      'Obrigado pela conversa! Como combinamos: para cada associado que quiser, faço um raio-x grátis de como a empresa aparece no Google. Se puderem divulgar, eu cuido do resto e te mando um resumo de quem participou.',
    dica: 'Só a partir daqui use "parceiro da [nome da CDL]" com os associados.',
    produtos: PRUMO,
  },
  {
    id: 'cdl-associado',
    titulo: 'Associado que veio pela CDL',
    texto:
      'Oi [nome]! Sou o Rômulo, do Prumo, parceiro da [nome da CDL]. Estamos oferecendo aos associados uma análise gratuita de como a empresa aparece no Google e de como facilitar o contato dos clientes. Usamos dados públicos, sem formulário para vocês.\n\nPosso preparar a da sua empresa?',
    dica: 'A conversa segue pela necessidade confirmada. Raio-X e Mapa são opcionais; parceria não autoriza envio indiscriminado.',
    produtos: PRUMO,
  },
]

// ------------------------------------------------------------------ preenchimento

/** O que a colinha lê do lead (um pedaço de CrmLead, para o teste montar à mão). */
export interface LeadDaColinha {
  /** Plus recebe a resposta da oferta concreta, não o preço do Site por padrão. */
  plus?: { oferta: 'site' | 'prumo' | 'iris' | 'estampa' }
  produto: CrmProduto
  etapa: CrmEtapa
  /** PRUMO `diagnostico`: o dono respondeu as 16 perguntas, é hora da devolutiva do Mapa. */
  sinal?: CrmSinal
  empresa: string
  resposta?: { tipo: CrmTipoDeResposta; trecho: string }
  links: { whatsapp?: string; site?: string; raioX?: string }
  /** Site: a variação da primeira mensagem (`mensagem: 'C'` = recebeu o raio-x). */
  abordagem?: { mensagem?: string }
  /**
   * A empresa tem equipe? Informação de contexto; não decide sozinha convite para o Mapa.
   * O CRM ainda não sabe (a planilha não tem porte): ausente, o convite aparece e
   * a dica diz o filtro, para o Rômulo decidir; `false` o esconde.
   */
  equipe?: boolean
}

/** Marcador que fica no texto quando o lead não tem demo: o Rômulo vê que falta. */
export const SEM_LINK = '[link do demo]'
/** O mesmo para o PRUMO: sem Raio-X publicado, a mensagem não sai pronta. */
export const SEM_RAIO_X = '[link do Raio-X]'

/** {NOME}, {ARTIGO}, {O_A}, {URL} e {RAIO_X} com os dados do lead; sem lead (a página), os marcadores ficam. */
export function preencher(texto: string, lead?: Pick<LeadDaColinha, 'empresa' | 'links'>): string {
  if (!lead) return texto
  const nome = lead.empresa.trim()
  return texto
    .split('{ARTIGO}').join(artigoDe(nome))
    .split('{O_A}').join(artigoDe(nome) === 'da' ? 'a' : 'o')
    .split('{NOME}').join(nome)
    .split('{URL}').join(lead.links.site?.trim() || SEM_LINK)
    .split('{RAIO_X}').join(lead.links.raioX?.trim() || SEM_RAIO_X)
    .split('{DETALHE}').join('')
}

/** O wa.me do lead com o texto pronto; vazio sem número. */
export function linkDoWhatsApp(whatsapp: string | undefined, texto: string): string {
  const numero = /wa\.me\/(\d+)/.exec(whatsapp ?? '')?.[1]
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : ''
}

/** Minúsculo e sem acento, para casar os sinais das objeções. */
export function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ')
}

/** As objeções que a resposta do lead traz, na ordem de OBJECOES. */
export function objecoesNoTexto(texto: string | undefined): Objecao[] {
  const t = normalizar(texto ?? '')
  if (!t.trim()) return []
  return OBJECOES.filter((o) => o.sinais.some((s) => t.includes(s)))
}

export const objecao = (id: IdDaObjecao): Objecao => OBJECOES.find((o) => o.id === id)!
export const passo = (momento: Momento): PassoDoRoteiro => ROTEIRO.find((p) => p.momento === momento)!

/** Todo "R$ …" de um texto, como aparece ("R$ 2.400"). */
export function precosNoTexto(texto: string): string[] {
  // Milhar só em grupos de 3: "[\d.]*" engolia o ponto final ("R$ 690." no fim da frase).
  return texto.match(/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d+)?/g) ?? []
}

// ------------------------------------------------------------------ o que serve para um lead

export interface ColinhaDoLead {
  /** Por que estes trechos, numa frase ("Respondeu negativa: 'já temos site'"). */
  motivo: string
  /** Objeções com resposta pronta, a reconhecida no texto primeiro. */
  objecoes: Objecao[]
  /** Momentos do roteiro que servem agora, só com os trechos do produto do lead. */
  momentos: PassoDoRoteiro[]
}

// Recebeu a C = foi convidado para o raio-x (o mesmo recebeuC de server/site-mensagem.ts). Sem o
// link na planilha, o texto mostra "[link do Raio-X]": melhor o Rômulo ver que falta que mandar o site.
const recebeuRaioX = (lead: LeadDaColinha) => lead.produto === 'site' && ['C', 'D'].includes((lead.abordagem?.mensagem ?? '').trim())
// Onde está o demo de quem recebeu a C (Trecho.demo): o Raio-X avulso é de quem não tinha demo no contato.
const lugarDoDemo = (lead: LeadDaColinha): Trecho['demo'] =>
  !raioXAvulso(lead.links.raioX) ? 'junto' : lead.links.site?.trim() ? 'depois' : 'sem'
const doLead = (p: PassoDoRoteiro, lead: LeadDaColinha): PassoDoRoteiro => ({
  ...p,
  trechos: p.trechos.filter((t) => t.produtos.includes(lead.produto) && (t.raioX === undefined || t.raioX === recebeuRaioX(lead))
    && (t.demo === undefined || !recebeuRaioX(lead) || t.demo === lugarDoDemo(lead))),
})
const temConteudo = (p: PassoDoRoteiro) => p.trechos.length > 0 || (p.perguntas?.length ?? 0) > 0

function unicas(lista: Objecao[]): Objecao[] {
  return lista.filter((o, i) => lista.findIndex((x) => x.id === o.id) === i)
}

/** Objeções de preço são da oferta discutida. Valores vêm só da tabela correspondente. */
export function objecaoDaOferta(o: Objecao, lead: Pick<LeadDaColinha, 'produto' | 'plus'>): Objecao {
  if (o.id !== 'quanto-custa' && o.id !== 'ta-caro') return o
  const produto = lead.produto === 'plus' ? lead.plus?.oferta : lead.produto
  if (produto === 'site') return o
  let texto: string
  if (produto === 'iris') texto = o.id === 'quanto-custa'
    ? `${textoDasFaixasIris()} O total depende de quantas fichas ficam ativas no mês. Quantas vocês têm hoje?`
    : 'Entendo. A Iris atende a governança da clínica e reúne as anotações das sessões para a reavaliação. O valor acompanha as fichas ativas do mês. Podemos conferir a quantidade e o trabalho que isso resolve antes de decidir?'
  else if (produto === 'prumo') texto = o.id === 'quanto-custa'
    ? `Raio-X e Mapa são gratuitos. Para implantação de atendimento, a base é ${precoDaTabela(CARDAPIO.find(s => s.id === 'respondido')!)}; Fonte: ${precoDaTabela(CARDAPIO.find(s => s.id === 'fonte')!)}. Qual dessas entregas você quer avaliar? O valor fechado depende do escopo, sem exigir diagnóstico ou reunião.`
    : 'Entendo. Vamos conferir o problema que precisa ser resolvido e o que entra na proposta. Qual parte parece maior do que o resultado esperado?'
  else if (produto === 'estampa') texto = o.id === 'quanto-custa'
    ? 'O preço do sistema para estamparia ainda precisa ser definido. Primeiro quero entender os pedidos, a equipe e o que precisa ficar organizado. Podemos ver isso por dez minutos?'
    : 'Antes de comparar valores, precisamos confirmar o escopo e o preço do sistema de estamparia. Qual parte da organização dos pedidos mais pesa hoje?'
  else texto = 'Qual solução vocês estão considerando? Confirmo o escopo e o preço correspondente antes de preparar a proposta.'
  return { ...o, levaPara: undefined, resposta: { ...o.resposta, produtos: [lead.produto], texto, dica: 'Use a oferta deste lead. Sem desconto, promessa ou preço de outra solução.' } }
}

/**
 * O que a ficha mostra: o momento da conversa sai da etapa e do tipo da última
 * resposta; a objeção sai do texto da resposta (o n8n classifica o tipo, a
 * colinha reconhece a frase). Resposta negativa sem frase reconhecida mostra
 * todas as objeções: melhor o Rômulo escolher que a colinha calar.
 */
export function colinhaDoLead(lead: LeadDaColinha): ColinhaDoLead {
  const tipo = lead.resposta?.tipo
  const reconhecidas = objecoesNoTexto(lead.resposta?.trecho)
  const prumo = lead.produto === 'prumo'
  if (tipo === 'exclusao') return { motivo: 'Interromper contato e seguir o procedimento de exclusão e proteção dos dados.', objecoes: [objecao('pode-apagar')], momentos: [] }
  if (lead.etapa === 'perdido') return { motivo: 'Cadastro encerrado: nada a mandar; revisão interna não autoriza contato.', objecoes: [], momentos: [] }
  if (tipo === 'negativa' && !reconhecidas.some(o => ['quanto-custa', 'ta-caro', 'ver-com-socio'].includes(o.id))) return { motivo: 'Respeitar a recusa, sem nova abordagem ou troca automática de oferta.', objecoes: [], momentos: [] }
  let momentos: Momento[] = []
  let objecoes: Objecao[] = reconhecidas
  let motivo = ''

  switch (lead.etapa) {
    case 'novo':
      momentos = []
      motivo = 'Primeiros contatos automáticos bloqueados. Roteiros antigos são referência histórica, não autorização de abordagem.'
      break
    case 'contato':
      if (prumo && lead.sinal === 'diagnostico' && tipo !== 'negativa') {
        momentos = ['mapa']
        motivo = 'Respondeu as 16 perguntas: mande o Mapa pronto e marque a devolutiva de 45 minutos.'
      } else if (tipo === 'interesse') {
        momentos = ['pode-mandar', 'conversa']
        motivo = 'Atender o pedido e confirmar necessidade e escopo. Interesse não comprova compra nem exige Mapa ou proposta imediata.'
      } else if (tipo === 'licenca') {
        // 17/10/2026 (a Baobá): "pode enviar sim" ao material oferecido é licença, não "quero ver". O
        // trecho é o material solicitado; pergunta de preço recebe resposta direta.
        momentos = ['pode-mandar']
        motivo = 'Entregar só o material solicitado. Se perguntar preço, responder diretamente; permissão não confirma compra.'

      } else if (tipo === 'negativa') {
        objecoes = reconhecidas.filter(o => o.id === 'quanto-custa' || o.id === 'ta-caro' || o.id === 'ver-com-socio')
        motivo = 'Respeitar a recusa. Esclarecer somente uma pergunta concreta, sem oferecer outro serviço ou insistir.'
      } else if (tipo === 'neutra') {
        momentos = ['conversa']
        motivo = 'Respondeu sem sim nem não: siga a conversa.'
      } else {
        momentos = []
        motivo = 'Sem resposta humana confirmada: aguardar ou conferir o próximo passo combinado; não recomendar follow-up pelo silêncio.'
      }
      break
    case 'proposta':
      momentos = ['proposta', 'fechamento']
      objecoes = [...reconhecidas, objecao('ta-caro'), objecao('ver-com-socio')]
      motivo = 'Proposta na mesa: as objeções de preço e de decisão, e como fechar.'
      break
    case 'ganho':
      momentos = ['fechamento']
      motivo = 'Ganho: o que combinar agora.'
      break
  }

  // O convite para o Mapa vem com as duas objeções dele à mão, depois da reconhecida no texto.
  if (momentos.includes('convite-mapa')) objecoes = [...objecoes, objecao('mapa-e-pago'), objecao('sem-tempo')]

  return {
    motivo,
    objecoes: unicas(objecoes).map(o => objecaoDaOferta(o, lead)).filter((o) => o.resposta.produtos.includes(lead.produto)),
    momentos: momentos.map((m) => doLead(passo(m), lead)).filter(temConteudo),
  }
}
