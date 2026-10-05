// Textos e utilitarios das mensagens do Site antes da venda. Vai na frente do
// codigo do Balcao (abordagem) e do Acompanhamento (follow-up): os dois falam
// com o mesmo tom e montam o telefone do mesmo jeito.

// Variacao A esta aprovada. B e C seguem null ate o Romulo escrever o texto;
// enquanto forem null, todo lead sai na variacao A.
// 22/09/2026: saiu o {NOME_CONTATO}. Ele usava a primeira palavra do nome do
// negocio ("Oi Clinica!", "Oi Academia!"), e a planilha nao tem o nome do dono.
// 30/09/2026: toda mensagem abre dizendo quem escreve e por quem ("Me chamo
// Romulo e represento o Prumo"): o Site antes da venda e a frente Vender mais
// do Prumo, e um numero desconhecido sem apresentacao parece golpe. O link vai
// numa linha so dele, e a mensagem fecha com uma pergunta so.
// 05/10/2026: duas mensagens. A primeira pede licenca e NAO leva link; o link
// vai na SEGUNDA, depois do "pode mandar". Medido ate 05/10: o texto curto de
// antes ("Oi! Sou o Romulo...") teve 8 respostas em 56 envios (14%); o de
// 30/09 ("Me chamo Romulo e represento o Prumo, que ajuda negocios locais...",
// link na primeira mensagem) teve 2 em 34 (6%) e 0 vendas. Numero desconhecido
// + apresentacao de agencia + link na primeira mensagem e o desenho de golpe e
// de spam; pedir licenca transforma a primeira resposta num "sim" pequeno, e o
// observador separa esse "sim" (interesse) do resto. {URL} nao entra na primeira.
const VARIACOES = ['Oi, tudo bem? Aqui é o Rômulo. Encontrei vocês no Google e montei, por conta própria, uma demonstração de site {ARTIGO} {NOME}{DETALHE}. Posso te mandar o link para dar uma olhada? É sem compromisso.', null, null];

// Mercado americano (Latin Dental, Universal Dental): mensagem em ingles.
const VARIACAO_EN = "Hi! This is Rômulo. I found {NOME} on Google and put together a demo website for you, on my own initiative. Can I send you the link so you can take a look? No strings attached.";

// A segunda mensagem: sai pelo aviso do Hermes e pela ficha do CRM quando a
// resposta e de interesse. Diz o que acontece se gostarem e se nao gostarem.
const SEGUNDA = 'Aqui está: {URL}\n\nFiz com as fotos e as avaliações de vocês no Google. Se gostarem, coloco no ar com o endereço de vocês; se não, eu apago, sem problema. O que acharam?';
const SEGUNDA_EN = "Here it is: {URL}\n\nI built it from your photos and Google reviews. If you like it, I can put it live under your own address; if not, I'll take it down, no problem. What do you think?";

// 29/09/2026: follow-up de 3 dias sem resposta. Vai pelo Acompanhamento como
// aviso ao Romulo; quem envia e ele. 05/10/2026: quem recebeu a primeira
// mensagem sem link e lembrado do pedido; quem ja recebeu o link (texto de
// antes de 05/10, ver followupDe) e lembrado do link.
const FOLLOWUP = 'Oi, tudo bem? Aqui é o Rômulo de novo. Montei uma demonstração de site {ARTIGO} {NOME} e queria te mostrar. Posso mandar o link?';
const FOLLOWUP_EN = "Hi! It's Rômulo again. I put together a demo website for {NOME} and would love to show you. Can I send you the link?";
const FOLLOWUP_COM_LINK = 'Oi, tudo bem? Aqui é o Rômulo de novo. Deu tempo de ver a demonstração de site {ARTIGO} {NOME}?\n{URL}\n\nSe quiserem, ajusto o que for preciso. O que acharam?';
const FOLLOWUP_COM_LINK_EN = "Hi! It's Rômulo again. Did you get a chance to see the demo website I built for {NOME}?\n{URL}\n\nHappy to adjust anything. What do you think?";

// Nomes que pedem artigo feminino. Lista simples de proposito: e facil de
// estender, e o Romulo le a mensagem antes de enviar.
const FEMININOS = ['clinica', 'academia', 'casa', 'barbearia', 'pizzaria', 'padaria', 'oficina', 'loja', 'escola', 'pousada', 'sorveteria', 'confeitaria', 'lavanderia', 'farmacia', 'marcenaria', 'vidracaria'];

function semAcento(t) { return String(t || '').normalize('NFD').replace(/[^a-zA-Z0-9 ]/g, ''); }
function primeiraPalavra(t) { return String(t || '').trim().split(' ')[0] || ''; }
function artigoDe(nome) { return FEMININOS.indexOf(semAcento(primeiraPalavra(nome)).toLowerCase()) >= 0 ? 'da' : 'do'; }

