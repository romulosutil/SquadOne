// Triar e checar sites (PRUMO · caçador de oferta, 14/10/2026). Gerado por
// deploy/dell/claude-ops/prumo-ofertas.py a partir de prumo-ofertas.json:
// edite lá e republique, não aqui no n8n.
//
// Recebe as páginas do Google Places e devolve uma linha por empresa nova:
// `_tipo: 'prospect'` (aba da oferta, Etapa Revisar) ou `_tipo: 'descarte'`
// (aba Descartados, para a busca seguinte não reavaliar). A regra é a do
// PRUMO (ops/n8n/README.md): WhatsApp só conta com o link publicado no site
// da empresa, e o número tem de ser celular brasileiro. O telefone do Google
// não vira WhatsApp. Só dado público de empresa: nada de paciente nem de
// cliente final (plano de 13/10, princípio 6).
//
// Site que não respondeu agora não é gravado: volta na próxima vez que a
// mesma busca rodar (só custa HTTP). Passou do teto da rodada, também.
const CONFIG = __CONFIG__;
const busca = $('Escolher a busca').first().json;
const agora = new Date().toISOString();
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// O texto comparado já vem sem acento (norm): o padrão também.
const re = (fonte) => new RegExp(norm(fonte), 'i');
const SEGMENTO = re(CONFIG.segmento);
const FORA = re(CONFIG.fora);
const CLIENTES = re(CONFIG.clientes);
const SINAIS = CONFIG.sinais.map(([rotulo, fonte]) => [rotulo, re(fonte)]);

// ------------------------------------------------------------------ quem já foi visto
// Em qualquer funil do PRUMO (as abas das ofertas, Descartados, Prospects e o
// Site antes da venda): place_id e WhatsApp. O ID da planilha pode vir em
// minúsculas (Roda Mais, 09/10/2026): compara sem caixa.
const chaveDoWhats = (t) => {
  let d = String(t ?? '').replace(/\D/g, '');
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d.length >= 10 ? d.slice(-8) + ':' + d.slice(0, 2) : '';
};
const idsVistos = new Set();
const whatsVistos = new Set();
for (const no of CONFIG.leitores) {
  let linhas = [];
  try { linhas = $(no).all().map((i) => i.json ?? {}); } catch (e) { linhas = []; }
  for (const l of linhas) {
    for (const k of ['ID', 'place_id', 'Google Place ID']) if (l[k]) idsVistos.add(String(l[k]).trim().toLowerCase());
    for (const k of ['WhatsApp', 'whatsapp', 'telefone', 'Telefone']) { const w = chaveDoWhats(l[k]); if (w) whatsVistos.add(w); }
  }
}

