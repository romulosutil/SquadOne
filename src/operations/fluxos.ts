// Como a operação funciona, para a seção "Como funciona" da home da Central.
// Conteúdo estático e versionado (pedido do Rômulo em 30/09/2026: "para eu
// nunca esquecer"). A verdade continua nas fontes vivas: deploy/dell/README.md,
// deploy/hermes/skills/mapa-do-ecossistema/SKILL.md, o n8n e o status.json.
// Ao mudar um fluxo, mude aqui também.
//
// `verificacao` e `fila` ligam um passo a uma verificação viva do status.json
// (fluxo:<id do n8n>, gerador, prumo-mapa, backup:*, pend:*): a tela mostra "Falhou agora"
// ou "53 esperando" no passo. Id que não existir no retrato não mostra nada.
//
// `trabalhador` (15/10/2026) é o catálogo dos automáticos de cada sala do
// Escritório: src/office/trabalhadores.ts deriva a lista daqui, com o `quando`
// e a `verificacao` do próprio passo, para o Escritório e o Como funciona nunca
// divergirem. Fora do prompt (RULES 26): nada do servidor importa este arquivo.
//
// `blueprint` (16/10/2026, OT-03 "um mapa da operação, não três") liga o passo
// ao cartão do service blueprint (docs/blueprint/servico.json), que é quem
// descreve a esteira por inteiro. Este arquivo, jornada.ts e o blueprint já
// tinham divergido (caçadores "desligados" que estavam ligados, observador que
// "não lia" a aba que lia); com o código, a tela linka o cartão e o teste
// src/operations-mapa-unico.test.ts falha se um código citado aqui sumir de lá.
// Só nos passos em que o cartão é claramente o mesmo trabalho.

export type Onde = 'voce' | 'dell' | 'nuvem' | 'externo'

/** O automático que faz este passo, e a sala (id do domínio) que responde por ele. */
export interface TrabalhadorDoPasso {
  id: string
  nome: string
  /** Id do domínio, que nunca muda (o nome muda no ✎). */
  sala: string
  /** O que ele faz, numa linha. */
  faz: string
  /** Onde roda, para quem for conferir. */
  onde: string
}

export const ROTULO_DO_ONDE: Record<Onde, string> = {
  voce: 'Você',
  dell: 'Dell',
  nuvem: 'Nuvem',
  externo: 'Externo',
}

export interface PassoDoFluxo {
  titulo: string
  texto: string
  onde: Onde
  quando: string
  /** Depende do Rômulo (o resto é automático). */
  comVoce?: boolean
  /** Desvio do caminho principal ("se não responder"). */
  ramo?: string
  verificacao?: string
  fila?: string
  link?: { rotulo: string; url: string }
  trabalhador?: TrabalhadorDoPasso
  /** Código do cartão (ou do passo) no service blueprint, ex.: 'SITE-1-B1'. */
  blueprint?: string
}

/** O service blueprint publicado (docs/blueprint/README.md); o endereço aceita `#<código>`. */
export const BLUEPRINT_URL = 'https://claude.ai/artifact/HHyUrvFAPSHsLZq5ZXmgJh'

export function linkDoBlueprint(codigo: string): string {
  return `${BLUEPRINT_URL}#${encodeURIComponent(codigo)}`
}

/**
 * O código que o "Ver no blueprint" do fluxo abre: o do primeiro passo que cita um (AC-24,
 * 17/10/2026). Eram ~44 selos "Blueprint XX", um por passo, que viravam ruído no meio do
 * passo; os códigos continuam nos passos (o teste do mapa único confere), só a tela mostra um.
 */
export function blueprintDoFluxo(fluxo: Pick<FluxoDaOperacao, 'passos'>): string | null {
  return fluxo.passos.find(p => p.blueprint)?.blueprint ?? null
}

export interface FluxoDaOperacao {
  id: string
  grupo: string
  nome: string
  frase: string
  passos: PassoDoFluxo[]
}

// "Vendas" é o nome do CRM na barra desde 16/10/2026 (glossário do blueprint).
const CRM_SITE = { rotulo: 'Abrir em Vendas', url: '/crm?produto=site' }
const CRM_PRUMO = { rotulo: 'Abrir em Vendas', url: '/crm?produto=prumo' }
const CRM_IRIS = { rotulo: 'Abrir em Vendas', url: '/crm?produto=iris' }
const CRM_ESTAMPA = { rotulo: 'Abrir em Vendas', url: '/crm?produto=estampa' }
const CRM_PLUS = { rotulo: 'Abrir em Vendas', url: '/crm?produto=plus' }
// A revisão dos prospects saiu da A fazer para uma fila própria (OT-05, 16/10/2026).
const triagem = (produto: string) => ({ rotulo: 'Abrir a Triagem', url: `/crm?ver=triagem&produto=${produto}` })

