// Colinha de atendimento do PRUMO (08/10/2026): o que dizer em cada momento da
// conversa com um lead, para o Rômulo atender com a resposta pronta na mão.
// Conteúdo estático e versionado, como fluxos.ts; PURO (sem Vue, sem fetch).
// Fonte: o plano "PRUMO 30 dias" de 08/10/2026, seções 2 a 5
// (https://claude.ai/artifact/4vPw5U3EX4Cz6RutAMkVee). Ao mudar o cardápio ou
// uma mensagem lá, mude aqui também.
//
// As mensagens da esteira automática (segunda mensagem e follow-ups) NÃO são
// copiadas: vêm de server/site-mensagem.ts, o espelho do que o n8n manda. Mudou
// lá, a colinha mostra o texto novo sem editar este arquivo.
//
// Os únicos "R$" daqui são os preços do cardápio (o teste confere): nada de
// finanças pessoais entra no CRM (RULES 24).

import { FOLLOWUP, FOLLOWUP_COM_LINK, SEGUNDA, artigoDe } from '../../server/site-mensagem.ts'
import type { CrmEtapa, CrmProduto, CrmTipoDeResposta } from './types'

// ------------------------------------------------------------------ tipos

export type IdDoServico = 'raio-x' | 'encontrado' | 'respondido' | 'mapa' | 'organizado'

export interface ServicoDoCardapio {
  id: IdDoServico
  nome: string
  /** O que o cliente recebe, dito como o Rômulo diria. */
  entrega: string
  /** "grátis", "R$ 990", "R$ 1.500"… */
  preco: string
  /** "R$ 69/mês" quando há mensalidade. */
  mensal?: string
  /** "abatido do projeto", "paga só depois de ver no ar"… */
  condicao?: string
  /** Para quem oferecer (e quando). */
  paraQuem: string
}

/** Um texto pronto. `texto` vai para o lead; `dica` é só para o Rômulo. */
export interface Trecho {
  id: string
  titulo: string
  /** Mensagem para mandar; {NOME}, {ARTIGO} e {URL} são preenchidos com o lead. */
  texto: string
  dica?: string
  /** Vem da esteira automática (server/site-mensagem.ts): o n8n manda o mesmo texto. */
  esteira?: boolean
  /** Para quais produtos do CRM o trecho serve. */
  produtos: CrmProduto[]
}

export type Momento = 'primeiro-contato' | 'pode-mandar' | 'followup' | 'mapa' | 'proposta' | 'fechamento'

export interface PassoDoRoteiro {
  momento: Momento
  titulo: string
  /** O que este momento precisa conseguir, numa frase. */
  objetivo: string
  trechos: Trecho[]
  /** Roteiro falado (a conversa de 45 min do Mapa): perguntas, não mensagens. */
  perguntas?: string[]
  /** O serviço do cardápio que este momento vende. */
  servico?: IdDoServico
}

export type IdDaObjecao = 'ja-tem-site' | 'ja-tem-agencia' | 'quanto-custa' | 'pode-apagar' | 'ver-com-socio' | 'ta-caro'

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

