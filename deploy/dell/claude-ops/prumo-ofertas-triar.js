// Triar e checar sites (PRUMO · caçador de oferta, 14/10/2026). Gerado por
// deploy/dell/claude-ops/prumo-ofertas.py a partir de prumo-ofertas.json:
// edite lá e republique, não aqui no n8n.
//
// Recebe as páginas do Google Places e devolve uma linha por empresa nova:
// `_tipo: 'prospect'` (aba da oferta, Etapa Revisar) ou `_tipo: 'descarte'`
// (aba Descartados, com site, telefone e Maps para dar para resgatar). Só
// dado público de empresa: nada de paciente nem de cliente final.
//
// De onde vem o WhatsApp (14/10/2026, decisão do Rômulo depois da análise do
// mesmo dia: a regra do PRUMO de "só link no site" descartava metade de cada
// busca, inclusive as melhores clínicas de ABA, que só têm Instagram), na
// ordem de confiança: link do WhatsApp cadastrado como site no Google; link
// no site (celular ou fixo: WhatsApp Business roda em fixo e o link é a
// prova); botão do site com o número no código; link encurtado (wa.link,
// bit.ly) que leva ao WhatsApp; número de celular escrito no site que fala de
// WhatsApp. Sem nada disso, o celular cadastrado no Google entra como "não
// confirmado", com prioridade menor. Fixo do Google não vira WhatsApp.
//
// Perfil: a oferta exige `perfil` no nome, no tipo do Google ou no texto do
// site. Sem site para ler, o perfil fica "não confirmado" (o nome precisa ao
// menos casar o segmento). Site que não respondeu agora não é gravado: volta
// quando a mesma busca rodar de novo. Passou do teto da rodada, também.
const CONFIG = __CONFIG__;
const busca = $('Escolher a busca').first().json;
const agora = new Date().toISOString();
const norm = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// O texto comparado já vem sem acento (norm): o padrão também.
const re = (fonte) => new RegExp(norm(fonte), 'i');
const SEGMENTO = re(CONFIG.segmento);
const FORA = re(CONFIG.fora);
// Identidade da empresa, separada do endereço: uma clínica dentro de um shopping continua clínica.
const FORA_ENTIDADE = CONFIG.fora_entidade ? re(CONFIG.fora_entidade) : null;
const SITE_DIRETORIO = CONFIG.site_diretorio ? re(CONFIG.site_diretorio) : null;
// Motivo de cada um, da oferta (prumo-ofertas.json). Até 28/10/2026 os dois diziam "Fora do perfil do Iris"
// para qualquer oferta que usasse esses campos; o Iris guarda o texto de sempre nos campos *_motivo.
const MOTIVO_FORA_ENTIDADE = CONFIG.fora_entidade_motivo || 'Fora do perfil (centro comercial ou empreendimento, não ' + CONFIG.plural + ')';
const MOTIVO_SITE_DIRETORIO = CONFIG.site_diretorio_motivo || 'Fora do perfil (site de centro comercial/diretório: contato da empresa não confirmado)';
const CLIENTES = re(CONFIG.clientes);
const PERFIL = re(CONFIG.perfil);
const FORA_SEM_PERFIL = re(CONFIG.fora_sem_perfil);
const SOLO = CONFIG.solo ? re(CONFIG.solo) : null;
const INSTITUICAO = CONFIG.instituicao ? re(CONFIG.instituicao) : null;
const SINAIS = CONFIG.sinais.map(([rotulo, fonte]) => [rotulo, re(fonte)]);

