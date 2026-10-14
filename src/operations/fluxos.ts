// Como a operação funciona, para a seção "Como funciona" da home da Central.
// Conteúdo estático e versionado (pedido do Rômulo em 30/09/2026: "para eu
// nunca esquecer"). A verdade continua nas fontes vivas: deploy/dell/README.md,
// deploy/hermes/skills/mapa-do-ecossistema/SKILL.md, o n8n e o status.json.
// Ao mudar um fluxo, mude aqui também.
//
// `verificacao` e `fila` ligam um passo a uma verificação viva do status.json
// (fluxo:<id do n8n>, gerador, prumo-mapa, backup:*, pend:*): a tela mostra "Falhou agora"
// ou "53 esperando" no passo. Id que não existir no retrato não mostra nada.

export type Onde = 'voce' | 'dell' | 'nuvem' | 'externo'

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
}

export interface FluxoDaOperacao {
  id: string
  grupo: string
  nome: string
  frase: string
  passos: PassoDoFluxo[]
}

const CRM_SITE = { rotulo: 'Abrir no CRM', url: '/crm?produto=site' }
const CRM_PRUMO = { rotulo: 'Abrir no CRM', url: '/crm?produto=prumo' }
const CRM_IRIS = { rotulo: 'Abrir no CRM', url: '/crm?produto=iris' }
const CRM_ESTAMPA = { rotulo: 'Abrir no CRM', url: '/crm?produto=estampa' }

