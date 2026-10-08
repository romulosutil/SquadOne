// Checar site próprio (01 · Caçador): quem tem site no ar não vira pasta.
// Até 07/10/2026 era UM GET de 10 s na raiz do domínio. 74 leads ganharam o +40
// de "site próprio fora do ar" assim, e 22 deles acabaram em _descartados porque
// o gerador achou o site respondendo (Baby School: www.babyschool.com.br deu
// timeout, babyschool.com.br respondia 301 -> 200 com WordPress completo, e a
// dona respondeu "hoje já temos uma agência").
// Agora "fora do ar" só vale depois de RODADAS rodadas espaçadas, cada uma
// testando o link como o Google mostra (Wix, Canva e landing page moram no
// caminho, não na raiz) e a raiz em https e http, com e sem www, seguindo
// redirecionamento com User-Agent de navegador.
// Saída, na ordem de entrada:
// - sem site próprio: segue como antes (site_morto false);
// - nada respondeu, ou só domínio à venda / página padrão / redireciona para
//   rede social: segue com site_morto true (o +40 do Pontuar);
// - site no ar com conteúdo real: descartar_site true, com motivo e URL; o
//   "Site no ar?" manda para a planilha como descartado, ANTES do Gemini e do
//   gerador. Crédito de agência no rodapé vira "tem site e agência";
// - o link só leva a anúncio num diretório de outro site: segue sem o +40,
//   como quem não tem site próprio;
// - responde mas não dá para ler (bloqueio de robô, página só de JavaScript),
//   ou ficou sem tempo para as RODADAS: não segue nem é gravado, como era com
//   site no ar: reavaliado na próxima rodada da busca, que custa só HTTP.
const RODADAS = 3;
const ESPERA_ENTRE_RODADAS_MS = 30000;
const TIMEOUT_MS = 10000;
// Teto de cada link testado numa rodada, somando redirecionamentos.
const PRAZO_DO_LINK_MS = 20000;
const MAX_SALTOS = 8;
// Texto visível mínimo para contar como site (~2 KB). Menos que isso não prova nada.
const TEXTO_MINIMO = 2000;
const SIMULTANEAS = 40;
// O runner do n8n mata o nó Code em 300 s, e a busca traz até 60 lugares (3
// páginas). Rodada que, no pior caso (todo link esgotando o prazo), acabaria
// depois de TETO_MS não começa: quem ainda não se decidiu fica de fora (sem
// planilha) e volta na próxima rodada da busca. Nunca vira "fora do ar" com
// menos de RODADAS.
const TETO_MS = 240000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const CABECALHOS = { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' };

// Domínio à venda, expirado, estacionado ou conta suspensa: o dono não tem nada no ar.
const ESTACIONADO = /domain (name )?(is |may be )?(for sale|parked|expired)|buy this domain|this domain (has expired|is for sale|may be for sale)|your domain (has |is )?expired|domain has expired|isn'?t connected to a website yet|sedoparking|parkingcrew|bodis\.com|hugedomains|afternic|this web ?page is parked|parked (free|domain|by)|dom[ií]nio (est[aá] )?([àa] venda|expirado|estacionado|suspenso)|compr(e|ar) este dom[ií]nio|este dom[ií]nio (est[aá] )?([àa] venda|expirou|pode estar [àa] venda)/i;
const SUSPENSO = /account (has been )?suspended|conta (foi )?suspensa|(site|hospedagem|conta de hospedagem) (est[aá] |foi )?(suspens[oa]|expirad[oa]|vencid[oa])|website (is )?(suspended|unavailable)/i;
// Título de página padrão de servidor/hospedagem, em construção ou "Hello world".
const PADRAO_NO_TITULO = /^(index of\b|welcome to nginx|apache2?\b.*default page|test page for|it works!?$|default (web ?)?(site|page)|iis windows|domain default page|parked domain|cpanel|plesk|hostinger|hostgator|locaweb|kinghost|umbler|godaddy|registro\.br)|em constru[cç][aã]o|coming soon|under construction|\bem breve\b|em manuten[cç][aã]o|under maintenance|hello world|ol[áa],? mundo|future home of/i;
// O post de exemplo do WordPress na página inicial: instalação que ninguém mexeu.
const PRIMEIRO_POST = /welcome to wordpress\. this is your first post|boas-vindas ao wordpress\. esta [ée] a sua primeira (postagem|publica)|bem-vindo ao wordpress\. (esse|este) [ée] o seu primeiro post/i;
// Os mesmos sinais no corpo só contam em página magra: site de verdade pode ter "em breve" num banner.
const PADRAO_NO_TEXTO = /em constru[cç][aã]o|coming soon|under construction|\bem breve\b|em manuten[cç][aã]o|under maintenance|hello world|ol[áa],? mundo|just another wordpress site|apenas mais um site wordpress|index of \/|welcome to nginx|it works!|default (web ?)?page|site hospedado (na|pela)|cpanel|plesk/i;
// Desafio anti-robô (Cloudflare, Sucuri, DDoS-Guard): o site existe, só não deixa ler.
const DESAFIO = /just a moment|attention required|checking your browser|ddos-guard|_cf_chl_|cf-browser-verification|sucuri website firewall/i;
const ERRO_SSL = /certificate|cert_|ssl|tls|eproto|altnames|self[- ]signed/i;
// Domínio que redireciona para rede social, mapa, link na bio ou diretório
// (a mesma lista que o Gemini não conta como site): não é site. O Google Meu
// Negócio (business.site) hoje redireciona para o Maps. Google só no Maps e na
// raiz: sites.google.com é site de verdade.
const NAO_E_SITE = /(^|\.)(instagram\.com|facebook\.com|fb\.(com|me)|linktr\.ee|linkme\.bio|beacons\.ai|taplink\.cc|bio\.link|wa\.me|whatsapp\.com|tiktok\.com|youtube\.com|linkedin\.com|x\.com|twitter\.com|goo\.gl|g\.page|booking\.com|airbnb\.[a-z.]+|tripadvisor\.[a-z.]+|ifood\.com\.br|doctoralia\.com\.br|booksy\.com|guiamais\.com\.br)$|^(www\.|maps\.)?google\.[a-z.]+$/i;
// Palavras do nome que não identificam o negócio (ramo, cidade, forma jurídica).
const GENERICAS = new Set(['pousada', 'hotel', 'advocacia', 'advogados', 'advogado', 'advogada', 'associados', 'escritorio',
  'moveis', 'planejados', 'studio', 'estudio', 'espaco', 'clinica', 'servicos', 'solucoes', 'engenharia', 'desentupidora',
  'dedetizadora', 'contabilidade', 'contabil', 'comercio', 'ltda', 'eireli', 'grupo', 'centro', 'casa', 'loja', 'buffet',
  'eventos', 'consultoria', 'assessoria', 'construtora', 'reformas', 'locacao', 'locadora', 'paraty', 'ubatuba']);
// Crédito de quem fez o site, perto de um link para fora. "Site:" sozinho não
// conta ("Agende pelo site: <link>"); "Site por" e "Criação:" contam.
const CREDITO = /(desenvolvid|criad|feit|produzid|projetad|elaborad|mantid)[oa]s?(\s+com\s+\S+)?\s+(por|pel[oa])\b|\b(site|website)\s+(por|by)\b|\b(layout|design|webdesign|cria[cç][aã]o|desenvolvimento)(\s+de\s+sites?)?\s*(por|by|:)|\b(made|developed|designed|created|crafted|built)(\s+with\s+\S+)?\s+by\b/gi;
// Link de crédito que não é agência: plataforma, tema, rede social, órgão.
const NAO_E_AGENCIA = /(^|\.)(wordpress\.(org|com)|wix(site)?\.com|wixstudio\.com|elementor\.com|squarespace\.com|hostinger\.com(\.br)?|hostgator\.com(\.br)?|locaweb\.com\.br|godaddy\.com|kinghost\.com\.br|umbler\.com|google\.[a-z.]+|goo\.gl|facebook\.com|fb\.(com|me)|instagram\.com|whatsapp\.com|wa\.me|youtube\.com|youtu\.be|linkedin\.com|twitter\.com|x\.com|tiktok\.com|pinterest\.[a-z.]+|t\.me|linktr\.ee|cloudflare\.com|w3\.org|schema\.org|creativecommons\.org|jquery\.com|getbootstrap\.com|fontawesome\.com|wpastra\.com|generatepress\.com|oceanwp\.org|themeisle\.com|themeforest\.net|envato\.com|elegantthemes\.com|shopify\.com|nuvemshop\.com\.br|lojaintegrada\.com\.br|tray\.com\.br|vtex\.com|canva\.(com|site)|webnode\.[a-z.]+|site123\.(com|me)|jimdo(site)?\.com|weebly\.com|strikingly\.com|hotmart\.com|doctoralia\.com\.br|ifood\.com\.br|booking\.com|tripadvisor\.[a-z.]+|airbnb\.[a-z.]+|bit\.ly|apple\.com|microsoft\.com|mozilla\.org|reclameaqui\.com\.br|jusbrasil\.com\.br|oab\.org\.br|gov\.br)$/i;

const esperar = (ms) => new Promise((pronto) => setTimeout(pronto, ms));
const mensagem = (e) => String(e?.message ?? e ?? 'erro').replace(/\s+/g, ' ').slice(0, 120);

// Sem URL(): no modo seguro do runner do n8n o contexto não tem esse global.
const partes = (link) => {
  const m = String(link ?? '').trim().match(/^(?:(https?):\/\/)?([^\/?#\s:]+)(:\d+)?([^#\s]*)/i);
  if (!m || !m[2].includes('.')) return null;
  const caminho = m[4] || '/';
  return { protocolo: (m[1] || 'http').toLowerCase(), host: m[2].toLowerCase().replace(/\.$/, ''), porta: m[3] || '',
           caminho: caminho.startsWith('/') ? caminho : '/' + caminho };
};
// Domínio registrável sem lista de sufixos: com.br, adv.br, co.uk... ficam com 3 rótulos.
const dominioBase = (host) => {
  const r = String(host).replace(/^www\./, '').split('.');
  return r.length >= 3 && r[r.length - 1].length === 2 && r[r.length - 2].length <= 4 ? r.slice(-3).join('.') : r.slice(-2).join('.');
};
const resolver = (base, destino) => {
  const d = String(destino ?? '').trim().replace(/&amp;/g, '&');
  if (/^https?:\/\//i.test(d)) return d;
  const b = partes(base);
  if (!b || !d) return '';
  if (d.startsWith('//')) return b.protocolo + ':' + d;
  const origem = b.protocolo + '://' + b.host + b.porta;
  if (d.startsWith('/')) return origem + d;
  if (d.startsWith('?')) return origem + b.caminho.split('?')[0] + d;
  return origem + b.caminho.split('?')[0].replace(/[^\/]*$/, '') + d;
};

// Os links testados por rodada: o do Google (se tiver caminho) e a raiz em
// https e http, com e sem www (www só no domínio registrável: em
// cliente.wixsite.com ou ubatuba.pousada.com.br o www não existe).
// Com caminho, a raiz pode ser de uma plataforma (mechamenozap.com.br/<lead>):
// ela só prova site se citar o nome do negócio (`conferirNome`).
const candidatas = (site) => {
  const u = partes(site);
  if (!u) return [];
  const hosts = [u.host];
  if (u.host.startsWith('www.')) hosts.push(u.host.slice(4));
  else if (dominioBase(u.host) === u.host) hosts.push('www.' + u.host);
  const lista = [];
  const por = (url, conferirNome) => { if (!lista.some((c) => c.url === url)) lista.push({ url, conferirNome }); };
  const profundo = u.caminho !== '/';
  if (profundo) por(u.protocolo + '://' + u.host + u.porta + u.caminho, false);
  for (const protocolo of [u.protocolo, u.protocolo === 'https' ? 'http' : 'https'])
    for (const h of hosts) por(protocolo + '://' + h + '/', profundo);
  return lista;
};

const normalizar = (t) => String(t ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const citaONome = (pagina, nome) => {
  const palavras = normalizar(nome).split(' ').filter((p) => p.length >= 4);
  const distintas = palavras.filter((p) => !GENERICAS.has(p));
  const texto = ' ' + normalizar(pagina) + ' ';
  return (distintas.length ? distintas : palavras).some((p) => texto.includes(' ' + p + ' '));
};

const textoVisivel = (html) => html
  .replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<(head|script|style|noscript|template|svg|iframe|object)\b[\s\S]*?<\/\1\s*>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;|&#160;/gi, ' ')
  .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, '_')
  .replace(/\s+/g, ' ')
  .trim();

// Página magra que só redireciona por meta refresh ou location em script.
const redirecionamentoNaPagina = (html, url) => {
  const meta = html.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?\s*\d*\s*;?\s*url\s*=\s*["']?([^"'>\s]+)/i);
  const js = html.match(/(?:window\.|document\.|top\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|location\.replace\(\s*["']([^"']+)["']/i);
  const destino = meta?.[1] ?? js?.[1] ?? js?.[2] ?? '';
  return destino ? resolver(url, destino) : '';
};

const paginaQueNaoESite = (titulo, texto, html) => {
  const comeco = titulo + ' ' + texto.slice(0, 5000);
  const curta = texto.length < 4 * TEXTO_MINIMO;
  if (ESTACIONADO.test(titulo) || (curta && ESTACIONADO.test(comeco))) return 'domínio à venda, expirado ou estacionado';
  if (SUSPENSO.test(titulo) || (curta && SUSPENSO.test(comeco))) return 'hospedagem suspensa';
  if (PADRAO_NO_TITULO.test(titulo)) return 'página padrão ou em construção ("' + titulo.slice(0, 60) + '")';
  if (PRIMEIRO_POST.test(texto)) return 'WordPress recém-instalado, só com o post de exemplo';
  if (texto.length < TEXTO_MINIMO && PADRAO_NO_TEXTO.test(comeco)) return 'página padrão ou em construção';
  // Em branco e sem script nenhum: nem um site feito em JavaScript.
  if (texto.length < 200 && !/<script\b/i.test(html)) return 'página em branco';
  return '';
};

// "Desenvolvido por <a href=agência>": procura no fim da página (o rodapé),
// um link para fora do domínio do site que não seja plataforma nem rede social.
const agenciaNoRodape = (html, url) => {
  // Sem as tags de formatação ("Desenvolvido <b>por</b>"); os <a> ficam, é deles o href.
  const limpo = html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<\/?(strong|b|em|i|span|small|u|font|p|br)\b[^>]*>/gi, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ');
  const fim = limpo.slice(-40000);
  const proprio = dominioBase(partes(url)?.host ?? '');
  // espadvocacia.com.br no rodapé de espadvocacia.com é o próprio dono, não agência.
  const nome = proprio.split('.')[0];
  for (const credito of fim.matchAll(CREDITO)) {
    const janela = fim.slice(Math.max(0, credito.index - 300), credito.index + 600);
    for (const link of janela.matchAll(/href\s*=\s*["']?(https?:\/\/[^"'\s>]+)/gi)) {
      const host = partes(link[1])?.host?.replace(/^www\./, '');
      if (host && dominioBase(host).split('.')[0] !== nome && !NAO_E_AGENCIA.test(host)) return host;
    }
  }
  return '';
};

const pedir = async (url, ignorarSsl, prazo) => {
  const espera = Math.min(TIMEOUT_MS, prazo - Date.now());
  if (espera <= 0) throw new Error('timeout (' + PRAZO_DO_LINK_MS / 1000 + ' s somando redirecionamentos)');
  const pedido = this.helpers.httpRequest({
    url, method: 'GET', headers: CABECALHOS, timeout: espera, encoding: 'text', returnFullResponse: true,
    ignoreHttpStatusErrors: true, disableFollowRedirect: true, skipSslCertificateValidation: ignorarSsl === true,
  });
  // Relógio próprio: o timeout do pedido é de inatividade e não cobre corpo que pinga devagar.
  let relogio;
  const limite = new Promise((_, falhar) => { relogio = setTimeout(() => falhar(new Error('timeout de ' + Math.round(espera / 1000) + ' s')), espera * 1.1); });
  try {
    return await Promise.race([pedido, limite]);
  } finally {
    clearTimeout(relogio);
  }
};

const cabecalho = (r, nome) => {
  const h = r?.headers ?? {};
  const chave = Object.keys(h).find((k) => k.toLowerCase() === nome);
  return chave ? String(h[chave] ?? '') : '';
};

// Um link: segue redirecionamento (HTTP, meta refresh e location em página
// magra) e diz o estado da página final: no_ar, magro, bloqueado, placeholder,
// outro_dominio, morto ou falha. Com `nome`, no_ar exige que a página o cite.
// Nunca lança.
const testar = async (inicio, nome) => {
  const prazo = Date.now() + PRAZO_DO_LINK_MS;
  const hostInicial = (partes(inicio)?.host ?? '').replace(/^www\./, '');
  const base = dominioBase(hostInicial);
  let url = inicio;
  let ssl = false;
  for (let salto = 0; salto <= MAX_SALTOS; salto++) {
    const alvo = partes(url);
    if (!alvo) return { url, estado: 'falha', detalhe: 'link ilegível' };
    if (salto > 0 && NAO_E_SITE.test(alvo.host)) return { url: inicio, estado: 'placeholder', detalhe: 'redireciona para ' + alvo.host.replace(/^www\./, '') };
    let r;
    try {
      r = await pedir(url, ssl, prazo);
    } catch (e) {
      // Cabeçalho grande demais para o parser do Node: o servidor respondeu.
      if (/parse error|HPE_/i.test(mensagem(e))) return { url, estado: 'magro', detalhe: 'responde, mas não deu para ler (' + mensagem(e) + ')' };
      if (ssl || !ERRO_SSL.test(mensagem(e))) return { url, estado: 'falha', detalhe: mensagem(e) };
      // Certificado vencido ou errado não prova que o site caiu: lê de novo sem conferir.
      ssl = true;
      try { r = await pedir(url, true, prazo); } catch (e2) { return { url, estado: 'falha', detalhe: mensagem(e) }; }
    }
    const status = Number(r?.statusCode ?? 0);
    const local = cabecalho(r, 'location');
    if (status >= 300 && status < 400 && local) { url = resolver(url, local); continue; }
    const corpo = typeof r?.body === 'string' ? r.body : JSON.stringify(r?.body ?? '');
    const html = corpo.slice(0, 1500000);
    const titulo = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (status >= 400 && (cabecalho(r, 'cf-mitigated').includes('challenge') || DESAFIO.test(titulo + ' ' + html.slice(0, 50000))))
      return { url, estado: 'bloqueado', detalhe: 'HTTP ' + status + ', desafio anti-robô' };
    if ([401, 403, 406, 429, 451].includes(status)) return { url, estado: 'bloqueado', detalhe: 'HTTP ' + status };
    if (status < 200 || status >= 300) return { url, estado: 'morto', detalhe: 'HTTP ' + status };
    const tipo = cabecalho(r, 'content-type');
    if (tipo && !/html|xml|text\/plain/i.test(tipo)) return { url, estado: 'magro', detalhe: 'responde ' + tipo.split(';')[0] };
    const texto = textoVisivel(html);
    if (texto.length < TEXTO_MINIMO) {
      const destino = redirecionamentoNaPagina(html, url);
      if (destino && destino !== url) { url = destino; continue; }
    }
    const naoESite = paginaQueNaoESite(titulo, texto, html);
    if (naoESite) return { url, estado: 'placeholder', detalhe: naoESite, ssl };
    // Foi parar numa página interna de outro site (pousada.traveleto.com ->
    // traveleto.com/hotel/...): é anúncio em diretório, não site próprio. Conta
    // trocar de domínio, ou sair do subdomínio de plataforma em que o link
    // estava. Domínio novo do mesmo dono costuma cair na raiz, e esse é site.
    const final = partes(url);
    const hostFinal = final.host.replace(/^www\./, '');
    const saiu = dominioBase(hostFinal) !== base || (hostInicial !== base && hostFinal !== hostInicial);
    if (saiu && !/^\/([a-z]{2}(-[a-z]{2})?\/?|index\.\w+|home\/?|inicio\/?)?$/i.test(final.caminho.split('?')[0]))
      return { url, estado: 'outro_dominio', detalhe: 'o link leva a uma página de ' + hostFinal };
    if (texto.length < TEXTO_MINIMO) return { url, estado: 'magro', detalhe: texto.length + ' caracteres de texto', ssl };
    if (nome && !citaONome(titulo + ' ' + texto, nome)) return { url, estado: 'magro', detalhe: 'responde, mas a página não cita o negócio', ssl };
    return { url, estado: 'no_ar', detalhe: 'HTTP ' + status + ', ' + texto.length + ' caracteres de texto', ssl, agencia: agenciaNoRodape(html, url) };
  }
  return { url, estado: 'falha', detalhe: 'redirecionamentos demais' };
};

// Depois de cada rodada: site no ar decide; algo que responde e não dá para
// ler decide (inconclusivo); link que só leva a diretório de outro domínio
// decide (segue como quem não tem site, sem o +40); só falha/morto/página que
// não é site espera a rodada seguinte e, na última, vira fora do ar.
const decidir = (resultados, ultima) => {
  const vivo = resultados.find((r) => r.estado === 'no_ar');
  if (vivo) return { tipo: 'no_ar', ...vivo };
  if (resultados.some((r) => r.estado === 'magro' || r.estado === 'bloqueado')) return { tipo: 'inconclusivo' };
  const diretorio = resultados.find((r) => r.estado === 'outro_dominio');
  if (diretorio) return { tipo: 'sem_site_proprio', motivo: diretorio.detalhe };
  if (!ultima) return null;
  const pagina = resultados.find((r) => r.estado === 'placeholder');
  if (pagina) return { tipo: 'fora_do_ar', motivo: pagina.detalhe + ' em ' + pagina.url };
  const detalhes = [...new Set(resultados.map((r) => r.detalhe.replace(/ [0-9A-F]{12,}:.*$/i, '')))].slice(0, 3).join('; ');
  return { tipo: 'fora_do_ar', motivo: 'nada respondeu em ' + RODADAS + ' tentativas, https e http, com e sem www: ' + detalhes };
};

const emLotes = async (tarefas, limite) => {
  const saida = new Array(tarefas.length);
  let proxima = 0;
  const trabalhar = async () => {
    while (proxima < tarefas.length) {
      const i = proxima++;
      saida[i] = await tarefas[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, tarefas.length) }, trabalhar));
  return saida;
};

const leads = $input.all().map((item) => {
  const urls = item.json.site_proprio ? candidatas(item.json.site_proprio) : [];
  return { p: item.json, urls, decisao: item.json.site_proprio && !urls.length ? { tipo: 'inconclusivo' } : null };
});
const comeco = Date.now();
for (let rodada = 1; rodada <= RODADAS; rodada++) {
  const pendentes = leads.filter((l) => l.urls.length && !l.decisao);
  const tarefas = pendentes.flatMap((l) => l.urls.map((c) => async () => ({ l, r: await testar(c.url, c.conferirNome ? l.p.nome : '') })));
  const espera = rodada > 1 ? ESPERA_ENTRE_RODADAS_MS : 0;
  const piorCaso = espera + Math.ceil(tarefas.length / SIMULTANEAS) * PRAZO_DO_LINK_MS * 1.1;
  if (!tarefas.length || Date.now() - comeco + piorCaso > TETO_MS) break;
  await esperar(espera);
  const feitos = await emLotes(tarefas, SIMULTANEAS);
  for (const l of pendentes) l.decisao = decidir(feitos.filter((f) => f.l === l).map((f) => f.r), rodada === RODADAS);
}

const saida = [];
leads.forEach(({ p, decisao }, i) => {
  if (!p.site_proprio) {
    saida.push({ json: { ...p, site_morto: false, site_status: '', descartar_site: false }, pairedItem: i });
  } else if (decisao?.tipo === 'sem_site_proprio') {
    saida.push({ json: { ...p, site_morto: false, site_status: decisao.motivo, descartar_site: false }, pairedItem: i });
  } else if (decisao?.tipo === 'fora_do_ar') {
    saida.push({ json: { ...p, site_morto: true, site_status: decisao.motivo, descartar_site: false }, pairedItem: i });
  } else if (decisao?.tipo === 'no_ar') {
    const motivo = (decisao.agencia ? 'tem site e agência (' + decisao.agencia + ')' : 'tem site') + ': ' + decisao.url
      + ' (' + decisao.detalhe + (decisao.ssl ? ', certificado SSL inválido' : '') + ')';
    // Campos que o "Linha descartada" lê do Pontuar; aqui ainda não há Gemini nem pontuação.
    saida.push({ json: { ...p, site_morto: false, site_status: '', descartar_site: true, site_no_ar_url: decisao.url,
      motivo_descarte: motivo, sinais: ['site checado antes do Gemini (não gastou Gemini nem gerador)'], score: '',
      vertical_classificada: String(p.tipo ?? '').trim().toLowerCase(), instagram_busca: '' }, pairedItem: i });
  }
  // inconclusivo: fica de fora, sem planilha (reavaliado na próxima rodada da busca).
});
return saida;