// ------------------------------------------------------------------ números
const digitos = (t) => String(t ?? '').replace(/\D/g, '');
/** 55 + DDD + celular de 9 dígitos; o antigo de 8 começando em 6-9 ganha o 9. */
const celularBR = (bruto) => {
  let d = digitos(bruto);
  if (d.length === 10 || d.length === 11) d = '55' + d;
  if (!d.startsWith('55') || !/^[1-9][1-9]$/.test(d.slice(2, 4))) return '';
  let local = d.slice(4);
  if (local.length === 8 && /^[6-9]/.test(local)) local = '9' + local;
  return local.length === 9 && local.startsWith('9') ? d.slice(0, 4) + local : '';
};
/** 55 + DDD + fixo de 8 dígitos (2 a 5). Só vale dentro de um link do WhatsApp. */
const fixoBR = (bruto) => {
  let d = digitos(bruto);
  if (d.length === 10) d = '55' + d;
  return d.length === 12 && d.startsWith('55') && /^[1-9][1-9][2-5]/.test(d.slice(2)) ? d : '';
};
const formatar = (d) => d.length === 13 ? `(${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}` : `(${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
const chaveDoWhats = (t) => {
  let d = digitos(t);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d.length >= 10 ? d.slice(-8) + ':' + d.slice(0, 2) : '';
};

// ------------------------------------------------------------------ quem já foi visto
// Em qualquer funil do PRUMO (as abas das ofertas, Descartados, Prospects e o
// Site antes da venda): place_id e WhatsApp. O ID da planilha pode vir em
// minúsculas (Roda Mais, 09/10/2026): compara sem caixa.
const idsVistos = new Set();
const whatsVistos = new Map();
for (const no of CONFIG.leitores) {
  let linhas = [];
  try { linhas = $(no).all().map((i) => i.json ?? {}); } catch (e) { throw new Error('Falha ao ler fonte de deduplicação: ' + no + '. Triagem cancelada.'); }
  for (const l of linhas) {
    for (const k of ['ID', 'place_id', 'Google Place ID']) if (l[k]) idsVistos.add(String(l[k]).trim().toLowerCase());
    for (const k of ['WhatsApp', 'whatsapp', 'telefone', 'Telefone']) {
      const w = chaveDoWhats(l[k]);
      if (w && !whatsVistos.has(w)) whatsVistos.set(w, String(l['Empresa'] ?? l['nome'] ?? '').trim());
    }
  }
}

// ------------------------------------------------------------------ o que o Places trouxe
const lugares = $('Buscar no Google Places').all().flatMap((i) => i.json.places ?? []);
const host = (url) => String(url ?? '').replace(/^https?:\/\//i, '').split(/[\/?#]/)[0].toLowerCase();
// Rede social: não dá para ler. Página de links (linktree e afins): dá, e costuma ter o WhatsApp.
const SOCIAL = /(^|\.)(instagram\.com|facebook\.com|fb\.com|fb\.me|tiktok\.com|youtube\.com|linkedin\.com|x\.com|twitter\.com|google\.com|business\.site|g\.page|goo\.gl)$/i;
const LINK_WA_HOST = /(^|\.)(wa\.me|whatsapp\.com)$/i;
const parte = (p, tipo, curto = false) => {
  const c = (p.addressComponents ?? []).find((x) => (x.types ?? []).includes(tipo));
  return c ? (curto ? c.shortText : c.longText) ?? '' : '';
};
const cidadeDe = (p) => [parte(p, 'locality') || parte(p, 'administrative_area_level_2'), parte(p, 'administrative_area_level_1', true)].filter(Boolean).join('/');

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
/** Para onde um link encurtado leva (cabeçalho Location), sem seguir. */
const destinoDe = async (url) => {
  try {
    const r = await this.helpers.httpRequest({ method: 'GET', url, headers: CABECALHOS, timeout: 8000, json: false,
      disableFollowRedirect: true, returnFullResponse: true, ignoreHttpStatusErrors: true });
    return String(r?.headers?.location ?? '');
  } catch (e) {
    return '';
  }
};
// wa.me/<número>, api|web.whatsapp.com/send?phone=<número>, whatsapp://send?phone=<número> (com o "&amp;" do HTML).
const LINK_WA = /(?:wa\.me\/(?:%2B|\+)?([\d\-]{8,20})|(?:api|web)\.whatsapp\.com\/send\/?\?[^"'<>\s]*?phone=(?:%2B|\+)?(\d{8,15})|whatsapp:\/\/send\/?\?[^"'<>\s]*?phone=(?:%2B|\+)?(\d{8,15}))/gi;
const numerosDosLinks = (texto) => [...String(texto).matchAll(LINK_WA)].map((m) => m[1] || m[2] || m[3]);
// Botão flutuante (joinchat e afins) com o número na configuração do código da página.
const WIDGET = /["']?(?:phone|number|telefone|whatsapp|wa_number|numero)["']?\s*[:=]\s*["']\+?(55\d{10,11})["']/gi;
const ENCURTADO = /https?:\/\/(?:www\.)?(?:wa\.link|bit\.ly|tinyurl\.com|encurtador\.com\.br|abre\.ai|zap\.page|l\.wl\.co)\/[A-Za-z0-9_\-]+/gi;
const textoVisivel = (html) => norm(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')).slice(0, 200000);
const CEL_NO_TEXTO = /\(?\b\d{2}\)?\s?9\s?\d{4}[\s.-]?\d{4}\b/g;

/** O WhatsApp do HTML, na ordem de confiança: { numero, origem } ou null. */
async function whatsDoHtml(html, texto) {
  const links = numerosDosLinks(html);
  const cel = links.map(celularBR).find(Boolean);
  if (cel) return { numero: cel, origem: 'link no site' };
  const fixo = links.map(fixoBR).find(Boolean);
  if (fixo) return { numero: fixo, origem: 'link no site (fixo)' };
  const widget = [...html.matchAll(WIDGET)].map((m) => celularBR(m[1]) || fixoBR(m[1])).find(Boolean);
  if (widget) return { numero: widget, origem: 'botão do site' };
  for (const curto of [...new Set(html.match(ENCURTADO) ?? [])].slice(0, 3)) {
    const destino = await destinoDe(curto);
    const n = numerosDosLinks(destino).map((x) => celularBR(x) || fixoBR(x)).find(Boolean);
    if (n) return { numero: n, origem: 'link encurtado no site' };
  }
  if (/whatsapp|whats\b|zap\b/i.test(texto)) {
    const noTexto = (texto.match(CEL_NO_TEXTO) ?? []).map(celularBR).find(Boolean);
    if (noTexto) return { numero: noTexto, origem: 'número no texto do site' };
  }
  return null;
}

async function checar(p) {
  const nome = p.displayName?.text ?? '';
  const tipo = p.primaryTypeDisplayName?.text ?? '';
  const site = String(p.websiteUri ?? '').trim();
  const foneGoogle = p.internationalPhoneNumber || p.nationalPhoneNumber || '';
  const base = { p, nome, tipo, site, foneGoogle };
  const nomeTipo = norm(nome + ' ' + tipo);
  if (CLIENTES.test(norm(nome + ' ' + host(site)))) return { ...base, descarte: 'Já é cliente do PRUMO: não abordar' };
  if (p.businessStatus && p.businessStatus !== 'OPERATIONAL') return { ...base, descarte: 'Fechada no Google' };
  if (FORA.test(nomeTipo)) return { ...base, descarte: 'Fora do perfil (' + (tipo || 'ramo') + ')' };

  if (FORA_ENTIDADE && (FORA_ENTIDADE.test(norm(nome)) || FORA_ENTIDADE.test(norm(tipo)))) {
    return { ...base, descarte: MOTIVO_FORA_ENTIDADE };
  }

  let whats = null;
  let texto = '';
  let leuSite = false;
  if (site && LINK_WA_HOST.test(host(site))) {
    const n = numerosDosLinks(site).map((x) => celularBR(x) || fixoBR(x)).find(Boolean);
    if (n) whats = { numero: n, origem: 'link do WhatsApp no Google' };
  } else if (site && !SOCIAL.test(host(site))) {
    const html = await baixar(site);
    if (html === null) return { ...base, adiar: true };
    leuSite = true;
    texto = textoVisivel(html);
    // Página de lojista pode descrever TEA/ABA e publicar o WhatsApp da administração no rodapé.
    // Não atribuir esse contato à clínica, nem usar o celular do Google como fallback neste site.
    const titulo = textoVisivel((html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '');
    if (SITE_DIRETORIO && (SITE_DIRETORIO.test(texto) || (FORA_ENTIDADE && FORA_ENTIDADE.test(titulo)))) {
      return { ...base, descarte: MOTIVO_SITE_DIRETORIO };
    }
    whats = await whatsDoHtml(html, texto);
    // Botão de WhatsApp só na página de contato é comum em site pequeno.
    if (!whats) {
      const contato = await baixar(site.replace(/[?#].*$/, '').replace(/\/+$/, '') + '/contato');
      if (contato) {
        const textoContato = textoVisivel(contato);
        texto += ' ' + textoContato;
        whats = await whatsDoHtml(contato, textoContato);
      }
    }
  }

  // Perfil da oferta: no nome, no tipo do Google ou no site. Sem site lido, só o nome diz.
  const perfil = PERFIL.test(nomeTipo) || PERFIL.test(texto);
  if (leuSite && !perfil) {
    if (!SEGMENTO.test(nomeTipo) && !SEGMENTO.test(texto)) return { ...base, descarte: 'Fora do segmento (nada de ' + CONFIG.plural + ' no nome nem no site)' };
    return { ...base, descarte: FORA_SEM_PERFIL.test(nomeTipo + ' ' + texto) ? CONFIG.fora_sem_perfil_motivo : CONFIG.perfil_motivo };
  }
  if (!leuSite && !perfil) {
    if (FORA_SEM_PERFIL.test(nomeTipo)) return { ...base, descarte: CONFIG.fora_sem_perfil_motivo };
    if (!SEGMENTO.test(nomeTipo)) return { ...base, descarte: 'Fora do segmento (nada de ' + CONFIG.plural + ' no nome, e sem site para conferir)' };
  }

  // Sem WhatsApp achado: o celular do Google, sem confirmação. Fixo do Google não serve.
  if (!whats) {
    const cel = celularBR(foneGoogle);
    if (!cel) return { ...base, descarte: leuSite ? 'Sem WhatsApp no site nem celular no Google' : 'Sem site e sem celular no Google' };
    whats = { numero: cel, origem: 'não confirmado: celular do Google' };
  }
  const sinais = SINAIS.filter(([, r]) => r.test(texto) || r.test(nomeTipo)).map(([rotulo]) => rotulo);
  const marcas = [];
  if (!perfil) marcas.push('perfil não confirmado (sem site)');
  const solo = Boolean(SOLO && SOLO.test(norm(nome)) && !(INSTITUICAO && INSTITUICAO.test(norm(nome))));
  if (solo) marcas.push('profissional que atende sozinho?');
  return { ...base, whats, sinais, marcas, perfil, solo };
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
const PONTOS_DO_CONTATO = { 'link do WhatsApp no Google': 20, 'link no site': 20, 'botão do site': 20, 'link encurtado no site': 20,
  'link no site (fixo)': 15, 'número no texto do site': 15, 'não confirmado: celular do Google': 5 };
// Prioridade (0 a 100): ordena a revisão humana, não diagnostica a empresa. Contato até 20, sinais
// do segmento até 50, avaliações até 20 (escala log), nota até 10; perfil não confirmado -15, solo -30.
const prioridade = (r) => Math.max(0, Math.min(100, Math.round((PONTOS_DO_CONTATO[r.whats.origem] ?? 5)
  + Math.min(50, r.sinais.length * 10) + Math.min(20, Math.log10(1 + avaliacoes(r.p)) * 10)
  + (Number(r.p.rating ?? 0) >= 4.5 ? 10 : Number(r.p.rating ?? 0) >= 4 ? 5 : 0)
  - (r.perfil ? 0 : 15) - (r.solo ? 30 : 0))));
const maps = (p) => p.googleMapsUri || ('https://www.google.com/maps/place/?q=place_id:' + p.id);
const linhaBase = (r) => ({
  'ID': r.p.id, 'Empresa': r.nome, 'Cidade': cidadeDe(r.p), 'Segmento': r.tipo || busca.nicho, 'Encontrado em': agora,
  'Tipo no Google': r.tipo, 'Busca': busca.query,
});
const descarte = (r, motivo) => ({ ...linhaBase(r), 'Motivo': CONFIG.rotulo + ': ' + motivo, 'Site': r.site, 'Telefone': r.foneGoogle,
  'Google Maps': maps(r.p), _tipo: 'descarte' });
const prospects = [];
const descartes = [];
const whatsNaRodada = new Map();
let adiados = 0;
for (const r of resultados) {
  if (r.adiar) { adiados += 1; continue; }
  if (r.descarte) { descartes.push(descarte(r, r.descarte)); continue; }
  const chave = chaveDoWhats(r.whats.numero);
  if (whatsNaRodada.has(chave)) {
    descartes.push(descarte(r, 'Outra unidade de ' + whatsNaRodada.get(chave) + ' (mesmo WhatsApp)'));
    continue;
  }
  if (whatsVistos.has(chave)) {
    const quem = whatsVistos.get(chave);
    descartes.push(descarte(r, 'WhatsApp já está em outro funil do PRUMO' + (quem ? ' (' + quem.slice(0, 60) + ')' : '')));
    continue;
  }
  whatsNaRodada.set(chave, r.nome.slice(0, 60));
  prospects.push({ r, prioridade: prioridade(r) });
}
prospects.sort((a, b) => b.prioridade - a.prioridade);
const cortados = Math.max(0, prospects.length - CONFIG.teto_por_rodada);
// Vai em todo item (o Sheets ignora o que não é coluna): o aviso conta o que ficou para a próxima.
const resumo = { _adiados: adiados, _cortados: cortados, _lugares: lugares.length, _novos: novos.length };
const saida = prospects.slice(0, CONFIG.teto_por_rodada).map(({ r, prioridade }) => ({
  ...linhaBase(r),
  'WhatsApp': formatar(r.whats.numero),
  'Site': r.site,
  'Nota Google': r.p.rating ? `${r.p.rating} (${avaliacoes(r.p)})` : '',
  'Etapa': 'Revisar',
  'Enviar convite': CONFIG.convite_url + encodeURIComponent(r.p.id),
  'Prioridade': prioridade,
  'Sinais': [...r.marcas, ...r.sinais].join(' · ') || 'nenhum sinal no site',
  'Próxima ação': r.whats.origem.startsWith('não confirmado')
    ? 'WhatsApp não confirmado (é o celular do Google): confira no Instagram ou no Maps antes do convite.'
    : CONFIG.proxima_revisar,
  'Google Maps': maps(r.p),
  'Origem do WhatsApp': r.whats.origem,
  'Telefone no Google': r.foneGoogle,
  _tipo: 'prospect',
}));
const linhas = [...saida, ...descartes];
// Rastro da rodada (19/10/2026): busca sem nenhuma empresa nova (tudo já visto, ou só sites fora do ar) não
// gravava linha, e o rodízio ("a mais antiga primeiro", em prumo-ofertas.py) a escolhia de novo no dia seguinte,
// travando as de trás. Esta linha em Descartados carrega Busca + Encontrado em, que o rodízio já lê.
if (!linhas.length) {
  linhas.push({ 'ID': 'busca-sem-novidade:' + busca.query + ':' + agora.slice(0, 10), 'Empresa': '(busca sem novidade)', 'Cidade': busca.cidade ?? '',
    'Segmento': busca.nicho ?? '', 'Motivo': CONFIG.rotulo + ': Busca sem novidade', 'Encontrado em': agora, 'Site': '', 'Telefone': '',
    'Google Maps': '', 'Tipo no Google': '', 'Busca': busca.query, _tipo: 'descarte' });
}
return linhas.map((json) => ({ json: { ...json, ...resumo } }));
