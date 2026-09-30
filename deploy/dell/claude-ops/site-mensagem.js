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
const VARIACOES = ['Olá! Me chamo Rômulo e represento o Prumo, que ajuda negócios locais a atrair mais clientes pela internet. Encontrei o perfil {ARTIGO} {NOME} no Google e montei um site de demonstração para mostrar como o de vocês poderia ficar:\n{URL}\n\n{DETALHE}O que acharam?', null, null];

// Mercado americano (Latin Dental, Universal Dental): mensagem em ingles.
const VARIACAO_EN = "Hi! My name is Rômulo and I'm with Prumo; we help local businesses attract more customers online. I came across {NOME} on Google and built a demo website to show how yours could look:\n{URL}\n\nWhat do you think?";

// 29/09/2026: follow-up de 3 dias sem resposta, no mesmo tom da variacao A.
// Vai pelo Acompanhamento como aviso ao Romulo; quem envia e ele.
// 30/09/2026: repete quem escreve; depois de 3 dias ninguem lembra do numero.
const FOLLOWUP = 'Olá! Aqui é o Rômulo, do Prumo. Passando para saber se deu tempo de ver o site de demonstração {ARTIGO} {NOME}:\n{URL}\n\nSe quiserem, ajusto o que for preciso. O que acharam?';
const FOLLOWUP_EN = "Hi! It's Rômulo from Prumo. Just checking in: did you get a chance to see the demo website I built for {NOME}?\n{URL}\n\nHappy to adjust anything. What do you think?";

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
  const texto = String(b || '')
    .replace(/\*\*/g, '')
    .replace(/^\s*Elogiam:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!texto) return '';
  const fim = texto.search(/(?<!\b(?:Dr|Dra|Sr|Sra|Prof|Profa))\.\s/);
  let frase = (fim >= 0 ? texto.slice(0, fim) : texto).trim();
  if (/^(reclamam|palavras deles|os clientes|clientes)/i.test(frase)) return '';
  if (/\s(é|são|foi|foram|está|estão|destacam|elogiam|apontam|mencionam)\s/i.test(frase)) return '';
  if (frase.length > 140) frase = frase.slice(0, 140).replace(/[\s,;]+\S*$/, '') + '...';
  // 30/09/2026: vira a frase de quem pesquisou ("Vi que..."), na linha da pergunta final.
  return 'Vi que os clientes elogiam ' + frase.charAt(0).toLowerCase() + frase.slice(1) + (/[.!?]$/.test(frase) ? '' : '.') + ' ';
}

// Numero do lead para o wa.me: o que o Balcao guardou em wa_me ou, sem ele, o telefone.
function numeroDoLead(l) {
  const guardado = String(l.wa_me || '').match(/wa\.me\/(\d+)/);
  return guardado ? guardado[1] : telefoneE164(l.telefone);
}

// Follow-up pronto para abrir no WhatsApp do Romulo (wa.me com o texto).
function followupDe(l) {
  const numero = numeroDoLead(l);
  const nome = String(l.nome || '').trim();
  const texto = preencher(numero && ehEua(numero) ? FOLLOWUP_EN : FOLLOWUP, nome, String(l.site_url || '').trim(), '');
  return { numero, texto, link: numero ? 'https://wa.me/' + numero + '?text=' + encodeURIComponent(texto) : '' };
}

