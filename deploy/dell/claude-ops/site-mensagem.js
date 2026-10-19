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
// 15/10/2026 (revisao de texto pedida pelo Romulo: as mensagens estavam diferentes entre si).
// A A ficou como ele ditou; as outras seguem o mesmo guia, para a conversa soar de uma pessoa so:
// - quem fala: "Oi, tudo bem? Aqui e o Romulo." no primeiro contato e no reenvio (que chega a
//   outra pessoa); "Oi, e o Romulo de novo." no follow-up. Sem "do PRUMO" no Site: a A nao o tem,
//   e com ele so na B e na C o A/B media a apresentacao junto com o gancho;
// - nomes que o lead entende: "demonstracao de site" (nunca "demo") e "raio-x" em minusculas;
// - o mesmo pedido no fim de toda primeira mensagem e follow-up: "Posso te mandar o link para dar
//   uma olhada? E sem compromisso.";
// - o link sempre sozinho na linha de baixo de quem ele e ("Aqui esta o raio-x da X:" e, na linha seguinte, o link);
// - preco legivel: "R$ 690 uma vez e R$ 39 por mes" (antes "R$ 690 e R$ 39 por mes", que lia
//   como dois valores do mesmo mes);
// - a saida facil igual em todas: "Se nao for o momento, e so dizer que eu apago."; uma pergunta so.
// 19/10/2026 (pedido do Romulo: "humanize mais a mensagem que os agentes enviam"; o time comercial
// manda este mesmo texto). A A fica como ele ditou: e o controle (24% de resposta em 14/10). A B e a
// C ficaram mais soltas, como alguem escreveria a mao: sem "por conta propria", sem o argumento de
// venda ("acaba indo para quem tem") e fechando com "Quer que eu te mande...? Sem compromisso.".
// "Site de exemplo" no lugar de "demonstracao de site" so na B: e o que o dono entende de primeira.
// A contagem do A/B dos pares com B ou C recomeca nesta data (TEXTO_DESDE em src/operations/ab-mensagem.ts):
// o envio de antes leva a letra com o texto antigo e nao entra na comparacao.
const VARIACOES = ['Oi, tudo bem? Aqui é o Rômulo. Encontrei vocês no Google e montei, por conta própria, uma demonstração de site {ARTIGO} {NOME}{DETALHE}. Posso te mandar o link para dar uma olhada? É sem compromisso.', 'Oi, tudo bem? Aqui é o Rômulo. Vi {O_A} {NOME} no Google, nota {NOTA} com {AVALIACOES} avaliações, muito bom! Só senti falta de um site de vocês, então montei um de exemplo com as fotos e as avaliações que já estão lá. Quer que eu te mande o link? Sem compromisso.', 'Oi, tudo bem? Aqui é o Rômulo. Dei uma olhada em como {O_A} {NOME} aparece no Google e anotei numa página o que já está bom e {PONTOS} o cliente ir para outro lugar. Quer que eu te mande? Sem compromisso.'];

