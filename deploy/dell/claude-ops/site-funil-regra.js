// Regra da pausa do "06 · Funil semanal" (site-acompanhamento.py), em funções puras: o nó
// Funil as chama com as abas lidas e o `--testar-regra` as roda no node com abas de mentira.
//
// Três motivos de pausa, na ordem em que valem:
// - busca sem sinal de compra (08/10/2026): a busca (segmento × cidade) tem SEM_SINAL_MAX+
//   enviados e nenhum sinal de compra;
// - nicho sem sinal de compra (08/10/2026): o segmento inteiro (coluna `vertical` da aba
//   Buscas, somando todas as cidades) tem SEM_SINAL_MAX+ enviados e nenhum sinal; pausa as
//   buscas ligadas dele, inclusive as que ainda nem enviaram;
// - silêncio (05/10/2026): MIN_ENVIADOS+ enviados maduros e nenhuma resposta humana que não seja
//   recusa ou robô (`respondeu`, que vem do nó Funil porque olha a pasta do lead) e
//   nenhum sinal de compra.
//
// Sinal de compra = resposta "interesse", pedido de preço, proposta aberta (aba CRM) ou
// ganho (status "fechado"). Negativa, pedido de exclusão e robô não são sinal; resposta
// neutra também não. Até aqui só o silêncio pausava, e uma resposta neutra bastava para
// segurar a busca: pousada chegou a 35 enviados, 8 respostas (6 negativas, 2 neutras) e
// nenhum interesse.
//
// Religar continua sendo TRUE em `ativa`: busca com `pausada_em` não é pausada de novo, e
// uma busca religada no nicho religa o nicho (as buscas dele que forem criadas depois não
// caem na regra do nicho; a da própria busca continua valendo).
// Envio só conta para a pausa depois de DIAS_PARA_RESPONDER (o follow-up do 05 sai no 3º
// dia): em 08/10/2026 os 13 envios de advocacia eram todos do mesmo dia, e o silêncio
// pausaria "advogado" em Brasília com 5 mensagens de poucas horas. Sinal de compra conta na
// hora, de qualquer envio.
const SEM_SINAL_MAX = 20;
const DIAS_PARA_RESPONDER = 3;
const NAO_E_SINAL = ['negativa', 'exclusao', 'bot'];
// O classificador (whatsapp-conversa.py) já põe "quanto custa?" em interesse; isto cobre a
// resposta marcada à mão ou classificada como neutra. Roda sobre o texto já normalizado.
const RE_PRECO = /\b(quanto (custa|cobra|fica|sai|seria|e)|precos?|valor(es)?|orcamento)\b/;

