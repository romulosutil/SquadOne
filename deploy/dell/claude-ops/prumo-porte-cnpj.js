// Filtro de porte do PRUMO: o Google não diz o tamanho da empresa, o CNPJ diz.
// Alvo: PME de 8 a 40 pessoas, 1 a 3 unidades, que já fatura (EPP ou DEMAIS).
// Só confere quem passou na pontuação (status REVIEW); o resto segue igual.
// CNPJ: o do site (home já baixada; senão páginas de contato e política).
// Porte: Receita pela BrasilAPI (minhareceita.org de reserva).
const UA = 'Mozilla/5.0 (compatible; PRUMO-LeadScout/1.0)';
const SUBPAGINAS = ['politica-de-privacidade', 'contato', 'quem-somos', 'sobre'];
const MAX_AVALIACOES = 1000;          // acima disso é rede ou varejo grande
const MIN_AVALIACOES_SEM_CNPJ = 10;   // sem CNPJ e quase sem avaliação: micro
const CAPITAL_GRANDE = 10_000_000;
const MESMO_NOME_REDE = 3;            // 3+ unidades com o mesmo nome na busca
const HOSPEDAGEM_GRATUITA = /(linktr\.ee|netlify\.app|vercel\.app|github\.io|wixsite\.com|webnode|negocio\.site|business\.site|sites\.google|blogspot|carrd\.co|bio\.link|beacons\.ai|ola\.click|goomer|anota\.ai|cardapio|ifood|instagram\.com|facebook\.com|wa\.me|whatsapp\.com|mechameaqui)/i;
const REDES = /\b(assai|makro|sams club|carrefour|tenda atacado|roldao|spani|max atacadista|fort atacadista|tauste|pao de acucar|st marche|hirota|boticario|sephora|drogasil|droga raia|pague menos|leroy merlin|telhanorte|obramax|casa do construtor|lig chopp|ambev|femsa|heineken|coca-cola)\b/;
const FORA_DO_SEGMENTO = /\b(consultoria|assessoria|treinamento|contabil|contabilidade|advocacia|engenharia|escola|cursos?|agencia|marketing)\b/;
const GENERICAS = new Set(['distribuidora', 'distribuidor', 'distribuicao', 'comercio', 'comercial', 'atacadista', 'atacado',
  'alimentos', 'bebidas', 'embalagens', 'cosmeticos', 'produtos', 'importacao', 'importadora', 'exportacao', 'industria',
  'materiais', 'construcao', 'limpeza', 'autopecas', 'pecas', 'ltda', 'eireli', 'servicos', 'loja', 'lojas', 'store',
  'brasil', 'paulo', 'santo', 'andre', 'campinas', 'guarulhos', 'osasco', 'sorocaba', 'jundiai', 'bernardo', 'campo',
  'campos', 'jose', 'ribeirao', 'preto', 'grupo', 'empresa', 'profissional', 'festas']);

const normalizar = v => String(v ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const dv = (base) => {
  let soma = 0, peso = base.length - 7;
  for (const c of base) { soma += Number(c) * peso--; if (peso < 2) peso = 9; }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
};
const cnpjValido = c => c.length === 14 && !/^(\d)\1+$/.test(c)
  && dv(c.slice(0, 12)) === Number(c[12]) && dv(c.slice(0, 13)) === Number(c[13]);
const cnpjsNoHtml = (html) => {
  const bruto = String(html ?? '');
  const texto = bruto + ' ' + bruto.replace(/<[^>]+>/g, '');
  return [...new Set((texto.match(/(?<!\d)\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}(?!\d)/g) ?? [])
    .map(x => x.replace(/\D/g, '')).filter(cnpjValido))];
};
const formatarCnpj = c => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
const reais = v => v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  : v >= 1e3 ? `R$ ${Math.round(v / 1e3)} mil` : `R$ ${v}`;