// ------------------------------------------------------------------ o que o Places trouxe
const lugares = $('Buscar no Google Places').all().flatMap((i) => i.json.places ?? []);
const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|linktr\.ee|linkme\.bio|beacons\.ai|taplink\.cc|bio\.link|wa\.me|whatsapp\.com|tiktok\.com|youtube\.com|linkedin\.com|x\.com|twitter\.com|bit\.ly|google\.com|business\.site|g\.page)$/i;
const host = (url) => String(url ?? '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].toLowerCase();
const parte = (p, tipo, curto = false) => {
  const c = (p.addressComponents ?? []).find((x) => (x.types ?? []).includes(tipo));
  return c ? (curto ? c.shortText : c.longText) ?? '' : '';
};
const cidadeDe = (p) => {
  const cidade = parte(p, 'locality') || parte(p, 'administrative_area_level_2');
  const uf = parte(p, 'administrative_area_level_1', true);
  return [cidade, uf].filter(Boolean).join('/');
};

// ------------------------------------------------------------------ o site
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CABECALHOS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9' };
const baixar = async (url) => {
  try {
    const corpo = await this.helpers.httpRequest({ method: 'GET', url, headers: CABECALHOS, timeout: 10000, json: false });
    return typeof corpo === 'string' ? corpo.slice(0, 1500000) : Buffer.isBuffer(corpo) ? corpo.toString('utf8').slice(0, 1500000) : '';
  } catch (e) {
    return null;
  }
};
// wa.me/<número>, api|web.whatsapp.com/send?phone=<número> e whatsapp://send?phone=<número>,
// com o "&amp;" do HTML. wa.me/message/<código> não traz número: não serve ao CRM.
const LINK_WA = /(?:wa\.me\/(?:%2B|\+)?([\d\-]{8,20})|(?:api|web)\.whatsapp\.com\/send\/?\?[^"'<>\s]*?phone=(?:%2B|\+)?(\d{8,15})|whatsapp:\/\/send\/?\?[^"'<>\s]*?phone=(?:%2B|\+)?(\d{8,15}))/gi;
const temLinkSemNumero = (html) => /wa\.me\/message\/|wa\.me\/?["'?]|api\.whatsapp\.com\/send\/?\?(?![^"'<>\s]*phone=\d)/i.test(html);
/** Celular brasileiro com DDD, como 55 + DDD + 9 dígitos; o antigo de 8 dígitos começando em 6-9 ganha o 9. */
const celularBR = (bruto) => {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!d.startsWith('55')) return '';
  const ddd = d.slice(2, 4);
  let local = d.slice(4);
  if (!/^[1-9][1-9]$/.test(ddd)) return '';
  if (local.length === 8 && /^[6-9]/.test(local)) local = '9' + local;
  return local.length === 9 && local.startsWith('9') ? '55' + ddd + local : '';
};
const formatar = (d) => `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
const textoVisivel = (html) => norm(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')).slice(0, 200000);

async function checar(p) {
  const nome = p.displayName?.text ?? '';
  const tipo = p.primaryTypeDisplayName?.text ?? '';
  const site = String(p.websiteUri ?? '').trim();
  const base = { p, nome, tipo, site };
  if (CLIENTES.test(norm(nome + ' ' + host(site)))) return { ...base, descarte: 'Já é cliente do PRUMO: não abordar' };
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return { ...base, descarte: 'Fechada no Google' };
  if (FORA.test(norm(nome + ' ' + tipo))) return { ...base, descarte: 'Fora do perfil (' + (tipo || 'ramo') + ')' };
  if (!site || SOCIAL.test(host(site))) return { ...base, descarte: 'Sem site próprio (o WhatsApp precisa estar publicado no site)' };
  let html = await baixar(site);
  if (html === null) return { ...base, adiar: true };
  let numeros = [...html.matchAll(LINK_WA)].map((m) => celularBR(m[1] || m[2] || m[3])).filter(Boolean);
  let texto = textoVisivel(html);
  // Botão de WhatsApp só na página de contato é comum em site pequeno.
  if (!numeros.length) {
    const contato = await baixar(site.replace(/[?#].*$/, '').replace(/\/+$/, '') + '/contato');
    if (contato) {
      numeros = [...contato.matchAll(LINK_WA)].map((m) => celularBR(m[1] || m[2] || m[3])).filter(Boolean);
      texto += ' ' + textoVisivel(contato);
      html += contato;
    }
  }
  if (!SEGMENTO.test(norm(nome + ' ' + tipo)) && !SEGMENTO.test(texto)) return { ...base, descarte: 'Fora do segmento (nada de ' + CONFIG.plural + ' no nome nem no site)' };
  if (!numeros.length) {
    const algum = [...html.matchAll(LINK_WA)].length > 0;
    return { ...base, descarte: algum ? 'WhatsApp do site não é celular brasileiro' : temLinkSemNumero(html) ? 'Link do WhatsApp sem número' : 'Sem WhatsApp publicado no site' };
  }
  const sinais = SINAIS.filter(([, r]) => r.test(texto) || r.test(norm(nome))).map(([rotulo]) => rotulo);
  return { ...base, whatsapp: numeros[0], sinais };
}

// ------------------------------------------------------------------ rodada
const novos = [];
const vistosNaRodada = new Set();
for (const p of lugares) {
  const id = String(p.id ?? '').trim();
  if (!id || idsVistos.has(id.toLowerCase()) || vistosNaRodada.has(id)) continue;
  vistosNaRodada.add(id);
  novos.push(p);
}
const resultados = [];
const SIMULTANEAS = 8;
for (let i = 0; i < novos.length; i += SIMULTANEAS) {
  resultados.push(...await Promise.all(novos.slice(i, i + SIMULTANEAS).map(checar)));
}

const avaliacoes = (p) => Number(p.userRatingCount ?? 0);
// Prioridade (0 a 100): ordena a revisão humana, não diagnostica a empresa.
// WhatsApp publicado 20, sinais do segmento até 50, avaliações até 20 (escala log), nota até 10.
const prioridade = (r) => Math.min(100, Math.round(20 + Math.min(50, r.sinais.length * 10)
  + Math.min(20, Math.log10(1 + avaliacoes(r.p)) * 10) + (Number(r.p.rating ?? 0) >= 4.5 ? 10 : Number(r.p.rating ?? 0) >= 4 ? 5 : 0)));
const linhaBase = (r) => ({
  'ID': r.p.id, 'Empresa': r.nome, 'Cidade': cidadeDe(r.p), 'Segmento': busca.nicho, 'Encontrado em': agora,
});
const prospects = [];
const descartes = [];
const whatsNaRodada = new Set();
for (const r of resultados) {
  if (r.adiar) continue;
  if (r.descarte) { descartes.push({ ...linhaBase(r), 'Motivo': CONFIG.rotulo + ': ' + r.descarte, _tipo: 'descarte' }); continue; }
  const chave = chaveDoWhats(r.whatsapp);
  if (whatsVistos.has(chave) || whatsNaRodada.has(chave)) {
    descartes.push({ ...linhaBase(r), 'Motivo': CONFIG.rotulo + ': WhatsApp já está em outro funil do PRUMO', _tipo: 'descarte' });
    continue;
  }
  whatsNaRodada.add(chave);
  prospects.push({ r, prioridade: prioridade(r) });
}
prospects.sort((a, b) => b.prioridade - a.prioridade);
const saida = prospects.slice(0, CONFIG.teto_por_rodada).map(({ r, prioridade }) => ({
  ...linhaBase(r),
  'WhatsApp': formatar(r.whatsapp),
  'Site': r.site,
  'Nota Google': r.p.rating ? `${r.p.rating} (${avaliacoes(r.p)})` : '',
  'Etapa': 'Revisar',
  'Enviar convite': CONFIG.convite_url + encodeURIComponent(r.p.id),
  'Prioridade': prioridade,
  'Sinais': r.sinais.join(' · ') || 'nenhum sinal no site',
  'Próxima ação': CONFIG.proxima_revisar,
  'Google Maps': r.p.googleMapsUri || ('https://www.google.com/maps/place/?q=place_id:' + r.p.id),
  _tipo: 'prospect',
}));
return [...saida, ...descartes].map((json) => ({ json }));