const txt = (v) => String(v ?? '').trim();
const norm = (t) => txt(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// Radicais de 5 letras: "espaço para eventos" e "espaço de eventos" batem; palavras
// genéricas não contam ("escritório de contabilidade" não é "escritório de engenharia").
const GENERICAS = new Set(['para', 'clinica', 'loja', 'particular', 'medida', 'servicos', 'centro', 'empresa', 'escritorio']);
const radicais = (...t) => new Set(t.flatMap(x => norm(x).split(' ')).filter(p => p.length >= 4 && !GENERICAS.has(p)).map(p => p.slice(0, 5)));
const cruza = (a, b) => [...a].some(r => b.has(r));
const enviado = (l) => ['enviado', 'expirado'].includes(txt(l.status)) || Boolean(txt(l.enviado_em));
const ehVerdade = (v) => ['true', 'verdadeiro', 'sim', 'x', '1'].includes(norm(v));
const novoSemSite = (l) => txt(l.status) === 'novo' && !txt(l.site_url);

// place_id dos leads do Site com proposta aberta: vale até ser desfeita (server/crm.ts, manuais).
function propostasAbertas(registros) {
  const abertas = new Set();
  const ordem = registros.filter(r => txt(r.produto) === 'site' && txt(r.id))
    .map(r => ({ id: txt(r.id), tipo: txt(r.tipo), em: Date.parse(txt(r.em)) }))
    .filter(r => Number.isFinite(r.em)).sort((a, b) => a.em - b.em);
  for (const r of ordem) {
    if (r.tipo === 'proposta') abertas.add(r.id);
    if (r.tipo === 'proposta_desfeita') abertas.delete(r.id);
  }
  return abertas;
}

// O sinal de compra do lead ('ganho', 'proposta', 'interesse', 'preço'), ou '' sem nenhum.
function sinalDeCompra(l, propostas) {
  if (txt(l.status) === 'fechado') return 'ganho';
  if (propostas.has(txt(l.place_id))) return 'proposta';
  const tipo = norm(l.resposta_tipo);
  if (NAO_E_SINAL.includes(tipo)) return '';
  if (tipo === 'interesse') return 'interesse';
  if (RE_PRECO.test(norm(l.resposta_trecho))) return 'preço';
  return '';
}

// Enviado há DIAS_PARA_RESPONDER+ dias (sem data legível, conta: é acervo).
const maduro = (l, agora) => {
  if (!enviado(l)) return false;
  const em = Date.parse(txt(l.enviado_em));
  return !Number.isFinite(em) || agora - em >= DIAS_PARA_RESPONDER * 24 * 60 * 60 * 1000;
};

// enviados e tipos: só os maduros; sinais: de qualquer lead (interesse de hoje já segura).
function medirSinal(ls, propostas, agora) {
  const env = ls.filter(l => maduro(l, agora));
  const tipos = {};
  for (const l of env) {
    const t = norm(l.resposta_tipo) || (txt(l.respondeu_em) ? 'sem tipo' : '');
    if (t) tipos[t] = (tipos[t] ?? 0) + 1;
  }
  return { enviados: env.length, sinais: ls.filter(l => sinalDeCompra(l, propostas)).length, tipos };
}
const semSinal = (m) => m.enviados >= SEM_SINAL_MAX && m.sinais === 0;

const NOMES_DOS_TIPOS = { negativa: ['negativa', 'negativas'], exclusao: ['pediu para apagar', 'pediram para apagar'],
  neutra: ['neutra', 'neutras'], bot: ['robô', 'robôs'], interesse: ['interesse', 'interesses'], 'sem tipo': ['sem tipo', 'sem tipo'] };
// "35 enviados; respostas: 6 negativas, 2 neutras": o porquê que vai para o aviso e para a aba Buscas.
function porque(m) {
  const partes = Object.entries(m.tipos).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([t, n]) => n + ' ' + (NOMES_DOS_TIPOS[t] ?? [t, t])[n === 1 ? 0 : 1]);
  return m.enviados + ' enviados; ' + (partes.length ? 'respostas: ' + partes.join(', ') : 'nenhuma resposta');
}

const nichoDaBusca = (b) => norm(b.vertical) || norm(b.query);