// Mercado americano (Latin Dental, Universal Dental): mensagem em ingles.
const VARIACAO_EN = 'Hi, how are you? This is Rômulo. I found {NOME} on Google and, on my own initiative, put together a demo website for you. Can I send you the link so you can take a look? No strings attached.';

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
// 14/10/2026: o sorteio pelo hash deu lugar a alocarVariante (abaixo): a letra passa a ter
// estado (a coluna mensagem_variante + ab_elegiveis), nao sai mais so do place_id.
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
// 14/10/2026 (demo sob pedido): lead sem demo (lead.sem_demo, recibo sem site_url) so recebia a C, porque
// A e B dizem "montei uma demonstracao" e o demo so e feito depois do botao "Gerar demo".
// 15/10/2026 (decisao do Romulo): a A tambem vale sem demo. Lead parado sem mensagem (gerador que
// falhou, raio-x sem padrao, fila antiga) recebe a A, e quem responder ganha o demo pelo "Gerar demo"
// (uns 20 a 40 minutos). A B continua so com demo. Nos EUA, sem demo, nao ha mensagem (null): o lead
// de fora segue a fila de sempre do gerador e recebe a EN quando o demo sai.
// O lead que ja tem demo sorteia entre as mesmas de antes, entao a letra dele nao muda.
// Os indices de VARIACOES que este lead pode receber (com texto e com os fatos que o texto cita).
const LETRAS_SEM_DEMO = ['A', 'C'];
function indicesElegiveis(lead) {
  const semDemo = Boolean(lead && lead.sem_demo);
  const fatos = fatosDoGoogle(lead);
  const raioX = raioXDe(lead);
  const cabe = (t, i) => Boolean(t) && (fatos || !citaNota(t)) && (raioX || !citaRaioX(t))
    && (!semDemo || LETRAS_SEM_DEMO.indexOf(LETRAS[i]) >= 0);
  return VARIACOES.map((t, i) => (cabe(t, i) ? i : -1)).filter(i => i >= 0);
}
// O molde da letra com {NOTA}, {AVALIACOES} e {PONTOS} ja preenchidos.
function moldeDaLetra(letra, lead) {
  let molde = VARIACOES[LETRAS.indexOf(letra)];
  const fatos = fatosDoGoogle(lead);
  const raioX = raioXDe(lead);
  if (fatos) molde = molde.split('{NOTA}').join(fatos.nota).split('{AVALIACOES}').join(fatos.avaliacoes);
  if (raioX) molde = molde.split('{PONTOS}').join(raioX.pontos);
  return molde;
}
// O hash de sempre (h * 31 + c): continua sendo o desempate da alocacao (14/10/2026).
function hashDoPlaceId(placeId) {
  let h = 0;
  for (const ch of String(placeId || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}
// O sorteio puro pelo hash (07/10 a 14/10/2026). O Balcao usa alocarVariante desde 14/10;
// esta fica porque o espelho TS e os testes do texto de cada letra a usam.
function varianteDe(placeId, eua, lead) {
  if (eua) return lead && lead.sem_demo ? null : { letra: 'EN', molde: VARIACAO_EN };
  const comTexto = indicesElegiveis(lead);
  if (!comTexto.length) return null;
  const letra = LETRAS[comTexto[hashDoPlaceId(placeId) % comTexto.length]];
  return { letra, molde: moldeDaLetra(letra, lead) };
}

// ---------------------------------------------------------------- A/B estratificado (14/10/2026)
// Medido em 14/10/2026: 221 envios, A 41 (24% responderam), B 25 (8%), C 5; Fisher A x B
// p = 0,11, e confundido: a B so e elegivel com nota boa (fatosDoGoogle) e a C so com Raio-X
// (raioXDe), e o hash nao equilibrava nada por nicho (so advocacia teve amostra nas duas, e la
// deu empate). Para o teste valer:
// 1. a letra so e comparada entre leads com o MESMO conjunto de letras elegiveis, que vai para
//    a coluna ab_elegiveis ("A", "AB", "AC", "ABC") junto com mensagem_variante;
// 2. dentro de cada estrato (nicho x conjunto), a letra nova e a que tem MENOS leads ja
//    atribuidos (minimizacao), contando todas as linhas da planilha com letra e conjunto
//    validos (pronto, enviado, tudo; "manual", "EN" e vazio nao contam). Empate: o hash do
//    place_id entre as empatadas (com o estrato vazio, e a regra antiga).
// Congelamento: a letra salva fica enquanto o conjunto salvo (ab_elegiveis) for igual ao de
// agora e contiver a letra. Mudou o conjunto (o Raio-X saiu depois e a C entrou, ou o Raio-X
// sumiu) ou a linha nao tem conjunto (vazia, ou letra do sorteio antigo sem ab_elegiveis):
// sorteia de novo, no estrato novo. Isso so acontece enquanto o lead e "pronto": o Balcao nunca
// reescreve a letra de quem ja foi enviado, entao o que saiu nunca muda.
const ELEGIVEIS_VALIDOS = /^A?B?C?$/;
// "ab", " A B " ou "BA" valem "AB"; vazio ou com outra letra, ''.
function normalizarElegiveis(valor) {
  const t = String(valor === undefined || valor === null ? '' : valor).toUpperCase().replace(/[^A-Z]/g, '');
  const letras = LETRAS.filter(l => t.indexOf(l) >= 0).join('');
  return letras && letras.length === new Set(t).size && ELEGIVEIS_VALIDOS.test(letras) ? letras : '';
}
// O conjunto de letras do lead agora ("A", "AB", "AC", "ABC").
function elegiveisDe(lead) { return indicesElegiveis(lead).map(i => LETRAS[i]).join(''); }
// Nicho da coluna vertical, sem caixa, acento nem espaco sobrando; vazio e um estrato so.
function estratoDoNicho(nicho) {
  const t = semAcento(String(nicho || '').normalize('NFC')).toLowerCase().replace(/\s+/g, ' ').trim();
  return t || 'sem nicho';
}
function chaveDoEstrato(nicho, elegiveis) { return estratoDoNicho(nicho) + '|' + elegiveis; }
// A letra salva continua? So com o mesmo conjunto de agora e a letra dentro dele.
function letraCongelada(elegiveis, salva) {
  const letra = String((salva && salva.letra) || '').trim();
  return Boolean(elegiveis) && normalizarElegiveis(salva && salva.elegiveis) === elegiveis
    && LETRAS.indexOf(letra) >= 0 && elegiveis.indexOf(letra) >= 0 ? letra : '';
}
// { '<nicho>|<conjunto>': { A, B, C } } das linhas da planilha (vertical, mensagem_variante,
// ab_elegiveis), sem as de `ignorar` (place_ids que vao ser sorteados de novo nesta rodada).
function contarSorteios(linhas, ignorar) {
  const contagens = {};
  for (const l of linhas || []) {
    if (!l || (ignorar && ignorar.has(String(l.place_id || '')))) continue;
    const elegiveis = normalizarElegiveis(l.ab_elegiveis);
    const letra = letraCongelada(elegiveis, { letra: l.mensagem_variante, elegiveis });
    if (!letra) continue;
    const chave = chaveDoEstrato(l.vertical, elegiveis);
    contagens[chave] = contagens[chave] || { A: 0, B: 0, C: 0 };
    contagens[chave][letra]++;
  }
  return contagens;
}
// PURA. { placeId, nicho, eua, lead, salva: { letra, elegiveis }, contagens } ->
// { letra, molde, elegiveis, chave, congelada }. Nao mexe em `contagens`: quem sorteia varios
// leads soma a letra devolvida na chave devolvida (alocarRodada faz isso).
// EUA: "EN" e conjunto vazio (fora do teste). Um elegivel so (so A; ou so C, do lead sem demo):
// essa letra, sem sorteio. null = nenhuma mensagem possivel, como em varianteDe (sem demo e sem
// raio-x, ou sem demo nos EUA): o Balcao nao grava letra nem wa_link.
function alocarVariante(p) {
  if (p.eua) return p.lead && p.lead.sem_demo ? null : { letra: 'EN', molde: VARIACAO_EN, elegiveis: '', chave: '', congelada: false };
  const elegiveis = elegiveisDe(p.lead);
  if (!elegiveis) return null;
  const chave = chaveDoEstrato(p.nicho, elegiveis);
  const salva = letraCongelada(elegiveis, p.salva);
  let letra = salva;
  if (!letra) {
    const ja = (p.contagens && p.contagens[chave]) || {};
    const candidatas = elegiveis.split('');
    const menor = Math.min(...candidatas.map(l => ja[l] || 0));
    const empatadas = candidatas.filter(l => (ja[l] || 0) === menor);
    letra = empatadas[hashDoPlaceId(p.placeId) % empatadas.length];
  }
  return { letra, molde: moldeDaLetra(letra, p.lead), elegiveis, chave, congelada: Boolean(salva) };
}
// PURA. Uma rodada do Balcao: `linhas` = todas as linhas da aba Leads; `pedidos` = os leads que
// vao levar letra agora ({ placeId, nicho, eua, lead, salva }). Sorteia em ordem de place_id
// (estavel, nao depende da ordem da planilha nem dos recibos) e soma cada letra nova antes do
// proximo, para dois leads da mesma rodada nao cairem juntos na mesma letra.
// Devolve { [placeId]: resultado de alocarVariante }.
function alocarRodada(linhas, pedidos) {
  const ordenados = (pedidos || []).slice().sort((a, b) => (String(a.placeId) < String(b.placeId) ? -1 : String(a.placeId) > String(b.placeId) ? 1 : 0));
  const sorteiam = new Set(ordenados
    .filter(p => !p.eua && !letraCongelada(elegiveisDe(p.lead), p.salva))
    .map(p => String(p.placeId)));
  const contagens = contarSorteios(linhas, sorteiam);
  const saida = {};
  for (const p of ordenados) {
    const r = alocarVariante({ ...p, contagens });
    saida[p.placeId] = r;
    if (r && !r.congelada && r.chave) {
      contagens[r.chave] = contagens[r.chave] || { A: 0, B: 0, C: 0 };
      contagens[r.chave][r.letra]++;
    }
  }
  return saida;
}

// A segunda mensagem: sai pelo aviso do Hermes e pela ficha do CRM quando a
// resposta e de interesse. Diz o que acontece se gostarem e se nao gostarem.
// 08/10/2026: termina com o preco do Encontrado e com "so pagam depois de ver
// funcionando". Ate aqui terminava em "coloco no ar", sem preco: a conversa
// travava no "quanto custa?" e nao separava curioso de comprador. O preco e o
// do plano PRUMO (hipotese ate 08/11/2026); mudou, muda so esta linha e o espelho.
// Em ingles sai sem numero: o preco em dolar ainda nao foi decidido.
const SEGUNDA = 'Aqui está a demonstração de site {ARTIGO} {NOME}:\n{URL}\n\nFiz com as fotos e as avaliações que vocês já têm no Google.\n\nSe gostarem, coloco no ar com o endereço de vocês. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver o site funcionando.\n\nSe não for o momento, é só dizer que eu apago.\n\nO que acharam?';
const SEGUNDA_EN = "Here is the demo website for {NOME}:\n{URL}\n\nI built it from the photos and reviews you already have on Google.\n\nIf you like it, I'll put it live under your own address, with domain, hosting and edits included. You only pay after you see it working.\n\nIf now isn't the right time, just let me know and I'll take it down.\n\nWhat do you think?";
// Quem recebeu a C pediu o raio-x, nao o site: a segunda manda os dois links (o raio-x
// primeiro) e o mesmo preco. {RAIO_X} vem da coluna raio_x_url, que o Balcao grava do
// publicado.json; sem ela, a segunda e a de sempre. So em portugues (EUA nunca e C).
const SEGUNDA_RAIO_X = 'Aqui está o raio-x {ARTIGO} {NOME}:\n{RAIO_X}\n\nFiz só com o que está público no Google: o que já está bom e o que faz o cliente ir para o concorrente.\n\nTambém montei uma demonstração de site, com as fotos e as avaliações que vocês já têm:\n{URL}\n\nSe gostarem, coloco o site no ar com o endereço de vocês. São R$ 690 uma vez e R$ 39 por mês, com domínio, hospedagem e ajustes incluídos. Vocês só pagam depois de ver o site funcionando.\n\nSe não for o momento, é só dizer que eu apago.\n\nO que acharam?';
// 14/10/2026 (demo sob pedido): o raio-x avulso (raio-x-prumo.vercel.app) e de quem ainda nao tem demo.
// A segunda leva so o raio-x e oferece a demonstracao, sem preco (o preco vai com o demo); quando o
// Romulo toca "Gerar demo" e o demo sai, a proxima mensagem e a do demo, com o preco de sempre.
const RAIO_X_AVULSO = 'https://raio-x-prumo.vercel.app/';
const SEGUNDA_RAIO_X_SEM_DEMO = 'Aqui está o raio-x {ARTIGO} {NOME}:\n{RAIO_X}\n\nFiz só com o que está público no Google: o que já está bom e o que faz o cliente ir para o concorrente.\n\nSe quiserem, também monto uma demonstração de site com as fotos e as avaliações que vocês já têm. É sem compromisso.\n\nO que acharam?';
// 15/10/2026: o mesmo texto da segunda (o demo que ele pediu depois do raio-x e o de quem recebeu a A).
const DEMO_DEPOIS_DO_RAIO_X = SEGUNDA;

// 29/09/2026: follow-up de 3 dias sem resposta. Vai pelo Acompanhamento como
// aviso ao Romulo; quem envia e ele. 05/10/2026: quem recebeu a primeira
// mensagem sem link e lembrado do pedido; quem ja recebeu o link (texto de
// antes de 05/10, ver followupDe) e lembrado do link.
// 08/10/2026: textos do plano PRUMO. O sem link diz que o demo ficou pronto (e
// quem escreve); o com link oferece mudar em um dia e apagar se nao for o
// momento. O link continua numa linha so dele (30/09).
const FOLLOWUP = 'Oi, é o Rômulo de novo. A demonstração de site {ARTIGO} {NOME} está pronta, com as fotos e as avaliações de vocês. Posso te mandar o link para dar uma olhada? É sem compromisso.';
const FOLLOWUP_EN = "Hi, it's Rômulo again. The demo website for {NOME} is ready, with your photos and reviews. Can I send you the link so you can take a look? No strings attached.";
const FOLLOWUP_COM_LINK = 'Oi, é o Rômulo de novo. Deu para ver a demonstração de site {ARTIGO} {NOME}?\n{URL}\n\nSe algo não ficou do jeito de vocês, eu mudo em um dia. Se não for o momento, é só dizer que eu apago.';
const FOLLOWUP_COM_LINK_EN = "Hi, it's Rômulo again. Did you get a chance to see the demo website for {NOME}?\n{URL}\n\nIf anything isn't quite right, I'll change it within a day. If now isn't the right time, just let me know and I'll take it down.";
// Quem recebeu a C (mensagem_variante) e lembrado do raio-x que ofereceu, nao do site.
const FOLLOWUP_RAIO_X = 'Oi, é o Rômulo de novo. O raio-x de como {O_A} {NOME} aparece no Google está pronto: o que já está bom e o que faz o cliente ir para o concorrente. Posso te mandar o link para dar uma olhada? É sem compromisso.';

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
// 14/10/2026: com o raio-x avulso (demo sob pedido), sem demo a segunda e so o raio-x; com o demo
// (feito depois, pelo botao), e a mensagem do demo. Sem raio-x nem demo, nao ha o que mandar ('').
function segundaDe(l) {
  const raioX = recebeuC(l) ? raioXDaLinha(l) : '';
  const site = String(l.site_url || '').trim();
  if (raioX && raioX.indexOf(RAIO_X_AVULSO) === 0) {
    return site ? abrirNoWhatsApp(l, DEMO_DEPOIS_DO_RAIO_X, SEGUNDA_EN)
      : abrirNoWhatsApp(l, SEGUNDA_RAIO_X_SEM_DEMO.split('{RAIO_X}').join(raioX), SEGUNDA_EN);
  }
  if (!site) return { numero: numeroDoLead(l), texto: '', link: '' };
  return abrirNoWhatsApp(l, raioX ? SEGUNDA_RAIO_X.split('{RAIO_X}').join(raioX) : SEGUNDA, SEGUNDA_EN);
}

