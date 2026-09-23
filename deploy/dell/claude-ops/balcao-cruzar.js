// Variacao A esta aprovada. B e C seguem null ate o Romulo escrever o texto;
// enquanto forem null, todo lead sai na variacao A.
// 22/09/2026: saiu o {NOME_CONTATO}. Ele usava a primeira palavra do nome do
// negocio ("Oi Clinica!", "Oi Academia!"), e a planilha nao tem o nome do dono.
const VARIACOES = ['Oi! Sou o Rômulo. Vi o perfil de vocês e fiz o site {ARTIGO} {NOME} pra mostrar como ficaria: {URL}{DETALHE} O que acharam?', null, null];

// Mercado americano (Latin Dental, Universal Dental): mensagem em ingles.
const VARIACAO_EN = "Hi! I'm Rômulo. I came across {NOME} and built a website to show how it could look: {URL} What do you think?";

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

// O briefing do Cacador comeca com "**Elogiam:**" e a primeira frase costuma
// ter "Dr." ou "Dra." no meio, que cortava a frase ao meio.
// Quando a frase nao e uma lista do que elogiam ("a academia e vista como...",
// "Os clientes destacam..."), "Os clientes elogiam" + frase fica quebrado:
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
  return ' Os clientes elogiam ' + frase.charAt(0).toLowerCase() + frase.slice(1) + (/[.!?]$/.test(frase) ? '' : '.');
}

const recibos = $('Ler o JSON do recibo').all();
const linhas = $input.all();

const porPlaceId = {};
for (const linha of linhas) {
  const pid = linha.json.place_id;
  if (pid) porPlaceId[pid] = linha.json;
}

const saida = [];
let indice = 0;

for (const item of recibos) {
  const rec = item.json.recibo || {};
  const pid = rec.place_id;
  if (!pid) continue;

  // Recibo sem linha correspondente: arquivo orfao, ignora em silencio.
  const linha = porPlaceId[pid];
  if (!linha) continue;

  const status = String(linha.status || '').trim();
  const waAtual = String(linha.wa_link || '').trim();

  // So mexe em lead novo (que vira pronto) ou em lead pronto, cujo link e
  // remontado a cada rodada (assim uma correcao no texto chega a todos).
  // Um lead ja enviado nunca volta para pronto.
  const ehNovo = status === '' || status === 'novo';
  if (!ehNovo && status !== 'pronto') continue;

  const siteUrl = rec.site_url || linha.site_url || '';
  if (!siteUrl) continue;

  const nome = linha.nome || rec.nome || '';
  const telefone = telefoneE164(linha.telefone);

  let waLink = '';
  if (telefone) {
    const eua = telefone.indexOf('1') === 0 && telefone.length === 11;
    const molde = eua ? VARIACAO_EN : (VARIACOES[indice % VARIACOES.length] || VARIACOES[0]);
    const mensagem = molde
      .split('{ARTIGO}').join(artigoDe(nome))
      .split('{NOME}').join(nome)
      .split('{URL}').join(siteUrl)
      .split('{DETALHE}').join(eua ? '' : detalheDoBriefing(linha.briefing));
    waLink = 'https://wa.me/' + telefone + '?text=' + encodeURIComponent(mensagem);
  }

  saida.push({ json: {
    place_id: pid,
    status: ehNovo ? 'pronto' : status,
    site_url: siteUrl,
    vercel_project: rec.vercel_project || linha.vercel_project || '',
    wa_link: waLink || waAtual
  } });
  indice = indice + 1;
}

return saida;
