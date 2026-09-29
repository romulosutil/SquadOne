// Cruza os recibos (publicado.json) com a planilha e monta a abordagem.
// Textos e utilitarios (VARIACOES, telefoneE164, detalheDoBriefing...) vem de
// site-mensagem.js, que o site-antes-da-venda.py poe na frente deste codigo.

// 29/09/2026: o link rastreado passa pela tailnet (tailscale serve /webhook ->
// n8n do Dell), entao abre no celular com Tailscale, nao so no Dell.
const LINKS = 'https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/webhook';

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
  // 29/09/2026: enviado sem site_url (o observador marcou a resposta antes de o
  // Balcao passar) ganha site e wa_me uma vez, sem mudar de status.
  const ehNovo = status === '' || status === 'novo';
  const semSite = (status === 'enviado' || status === 'expirado') && !String(linha.site_url || '').trim();
  if (!ehNovo && status !== 'pronto' && !semSite) continue;

  const siteUrl = rec.site_url || linha.site_url || '';
  if (!siteUrl) continue;

  const nome = linha.nome || rec.nome || '';
  const telefone = telefoneE164(linha.telefone);

  let waLink = '';
  if (telefone) {
    const eua = ehEua(telefone);
    const molde = eua ? VARIACAO_EN : (VARIACOES[indice % VARIACOES.length] || VARIACOES[0]);
    const mensagem = preencher(molde, nome, siteUrl, eua ? '' : detalheDoBriefing(linha.briefing));
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
    wa_link: waMe ? LINKS + '/enviar?place_id=' + encodeURIComponent(pid) : waAtual
  } });
  indice = indice + 1;
}

return saida;