const buscar = async (url, json = false) => {
  try { return await this.helpers.httpRequest({ url, json, timeout: 8000, headers: { 'User-Agent': UA } }); }
  catch { return null; }
};
const receita = async (cnpj) => {
  for (const url of [`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, `https://minhareceita.org/${cnpj}`]) {
    const r = await buscar(url, true);
    if (r && r.cnpj) return r;
  }
  return null;
};

// O CNPJ do site só vale se bater com a empresa (CEP, cidade ou nome):
// evita pegar o CNPJ da plataforma de pagamento ou da agência do site.
const bate = (lead, r) => {
  const endereco = normalizar(lead.address);
  const cep = String(r.cep ?? '').replace(/\D/g, '');
  if (cep.length === 8 && endereco.replace(/\D/g, '').includes(cep)) return true;
  if (r.municipio && endereco.includes(normalizar(r.municipio))) return true;
  const nomes = normalizar(`${r.razao_social ?? ''} ${r.nome_fantasia ?? ''}`);
  const palavras = new Set(nomes.split(/[^a-z0-9]+/));
  return normalizar(lead.company_name).split(/[^a-z0-9]+/)
    .some(t => !GENERICAS.has(t) && ((t.length >= 3 && palavras.has(t)) || (t.length >= 5 && nomes.includes(t))));
};

const julgarReceita = (r, cnpj) => {
  const situacao = normalizar(r.descricao_situacao_cadastral);
  const porte = normalizar(r.porte);
  const cnae = Number(r.cnae_fiscal ?? 0);
  const divisao = Math.floor(cnae / 100000);
  const capital = Number(r.capital_social ?? 0);
  const unidade = Number(cnpj.slice(8, 12));
  const inicio = new Date(r.data_inicio_atividade ?? '');
  const meses = (Date.now() - inicio.getTime()) / (30.4 * 86400000);
  if (situacao && situacao !== 'ativa') return `CNPJ ${situacao} na Receita`;
  if (r.opcao_pelo_mei) return 'micro, MEI';
  if (porte === 'micro empresa') return 'micro, microempresa na Receita (faturamento declarado até R$ 360 mil/ano)';
  if (cnae && ![45, 46, 47].includes(divisao)) return `fora do segmento, atividade principal é ${r.cnae_fiscal_descricao}`;
  if (unidade >= 4) return `rede, o CNPJ do site é a unidade nº ${unidade}`;
  if (capital >= CAPITAL_GRANDE) return `porte grande, capital social de ${reais(capital)}`;
  if (unidade === 1 && meses < 12) return 'empresa aberta há menos de 1 ano';
  return '';
};

const resumo = (r, cnpj) => [
  `CNPJ ${formatarCnpj(cnpj)}`,
  { 'empresa de pequeno porte': 'EPP', 'demais': 'porte DEMAIS' }[normalizar(r.porte)] ?? (r.porte || 'porte não informado'),
  `capital ${reais(Number(r.capital_social ?? 0))}`,
  r.cnae_fiscal_descricao,
  r.data_inicio_atividade ? `desde ${String(r.data_inicio_atividade).slice(0, 4)}` : '',
].filter(Boolean).join(' · ');

let lote = [];
try { lote = $('Normalizar empresas').all().map(i => normalizar(i.json.company_name)); } catch {}
const unidades = new Map();
for (const n of lote) unidades.set(n, (unidades.get(n) ?? 0) + 1);

const conferir = async (lead) => {
  const nome = normalizar(lead.company_name);
  const avaliacoes = Number(lead.review_count ?? 0);
  const site = String(lead.website ?? '');
  const fora = (motivo) => ({ ...lead, status: 'DESCARTAR', research_note: `Fora do perfil PME: ${motivo}` });

  if (avaliacoes > MAX_AVALIACOES) return fora(`rede ou varejo grande (${avaliacoes} avaliações no Google)`);
  if (REDES.test(nome)) return fora('rede ou marca grande');
  if ((unidades.get(nome) ?? 0) >= MESMO_NOME_REDE) return fora(`rede (${unidades.get(nome)} unidades com o mesmo nome na busca)`);
  if (FORA_DO_SEGMENTO.test(nome)) return fora('serviço ou consultoria, não é comércio');
  if (HOSPEDAGEM_GRATUITA.test(site)) return fora('micro, sem site próprio');

  let candidatos = cnpjsNoHtml(await buscar(site));
  const origem = site.match(/^https?:\/\/[^/?#]+/i)?.[0];
  if (!candidatos.length && origem) {
    const paginas = await Promise.all(SUBPAGINAS.map(p => buscar(`${origem}/${p}`)));
    candidatos = [...new Set(paginas.flatMap(cnpjsNoHtml))];
  }
  for (const cnpj of candidatos.slice(0, 3)) {
    const r = await receita(cnpj);
    if (!r || !bate(lead, r)) continue;
    const motivo = julgarReceita(r, cnpj);
    if (motivo) return { ...fora(motivo), cnpj: formatarCnpj(cnpj) };
    return { ...lead, cnpj: formatarCnpj(cnpj), porte_resumo: resumo(r, cnpj),
      proxima_acao: 'Porte conferido pelo CNPJ. Veja o site; se fizer sentido, clique em Enviar convite.' };
  }
  const semCnpj = candidatos.length ? 'CNPJ do site não confere com a empresa' : 'CNPJ não encontrado no site';
  if (avaliacoes < MIN_AVALIACOES_SEM_CNPJ) return fora(`micro, ${candidatos.length ? 'CNPJ do site não confere' : 'sem CNPJ no site'} e só ${avaliacoes} avaliação(ões)`);
  return { ...lead, porte_resumo: semCnpj, proxima_acao: `${semCnpj}: confira o porte antes de enviar o convite.` };
};

const itens = $input.all().map(i => i.json);
const saida = [];
for (let i = 0; i < itens.length; i += 4) {
  const bloco = itens.slice(i, i + 4);
  saida.push(...await Promise.all(bloco.map(l => l.status === 'REVIEW' ? conferir(l) : l)));
}
return saida.map(json => ({ json }));