// PRUMO como holding (14/10/2026): o PRUMO fica sob o SquadOne, e as quatro ofertas
// (Site antes da venda, os serviços do PRUMO, Iris e CRM de estamparia) ficam sob o
// PRUMO, no mesmo CRM. Os fluxos delas formam o grupo "PRUMO".
export const FLUXOS: FluxoDaOperacao[] = [
  {
    id: 'site',
    grupo: 'PRUMO',
    nome: 'PRUMO · Site antes da venda',
    frase: 'O Dell acha o negócio, faz o site e publica. Você aborda e marca o desfecho. Envio, leitura, resposta e follow-up se marcam sozinhos.',
    passos: [
      { titulo: 'Escolhe os nichos', texto: 'Aba Buscas da planilha "Leads — Site antes da venda": segmento × cidade. Desde 05/10: serviço que se procura no Google (advocacia, contabilidade, desentupidora, indústria, reformas); B2C de vitrine deu 0 interesse. O funil de segunda pausa a busca e o nicho sem sinal de compra.', onde: 'voce', quando: 'quando quiser', comVoce: true },
      { titulo: 'Caçador acha o lead', texto: 'n8n 01: Google Places + Gemini. Fica quem tem nota 60 ou mais e WhatsApp; vira linha "novo" na planilha.', onde: 'dell', quando: '06:00', verificacao: 'fluxo:oow8TkxrAf4fVvTj' },
      { titulo: 'A pasta do lead nasce', texto: 'auto-entrada cria ~/auto-site/<lead> com fotos e content.md.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Gerador faz e publica o site', texto: 'Claude (/lead-novo), até 4 por dia, 45 min cada; publica na Vercel como demo-<lead>. Com o Dell desligado às 08:00, roda quando ele liga.', onde: 'dell', quando: '08:00', verificacao: 'gerador', fila: 'pend:sites-fila' },
      { titulo: 'Hermes avisa "Site publicado"', texto: 'No WhatsApp, com o link do demo.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Balcão marca "pronto"', texto: 'n8n 03 lê o publicado.json, monta a mensagem e o link de envio.', onde: 'dell', quando: 'de hora em hora (:10)', verificacao: 'fluxo:wjuoIknp2qlWo0QI' },
      { titulo: 'Sites e pendências no WhatsApp', texto: 'Uma mensagem pela fila de avisos (o Hermes entrega): os sites do dia, o que espera você e o link de cada lead enviado ou em conversa.', onde: 'dell', quando: '10:30' },
      { titulo: 'Aborda o lead', texto: 'No CRM, em Hoje › Sites prontos para enviar: o botão abre o WhatsApp com a mensagem. Escrever direto ao número do lead também conta como envio.', onde: 'voce', quando: 'você decide', comVoce: true, fila: 'pend:site-enviar', link: CRM_SITE },
      { titulo: 'Envio e leitura se marcam', texto: 'O observador do WhatsApp registra o envio e, quando o lead lê, o visto_em. Quem desliga a confirmação de leitura nunca aparece como lido: é "não sei", não "não viu".', onde: 'dell', quando: 'na hora', verificacao: 'fluxo:fd8gz4uDQkJtEd9W' },
      { titulo: 'Lead responde', texto: 'Mensagem 5 min ou mais depois do envio preenche respondeu_em e a pasta vai para _em-conversa. Antes disso é a saudação automática do WhatsApp Business.', onde: 'dell', quando: 'na hora', fila: 'pend:site-resposta' },
      { ramo: 'se não responder', titulo: 'Follow-up no 3º dia', texto: 'O Hermes manda o texto pronto e o link do lead.', onde: 'dell', quando: '09:00', verificacao: 'fluxo:4lFlWNGv5KDZytJE' },
      { ramo: 'se não responder', titulo: 'Expira no 10º dia', texto: 'Status "expirado". Se o lead responder depois, volta para "enviado".', onde: 'dell', quando: '09:00' },
      { titulo: 'Marca o desfecho', texto: 'Na página do lead (link no CRM e na mensagem das 10:30): Recusou, Fechou ou Desfazer. Planilha e pasta mudam juntas.', onde: 'voce', quando: 'um toque', comVoce: true, verificacao: 'fluxo:Kf5IWNdEFFnuSOy2', link: CRM_SITE },
      { ramo: 'se recusou ou expirou', titulo: 'Demo pausado em 15 dias', texto: 'O site sai do ar na Vercel, sem apagar. Desfazer ou uma resposta nova põe de volta.', onde: 'dell', quando: '09:40' },
      { titulo: 'Conversa, proposta e fechamento', texto: 'Com você. A ficha do CRM guarda nota, próximo passo e "proposta enviada"; prumo-pdf faz o PDF da proposta.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_SITE },
      { titulo: 'Funil por nicho', texto: 'Toda segunda: sites, envios, respostas e fechamentos por segmento. Pausa a busca (segmento × cidade) e o nicho inteiro com 20+ enviados sem sinal de compra (interesse, pedido de preço, proposta ou ganho; negativa e robô não contam), e a busca com 5+ enviados sem resposta humana. Envio só conta depois de 3 dias. O gerador pula os leads novos do que pausou, e o aviso diz quais nichos pararam e por quê. Religar é TRUE em ativa na aba Buscas.', onde: 'dell', quando: 'segunda 08:00', verificacao: 'fluxo:cn4KcQujNk9CwcN0' },
    ],
  },
  {
    id: 'prumo',
    grupo: 'PRUMO',
    nome: 'PRUMO · Organizar',
    frase: 'Do prospect ao Mapa. O prospect chega pela CDL; o Dell pontua e monta o rascunho; você revisa, convida e conduz.',
    passos: [
      { titulo: 'O prospect chega pela CDL ou pelo Raio-X', texto: 'A empresa com equipe chega pela CDL ou pede o Mapa depois do Raio-X. O caminho é Raio-X, depois o Mapa (grátis) e, só depois dele, a Fonte (09/10). O Lead Scout (convite frio a distribuidoras achadas no Places) está desligado no n8n: 57 convites, 21 respostas de robô e nenhum dono interessado. O fluxo continua lá, inativo.', onde: 'externo', quando: 'quando chegar' },
      { titulo: 'Revisa o prospect', texto: 'No CRM, em Hoje › Prospects para revisar: veja o site e o briefing do CNPJ.', onde: 'voce', quando: 'você decide', comVoce: true, fila: 'pend:prumo-revisar', link: CRM_PRUMO },
      { titulo: 'Enviar convite', texto: 'O clique marca "Convite enviado" e abre o WhatsApp com a mensagem. Escrever direto ao dono também conta.', onde: 'voce', quando: 'um clique', comVoce: true, verificacao: 'fluxo:GkgYmWZJ65a2e9XF' },
      { titulo: 'Leitura e resposta se marcam', texto: 'O observador anota "Leu o convite em…" e "Respondeu no WhatsApp em…" na planilha.', onde: 'dell', quando: 'na hora' },
      { ramo: 'se não responder', titulo: 'Manda um lembrete', texto: 'O CRM mostra há quantos dias cada convite espera; o lembrete é com você.', onde: 'voce', quando: 'você decide', comVoce: true, fila: 'pend:prumo-aguardando', link: CRM_PRUMO },
      { titulo: 'Dono responde o formulário', texto: '"Prumo — Roteiro do Mapa", 16 perguntas.', onde: 'nuvem', quando: 'quando ele responder' },
      { titulo: 'Diagnóstico', texto: 'n8n: Índice PRUMO e briefing na planilha, aviso no WhatsApp.', onde: 'dell', quando: 'de hora em hora', verificacao: 'fluxo:b091d18b-106b-4f4d-ad4e-f77cdeaa7a5f', fila: 'pend:prumo-diagnostico' },
      { titulo: 'Rascunho do Mapa em PDF', texto: 'O Dell monta o Mapa de 7 páginas com o que o formulário permite e deixa [PREENCHER] no resto. Fica em ~/prumo-entregas e no Drive (PRUMO/Entregas).', onde: 'dell', quando: 'na hora', verificacao: 'prumo-mapa' },
      { titulo: 'Completa o Mapa e conduz', texto: 'Entrevistas, travas em R$, recomendação, workshop e proposta. prumo-mapa refaz o PDF depois que você edita; "proposta enviada" vai na ficha do CRM.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_PRUMO },
    ],
  },
  {
    id: 'iris',
    grupo: 'PRUMO',
    nome: 'PRUMO · Iris',
    frase: 'Clínicas de terapia para o Iris. O Dell acha a clínica com WhatsApp no site; você revisa, convida em nome do PRUMO e conduz até o teste.',
    passos: [
      { titulo: 'Nichos e cidades', texto: 'deploy/dell/claude-ops/prumo-ofertas.json: ABA/TEA, multidisciplinar infantil, neuropsicologia, fono, TO e TCC; ES primeiro, depois BH, Rio, São Paulo e Campinas. Uma busca por rodada, em rodízio.', onde: 'voce', quando: 'quando quiser', comVoce: true },
      { titulo: 'Caçador acha a clínica', texto: 'n8n "PRUMO · Iris — Caçador de clínicas": Google Places, depois o site de cada clínica. Fica quem tem WhatsApp publicado no site (celular) e não está em outro funil do PRUMO; sinais como convênio, ABA e equipe ordenam a Prioridade. Até 15 por rodada, na aba Clínicas. Nasceu desligado: roda à mão até você ligar o agendamento (dias úteis, 9h).', onde: 'dell', quando: 'à mão; 9h quando ligado', verificacao: 'fluxo:QRVkAhJBvBxt9mx8' },
      { titulo: 'Revisa a clínica', texto: 'No CRM, em Hoje › Prospects para revisar (filtro Iris · Clínicas): veja o site e decida. Sem interesse na Etapa tira a clínica da fila.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_IRIS },
      { titulo: 'Enviar convite', texto: 'O clique abre o WhatsApp com o convite em nome do PRUMO (sem preço e sem link) e marca "Convite enviado".', onde: 'voce', quando: 'um clique', comVoce: true, verificacao: 'fluxo:mfyO1YAhBrXxe5Mb' },
      { titulo: 'Resposta', texto: 'O observador do WhatsApp ainda não lê a aba Clínicas: quem responder, marque "Em conversa" na Etapa.', onde: 'voce', quando: 'quando responder', comVoce: true, link: CRM_IRIS },
      { ramo: 'se não responder', titulo: 'Um lembrete só', texto: 'No 3º dia o CRM põe o convite em Follow-up para mandar; no 7º sem resposta, vai para Perdido.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_IRIS },
      { titulo: 'Demonstração e teste', texto: 'Demonstração do dossiê com caso fictício (nunca dado de paciente), cadastro da clínica no Iris e "proposta enviada" na ficha do CRM. Clínica pagando: Concluído na Etapa.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_IRIS },
    ],
  },
  {
    id: 'estampa',
    grupo: 'PRUMO',
    nome: 'PRUMO · Estamparias',
    frase: 'Estamparias para o CRM de estamparia (white-label do CRM da Silmer). Primeiro provar que alguém quer: conversa, não venda.',
    passos: [
      { titulo: 'Nichos e cidades', texto: 'deploy/dell/claude-ops/prumo-ofertas.json: estamparia, camisetas e uniformes personalizados, silk, sublimação e confecção sob encomenda; ES primeiro. A Silmer, cliente do PRUMO, nunca entra.', onde: 'voce', quando: 'quando quiser', comVoce: true },
      { titulo: 'Caçador acha a estamparia', texto: 'n8n "PRUMO · CRM de estamparia — Caçador de estamparias": a mesma regra do Iris (WhatsApp publicado no site, sem repetir lead de outro funil), na aba Estamparias. Nasceu desligado.', onde: 'dell', quando: 'à mão; 9h quando ligado', verificacao: 'fluxo:6pIzCCmktXAUGOdf' },
      { titulo: 'Revisa a estamparia', texto: 'No CRM, em Hoje › Prospects para revisar (filtro CRM de estamparia). O plano pede 8 a 10 escolhidas à mão antes de ligar o agendamento.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_ESTAMPA },
      { titulo: 'Enviar convite', texto: 'O clique abre o WhatsApp com o convite (organizar os pedidos que chegam pelo WhatsApp) e marca "Convite enviado". O texto não diz que o CRM já roda num cliente: a Silmer ainda está em homologação.', onde: 'voce', quando: 'um clique', comVoce: true, verificacao: 'fluxo:rNp1Upq53IFIuRwT' },
      { titulo: 'Resposta e conversa', texto: 'Quem responder, marque "Em conversa": 20 minutos sobre como os pedidos chegam hoje. Meta do piloto: 2 conversas em 4 semanas; sem isso, pausa.', onde: 'voce', quando: 'você decide', comVoce: true, link: CRM_ESTAMPA },
      { titulo: 'Só depois: instalar', texto: 'Uma instalação por cliente, depois do CRM da Silmer estável por 30 dias, com contrato e DPA (plano de 13/10, B1 e B2).', onde: 'voce', quando: 'depois do piloto', comVoce: true },
    ],
  },
  {
    id: 'crm',
    grupo: 'PRUMO',
    nome: 'CRM do PRUMO',
    frase: 'Quem viu, quem respondeu e quem recusou, nas quatro ofertas do PRUMO. A planilha é a verdade; o CRM só lê e anota.',
    passos: [
      { titulo: 'Tudo se marca na planilha', texto: 'Cliques nos links, o que você escreve, leitura, resposta, follow-up e desfecho escrevem na planilha sozinhos.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Retrato a cada 10 min', texto: 'O fluxo 08 lê Leads, Prospects, Clínicas, Estamparias e a aba CRM e grava o retrato que a Central mostra. Leitura que falha mantém o último retrato bom (Clínicas e Estamparias não seguram o retrato: viram aviso).', onde: 'dell', quando: 'a cada 10 min', verificacao: 'fluxo:AsjxktRCqRJSmj9P' },
      { titulo: 'Hoje', texto: 'Só o que depende de você: próximos passos, follow-ups, respostas, prospects, propostas e sites para enviar, cada um com o link que resolve.', onde: 'voce', quando: 'quando abrir', comVoce: true, link: { rotulo: 'Abrir o CRM', url: '/crm' } },
      { titulo: 'Funil', texto: 'As 5 etapas (Novo, Em contato, Proposta, Ganho, Perdido) com filtros por oferta (Site, Organizar, Iris, Estampa), nicho e cidade. Em contato sai sozinho para Perdido depois de 7 dias sem mensagem do lead.', onde: 'voce', quando: 'quando quiser', link: { rotulo: 'Ver o funil', url: '/crm?ver=funil' } },
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
      { titulo: 'Aviso no WhatsApp', texto: 'Só o vermelho: quando quebra, a cada 12 h enquanto continuar e quando volta. Vem com o que fazer e o link desta Central.', onde: 'dell', quando: 'na hora' },
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
    nome: 'O que chega no WhatsApp',
    frase: 'O Hermes é o secretário: informa e não manda nada a lead. Estas são as mensagens programadas.',
    passos: [
      { titulo: 'Radar de licitações', texto: 'Resumo do PNCP.', onde: 'dell', quando: '08:00' },
      { titulo: 'Funil por nicho', texto: 'Só às segundas.', onde: 'dell', quando: 'segunda 08:00' },
      { titulo: 'Visão semanal de receita', texto: 'Lê ~/renda-2026 e o PRUMO.', onde: 'dell', quando: 'segunda 08:30' },
      { titulo: 'Follow-up pronto', texto: 'Quando um lead completa 3 dias sem resposta: o texto e o link.', onde: 'dell', quando: '09:00' },
      { titulo: 'ASMR: conceito do dia', texto: 'Briefing de prompt tátil.', onde: 'dell', quando: '09:00' },
      { titulo: 'ASMR: revisão 24/48 h', texto: 'Decisão editorial com os números do canal.', onde: 'dell', quando: '09:30' },
      { titulo: 'Demos pausados', texto: 'Quando um demo sai do ar, 15 dias depois de recusar ou expirar.', onde: 'dell', quando: '09:40' },
      { titulo: 'Sites e pendências', texto: 'Os sites do dia, o que espera você e o link de cada lead.', onde: 'dell', quando: '10:30' },
      { titulo: '"Registrado: você abordou…"', texto: 'Quando você escreve a um lead novo, juntando o que acontecer em 5 min.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Avisos a qualquer hora', texto: 'Site publicado, rascunho do Mapa e os alertas vermelhos do monitor.', onde: 'dell', quando: 'na hora' },
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
    frase: 'Uma frase vira evento no Google Calendar e lembrete no WhatsApp. Os agentes do SquadOne, no Dell, decidem quem cuida.',
    passos: [
      { titulo: 'Manda a demanda', texto: 'Pelo SquadOne ou pelo Telegram (texto ou áudio), que o Dell busca sozinho. Com /p na frente, vai direto para a squad PRUMO.', onde: 'voce', quando: 'quando quiser', comVoce: true },
      { titulo: 'O agente certo decide', texto: 'Squads e pessoas do SquadOne viram o prompt; o Gemini escolhe a intenção, uma chamada por turno.', onde: 'externo', quando: 'na hora', link: { rotulo: 'Agentes do SquadOne', url: '/squadone' } },
      { titulo: 'O servidor escolhe o horário', texto: 'Foco, prazo ou baixa prioridade, na grade de 15 min.', onde: 'dell', quando: 'na hora' },
      { titulo: 'Calendar e Tasks', texto: 'Eventos e passos na lista da squad.', onde: 'externo', quando: 'na hora' },
      { titulo: 'Lembrete no WhatsApp', texto: 'Pela fila de avisos do Hermes, 10 min antes de cada bloco e prazo. Se o WhatsApp cair por mais de 15 min, o healthchecks avisa no Telegram e por e-mail.', onde: 'voce', quando: '10 min antes', verificacao: 'whatsapp-sessao' },
    ],
  },
]

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
      { onde: 'dell', titulo: 'Gerador de sites', nota: 'até 4 leads; desligado, roda ao ligar' },
      { onde: 'dell', titulo: 'Repescagem do PNCP', nota: 'só se a das 07:30 não veio' },
      { onde: 'dell', titulo: 'Radar de licitações no WhatsApp', nota: 'Hermes' },
      { onde: 'dell', titulo: 'Funil por nicho', nota: 'só segunda' },
    ],
  },
  { hora: '08:30', itens: [{ onde: 'dell', titulo: 'Visão semanal de receita', nota: 'só segunda' }] },
  {
    hora: '09:00',
    itens: [
      { onde: 'dell', titulo: 'Acompanhamento dos leads', nota: 'follow-up no 3º dia, expira no 10º' },
      { onde: 'dell', titulo: 'ASMR: conceito do dia', nota: 'Hermes' },
    ],
  },
  { hora: '09:30', itens: [{ onde: 'dell', titulo: 'ASMR: revisão 24/48 h', nota: 'Hermes' }] },
  { hora: '09:40', itens: [{ onde: 'dell', titulo: 'Pausa dos demos', nota: '15 dias depois de recusar ou expirar' }] },
  { hora: '10:30', itens: [{ onde: 'dell', titulo: 'Sites e pendências', nota: 'a mensagem do dia com o que espera você' }] },
]

export const O_TEMPO_TODO: Array<{ quando: string; texto: string }> = [
  { quando: 'a cada minuto', texto: 'O monitor do Dell: esta página e os avisos' },
  { quando: 'a cada 10 min', texto: 'Retrato do CRM; a Central confere a main' },
  { quando: 'de hora em hora', texto: 'Balcão (:10), espelho dos sites (:05), página do lead (:20), Diagnóstico do PRUMO, métricas do ASMR' },
  { quando: 'todo dia', texto: 'Espelho do PRUMO e dos Mapas no Drive' },
  { quando: 'na hora', texto: 'Pasta do lead, site publicado, observador do WhatsApp, pastas movidas, rascunho do Mapa, falhas do n8n' },
]

export const DELL_LIGADO = 'O Dell precisa estar ligado. Desligado, o Caçador (06:00), a coleta do PNCP (07:30) e os fluxos de hora em hora não rodam e não se repetem; o gerador, o cofre e a repescagem do PNCP rodam quando ele liga.'
