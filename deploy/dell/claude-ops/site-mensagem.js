// Textos e utilitarios das mensagens do Site antes da venda. Vai na frente do
// codigo do Balcao (abordagem) e do Acompanhamento (follow-up): os dois falam
// com o mesmo tom e montam o telefone do mesmo jeito.

// Variacao A esta aprovada e fica como controle. Variacao null nao sai: com B e C
// null, todo lead sai na A.
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
// 08/10/2026 (plano PRUMO, secao 5 "Mensagens"): o Site antes da venda vira o
// servico "Encontrado" do PRUMO. Medido ate 08/10 com a A: 108 envios, 18
// respostas, 1 interesse, 0 propostas. A B troca o "encontrei voces" generico
// por um fato que o dono confere na hora (a nota e o numero de avaliacoes do
// Google, que o Cacador grava nas colunas nota e avaliacoes). Variacao com
// {NOTA} ou {AVALIACOES} so entra para lead com nota boa (ver fatosDoGoogle);
// sem ela, o lead sai na A. {O_A} e o artigo sem preposicao ("Vi a Clinica X").
// A C oferece o Raio-X (a pagina <demo>/raio-x, deploy/dell/raio-x.py), nao o site.
// So entra para lead cujo publicado.json tem raio_x_url e raio_x_pontos (ver raioXDe):
// o raio-x.py so grava os dois com a pagina no ar e conferida. {PONTOS} vem de
// raio_x_pontos ("1 ponto que faz", "2 pontos que fazem"): o plano dizia "3 pontos",
// mas em 08/10 so 1 dos 88 demos tinha 3 (o Raio-X so mostra fato verificavel do
// Places), e o numero fixo seria falso para quase todos.
const VARIACOES = ['Oi, tudo bem? Aqui é o Rômulo. Encontrei vocês no Google e montei, por conta própria, uma demonstração de site {ARTIGO} {NOME}{DETALHE}. Posso te mandar o link para dar uma olhada? É sem compromisso.', 'Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Vi {O_A} {NOME} no Google: nota {NOTA} com {AVALIACOES} avaliações, mas quem pesquisa não encontra um site de vocês e acaba indo para quem tem. Montei uma demonstração com as fotos e as avaliações que vocês já têm. Posso te mandar o link?', 'Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Fiz um raio-x de como {O_A} {NOME} aparece para quem procura no Google: o que já está bom e {PONTOS} cliente ir para o concorrente. É uma página só. Posso te mandar?'];

// Mercado americano (Latin Dental, Universal Dental): mensagem em ingles.
const VARIACAO_EN = "Hi! This is Rômulo. I found {NOME} on Google and put together a demo website for you, on my own initiative. Can I send you the link so you can take a look? No strings attached.";

