// Cruza os recibos (publicado.json) com a planilha e monta a abordagem.
// Textos e utilitarios (VARIACOES, alocarRodada, telefoneE164, detalheDoBriefing...) vem de
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
// 08/10/2026: pasta em _descartados/ é lead que o gerador tirou da esteira; recibo de lá nunca
// vira "pronto" (o runner só descarta quem não tem publicado.json, mas uma pasta movida à mão pode ter).
const emDescartados = (dir) => String(dir).split('/').includes('_descartados');

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
// 08/10/2026: o DOSSIE.md só nasce no modo personalizado (etapa A do gerador). Os leads refeitos
// em 07/10 à tarde (v1) não têm personalizado.json, que veio depois, e saíam "padrão": quem tem
// dossiê e não tem marca é ao menos v1. A marca, quando existe, vence.
const comDossie = new Set($('Ler dossiês do modo personalizado').all()
  .map(d => String(d.binary?.data?.directory ?? '')).filter(dir => dir && !ehCopia(dir)));
const versaoDoSite = (dir) => (versaoNaPasta[dir] ? 'personalizado-v' + versaoNaPasta[dir]
  : comDossie.has(dir) ? 'personalizado-v1' : 'padrão');

const porPlaceId = {};
for (const linha of linhas) {
  const pid = linha.json.place_id;
  if (pid) porPlaceId[pid] = linha.json;
}

const saida = [];
// Lead com recibo fora de _descartados/: está vivo, mesmo que uma cópia antiga dele tenha sido descartada.
const comRecibo = new Set();
// 14/10/2026: a letra sai da alocação balanceada por nicho (alocarRodada, site-mensagem.js), que
// precisa de todos os leads da rodada de uma vez: o laço junta, a alocação roda, e só então monta.
const aMontar = [];

recibos.forEach((item, i) => {
  const rec = item.json.recibo || {};
  const pid = rec.place_id;
  const dir = pastaDe(arquivosDosRecibos, item, i);
  if (!pid || ehCopia(dir) || emDescartados(dir)) return;
  comRecibo.add(pid);

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
  // 14/10/2026 (demo sob pedido): o recibo do Raio-X avulso nao tem site_url; o lead vira "pronto" com o
  // raio-x e recebe a C. O site_url chega depois, quando o Romulo toca "Gerar demo" e o gerador publica.
  const raioXUrl = String(rec.raio_x_url || '').trim();
  if (!siteUrl && !raioXUrl) return;
  // Enviado so com o raio-x: nada a preencher ate o demo sair (sem isto, uma escrita igual por hora).
  if (semSite && !siteUrl) return;
  aMontar.push({ pid, rec, linha, status, waAtual, siteVersao, siteUrl, ehNovo, semSite });
});

// A linha leva nota e avaliacoes (Cacador): sem nota boa, a variacao B nao entra.
// O recibo leva raio_x_url e raio_x_pontos (raio-x.py): sem os dois, a C nao entra.
// Sem site_url (demo sob pedido), sem_demo: so a C cabe, e sem raio-x nao ha mensagem (null).
const leadDaVariante = (m) => ({ ...m.linha, raio_x_url: m.rec.raio_x_url, raio_x_pontos: m.rec.raio_x_pontos, sem_demo: !m.siteUrl });
// Só quem grava a letra entra na alocação: o enviado sem site (semSite) só ganha o wa_me.
const alocadas = alocarRodada(linhas.map(l => l.json), aMontar
  .filter(m => !m.semSite && telefoneE164(m.linha.telefone))
  .map(m => ({
    placeId: m.pid, nicho: m.linha.vertical, eua: ehEua(telefoneE164(m.linha.telefone)), lead: leadDaVariante(m),
    salva: { letra: m.linha.mensagem_variante, elegiveis: m.linha.ab_elegiveis },
  })));

for (const { pid, rec, linha, status, waAtual, siteVersao, siteUrl, ehNovo, semSite } of aMontar) {
  const nome = linha.nome || rec.nome || '';
  const telefone = telefoneE164(linha.telefone);

  let waLink = '';
  let letra = '';
  let elegiveis = '';
  // Enviado que ganha o site agora (demo pedido depois do raio-x): a primeira mensagem ja foi, e o wa_me
  // guarda o que foi enviado. Remontar trocaria o registro por outro texto (o sorteio muda com o site).
  const manterWaMe = semSite && String(linha.wa_me || '').trim();
  if (telefone && !manterWaMe) {
    const eua = ehEua(telefone);
    // A alocacao ja decidiu quem grava letra (null = nenhuma mensagem possivel); o enviado sem site
    // ficou fora dela e so ganha o wa_me, pelo sorteio de sempre.
    const variante = Object.prototype.hasOwnProperty.call(alocadas, pid) ? alocadas[pid]
      : varianteDe(pid, eua, leadDaVariante({ rec, linha, siteUrl }));
    if (variante) {
      letra = variante.letra;
      elegiveis = variante.elegiveis || '';
      const mensagem = preencher(variante.molde, nome, siteUrl, eua ? '' : detalheDoBriefing(linha.briefing));
      waLink = 'https://wa.me/' + telefone + '?text=' + encodeURIComponent(mensagem);
    }
  }
  // Sem demo e sem mensagem possivel (EUA, ou o raio-x sem pontos): o lead fica como esta, sem virar pronto.
  if (!siteUrl && !waLink && !manterWaMe) continue;

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
    // 08/10/2026: o link do Raio-X vai para a planilha porque a segunda mensagem (aviso de
    // interesse e ficha do CRM) e montada da linha, nao do recibo. Vazio sem Raio-X no ar.
    raio_x_url: String(rec.raio_x_url || '').trim(),
    // A variacao que o wa_link leva, so enquanto o lead nao foi enviado: o clique marca
    // "enviado" e a letra fica; envio que o observador ve sem o clique vira "manual".
    // ab_elegiveis (14/10/2026) vai na MESMA escrita: as letras do sorteio, que dizem com quem a
    // letra pode ser comparada. Congela junto com a letra quando o lead sai de "pronto".
    ...(semSite ? {} : { mensagem_variante: letra, ab_elegiveis: elegiveis }),
  } });
}

// Descartes do gerador (08/10/2026): o runner move para _descartados/ o lead em que o Claude
// gravou DESCARTAR.md (já tem site, rede, duplicado), mas não escreve na planilha, e o lead
// seguia "novo" para sempre: o CRM apontava divergência e o funil semanal o contava como lead.
// Só "novo" (ou vazio) vira "descartado"; o que já andou (pronto, enviado, recusado...) não muda.
// Reabrir um descartado é voltar a pasta para a raiz E pôr "novo" na planilha.
const PLACE_ID = /place_id[:* \t]+([a-zA-Z0-9_-]+)/i;
const arquivosDosDescartes = $('Ler descartes do gerador').all();
const descartados = new Set();
$('Ler o texto do descarte').all().forEach((d, i) => {
  const m = PLACE_ID.exec(String(d.json?.conteudo ?? ''));
  if (m && emDescartados(pastaDe(arquivosDosDescartes, d, i))) descartados.add(m[1]);
});
for (const pid of descartados) {
  if (comRecibo.has(pid)) continue;
  const linha = porPlaceId[pid];
  const status = String(linha?.status ?? '').trim();
  if (linha && (status === '' || status === 'novo')) saida.push({ json: { place_id: pid, status: 'descartado' } });
}

return saida;