// Os preços são uma proposta para testar (plano, seção 2), não uma decisão:
// mudou lá, muda aqui e em PRECOS_DO_CARDAPIO.
export const CARDAPIO: ServicoDoCardapio[] = [
  {
    id: 'raio-x',
    nome: 'Raio-X',
    entrega: 'Uma página feita por mim, só com dados públicos: como a empresa aparece no Google, o que já está bom, 3 coisas que mandam cliente para o concorrente e a demonstração do site. O dono não preenche nada.',
    preco: 'grátis',
    paraQuem: 'Todo lead frio, antes do primeiro contato: vai junto do demo. Funciona também com quem já tem site.',
  },
  {
    id: 'encontrado',
    nome: 'Encontrado',
    entrega: 'Site no ar com o endereço da empresa, perfil do Google revisado e botão de WhatsApp. A mensalidade cobre domínio, hospedagem e ajustes.',
    preco: 'R$ 990',
    mensal: 'R$ 69/mês',
    condicao: 'paga só depois de ver no ar',
    paraQuem: 'Quem não tem site, ou tem um que ninguém acha no Google. É o que o demo e a segunda mensagem vendem.',
  },
  {
    id: 'respondido',
    nome: 'Respondido e Acompanhado',
    entrega: 'WhatsApp que responde na hora, faz as primeiras perguntas e marca horário; retorno automático de orçamento parado; painel simples de quem chamou e de quem fechou.',
    preco: 'R$ 2.400',
    mensal: 'R$ 390/mês',
    condicao: 'só depois de uma conversa, nunca no WhatsApp frio',
    paraQuem: 'Quem já tem site e perde cliente no WhatsApp: demora para responder, ninguém responde fora do horário, orçamento pedido que some.',
  },
  {
    id: 'mapa',
    nome: 'Mapa do Cliente',
    entrega: 'Uma conversa de 45 minutos e acesso de leitura ao WhatsApp e às planilhas. Entrega os números: quantos chamam, quanto demoram para ter resposta, quantos fecham, quanto escapa por mês e o que fazer primeiro.',
    preco: 'R$ 1.500',
    condicao: 'abatido do projeto',
    paraQuem: 'O dono que topou conversar e quer ver o tamanho do problema antes de decidir. Cada achado aponta para um serviço do cardápio.',
  },
  {
    id: 'organizado',
    nome: 'Organizado',
    entrega: 'A Fonte: como a empresa vende, compra, entrega e cobra, escrito e validado com o time (num Notion ou num agente com IA). As regras da casa saem da cabeça do dono.',
    preco: 'R$ 6.500',
    paraQuem: 'Associados da CDL onde tudo depende do dono. Chega pela CDL, não pelo frio.',
  },
]

/** Os 3 primeiros clientes de cada serviço: menos, em troca de depoimento em vídeo. */
export const CLIENTE_FUNDADOR =
  'Os 3 primeiros clientes de cada serviço pagam menos (o Encontrado, por exemplo, sai por R$ 690) em troca de um depoimento em vídeo e da permissão para usar o caso.'

/** Todo "R$" que a colinha pode mostrar. Fora desta lista, o teste falha. */
export const PRECOS_DO_CARDAPIO: string[] = ['R$ 990', 'R$ 69', 'R$ 2.400', 'R$ 390', 'R$ 1.500', 'R$ 6.500', 'R$ 690']

const SITE: CrmProduto[] = ['site']
const PRUMO: CrmProduto[] = ['prumo']
const TODOS: CrmProduto[] = ['site', 'prumo']