// buscas: [{ query, vertical, cidade, ativa (bool), pausada_em, linha, lat, lng, r (radicais),
// leads (os que o Funil atribuiu à busca) }]. leads: a aba Leads inteira. respondeu(l): a
// resposta da regra do silêncio. semSinalLigada: false quando a aba CRM não foi lida (sem
// ela uma proposta passaria por falta de sinal, e a regra nova não pausa nada). agora: ms.
function decidirPausas(buscas, leads, propostas, { respondeu, minEnviados, agora, semSinalLigada = true }) {
  const nichos = new Map();
  for (const b of buscas) {
    const nome = nichoDaBusca(b);
    const n = nichos.get(nome) ?? { nicho: nome, r: new Set(), rv: new Set(), buscas: [], leads: [] };
    b.r.forEach(x => n.r.add(x));
    radicais(b.vertical || b.query).forEach(x => n.rv.add(x));
    n.buscas.push(b);
    nichos.set(nome, n);
  }
  // O lead é do nicho da busca que o trouxe; sem ela, do único nicho que cruza a vertical dele
  // (na dúvida, o que cruza pela coluna vertical da busca; ambíguo, de nenhum).
  const donaDe = new Map();
  for (const b of buscas) for (const l of b.leads) donaDe.set(l, b);
  for (const l of leads) {
    const dona = donaDe.get(l);
    let n = dona ? nichos.get(nichoDaBusca(dona)) : null;
    if (!n) {
      const rl = radicais(l.vertical);
      const cand = [...nichos.values()].filter(x => cruza(x.r, rl));
      const pelaVertical = cand.filter(x => cruza(x.rv, rl));
      n = cand.length === 1 ? cand[0] : pelaVertical.length === 1 ? pelaVertical[0] : null;
    }
    if (n) n.leads.push(l);
  }
  const porNicho = new Map([...nichos.values()].map(n => {
    const m = medirSinal(n.leads, propostas, agora);
    const religado = n.buscas.some(b => b.ativa && b.pausada_em);
    const cidades = new Set(n.leads.filter(l => maduro(l, agora)).map(l => txt(l.cidade)).filter(Boolean)).size;
    return [n.nicho, { n, m, cidades, religado, ruim: semSinalLigada && semSinal(m) && !religado }];
  }));

  const nao_gerar = [];
  const fora = new Set();
  const tirar = (l, rotulo) => {
    if (!novoSemSite(l) || fora.has(txt(l.place_id))) return;
    fora.add(txt(l.place_id));
    nao_gerar.push({ place_id: txt(l.place_id), nome: txt(l.nome), busca: rotulo });
  };
  const porBusca = buscas.map(({ r, leads: ls, ...b }) => {
    const enviados = ls.filter(l => maduro(l, agora)).length, respostas = ls.filter(respondeu).length;
    const m = medirSinal(ls, propostas, agora);
    const x = porNicho.get(nichoDaBusca(b));
    const livre = b.ativa && !b.pausada_em;
    let regra = '', pausa_motivo = '';
    if (livre && semSinalLigada && semSinal(m)) {
      regra = 'busca_sem_sinal';
      pausa_motivo = 'sem sinal de compra: ' + porque(m) + ' (funil semanal)';
    } else if (livre && x.ruim) {
      regra = 'nicho_sem_sinal';
      pausa_motivo = 'nicho ' + x.n.nicho + ' sem sinal de compra: ' + porque(x.m) + ', em ' + x.cidades + ' cidade(s) (funil semanal)';
    } else if (livre && enviados >= minEnviados && respostas === 0 && m.sinais === 0) {
      // Proposta ou ganho sem resposta escrita (fechou por telefone) também segura a busca.
      regra = 'silencio';
      pausa_motivo = enviados + ' enviados e nenhuma resposta humana (funil semanal)';
    }
    const pausar = Boolean(regra);
    const desligada = !b.ativa || pausar;
    const rotulo = '"' + b.query + '"' + (b.cidade ? ' em ' + b.cidade : '');
    // Lead novo de busca desligada: o gerador de sites não gasta uma sessão nele.
    if (desligada) ls.forEach(l => tirar(l, rotulo));
    return { ...b, nicho: x.n.nicho, leads: ls.filter(l => txt(l.status) !== 'descartado').length, enviados, respostas,
      sinais: m.sinais, candidata: pausar, pausar, regra, pausa_motivo, ativa_depois: !desligada };
  });
  // Lead novo de nicho sem sinal que nenhuma busca reclama (cidade nova, lote fora da janela).
  for (const { n, ruim } of porNicho.values()) if (ruim) n.leads.filter(l => !donaDe.has(l)).forEach(l => tirar(l, 'nicho ' + n.nicho));

  const pausadasPorNicho = (nome) => porBusca.filter(b => b.nicho === nome && b.pausar).length;
  const nichosSaida = [...porNicho.values()].map(({ n, m, cidades, religado, ruim }) => ({
    nicho: n.nicho, enviados: m.enviados, sinais: m.sinais, tipos: m.tipos, cidades, religado,
    sem_sinal: semSinal(m), ruim, porque: porque(m),
    buscas_ligadas: porBusca.filter(b => b.nicho === n.nicho && b.ativa_depois).length,
    pausadas_agora: pausadasPorNicho(n.nicho),
  })).sort((a, b) => b.enviados - a.enviados || a.nicho.localeCompare(b.nicho));
  return { buscas: porBusca, segmentos: nichosSaida, nao_gerar };
}