// 07/10/2026: a variacao de cada lead vai para a coluna mensagem_variante (o funil so
// aprende comparando). A letra sai do place_id, nao da ordem da rodada: o Balcao remonta
// o wa_link de hora em hora e um lead "pronto" nao pode trocar de A para B entre duas
// rodadas. Entre as variacoes com texto; B e C null = todo lead em A. EUA = "EN".
// 08/10/2026: `lead` e a linha da planilha (nota, avaliacoes). Variacao que cita a nota
// so entra no sorteio com fatosDoGoogle(lead); sem eles o sorteio e so entre as outras
// (hoje, so a A). A nota e as avaliacoes nao mudam depois que o Cacador grava a linha,
// entao a letra continua estavel entre rodadas. O molde volta com {NOTA}/{AVALIACOES}
// ja preenchidos; {ARTIGO}, {NOME} e {DETALHE} ficam para o preencher.
// A C, do mesmo jeito, so com raioXDe(lead) ({PONTOS} preenchido aqui). O lead que o
// Raio-X alcanca depois de ja estar "pronto" pode trocar de letra uma vez (de A/B para
// C, se o sorteio cair nela): o Balcao grava a letra nova junto com o wa_link novo.
const LETRAS = ['A', 'B', 'C'];
const NOTA_MINIMA_B = 4.3;
const AVALIACOES_MINIMAS_B = 15;
const citaNota = (t) => t.indexOf('{NOTA}') >= 0 || t.indexOf('{AVALIACOES}') >= 0;
const citaRaioX = (t) => t.indexOf('{PONTOS}') >= 0;
// { url, pontos: '2 pontos que fazem' } do recibo (publicado.json), ou null (sem C).
function raioXDe(lead) {
  const url = String((lead && lead.raio_x_url) || '').trim();
  const n = numeroDaPlanilha(lead && lead.raio_x_pontos);
  if (url.indexOf('https://') !== 0 || !(Number.isInteger(n) && n >= 1 && n <= 3)) return null;
  return { url, pontos: n === 1 ? '1 ponto que faz' : n + ' pontos que fazem' };
}
function numeroDaPlanilha(v) {
  // O Sheets devolve 4.9 (numero) ou '4.9' (texto); '4,9' vale o mesmo.
  const t = String(v === undefined || v === null ? '' : v).trim().replace(',', '.');
  return t && /^\d+(\.\d+)?$/.test(t) ? Number(t) : NaN;
}
// { nota: '4,9', avaliacoes: '1.234' } para a mensagem, ou null (sem nota boa: sai a A).
function fatosDoGoogle(lead) {
  const nota = numeroDaPlanilha(lead && lead.nota);
  const avaliacoes = numeroDaPlanilha(lead && lead.avaliacoes);
  if (!(nota >= NOTA_MINIMA_B && nota <= 5) || !(Number.isInteger(avaliacoes) && avaliacoes >= AVALIACOES_MINIMAS_B)) return null;
  return { nota: nota.toFixed(1).replace('.', ','), avaliacoes: String(avaliacoes).replace(/\B(?=(\d{3})+(?!\d))/g, '.') };
}
function varianteDe(placeId, eua, lead) {
  if (eua) return { letra: 'EN', molde: VARIACAO_EN };
  const fatos = fatosDoGoogle(lead);
  const raioX = raioXDe(lead);
  const cabe = (t) => Boolean(t) && (fatos || !citaNota(t)) && (raioX || !citaRaioX(t));
  const comTexto = VARIACOES.map((t, i) => (cabe(t) ? i : -1)).filter(i => i >= 0);
  let h = 0;
  for (const ch of String(placeId || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const i = comTexto[h % comTexto.length];
  let molde = VARIACOES[i];
  if (fatos) molde = molde.split('{NOTA}').join(fatos.nota).split('{AVALIACOES}').join(fatos.avaliacoes);
  if (raioX) molde = molde.split('{PONTOS}').join(raioX.pontos);
  return { letra: LETRAS[i], molde };
}

// A segunda mensagem: sai pelo aviso do Hermes e pela ficha do CRM quando a
// resposta e de interesse. Diz o que acontece se gostarem e se nao gostarem.
// 08/10/2026: termina com o preco do Encontrado e com "so pagam depois de ver
// funcionando". Ate aqui terminava em "coloco no ar", sem preco: a conversa
// travava no "quanto custa?" e nao separava curioso de comprador. O preco e o
// do plano PRUMO (hipotese ate 08/11/2026); mudou, muda so esta linha e o espelho.
// Em ingles sai sem numero: o preco em dolar ainda nao foi decidido.
const SEGUNDA = 'Aqui está: {URL}\n\nFiz com as fotos e as avaliações que vocês já têm no Google.\n\nSe gostarem, coloco no ar com o endereço de vocês: R$ 990 e R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando. Se não for o momento, eu apago, sem problema.\n\nO que acharam?';
const SEGUNDA_EN = "Here it is: {URL}\n\nI built it from the photos and reviews you already have on Google.\n\nIf you like it, I'll put it live under your own address, with domain, hosting and edits included. You only pay after you see it working. If now isn't the right time, I'll take it down, no problem.\n\nWhat do you think?";
// Quem recebeu a C pediu o raio-x, nao o site: a segunda manda os dois links (o raio-x
// primeiro) e o mesmo preco. {RAIO_X} vem da coluna raio_x_url, que o Balcao grava do
// publicado.json; sem ela, a segunda e a de sempre. So em portugues (EUA nunca e C).
const SEGUNDA_RAIO_X = 'Aqui está o raio-x: {RAIO_X}\n\nFiz só com o que está público no Google. A demonstração do site, com as fotos e as avaliações que vocês já têm, está aqui:\n{URL}\n\nSe gostarem, coloco o site no ar com o endereço de vocês: R$ 990 e R$ 69 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver funcionando. Se não for o momento, eu apago, sem problema.\n\nO que acharam?';

// 29/09/2026: follow-up de 3 dias sem resposta. Vai pelo Acompanhamento como
// aviso ao Romulo; quem envia e ele. 05/10/2026: quem recebeu a primeira
// mensagem sem link e lembrado do pedido; quem ja recebeu o link (texto de
// antes de 05/10, ver followupDe) e lembrado do link.
// 08/10/2026: textos do plano PRUMO. O sem link diz que o demo ficou pronto (e
// quem escreve); o com link oferece mudar em um dia e apagar se nao for o
// momento. O link continua numa linha so dele (30/09).
const FOLLOWUP = 'Oi, aqui é o Rômulo de novo, do PRUMO. A demonstração de site {ARTIGO} {NOME} ficou pronta, com as fotos e as avaliações de vocês. Quer que eu mande o link?';
const FOLLOWUP_EN = "Hi, it's Rômulo again, from PRUMO. The demo website for {NOME} is ready, with your photos and reviews. Would you like me to send the link?";
const FOLLOWUP_COM_LINK = 'Oi, aqui é o Rômulo de novo. Deu para ver o site {ARTIGO} {NOME}?\n{URL}\n\nSe algo não ficou do jeito de vocês, eu mudo em um dia. E se não for o momento, é só me dizer que eu apago.';
const FOLLOWUP_COM_LINK_EN = "Hi, it's Rômulo again. Did you get a chance to see the website for {NOME}?\n{URL}\n\nIf anything isn't quite right for you, I'll change it within a day. And if now isn't the right time, just let me know and I'll take it down.";
// Quem recebeu a C (mensagem_variante) e lembrado do raio-x que ofereceu, nao do site.
const FOLLOWUP_RAIO_X = 'Oi, aqui é o Rômulo de novo, do PRUMO. O raio-x de como {O_A} {NOME} aparece no Google ficou pronto: o que já está bom e o que faz cliente ir para o concorrente. Quer que eu mande?';

// Nomes que pedem artigo feminino. Lista simples de proposito: e facil de
// estender, e o Romulo le a mensagem antes de enviar.
// 05/10/2026: nichos novos (desentupidora, contabilidade, usinagem, locação...).
const FEMININOS = ['clinica', 'academia', 'casa', 'barbearia', 'pizzaria', 'padaria', 'oficina', 'loja', 'escola', 'pousada', 'sorveteria', 'confeitaria', 'lavanderia', 'farmacia', 'marcenaria', 'vidracaria', 'desentupidora', 'dedetizadora', 'contabilidade', 'assessoria', 'advocacia', 'sociedade', 'usinagem', 'caldeiraria', 'metalurgica', 'industria', 'fabrica', 'empresa', 'locadora', 'locacao', 'construtora', 'serralheria', 'distribuidora', 'transportadora'];

function semAcento(t) { return String(t || '').normalize('NFD').replace(/[^a-zA-Z0-9 ]/g, ''); }
function primeiraPalavra(t) { return String(t || '').trim().split(' ')[0] || ''; }
// 08/10/2026: a primeira rodada com o nome na frase ("site do Advogada Camila Brito",
// "Vi o AMANDA CAMILO ADVOCACIA") mostrou que nome de pessoa e titulo feminino eram
// lidos como masculinos. Primeira palavra terminada em "a" e feminina, salvo as
// palavras masculinas abaixo; mais "Dra." e os nomes femininos que nao terminam em "a".
const TITULOS_FEMININOS = ['dra', 'doutora', 'advogada', 'arquiteta', 'psicologa', 'medica', 'odontologa', 'veterinaria', 'professora', 'corretora', 'engenheira'];
const NOMES_FEMININOS = ['karolinne', 'karoline', 'caroline', 'carolline', 'raquel', 'isabel', 'beatriz', 'ines', 'ingrid', 'alice', 'aline', 'denise', 'elaine', 'simone', 'tatiane', 'viviane', 'cristiane', 'gisele', 'michele', 'michelle', 'daniele', 'danielle', 'jaqueline', 'eliane', 'luciane', 'rosane', 'solange', 'miriam', 'mirian', 'ester', 'ruth', 'lais', 'thais', 'tais', 'yasmin', 'evelyn', 'ellen', 'kelly', 'sueli', 'nathalie', 'camille', 'nicole', 'gabrielle', 'joyce', 'suelen', 'marlene', 'irene', 'jane', 'cleide', 'neide', 'iris', 'elis', 'deise', 'rose', 'liz', 'lis'];
const MASCULINOS_EM_A = ['sistema', 'clima', 'programa', 'dia', 'mapa', 'planeta', 'problema', 'tema', 'cinema', 'poema', 'alfa', 'delta', 'omega', 'gama', 'beta', 'luca', 'joshua', 'nikita', 'garcia', 'costa', 'souza', 'sousa', 'silva', 'moura', 'rocha', 'vieira', 'pereira', 'oliveira', 'ferreira', 'correa', 'lima', 'cunha', 'mota', 'motta', 'nogueira', 'teixeira', 'siqueira', 'moreira', 'barbosa', 'cardoso'];
function artigoDe(nome) {
  const p = semAcento(primeiraPalavra(nome)).toLowerCase();
  if (FEMININOS.indexOf(p) >= 0 || TITULOS_FEMININOS.indexOf(p) >= 0 || NOMES_FEMININOS.indexOf(p) >= 0) return 'da';
  return p.length > 2 && p.slice(-1) === 'a' && MASCULINOS_EM_A.indexOf(p) < 0 ? 'da' : 'do';
}
// O artigo sem a preposicao, para "Vi a Clinica X" / "Vi o Escritorio Y" (variacao B).
function artigoSimplesDe(nome) { return artigoDe(nome) === 'da' ? 'a' : 'o'; }

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
    .split('{O_A}').join(artigoSimplesDe(nome))
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

// A primeira mensagem foi a C (o raio-x)? A letra e a que o Balcao gravou no envio.
const recebeuC = (l) => String(l.mensagem_variante || '').trim() === 'C';
// O raio_x_url da linha, so se for https (vem do publicado.json pelo Balcao).
function raioXDaLinha(l) {
  const url = String(l.raio_x_url || '').trim();
  return url.indexOf('https://') === 0 ? url : '';
}

// Follow-up pronto para abrir no WhatsApp do Romulo (wa.me com o texto).
function followupDe(l) {
  if (linkJaFoi(l)) return abrirNoWhatsApp(l, FOLLOWUP_COM_LINK, FOLLOWUP_COM_LINK_EN);
  return abrirNoWhatsApp(l, recebeuC(l) ? FOLLOWUP_RAIO_X : FOLLOWUP, FOLLOWUP_EN);
}

// Segunda mensagem (o link), para quem respondeu com interesse. Quem recebeu a C ganha
// o raio-x e o site; sem o raio_x_url na linha, sai a de sempre (o site).
function segundaDe(l) {
  const raioX = recebeuC(l) ? raioXDaLinha(l) : '';
  return abrirNoWhatsApp(l, raioX ? SEGUNDA_RAIO_X.split('{RAIO_X}').join(raioX) : SEGUNDA, SEGUNDA_EN);
}