// Os textos com fonte no plano (primeira B e C, Organizado, objeções "já temos
// site", "já temos agência", "pode apagar", CDL) estão literais; o resto segue o
// mesmo tom. Colchetes ([nota], [nome da CDL]…) o Rômulo completa à mão: só
// {NOME}, {ARTIGO} e {URL} são preenchidos pela colinha.
export const ROTEIRO: PassoDoRoteiro[] = [
  {
    momento: 'primeiro-contato',
    titulo: 'Primeiro contato',
    objetivo: 'Ganhar um "pode mandar" (ou os 20 minutos, no Organizado) com um fato que o dono confere na hora.',
    trechos: [
      {
        id: 'primeira-b',
        titulo: 'Primeira mensagem · B · observação concreta',
        texto:
          'Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Vi a {NOME} no Google: nota [nota] com [avaliações] avaliações, mas quem pesquisa não encontra um site de vocês e acaba indo para quem tem. Montei uma demonstração com as fotos e as avaliações que vocês já têm. Posso te mandar o link?',
        dica: 'Troca o "encontrei vocês" genérico por um fato que o dono confere na hora. Sem nota boa (abaixo de 4,3 ou menos de 15 avaliações), sai a A.',
        produtos: SITE,
      },
      {
        id: 'primeira-c',
        titulo: 'Primeira mensagem · C · Raio-X',
        texto:
          'Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Fiz um raio-x de como a {NOME} aparece para quem procura no Google: o que já está bom e 3 pontos que fazem cliente ir para o concorrente. É uma página só. Posso te mandar?',
        dica: 'A partir da semana 2. Oferece um diagnóstico, não um site: funciona também com quem já tem site.',
        produtos: SITE,
      },
      {
        id: 'primeira-organizado',
        titulo: 'Organizado · primeiro contato vindo da CDL',
        texto:
          'Oi [nome], aqui é o Rômulo, do PRUMO, parceiro da [nome da CDL]. Ajudo donos de [segmento] a responder orçamento no mesmo dia sem precisar aprovar cada preço. Posso te mostrar em 20 minutos como funciona?',
        dica: 'Substitui o convite frio do formulário de 16 perguntas. Só use "parceiro" depois de a CDL aceitar.',
        produtos: PRUMO,
      },
    ],
  },
  {
    momento: 'pode-mandar',
    titulo: 'Depois do "pode mandar"',
    objetivo: 'Mandar o link com o preço junto: quem continua a conversa depois do preço é comprador.',
    servico: 'encontrado',
    trechos: [
      {
        id: 'segunda',
        titulo: 'Segunda mensagem (a da esteira)',
        texto: SEGUNDA,
        esteira: true,
        dica: 'A esteira manda sem o preço. Mandando à mão, junte o trecho de preço logo abaixo.',
        produtos: SITE,
      },
      {
        id: 'segunda-preco',
        titulo: 'Preço do Encontrado (para juntar à segunda)',
        texto:
          'Se gostarem, coloco no ar com o endereço de vocês: R$ 990 e R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando.',
        dica: 'O preço logo de cara separa curiosos de compradores e evita o "quanto custa?" que trava a conversa.',
        produtos: SITE,
      },
    ],
  },
  {
    momento: 'followup',
    titulo: 'Follow-up do 3º dia',
    objetivo: 'Lembrar uma vez, no 3º dia, e deixar a porta aberta para um "não".',
    trechos: [
      {
        id: 'followup-sem-link',
        titulo: 'Ainda sem link',
        texto: FOLLOWUP,
        esteira: true,
        dica: 'O n8n já manda este no 3º dia: confira a conversa antes de mandar de novo.',
        produtos: SITE,
      },
      {
        id: 'followup-com-link',
        titulo: 'Link já enviado',
        texto: FOLLOWUP_COM_LINK,
        esteira: true,
        dica: 'Um follow-up só. Sem resposta depois dele, deixe quieto.',
        produtos: SITE,
      },
      {
        id: 'followup-prumo',
        titulo: 'PRUMO · sem resposta',
        texto:
          'Oi [nome], aqui é o Rômulo de novo, do PRUMO. Ainda faz sentido a gente conversar 20 minutos sobre responder orçamento no mesmo dia? Se não for o momento, é só me dizer que eu não insisto.',
        dica: 'Um só, 3 dias depois do primeiro contato. Sem resposta, deixe quieto.',
        produtos: PRUMO,
      },
    ],
  },
  {
    momento: 'mapa',
    titulo: 'Conversa do Mapa do Cliente (45 min)',
    objetivo: 'Medir em números quanto cliente escapa por mês e sair da conversa com o serviço que fecha o maior vazamento.',
    servico: 'mapa',
    trechos: [
      {
        id: 'mapa-convite',
        titulo: 'Convite para o Mapa',
        texto:
          'Que bom! Antes de te propor qualquer coisa, quero entender como o cliente chega até vocês hoje. É uma conversa de 45 minutos, mais acesso só de leitura ao WhatsApp e às planilhas. No fim, vocês recebem em números quanto cliente escapa por mês e o que resolver primeiro. Custa R$ 1.500, e se a gente seguir com um projeto, esse valor sai do preço dele. Que dia fica bom?',
        dica: 'Só depois de um sim ou de uma conversa, nunca no WhatsApp frio. O valor abatido é o que tira o peso do "pagar para ouvir".',
        produtos: TODOS,
      },
      {
        id: 'mapa-entrega',
        titulo: 'Entrega do Mapa',
        texto:
          'Oi [nome], o Mapa {ARTIGO} {NOME} ficou pronto. O que mais pesa: de cada 10 pessoas que chamam vocês, [quantas] não têm resposta no mesmo dia. Isso dá uns [quantos] clientes por mês indo para outro lugar. Junto vai o que eu faria primeiro e quanto custa. Podemos falar 15 minutos [dia] para eu te mostrar?',
        dica: 'Abra com o maior número. Cada achado aponta para um serviço do cardápio; a proposta vai junto ou em até 24 h.',
        produtos: TODOS,
      },
    ],
    // Cada pergunta leva a um número: é o número que faz o dono decidir, e cada
    // um aponta para um serviço (Encontrado, Respondido, Organizado).
    perguntas: [
      'Numa semana normal, quantas pessoas chamam vocês no WhatsApp ou ligam pedindo informação ou orçamento?',
      'Quando alguém chama, quanto tempo leva até a primeira resposta? E quem responde?',
      'E fora do horário, à noite ou no fim de semana: quem responde? Quantas mensagens chegam assim por semana?',
      'De cada 10 que pedem orçamento, quantos somem sem responder? Alguém volta a chamar essas pessoas?',
      'De cada 10 que chamam, quantos viram cliente?',
      'Quanto vale um cliente para vocês, em média, num serviço?',
      'De cada 10 clientes novos, quantos chegam pelo Google? Quem procura vocês lá, acha?',
      'Para fechar: "Pelo que vocês me contaram, o maior vazamento está em [onde]: uns [quantos] clientes por mês. É isso que o [serviço] resolve. Te mando a proposta até amanhã."',
    ],
  },
  {
    momento: 'proposta',
    titulo: 'Proposta',
    objetivo: 'Mandar a proposta em até 24 h depois do "gostei" ou da conversa: o que entra, quanto custa e quando começa.',
    trechos: [
      {
        id: 'proposta-encontrado',
        titulo: 'Encontrado (depois do "gostei")',
        texto:
          'Que bom que gostaram! Fica assim: coloco o site no ar com o endereço de vocês, reviso o perfil do Google e ponho o botão de WhatsApp. São R$ 990 para colocar no ar e R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando. Posso começar?',
        dica: 'Até 24 h depois do "gostei". Pediram mudança no demo? Faça antes de cobrar.',
        produtos: SITE,
      },
      {
        id: 'proposta-respondido',
        titulo: 'Respondido e Acompanhado (depois de uma conversa)',
        texto:
          'Como conversamos: hoje [o maior vazamento, com o número]. A proposta: o WhatsApp de vocês passa a responder na hora, até fora do horário, faz as primeiras perguntas e marca horário; quem pediu orçamento e sumiu recebe retorno sem vocês precisarem lembrar; e vocês veem num painel simples quem chamou e quem fechou. São R$ 2.400 para montar e R$ 390 por mês. Se fizer sentido, começo [dia].',
        dica: 'Só depois de uma conversa, nunca no WhatsApp frio. Se fez o Mapa, desconte os R$ 1.500 e diga isso no texto.',
        produtos: TODOS,
      },
      {
        id: 'proposta-organizado',
        titulo: 'Organizado (depois da conversa)',
        texto:
          'Como conversamos: hoje [o que só anda com você]. A proposta: escrevo junto com o time como a {NOME} vende, compra, entrega e cobra, e valido com vocês, num Notion ou num agente com IA que o time consulta. Assim o orçamento sai no mesmo dia sem você aprovar cada preço. São R$ 6.500 pelo projeto inteiro. Se fizer sentido, começo [dia].',
        dica: 'Até 24 h depois da conversa. Se fez o Mapa, desconte os R$ 1.500 e diga isso no texto.',
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
        dica: 'Um dia depois da proposta. Sem resposta, um último toque em 3 dias e pronto.',
        produtos: TODOS,
      },
      {
        id: 'fechamento-encontrado',
        titulo: 'Fechou o Encontrado',
        texto:
          'Fechado, obrigado pela confiança! Para colocar no ar preciso só de duas coisas: o endereço que vocês querem (por exemplo, nomedaempresa.com.br) e acesso ao perfil do Google, me adicionando como administrador. Em [dias] está no ar; vocês conferem e só então pagam.',
        dica: 'Pagamento só depois de ver no ar. Cliente fundador? Combine o depoimento em vídeo agora.',
        produtos: SITE,
      },
      {
        id: 'fechamento-projeto',
        titulo: 'Fechou um projeto (Mapa, Respondido ou Organizado)',
        texto:
          'Fechado, obrigado pela confiança! Para começar, marco com vocês [dia e hora] e preciso de acesso de leitura ao WhatsApp e às planilhas. Te mando por aqui o que entra em cada semana, para vocês acompanharem.',
        dica: 'Combine forma e data do pagamento por escrito. Cliente fundador? Combine o depoimento em vídeo e a permissão para contar o caso.',
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
    levaPara: 'respondido',
    resposta: {
      id: 'objecao-ja-tem-site',
      titulo: '"Já temos site"',
      texto: 'Ótimo, então o site não é o problema. Uma pergunta só: quando alguém chama vocês no WhatsApp fora do horário, o que acontece com essa pessoa?',
      dica: 'Leva para o Respondido. Se ele contar que ninguém responde, ofereça o Mapa.',
      produtos: TODOS,
    },
  },
  {
    id: 'ja-tem-agencia',
    fala: 'já temos agência',
    sinais: ['ja temos agencia', 'ja temos uma agencia', 'ja tem agencia', 'ja tem uma agencia', 'ja tenho agencia', 'ja tenho uma agencia', 'trabalhamos com agencia', 'trabalhamos com uma agencia', 'nossa agencia'],
    levaPara: 'respondido',
    resposta: {
      id: 'objecao-ja-tem-agencia',
      titulo: '"Já temos agência"',
      texto: 'Faz sentido. A agência traz o cliente; eu cuido do que acontece depois que ele chama: resposta, retorno e agenda. Se um dia quiser ver como funciona, é só me chamar. Bom trabalho!',
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
        'Para colocar esse site no ar com o endereço de vocês: R$ 990, e depois R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando. Quer que eu coloque?',
      dica: 'Diga o preço na hora, sem rodeio. Lead do PRUMO: o preço sai depois do Mapa (R$ 1.500, abatido do projeto).',
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
        'Entendo. Uma coisa que ajuda: os 3 primeiros clientes de cada serviço entram como fundadores e pagam menos. O Encontrado, por exemplo, sai por R$ 690 em vez de R$ 990 para colocar no ar. Em troca, vocês gravam um depoimento curto em vídeo e me deixam contar o caso. Quer entrar assim?',
      dica: 'Confira se ainda há vaga de fundador (3 por serviço) antes de mandar; no Respondido e no Organizado, combine o desconto na conversa. Nada de prazo inventado para pressionar.',
      produtos: TODOS,
    },
  },
]

/** O que mandar à CDL (o Organizado chega por ela) e ao associado que vier dela. */
export const CDL: Trecho[] = [
  {
    id: 'cdl-conversa',
    titulo: 'CDL · pedir uma conversa',
    texto:
      'Olá, tudo bem? Aqui é o Rômulo, fundador do PRUMO, aqui do Espírito Santo. Ajudo empresas de serviço a não perder cliente entre o Google, o WhatsApp e o orçamento: site, resposta na hora e retorno de orçamento parado. Gostaria de oferecer aos associados um raio-x gratuito de como cada empresa aparece para quem procura no Google. Com quem posso conversar sobre isso?',
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
      'Oi [nome], aqui é o Rômulo, do PRUMO, parceiro da [nome da CDL]. A CDL está oferecendo aos associados um raio-x grátis de como a empresa aparece para quem procura no Google: o que já está bom e 3 pontos que fazem cliente ir para o concorrente. É uma página só, vocês não preenchem nada. Posso fazer o de vocês?',
    dica: 'Do raio-x, a conversa segue para o Mapa ou para o Organizado.',
    produtos: PRUMO,
  },
]

// ------------------------------------------------------------------ preenchimento

/** O que a colinha lê do lead (um pedaço de CrmLead, para o teste montar à mão). */
export interface LeadDaColinha {
  produto: CrmProduto
  etapa: CrmEtapa
  empresa: string
  resposta?: { tipo: CrmTipoDeResposta; trecho: string }
  links: { whatsapp?: string; site?: string }
}

/** Marcador que fica no texto quando o lead não tem demo: o Rômulo vê que falta. */
export const SEM_LINK = '[link do demo]'

/** {NOME}, {ARTIGO} e {URL} com os dados do lead; sem lead (a página), os marcadores ficam. */
export function preencher(texto: string, lead?: Pick<LeadDaColinha, 'empresa' | 'links'>): string {
  if (!lead) return texto
  const nome = lead.empresa.trim()
  return texto
    .split('{ARTIGO}').join(artigoDe(nome))
    .split('{NOME}').join(nome)
    .split('{URL}').join(lead.links.site?.trim() || SEM_LINK)
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
  // Milhar só em grupos de 3: "[\d.]*" engolia o ponto final ("R$ 990." no fim da frase).
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

const doProduto = (p: PassoDoRoteiro, produto: CrmProduto): PassoDoRoteiro => ({ ...p, trechos: p.trechos.filter((t) => t.produtos.includes(produto)) })
const temConteudo = (p: PassoDoRoteiro) => p.trechos.length > 0 || (p.perguntas?.length ?? 0) > 0

function unicas(lista: Objecao[]): Objecao[] {
  return lista.filter((o, i) => lista.findIndex((x) => x.id === o.id) === i)
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
  let momentos: Momento[] = []
  let objecoes: Objecao[] = reconhecidas
  let motivo = ''

  switch (lead.etapa) {
    case 'novo':
      momentos = ['primeiro-contato']
      motivo = 'Ainda sem contato: a primeira mensagem.'
      break
    case 'contato':
      if (tipo === 'interesse') {
        momentos = prumo ? ['mapa', 'proposta'] : ['pode-mandar', 'proposta']
        motivo = 'Respondeu com interesse: mande o próximo passo e já fale de preço.'
      } else if (tipo === 'exclusao') {
        objecoes = [objecao('pode-apagar'), ...reconhecidas]
        motivo = 'Pediu para apagar: agradeça e apague no mesmo dia.'
      } else if (tipo === 'negativa') {
        if (!reconhecidas.length) objecoes = OBJECOES
        motivo = reconhecidas.length ? 'Respondeu negativa: a resposta pronta para o que ele disse.' : 'Respondeu negativa sem objeção reconhecida: escolha a resposta.'
      } else if (tipo === 'neutra') {
        momentos = prumo ? ['mapa'] : ['pode-mandar']
        motivo = 'Respondeu sem sim nem não: siga a conversa.'
      } else {
        momentos = ['followup']
        motivo = tipo === 'bot' ? 'Só o robô respondeu: ninguém leu ainda, vale o follow-up.' : 'Sem resposta ainda: o follow-up.'
      }
      break
    case 'proposta':
      momentos = ['proposta', 'fechamento']
      objecoes = [...reconhecidas, objecao('ta-caro'), objecao('ver-com-socio')]
      motivo = 'Proposta na mesa: as objeções de preço e de decisão, e como fechar.'
      break
    case 'ganho':
      momentos = ['fechamento']
      motivo = 'Fechou: o que combinar agora.'
      break
    case 'perdido':
      if (tipo === 'exclusao') objecoes = [objecao('pode-apagar'), ...reconhecidas]
      motivo = 'Lead encerrado: nada a mandar, a não ser que ele volte a escrever.'
      break
  }

  return {
    motivo,
    objecoes: unicas(objecoes).filter((o) => o.resposta.produtos.includes(lead.produto)),
    momentos: momentos.map((m) => doProduto(passo(m), lead.produto)).filter(temConteudo),
  }
}
