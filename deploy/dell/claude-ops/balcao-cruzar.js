// Cruza os recibos (publicado.json) com a planilha e monta a abordagem.
// Textos e utilitarios (VARIACOES, varianteDe, telefoneE164, detalheDoBriefing...) vem de
// site-mensagem.js, que o site-antes-da-venda.py poe na frente deste codigo.

// 29/09/2026: o link rastreado passa pela tailnet (tailscale serve /webhook ->
// n8n do Dell), entao abre no celular com Tailscale, nao so no Dell.
const LINKS = 'https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook';

const recibos = $('Ler o JSON do recibo').all();
const arquivosDosRecibos = $('Ler recibos da pasta auto').all();
const linhas = $input.all();

// Pasta de cada arquivo lido (o readWriteFile guarda o diretorio no binario).
const pastaDe = (arquivos, item, i) => String(arquivos[item.pairedItem?.item ?? i]?.binary?.data?.directory ?? '');
// 07/10/2026: o modo personalizado guarda o site anterior em <slug>/_v1/ (e o que falhou em
// _tentativa-falha/), com o publicado.json junto e o mesmo place_id. Essa copia nao e o lead.
const ehCopia = (dir) => String(dir).split('/').pop().startsWith('_');

// site_versao (07/10/2026): o personalizado.json da pasta do lead (gerador-de-sites.py,
// marcar_personalizado) diz a versao do modo personalizado; sem ele, o site saiu no
// modo padrao. Leitura que falhou ou pasta sem nenhum arquivo nao tem "marca": vale padrao.
const arquivosDasMarcas = $('Ler marcas do modo personalizado').all();
const versaoNaPasta = {};
$('Ler o JSON da marca').all().forEach((m, i) => {
  const v = Number(m.json?.marca?.versao);
  const dir = pastaDe(arquivosDasMarcas, m, i);
  if (dir && !ehCopia(dir) && Number.isInteger(v) && v > 0) versaoNaPasta[dir] = v;
});
const versaoDoSite = (dir) => (versaoNaPasta[dir] ? 'personalizado-v' + versaoNaPasta[dir] : 'padrão');

const porPlaceId = {};
for (const linha of linhas) {
  const pid = linha.json.place_id;
  if (pid) porPlaceId[pid] = linha.json;
}

const saida = [];

recibos.forEach((item, i) => {
  const rec = item.json.recibo || {};
  const pid = rec.place_id;
  const dir = pastaDe(arquivosDosRecibos, item, i);
  if (!pid || ehCopia(dir)) return;

  // Recibo sem linha correspondente: arquivo orfao, ignora em silencio.
  const linha = porPlaceId[pid];
  if (!linha) return;

  const status = String(linha.status || '').trim();
  const waAtual = String(linha.wa_link || '').trim();
  const siteVersao = versaoDoSite(dir);

  // So mexe em lead novo (que vira pronto) ou em lead pronto, cujo link e
  // remontado a cada rodada (assim uma correcao no texto chega a todos).
  // Um lead ja enviado nunca volta para pronto.
  // 29/09/2026: enviado sem site_url (o observador marcou a resposta antes de o
  // Balcao passar) ganha site e wa_me uma vez, sem mudar de status.
  const ehNovo = status === '' || status === 'novo';
  const semSite = (status === 'enviado' || status === 'expirado') && !String(linha.site_url || '').trim();
  if (!ehNovo && status !== 'pronto' && !semSite) {
    // Enviado (ou adiante): so a versao do site, quando a coluna ainda nao diz a da pasta.
    // Lead enviado nunca e refeito, entao isto so acerta a primeira vez (e a janela entre
    // um refazer e o envio, se o Romulo mandar antes desta rodada).
    if (String(linha.site_versao || '').trim() !== siteVersao) saida.push({ json: { place_id: pid, site_versao: siteVersao } });
    return;
  }

  const siteUrl = rec.site_url || linha.site_url || '';
  if (!siteUrl) return;

  const nome = linha.nome || rec.nome || '';
  const telefone = telefoneE164(linha.telefone);

  let waLink = '';
  let letra = '';
  if (telefone) {
    const eua = ehEua(telefone);
    const variante = varianteDe(pid, eua);
    letra = variante.letra;
    const mensagem = preencher(variante.molde, nome, siteUrl, eua ? '' : detalheDoBriefing(linha.briefing));
    waLink = 'https://wa.me/' + telefone + '?text=' + encodeURIComponent(mensagem);
  }

  // 23/09/2026: wa_link passa a ser o link rastreado do n8n do Dell. O clique
  // marca o lead como enviado e redireciona para o wa.me real, guardado em wa_me.
  const waMe = waLink || String(linha.wa_me || '').trim() || (waAtual.indexOf('https://wa.me/') === 0 ? waAtual : '');
  saida.push({ json: {
    place_id: pid,
    status: ehNovo ? 'pronto' : status,
    site_url: siteUrl,
    vercel_project: rec.vercel_project || linha.vercel_project || '',
    wa_me: waMe,
    wa_link: waMe ? LINKS + '/enviar?place_id=' + encodeURIComponent(pid) : waAtual,
    site_versao: siteVersao,
    // A variacao que o wa_link leva, so enquanto o lead nao foi enviado: o clique marca
    // "enviado" e a letra fica; envio que o observador ve sem o clique vira "manual".
    ...(semSite ? {} : { mensagem_variante: letra }),
  } });
});

return saida;