// PRUMO como holding (14/10/2026): o PRUMO fica sob o SquadOne, e as quatro ofertas
// (Site antes da venda, os serviços do PRUMO, Iris e CRM de estamparia) ficam sob o
// PRUMO, no mesmo CRM. Os fluxos delas formam o grupo "PRUMO".
export const FLUXOS: FluxoDaOperacao[] = [
  {
    id: 'site',
    grupo: 'PRUMO',
    nome: 'PRUMO · Site antes da venda',
    frase: 'O Dell acha o negócio e publica o Raio-X dele; o demo só sai quando o lead pede para ver. Você aborda, manda o link e marca o desfecho. Envio, leitura e resposta se marcam sozinhos.',
    passos: [
      { titulo: 'Escolhe os nichos', texto: 'Aba Buscas da planilha "Leads — Site antes da venda": segmento × cidade. Desde 05/10: serviço que se procura no Google (advocacia, contabilidade, desentupidora, indústria, reformas); B2C de vitrine deu 0 interesse. O funil de segunda pausa a busca e o nicho sem sinal de compra.', onde: 'voce', quando: 'quando quiser', comVoce: true, blueprint: 'SITE-1-A2' },
      { titulo: 'Caçador acha o lead', texto: 'n8n 01: Google Places + Gemini. Fica quem tem nota 60 ou mais e WhatsApp; vira linha "novo" na planilha.', onde: 'dell', quando: '06:00', verificacao: 'fluxo:oow8TkxrAf4fVvTj', blueprint: 'SITE-1-B1',
        trabalhador: { id: 'cacador', nome: 'Caçador', sala: 'prumo--prospeccao', faz: 'acha negócios no Google Places e põe na planilha do Site antes da venda os de nota 60 ou mais com WhatsApp', onde: 'n8n 01, no Dell' } },
      { titulo: 'A pasta do lead nasce', texto: 'auto-entrada cria ~/auto-site/<lead> com fotos e content.md.', onde: 'dell', quando: 'na hora', blueprint: 'SITE-1-A3' },
      // Demo sob pedido (14/10/2026): o lead novo do Brasil não ganha mais demo antes de falar; a isca é o Raio-X.
      { titulo: 'Raio-X publicado', texto: 'raio-x.py monta a página do Raio-X a partir do Google Places (sem modelo) e publica na Vercel. Desde 14/10 (demo sob pedido) é só isso que o lead novo do Brasil ganha antes do primeiro contato; o demo espera o "Gerar demo".', onde: 'dell', quando: '11:15 e 17:15', blueprint: 'SITE-2-B2' },
      { titulo: 'Balcão marca "pronto"', texto: 'n8n 03 lê o publicado.json, monta a mensagem, sorteia a letra do A/B e o link de envio.', onde: 'dell', quando: 'de hora em hora (:10)', verificacao: 'fluxo:wjuoIknp2qlWo0QI', blueprint: 'SITE-2-B1',
        trabalhador: { id: 'balcao', nome: 'Balcão', sala: 'prumo--geral', faz: 'lê os Raio-X e sites publicados, monta a mensagem e o link de envio e marca o lead como pronto para abordar', onde: 'n8n 03, no Dell' } },
      { titulo: 'Sites e pendências no WhatsApp', texto: 'Uma mensagem pela fila de avisos (o Hermes entrega): os sites do dia, o que espera você e o link de cada lead enviado ou em conversa.', onde: 'dell', quando: '10:30' },
      { titulo: 'Aborda o lead', texto: 'Pela Próxima venda (na Hoje e em Vendas › A fazer) ou pelo "Envie para X" do Telegram: "Abrir no WhatsApp" mostra e abre a primeira mensagem. Só no expediente (seg a sex, 8h às 17h30, ou com o "Liberar" daquele lead) e no ritmo da trava. Escrever direto ao número do lead também conta como envio.', onde: 'voce', quando: 'no expediente, no ritmo da trava', comVoce: true, fila: 'pend:site-enviar', link: CRM_SITE, blueprint: 'SITE-3-P1' },
      { titulo: 'Envio e leitura se marcam', texto: 'O observador do WhatsApp registra o envio e, quando o lead lê, o visto_em. Quem desliga a confirmação de leitura nunca aparece como lido: é "não sei", não "não viu".', onde: 'dell', quando: 'na hora', verificacao: 'fluxo:fd8gz4uDQkJtEd9W', blueprint: 'SITE-4-B1',
        trabalhador: { id: 'observador', nome: 'Observador do WhatsApp', sala: 'prumo--geral', faz: 'marca sozinho o envio, a leitura e a resposta de cada lead a partir do que o aparelho vinculado recebe', onde: 'n8n "WhatsApp — conversa com lead", no Dell' } },
      { titulo: 'Lead responde', texto: 'Mensagem 5 min ou mais depois do envio preenche respondeu_em, a resposta é classificada (interesse, negativa, exclusão, neutra ou robô) e a pasta vai para _em-conversa. Antes disso é a saudação automática do WhatsApp Business.', onde: 'dell', quando: 'na hora', fila: 'pend:site-resposta', blueprint: 'SITE-4-B2' },
      { titulo: 'Manda o link', texto: 'A 2ª mensagem, com o Raio-X ou o demo, pela Próxima venda ou pela Ficha. O toque anota segunda_enviada; o link visto numa mensagem nossa na conversa também vale.', onde: 'voce', quando: 'em até 2 h depois do "quero ver"', comVoce: true, link: CRM_SITE, blueprint: 'SITE-5-P1' },
      { ramo: 'se pediu para ver o site', titulo: 'Gerar demo', texto: 'O toque em "Gerar demo" na página do lead acorda o gerador: Claude faz o site em 20 a 40 min, publica na Vercel como demo-<lead> e o aviso "Site publicado" chega no WhatsApp. Lead de fora do Brasil segue na fila de sempre das 08:00 (até 4 por dia; com o Dell desligado, roda quando ele liga).', onde: 'dell', quando: 'no toque; 08:00 a fila', verificacao: 'gerador', fila: 'pend:sites-fila', blueprint: 'SITE-5-B1',
        trabalhador: { id: 'gerador', nome: 'Gerador', sala: 'prumo--site-antes-da-venda', faz: 'faz e publica na Vercel o demo de quem pediu para ver ("Gerar demo"); lead de fora do Brasil, na fila das 08:00', onde: 'gerador-de-sites (timer e pedido), no Dell' } },
      // Desde 16/10/2026 quem põe o follow-up na sua frente é a Próxima venda (e o vendedor do Telegram).
      { ramo: 'se não responder', titulo: 'Follow-up no 3º dia', texto: 'O 05 · Acompanhamento aponta o follow-up do 3º dia só para quem leu a primeira (desde 15/10, depois da restrição do WhatsApp); a Próxima venda e o vendedor do Telegram o põem na fila com o texto pronto. O envio é seu.', onde: 'dell', quando: '09:00', verificacao: 'fluxo:4lFlWNGv5KDZytJE', blueprint: 'SITE-6-B1',
        trabalhador: { id: 'acompanhamento', nome: 'Acompanhamento', sala: 'prumo--geral', faz: 'no 3º dia sem resposta aponta o follow-up de quem leu; no 10º, expira o lead', onde: 'n8n 05, no Dell' } },
      { ramo: 'se não responder', titulo: 'Expira no 10º dia', texto: 'Status "expirado". Se o lead responder depois, volta para "enviado".', onde: 'dell', quando: '09:00' },
      { titulo: 'Marca o desfecho', texto: 'Na página do lead (link no CRM e na mensagem das 10:30): Recusou, Fechou ou Desfazer. Planilha e pasta mudam juntas.', onde: 'voce', quando: 'um toque', comVoce: true, verificacao: 'fluxo:Kf5IWNdEFFnuSOy2', link: CRM_SITE, blueprint: 'SITE-7-P1' },
      { ramo: 'se recusou ou expirou', titulo: 'Demo pausado em 15 dias', texto: 'O site sai do ar na Vercel, sem apagar. Desfazer ou uma resposta nova põe de volta.', onde: 'dell', quando: '09:40', blueprint: 'SITE-7-B2' },
      { titulo: 'Conversa, proposta e fechamento', texto: 'Com você. Depois do "gostei", "Mandar a proposta" abre o WhatsApp com a proposta do cardápio e já a marca no CRM; a Ficha guarda nota e próximo passo.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_SITE, blueprint: 'SITE-7-P1' },
      { titulo: 'Funil por nicho', texto:'Toda segunda: sites, envios, respostas e fechamentos por segmento. Pausa a busca (segmento × cidade) e o nicho inteiro com 20+ enviados sem sinal de compra (interesse, pedido de preço, proposta ou ganho; negativa e robô não contam), e a busca com 5+ enviados sem resposta humana. Envio só conta depois de 3 dias. O gerador pula os leads novos do que pausou, e o aviso diz quais nichos pararam e por quê. Religar é TRUE em ativa na aba Buscas.', onde: 'dell', quando: 'segunda 08:00', verificacao: 'fluxo:cn4KcQujNk9CwcN0',
        trabalhador: { id: 'funil-por-nicho', nome: 'Funil por nicho', sala: 'prumo--prospeccao', faz: 'conta envios, respostas e fechamentos por segmento e pausa a busca e o nicho sem sinal de compra', onde: 'n8n 06, no Dell' } },
    ],
  },
  {
    id: 'prumo',
    grupo: 'PRUMO',
    nome: 'PRUMO · Organizar',
    frase: 'Do prospect ao Mapa. O prospect chega pela CDL; o Dell pontua e monta o rascunho; você revisa, convida e conduz.',
    passos: [
      { titulo: 'O prospect chega pela CDL ou pelo Raio-X', texto: 'A empresa com equipe chega pela CDL ou pede o Mapa depois do Raio-X. O caminho é Raio-X, depois o Mapa (grátis) e, só depois dele, a Fonte (09/10). O Lead Scout (convite frio a distribuidoras achadas no Places) está desligado no n8n: 57 convites, 21 respostas de robô e nenhum dono interessado. O fluxo continua lá, inativo.', onde: 'externo', quando: 'quando chegar' },
      { titulo: 'Revisa o prospect', texto: 'Em Vendas › Triagem, fora da A fazer: veja o site e o briefing do CNPJ.', onde: 'voce', quando: 'você decide', comVoce: true, fila: 'pend:prumo-revisar', link: triagem('prumo') },
      { titulo: 'Enviar convite', texto: 'Pela Próxima venda ou pela Ficha, com as mesmas travas de horário e de ritmo do Site: o clique marca "Convite enviado" e abre o WhatsApp com a mensagem. Escrever direto ao dono também conta.', onde: 'voce', quando: 'um clique', comVoce: true, verificacao: 'fluxo:GkgYmWZJ65a2e9XF', blueprint: 'PRUMO-1-P1' },
      { titulo: 'Leitura e resposta se marcam', texto: 'O observador anota "Leu o convite em…" e "Respondeu no WhatsApp em…" na planilha.', onde: 'dell', quando: 'na hora' },
      { ramo: 'se não responder', titulo: 'Manda um lembrete', texto: 'O CRM mostra há quantos dias cada convite espera; o lembrete é com você.', onde: 'voce', quando: 'você decide', comVoce: true, fila: 'pend:prumo-aguardando', link: CRM_PRUMO },
      { titulo: 'Dono responde o formulário', texto: '"Prumo — Roteiro do Mapa", 16 perguntas.', onde: 'nuvem', quando: 'quando ele responder', blueprint: 'PRUMO-3-C1' },
      { titulo: 'Diagnóstico', texto: 'n8n: Índice PRUMO e briefing na planilha, aviso no WhatsApp.', onde: 'dell', quando: 'de hora em hora', verificacao: 'fluxo:b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f', fila: 'pend:prumo-diagnostico', blueprint: 'PRUMO-3-B1',
        trabalhador: { id: 'diagnostico', nome: 'Diagnóstico', sala: 'prumo--organizar', faz: 'fecha o Índice PRUMO com a resposta do dono, grava índice e briefing e avisa', onde: 'n8n, no Dell' } },
      { titulo: 'Rascunho do Mapa em PDF', texto: 'O Dell monta o Mapa de 7 páginas com o que o formulário permite e deixa [PREENCHER] no resto. Fica em ~/prumo-entregas e no Drive (PRUMO/Entregas).', onde: 'dell', quando: 'na hora', verificacao: 'prumo-mapa', blueprint: 'PRUMO-3-B2',
        trabalhador: { id: 'prumo-mapa', nome: 'Rascunho do Mapa', sala: 'prumo--organizar', faz: 'monta o PDF de 7 páginas do Mapa com o que o formulário permite e deixa [PREENCHER] no resto, em ~/prumo-entregas', onde: 'prumo-mapa (unit .path sobre a fila do n8n), no Dell' } },
      { titulo: 'Completa o Mapa e conduz', texto: 'Entrevistas, travas em R$, recomendação, workshop e proposta. prumo-mapa refaz o PDF depois que você edita; "proposta enviada" vai na ficha do CRM.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_PRUMO, blueprint: 'PRUMO-4-P1' },
    ],
  },
  {
    id: 'iris',
    grupo: 'PRUMO',
    nome: 'PRUMO · Iris',
    frase: 'Clínicas de terapia para o Iris. O Dell acha a clínica com WhatsApp no site; você revisa, convida em nome do PRUMO e conduz até o teste.',
    passos: [
      { titulo: 'Nichos e cidades', texto: 'deploy/dell/claude-ops/prumo-ofertas.json: ABA/TEA, multidisciplinar infantil, neuropsicologia, fono, TO e TCC; ES primeiro, depois BH, Rio, São Paulo e Campinas. Uma busca por rodada, em rodízio.', onde: 'voce', quando: 'quando quiser', comVoce: true },
      { titulo: 'Caçador acha a clínica', texto: 'n8n "PRUMO · Iris — Caçador de clínicas": Google Places, depois o site de cada clínica. Fica quem tem WhatsApp publicado no site (celular) e não está em outro funil do PRUMO; sinais como convênio, ABA e equipe ordenam a Prioridade. Até 15 por rodada, na aba Clínicas. Nasceu desligado e foi ligado em 16/10/2026 (dias úteis, 9h); só enche a aba e avisa, nada é enviado. `prumo-ofertas.py --estado` diz se está ligado.', onde: 'dell', quando: 'dias úteis, 9h', verificacao: 'fluxo:QRVkAhJBvBxt9mx8', blueprint: 'OFERTAS-1-B1',
        trabalhador: { id: 'cacador-iris', nome: 'Caçador de clínicas', sala: 'prumo--iris', faz: 'acha no Google Places as clínicas de terapia com WhatsApp no site e põe até 15 por rodada na aba Clínicas', onde: 'n8n "PRUMO · Iris — Caçador de clínicas", no Dell' } },
      { titulo: 'Revisa a clínica', texto: 'Em Vendas › Triagem (filtro Iris), fora da A fazer: veja o site e decida. Sem interesse na Etapa tira a clínica da fila.', onde: 'voce', quando: 'você decide', comVoce: true, link: triagem('iris'), blueprint: 'OFERTAS-2-B1' },
      { titulo: 'Enviar convite', texto: 'O clique abre o WhatsApp com o convite em nome do PRUMO (sem preço e sem link) e marca "Convite enviado". As travas de horário e de ritmo valem igual: o convite é primeiro contato.', onde: 'voce', quando: 'um clique', comVoce: true, verificacao: 'fluxo:mfyO1YAhBrXxe5Mb', blueprint: 'OFERTAS-3-P1' },
      { titulo: 'Resposta se marca', texto: 'Desde 14/10 o observador do WhatsApp lê a aba Clínicas: a resposta é registrada e classificada como a do Site, sem anotar à mão.', onde: 'dell', quando: 'na hora', link: CRM_IRIS, blueprint: 'OFERTAS-4-B1' },
      { ramo: 'se não responder', titulo: 'Um lembrete só', texto: 'No 3º dia o CRM põe o convite em Follow-up para mandar; no 7º sem resposta, vai para Perdido.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_IRIS },
      { titulo: 'Demonstração e teste', texto: 'Demonstração do dossiê com caso fictício (nunca dado de paciente), cadastro da clínica no Iris e "proposta enviada" na ficha do CRM. Clínica pagando: Concluído na Etapa.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_IRIS, blueprint: 'OFERTAS-5-E1' },
    ],
  },
  {
    id: 'estampa',
    grupo: 'PRUMO',
    nome: 'PRUMO · Estamparias',
    frase: 'Estamparias para o CRM de estamparia (white-label do CRM da Silmer). Primeiro provar que alguém quer: conversa, não venda.',
    passos: [
      { titulo: 'Nichos e cidades', texto: 'deploy/dell/claude-ops/prumo-ofertas.json: estamparia, camisetas e uniformes personalizados, silk, sublimação e confecção sob encomenda; ES primeiro. A Silmer, cliente do PRUMO, nunca entra.', onde: 'voce', quando: 'quando quiser', comVoce: true },
      { titulo: 'Caçador acha a estamparia', texto: 'n8n "PRUMO · CRM de estamparia — Caçador de estamparias": a mesma regra do Iris (WhatsApp publicado no site, sem repetir lead de outro funil), na aba Estamparias. Nasceu desligado e foi ligado em 16/10/2026 (dias úteis, 9h); só enche a aba e avisa.', onde: 'dell', quando: 'dias úteis, 9h', verificacao: 'fluxo:6pIzCCmktXAUGOdf', blueprint: 'OFERTAS-1-B1',
        trabalhador: { id: 'cacador-estampa', nome: 'Caçador de estamparias', sala: 'prumo--estamparias', faz: 'acha estamparias e confecções com WhatsApp no site e põe na aba Estamparias, sem repetir lead de outro funil', onde: 'n8n "PRUMO · CRM de estamparia — Caçador de estamparias", no Dell' } },
      { titulo: 'Revisa a estamparia', texto: 'Em Vendas › Triagem (filtro CRM de estamparia), fora da A fazer: veja o site e decida.', onde: 'voce', quando: 'você decide', comVoce: true, link: triagem('estampa'), blueprint: 'OFERTAS-2-B1' },
      { titulo: 'Enviar convite', texto: 'O clique abre o WhatsApp com o convite (organizar os pedidos que chegam pelo WhatsApp) e marca "Convite enviado", dentro das travas de horário e de ritmo. O texto não diz que o CRM já roda num cliente: a Silmer ainda está em homologação.', onde: 'voce', quando: 'um clique', comVoce: true, verificacao: 'fluxo:rNp1Upq53IFIuRwT', blueprint: 'OFERTAS-3-P1' },
      { titulo: 'Resposta e conversa', texto: 'Desde 14/10 o observador lê a aba Estamparias e registra a resposta sozinho. A conversa é com você: 20 minutos sobre como os pedidos chegam hoje. Meta do piloto: 2 conversas em 4 semanas; sem isso, pausa.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_ESTAMPA, blueprint: 'OFERTAS-5-P1' },
      { titulo: 'Só depois: instalar', texto: 'Uma instalação por cliente, depois do CRM da Silmer estável por 30 dias, com contrato e DPA (plano de 13/10, B1 e B2).', onde: 'voce', quando: 'depois do piloto', comVoce: true },
    ],
  },
  {
    // Plus (15/10/2026): não é uma quinta oferta, é um filtro com os melhores leads; cada um anda no funil da oferta dele.
    id: 'plus',
    grupo: 'PRUMO',
    nome: 'PRUMO · Plus',
    frase: 'Os melhores leads, do Catálogo de Negócios Maçônicos. Não há robô: o catálogo é importado à mão, e envio e resposta você anota no CRM.',
    passos: [
      { titulo: 'O catálogo vira leads', texto: 'scripts/plus-importar.ts lê o PDF do catálogo, junta o mesmo WhatsApp num lead só e grava ~/prumo-entregas/plus/leads.json no Dell (nunca no git: são telefones de terceiros). Quem não tem telefone legível fica de fora.', onde: 'dell', quando: 'à mão, a cada catálogo novo', comVoce: true, blueprint: 'OFERTAS-1-B2' },
      { titulo: 'Cada lead ganha a oferta dele', texto: 'Roupa = CRM de estamparia; psicologia e terapia = Iris; com site próprio = serviços PRUMO; o resto = Site. É o texto dessa oferta que ele recebe.', onde: 'dell', quando: 'na importação' },
      { titulo: 'Envia com a saudação', texto: 'Na Hoje (os 10 primeiros Plus, na frente dos do Site) e pela Próxima venda: "Enviar pelo WhatsApp" abre a mensagem ("Meu Ir.\'., tudo bem?…", sem preço e sem link) e anota o envio. Fica fora de "Enviar um por um", e as travas de horário e de ritmo valem igual.', onde: 'voce', quando: 'no expediente, no ritmo da trava', comVoce: true, link: CRM_PLUS, blueprint: 'OFERTAS-3-P1' },
      { titulo: 'Resposta', texto: 'O observador do WhatsApp não lê o Plus: quem responder, anote "Respondeu no WhatsApp" na Ficha (de novo a cada resposta, para recomeçar os 7 dias).', onde: 'voce', quando: 'quando responder', comVoce: true, link: CRM_PLUS, blueprint: 'OFERTAS-4-P1' },
      { ramo: 'se não responder', titulo: 'Follow-up no 3º dia', texto: 'O CRM põe o lead em Follow-up para mandar; 7 dias sem mensagem, vai para Perdido.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_PLUS },
      { titulo: 'Conversa e proposta', texto: 'Segue a jornada da oferta dele: o Raio-X e o Encontrado no Site, o Mapa nos serviços PRUMO, a demonstração no Iris.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_PLUS, blueprint: 'OFERTAS-5-C1' },
    ],
  },
  {
    id: 'crm',
    grupo: 'PRUMO',
    nome: 'Vendas (o CRM do PRUMO)',
    frase: 'Quem viu, quem respondeu e quem recusou, nas ofertas do PRUMO. A planilha é a verdade; Vendas só lê e anota. Abas: A fazer · Triagem · Funil · Números · Roteiro.',
    passos: [
      { titulo: 'Tudo se marca na planilha', texto: 'Cliques nos links, o que você escreve, leitura, resposta, follow-up e desfecho escrevem na planilha sozinhos.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Retrato a cada 10 min', texto: 'O fluxo 08 lê Leads, Prospects, Clínicas, Estamparias e a aba CRM e grava o retrato que a Central mostra. Leitura que falha mantém o último retrato bom (Clínicas e Estamparias não seguram o retrato: viram aviso).', onde: 'dell', quando: 'a cada 10 min', verificacao: 'fluxo:AsjxktRCqRJSmj9P', blueprint: 'SITE-4-B3',
        trabalhador: { id: 'retrato-do-crm', nome: 'Retrato do CRM', sala: 'prumo--geral', faz: 'lê as planilhas das quatro ofertas e a aba CRM e grava o retrato que o CRM e estas salas mostram', onde: 'n8n 08, no Dell' } },
      { titulo: 'A fazer', texto: 'A Próxima venda: uma ação por vez, na ordem de quem está mais perto de comprar (responder, proposta, "o que achou?", follow-up, primeiro contato), com a mensagem pronta. A mesma fila está na Hoje e no "Envie para X" do Telegram (seg a sex, 8h às 17h30).', onde: 'voce', quando: 'quando abrir', comVoce: true, link: { rotulo: 'Abrir Vendas', url: '/crm' }, blueprint: 'SITE-3-B3' },
      { titulo: 'Triagem', texto: 'Os prospects dos caçadores (PRUMO, Iris e estamparias) para revisar, numa fila própria: triagem não é venda e não disputa a A fazer com quem respondeu.', onde: 'voce', quando: 'quando puder', comVoce: true, link: { rotulo: 'Abrir a Triagem', url: '/crm?ver=triagem' }, blueprint: 'OFERTAS-2-B1' },
      { titulo: 'Funil', texto: 'As 5 etapas (Novo, Em contato, Proposta, Ganho, Perdido), ou por passo da jornada, com filtros por oferta (Site, PRUMO, Iris, Estamparias, Plus), nicho e cidade. Em contato sai sozinho para Perdido depois de 7 dias sem mensagem do lead.', onde: 'voce', quando: 'quando quiser', link: { rotulo: 'Ver o funil', url: '/crm?ver=funil' }, blueprint: 'SITE-7-B1' },
      { titulo: 'Números e Roteiro', texto: 'Números: envios, respostas e interesse por nicho, mensagem e horário, abrindo com "Depois do sim". Roteiro: o que dizer em cada momento, objeções e o cardápio.', onde: 'voce', quando: 'quando quiser', link: { rotulo: 'Ver os Números', url: '/crm?ver=numeros' } },
      { titulo: 'Ficha e registros', texto: 'Nota, próximo passo com data e "proposta enviada" vão para a aba CRM pelo n8n. Nada é enviado ao lead.', onde: 'voce', quando: 'você decide', comVoce: true },
      { titulo: 'Divergência vira nota', texto: 'Se a planilha e a pasta discordam por mais de 2 h, a ficha mostra. Nada é corrigido sozinho.', onde: 'dell', quando: 'a cada leitura' },
    ],
  },
  {
    id: 'pncp',
    grupo: 'Licitações',
    nome: 'Radar PNCP',
    frase: 'Toda manhã o Dell procura licitações de design e te manda só o que ainda dá tempo de disputar.',
    passos: [
      { titulo: 'n8n dispara a coleta', texto: 'O collector responde na hora e busca em segundo plano.', onde: 'dell', quando: '07:30', verificacao: 'fluxo:c8d62107-67db-4a1e-b6a9-211f9d9ef0df' },
      { titulo: 'Busca no PNCP', texto: 'Filtra, pontua e guarda o relatório.', onde: 'externo', quando: 'em segundo plano', verificacao: 'pncp' },
      { titulo: 'Tira o que vence em menos de 3 h', texto: 'Não chega no resumo; fica só a contagem.', onde: 'dell', quando: 'na coleta' },
      { ramo: 'se a coleta não veio', titulo: 'Repescagem', texto: 'pncp-catchup refaz a coleta, também quando o Dell estava desligado às 07:30.', onde: 'dell', quando: '08:00 ou ao ligar' },
      { titulo: 'Resumo no WhatsApp', texto: 'O Hermes lê o relatório e manda as oportunidades.', onde: 'dell', quando: '08:00' },
      { titulo: 'Monta o dossiê do edital', texto: 'Matriz do edital e proposta em ~/Licitacoes.', onde: 'voce', quando: 'você decide', comVoce: true },
    ],
  },
  {
    id: 'alertas',
    grupo: 'Operação do Dell',
    nome: 'Alertas e saúde',
    frase: 'Um monitor confere tudo a cada minuto. Vermelho é "você precisa agir"; amarelo, "vale olhar"; o que resolve sozinho diz quando.',
    passos: [
      { titulo: 'O monitor confere o Dell', texto: 'Serviços, fluxos do n8n, containers, rotinas do Hermes, gerador, backup, radar e filas. Grava o retrato desta página.', onde: 'dell', quando: 'a cada minuto', verificacao: 'monitor' },
      { titulo: 'Cada alerta diz o que fazer', texto: 'Em "Precisa de você", com o link que resolve. Fluxo de clique não é cobrado por não rodar; horário perdido com o Dell desligado resolve sozinho.', onde: 'dell', quando: 'a cada minuto' },
      { titulo: 'Falha de um fluxo do n8n', texto: 'Cai no "00 · Avisar falha" e entra na fila de avisos.', onde: 'dell', quando: 'na hora', verificacao: 'fluxo:5FlXnne7lTMihLic' },
      // 16/10/2026 (OT-14): o número do Hermes é o que fala com os leads e levou restrição de 24 h em 15/10.
      { titulo: 'Socorro tenta primeiro', texto: 'Falha nova: o socorro religa a unit ou o container da lista branca (2 vezes por falha a cada 6 h) e, se não resolver, o Hermes diagnostica, sem terminal.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Aviso no Telegram', texto: 'Só o vermelho, pelo bot do Telegram (sem som das 22h às 7h): quando quebra, a cada 12 h enquanto continuar e quando volta. Vem com o que fazer e o link desta Central. Só cai no WhatsApp se o bot falhar.', onde: 'dell', quando: 'na hora', blueprint: 'AGENDA-4-A1' },
      { titulo: 'O healthwatch religa o que cair', texto: 'Hermes, Central, n8n e code-server.', onde: 'dell', quando: 'a cada 30 s' },
      { titulo: 'Resolve ou pede ao Claude', texto: 'O "o que fazer" diz quando é com você (ex.: reconectar o Google) e quando é pedir ao Claude, com a frase pronta.', onde: 'voce', quando: 'quando avisar', comVoce: true },
    ],
  },
  {
    id: 'backup',
    grupo: 'Operação do Dell',
    nome: 'Backup no Drive',
    frase: 'Desde 29/09 existe cópia fora do Dell: um espelho legível no Drive e um cofre cifrado que refaz o Dell.',
    passos: [
      { titulo: 'Espelho dos sites', texto: '~/auto-site → Drive "PRUMO/Sites antes da venda". Espera o gerador terminar de escrever.', onde: 'dell', quando: 'de hora em hora (:05)', verificacao: 'backup:sites' },
      { titulo: 'Espelho do PRUMO e dos Mapas', texto: '~/prumo → "PRUMO/Consultoria"; ~/prumo-entregas → "PRUMO/Entregas".', onde: 'dell', quando: 'uma vez por dia', verificacao: 'backup:entregas' },
      { titulo: 'Cofre cifrado', texto: 'restic com a home, o banco do n8n e o Hermes → "Backups/dell-worker". Com o Dell desligado às 03:30, roda quando ele liga.', onde: 'dell', quando: '03:30', verificacao: 'backup:cofre' },
      { titulo: 'Estrutura no Drive', texto: 'O mapa e as configurações da Mel e do PC, sem segredo (manifesto, projetos, units, compose, fluxos do n8n) → pasta "Estrutura". Um filtro esconde os valores e a coleta falha se um segredo conhecido aparecer.', onde: 'dell', quando: 'todo dia às 4h', verificacao: 'backup:estrutura' },
      { titulo: 'Ensaio de restauração', texto: 'Restaura numa pasta à parte e prova que o n8n abre.', onde: 'dell', quando: 'mensal', verificacao: 'backup:ensaio' },
      { titulo: 'Google conectado', texto: 'O backup tem conexão própria com o Drive (rclone). Se o Google desconectar, o alerta traz o comando para reconectar.', onde: 'voce', quando: 'se desconectar', comVoce: true },
      { titulo: 'Guarda o kit de recuperação', texto: 'Uma vez: copie ~/.config/backup-dell/KIT-DE-RECUPERACAO.txt para o gerenciador de senhas e para o papel, depois apague o arquivo.', onde: 'voce', quando: 'uma vez', comVoce: true },
    ],
  },
  {
    id: 'whatsapp',
    grupo: 'Operação do Dell',
    nome: 'O que chega no WhatsApp e no Telegram',
    frase: 'O Hermes é o secretário: informa e não manda nada a lead. O WhatsApp dele é o mesmo número que fala com os leads; desde 16/10/2026 o que é pessoal (lembretes, finanças, falhas do Dell) e o vendedor vão pelo bot do Telegram.',
    passos: [
      { titulo: 'Radar de licitações', texto: 'Resumo do PNCP.', onde: 'dell', quando: '08:00' },
      { titulo: 'Funil por nicho', texto: 'Só às segundas.', onde: 'dell', quando: 'segunda 08:00' },
      { titulo: 'Visão semanal de receita', texto: 'Lê ~/renda-2026 e o PRUMO.', onde: 'dell', quando: 'segunda 08:30' },
      { titulo: 'ASMR: conceito do dia', texto: 'Briefing de prompt tátil.', onde: 'dell', quando: '09:00' },
      { titulo: 'ASMR: revisão 24/48 h', texto: 'Decisão editorial com os números do canal.', onde: 'dell', quando: '09:30' },
      { titulo: 'Demos pausados', texto: 'Quando um demo sai do ar, 15 dias depois de recusar ou expirar.', onde: 'dell', quando: '09:40' },
      { titulo: 'Sites e pendências', texto: 'Os sites do dia, o que espera você e o link de cada lead.', onde: 'dell', quando: '10:30' },
      { titulo: '"Registrado: você abordou…"', texto: 'Quando você escreve a um lead novo, juntando o que acontecer em 5 min.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Avisos a qualquer hora', texto: 'Site publicado, rascunho do Mapa e os avisos dos fluxos do n8n e dos scripts do Dell. O P0 vai aos dois canais.', onde: 'dell', quando: 'na hora' },
      { titulo: 'No Telegram: o vendedor', texto: '"Envie para X" com "Abrir no WhatsApp", "Enviei" e "Pular", um aviso por vez, na ordem da Próxima venda (o follow-up do 3º dia entra aqui). Nada sai ao lead sem o seu toque.', onde: 'dell', quando: 'seg a sex, 8h às 17h30', blueprint: 'SITE-3-B3' },
      { titulo: 'No Telegram: lembretes e finanças', texto: 'O lembrete da agenda e o alerta de finanças, sem som das 22h às 7h. A fila do WhatsApp fica só de reserva, se o bot falhar.', onde: 'dell', quando: 'na hora', blueprint: 'AGENDA-4-E1' },
      { titulo: 'No Telegram: falhas do Dell', texto: 'O "Quebrou / Continua fora / Voltou ao normal" do monitor e o aviso do socorro.', onde: 'dell', quando: 'na hora', blueprint: 'AGENDA-4-A1' },
    ],
  },
  {
    id: 'entrada',
    grupo: 'Operação do Dell',
    nome: 'Entrada para o Hermes',
    frase: 'Uma página privada onde você manda texto e arquivos e o Hermes arruma. Segredo nunca chega ao modelo.',
    passos: [
      { titulo: 'Você manda', texto: 'No menu "Entrada" da Central (logo abaixo de CRM), com três botões: guardar no cofre, organizar ou só guardar sem IA.', onde: 'voce', quando: 'quando quiser', comVoce: true, link: { rotulo: 'Abrir a Entrada', url: '/entrada/' } },
      { titulo: 'O filtro olha primeiro', texto: 'Chave, senha, token ou chave privada no que você mandou para organizar: bloqueia e pede o cofre. O código decide, antes de qualquer modelo.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Cofre', texto: 'Cifra com age para a Mel e para você; o valor nunca volta à página. Ler só no terminal da Mel (cofre ler), com confirmação.', onde: 'dell', quando: 'na hora' },
      { titulo: 'O Hermes organiza', texto: 'Só se a fila tem algo (fila vazia não gasta token). O modelo, sem ferramentas, propõe um plano; um executor com lista de permissão arruma em ~/Mel/Entrada/organizado ou em ~/Arquivo/<dia>, sem apagar nem sobrescrever.', onde: 'dell', quando: 'a cada 5 min' },
      { titulo: 'Resumo no WhatsApp', texto: 'Só o que mudou.', onde: 'dell', quando: 'na hora' },
    ],
  },
  {
    id: 'codigo',
    grupo: 'Operação do Dell',
    nome: 'Código e Central',
    frase: 'O Claude edita no próprio Dell e o GitHub é a fronteira. O que sai da main se atualiza sozinho.',
    passos: [
      { titulo: 'Pede ao Claude', texto: 'Claude no próprio Dell, nos clones ~/SquadOne, ~/prumo e ~/crm-silmer.', onde: 'voce', quando: 'você decide', comVoce: true },
      { titulo: 'Commit e push na main', texto: 'GitHub romulosutil/*.', onde: 'nuvem', quando: 'fim da tarefa' },
      { titulo: 'Easypanel publica a reserva', texto: 'A cópia fria do SquadOne implanta sozinha, travada e sem Telegram: é a volta se o Dell morrer.', onde: 'nuvem', quando: 'no push', verificacao: 'squadone-app' },
      { titulo: 'A Central se atualiza', texto: 'atualizar-central confere a main e reconstrói só quando ela andou.', onde: 'dell', quando: 'a cada 10 min' },
      { titulo: 'Grafo dos projetos', texto: 'Um timer do Dell mantém um clone raso de cada repositório do GitHub e roda o graphify em todos. O PC puxa os grafos por SSH.', onde: 'dell', quando: '03:00' },
      { titulo: 'Central no celular', texto: 'Pela tailnet, com o Tailscale ligado no celular (porta 8443).', onde: 'voce', quando: 'quando quiser' },
    ],
  },
  {
    id: 'agenda',
    grupo: 'Pessoal',
    nome: 'Agenda e agentes',
    frase: 'Uma frase vira evento no Google Calendar e lembrete no Telegram. Os agentes do SquadOne, no Dell, decidem quem cuida.',
    passos: [
      { titulo: 'Manda a demanda', texto: 'Pelo SquadOne ou pelo Telegram (texto ou áudio), que o Dell busca sozinho. Com /p na frente, vai direto para a squad PRUMO.', onde: 'voce', quando: 'quando quiser', comVoce: true, blueprint: 'AGENDA-1-C1' },
      { titulo: 'O agente certo decide', texto: 'Squads e pessoas do SquadOne viram o prompt; o Gemini escolhe a intenção, uma chamada por turno.', onde: 'externo', quando: 'na hora', link: { rotulo: 'Agentes do SquadOne', url: '/squadone' }, blueprint: 'AGENDA-2-B1' },
      { titulo: 'O servidor escolhe o horário', texto: 'Foco, prazo ou baixa prioridade, na grade de 15 min.', onde: 'dell', quando: 'na hora', blueprint: 'AGENDA-3-B1' },
      { titulo: 'Calendar e Tasks', texto: 'Eventos e passos na lista da squad.', onde: 'externo', quando: 'na hora', blueprint: 'AGENDA-3-A1' },
      // Sem a verificação da sessão do WhatsApp desde 16/10/2026: o lembrete não depende mais dela.
      { titulo: 'Lembrete no Telegram', texto: 'Pelo bot do Telegram, 10 min antes de cada bloco e prazo, sem som das 22h às 7h (desde 16/10/2026, fora do número que fala com os leads). Só cai na fila do WhatsApp se o bot falhar.', onde: 'voce', quando: '10 min antes', blueprint: 'AGENDA-4-E1' },
    ],
  },
]

/**
 * O fluxo e o passo pedidos no endereço (?fluxo=iris&passo=1), vindos do robô de
 * uma sala do Escritório. Fluxo desconhecido = null (a aba guardada vale); passo
 * fora do fluxo = só a aba.
 */
export function fluxoDoEndereco(busca: string): { fluxo: string; passo: number | null } | null {
  const q = new URLSearchParams(busca)
  const fluxo = FLUXOS.find(f => f.id === q.get('fluxo'))
  if (!fluxo) return null
  const n = Number(q.get('passo') ?? NaN)
  return { fluxo: fluxo.id, passo: Number.isInteger(n) && n >= 0 && n < fluxo.passos.length ? n : null }
}

export interface HoraDoDia {
  hora: string
  itens: Array<{ onde: Onde; titulo: string; nota: string }>
}

export const UM_DIA: HoraDoDia[] = [
  { hora: '03:00', itens: [{ onde: 'dell', titulo: 'Grafo dos projetos', nota: 'timer · graphify' }] },
  { hora: '03:30', itens: [{ onde: 'dell', titulo: 'Cofre cifrado do backup', nota: 'restic → Drive; desligado, roda ao ligar' }] },
  { hora: '06:00', itens: [{ onde: 'dell', titulo: 'Caçador', nota: 'Site antes da venda; perdido se o Dell estiver desligado' }] },
  { hora: '07:30', itens: [{ onde: 'dell', titulo: 'Coleta do radar PNCP', nota: 'n8n → collector' }] },
  {
    hora: '08:00',
    itens: [
      { onde: 'dell', titulo: 'Gerador de sites', nota: 'só lead de fora do Brasil, até 4; o "Gerar demo" roda na hora; desligado, roda ao ligar' },
      { onde: 'dell', titulo: 'Repescagem do PNCP', nota: 'só se a das 07:30 não veio' },
      { onde: 'dell', titulo: 'Radar de licitações no WhatsApp', nota: 'Hermes' },
      { onde: 'dell', titulo: 'Funil por nicho', nota: 'só segunda' },
    ],
  },
  { hora: '08:30', itens: [{ onde: 'dell', titulo: 'Visão semanal de receita', nota: 'só segunda' }] },
  {
    hora: '09:00',
    itens: [
      { onde: 'dell', titulo: 'Acompanhamento dos leads', nota: 'aponta o follow-up do 3º dia (só de quem leu), expira no 10º' },
      { onde: 'dell', titulo: 'Caçadores de clínicas e de estamparias', nota: 'só dias úteis; enchem a Triagem' },
      { onde: 'dell', titulo: 'ASMR: conceito do dia', nota: 'Hermes' },
    ],
  },
  { hora: '09:30', itens: [{ onde: 'dell', titulo: 'ASMR: revisão 24/48 h', nota: 'Hermes' }] },
  { hora: '09:40', itens: [{ onde: 'dell', titulo: 'Pausa dos demos', nota: '15 dias depois de recusar ou expirar' }] },
  { hora: '10:30', itens: [{ onde: 'dell', titulo: 'Sites e pendências', nota: 'a mensagem do dia com o que espera você' }] },
  { hora: '11:15', itens: [{ onde: 'dell', titulo: 'Raio-X dos leads prontos', nota: 'raio-x.py, Places sem modelo' }] },
  { hora: '17:15', itens: [{ onde: 'dell', titulo: 'Raio-X dos leads prontos', nota: 'a segunda rodada do dia' }] },
]

export const O_TEMPO_TODO: Array<{ quando: string; texto: string }> = [
  { quando: 'a cada minuto', texto: 'O monitor do Dell: esta página e os avisos' },
  { quando: 'a cada 10 min', texto: 'Retrato do CRM; a Central confere a main' },
  { quando: 'de hora em hora', texto: 'Balcão (:10), espelho dos sites (:05), página do lead (:20), Diagnóstico do PRUMO, métricas do ASMR' },
  { quando: 'todo dia', texto: 'Espelho do PRUMO e dos Mapas no Drive' },
  { quando: 'na hora', texto: 'Pasta do lead, site publicado, observador do WhatsApp, pastas movidas, rascunho do Mapa, falhas do n8n' },
]

export const DELL_LIGADO = 'O Dell precisa estar ligado. Desligado, o Caçador (06:00), a coleta do PNCP (07:30) e os fluxos de hora em hora não rodam e não se repetem; o gerador, o cofre e a repescagem do PNCP rodam quando ele liga.'