// Desde 18/09 o Cacador grava o telefone internacional do Google ("+55 31 3643-7155",
// "+1 305-642-0504", "+351 21 ..."). Com "+", os digitos ja trazem o DDI.
// Sem "+", e o formato antigo nacional brasileiro ("(27) 99926-6032").
// As linhas de 18-22/09 tinham virado #ERROR! (o Sheets leu o + como formula) e
// foram corrigidas a mao para '+55 ..., entao o apostrofo inicial e ignorado.
function telefoneE164(bruto) {
  const texto = String(bruto || '').trim().replace(/^'/, '');
  const digitos = texto.replace(/[^0-9]/g, '');
  if (!digitos) return '';
  if (texto.indexOf('+') === 0) return digitos.length >= 10 ? digitos : '';
  const semPais = (digitos.indexOf('55') === 0 && digitos.length > 11) ? digitos.slice(2) : digitos;
  const semZero = semPais.indexOf('0') === 0 ? semPais.slice(1) : semPais;
  if (semZero.length < 10 || semZero.length > 11) return '';
  return '55' + semZero;
}

function ehEua(telefone) { return telefone.indexOf('1') === 0 && telefone.length === 11; }

function preencher(molde, nome, url, detalhe) {
  return molde
    .split('{ARTIGO}').join(artigoDe(nome))
    .split('{NOME}').join(nome)
    .split('{URL}').join(url)
    .split('{DETALHE}').join(detalhe || '');
}

// O briefing do Cacador comeca com "**Elogiam:**" e a primeira frase costuma
// ter "Dr." ou "Dra." no meio, que cortava a frase ao meio.
// Quando a frase nao e uma lista do que elogiam ("a academia e vista como...",
// "Os clientes destacam..."), "Vi que os clientes elogiam" + frase fica quebrado:
// nesse caso a mensagem sai sem detalhe.
function detalheDoBriefing(b) {
  const bruto = String(b || '').replace(/\*\*/g, '');
  // 30/09/2026: sem "Elogiam:" nao ha lista de elogios (descricao do negocio,
  // motivo de descarte do Cacador); a mensagem sai sem detalhe.
  if (!/^\s*Elogiam\s*:/i.test(bruto)) return '';
  const texto = bruto
    .replace(/^\s*Elogiam\s*:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return '';
  const fim = texto.search(/(?<!\b(?:Dr|Dra|Sr|Sra|Prof|Profa))\.\s/);
  let frase = (fim >= 0 ? texto.slice(0, fim) : texto).trim();
  if (/^(reclamam|palavras deles|os clientes|clientes)/i.test(frase)) return '';
  if (/\s(é|são|foi|foram|está|estão|destacam|elogiam|apontam|mencionam)\s/i.test(frase)) return '';
  frase = resumoDosElogios(frase);
  if (!frase) return '';
  // 05/10/2026: entra no meio da primeira mensagem ("...demonstração de site da X,
  // destacando o que os clientes mais elogiam: ..."), antes do pedido de licença.
  return ', destacando o que os clientes mais elogiam: ' + frase.charAt(0).toLowerCase() + frase.slice(1);
}

// 30/09/2026: o corte em 140 caracteres com "..." deixava a primeira mensagem
// terminando em "o atendimento atencioso da...", cara de robo. Agora a lista
// perde os parenteses e o que vem depois de travessao, e ficam os primeiros
// itens inteiros que cabem em LIMITE_ELOGIOS, ligados por "e".
const LIMITE_ELOGIOS = 110;
function resumoDosElogios(frase) {
  const limpa = String(frase || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+[—–]\s.*$/, '')
    .replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  if (limpa.length <= LIMITE_ELOGIOS) return limpa;
  const cabem = (partes) => {
    const r = [];
    for (const p of partes) {
      if ([...r, p].join(', ').length > LIMITE_ELOGIOS) break;
      r.push(p);
    }
    return r;
  };
  // Item novo comeca em ", o/a/os/as ..." ou ", alem do/da ..." (o "alem d" sai).
  const itens = limpa.split(/,\s+(?:além\s+d(?=[oa]s?\s)|(?=(?:o|a|os|as)\s))/i).map(i => i.trim()).filter(Boolean);
  const escolhidos = cabem(itens);
  if (escolhidos.length) {
    return escolhidos.length === 1 ? escolhidos[0] : escolhidos.slice(0, -1).join(', ') + ' e ' + escolhidos[escolhidos.length - 1];
  }
  // Primeiro item longo, sem artigo nos pedacos ("atendimento acolhedor, humano
  // e prestativo, ..."): fica o comeco dele, cortado numa virgula, como estava.
  return cabem(itens[0].split(/,\s+/)).join(', ');
}

// Numero do lead para o wa.me: o que o Balcao guardou em wa_me ou, sem ele, o telefone.
function numeroDoLead(l) {
  const guardado = String(l.wa_me || '').match(/wa\.me\/(\d+)/);
  return guardado ? guardado[1] : telefoneE164(l.telefone);
}

// A primeira mensagem guardada em wa_me ja levava o link? (texto de antes de 05/10/2026)
function linkJaFoi(l) {
  const url = String(l.site_url || '').trim();
  let texto = '';
  try { texto = decodeURIComponent(String(l.wa_me || '').split('?text=')[1] || ''); } catch (e) { texto = String(l.wa_me || ''); }
  return Boolean(url) && texto.indexOf(url) >= 0;
}

function abrirNoWhatsApp(l, moldeBr, moldeEn) {
  const numero = numeroDoLead(l);
  const nome = String(l.nome || '').trim();
  const texto = preencher(numero && ehEua(numero) ? moldeEn : moldeBr, nome, String(l.site_url || '').trim(), '');
  return { numero, texto, link: numero ? 'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto) : '' };
}

// Follow-up pronto para abrir no WhatsApp do Romulo (wa.me com o texto).
function followupDe(l) {
  return linkJaFoi(l) ? abrirNoWhatsApp(l, FOLLOWUP_COM_LINK, FOLLOWUP_COM_LINK_EN) : abrirNoWhatsApp(l, FOLLOWUP, FOLLOWUP_EN);
}

// Segunda mensagem (o link), para quem respondeu com interesse.
function segundaDe(l) {
  return abrirNoWhatsApp(l, SEGUNDA, SEGUNDA_EN);
}

