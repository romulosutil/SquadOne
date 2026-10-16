/**
 * PURO: o "Catálogo de Negócios Maçônicos" (PDF do macons.org, 15/10/2026) -> leads do filtro Plus do CRM.
 *
 * O PDF é uma grade de três colunas (x ≈ 29, 215 e 401) com cartões empilhados: nome (9,5 pt), telefone
 * e links (7,8 pt) e descrição cortada (7,3 pt). O cabeçalho "CIDADE: X - UF" vale para a largura toda e
 * para tudo abaixo dele, inclusive na página seguinte. Aqui só se lê os itens de texto já posicionados
 * (quem abre o PDF é scripts/plus-importar.ts); nada de arquivo, rede ou relógio.
 *
 * Plus (15/10/2026, pedido do Rômulo): os melhores leads, abordados com a saudação maçônica. Cada um cai
 * numa das quatro ofertas do funil (site, prumo, iris, estampa) pelo que a empresa é e tem.
 */

import { createHash } from "node:crypto";

export interface ItemDoPdf {
  s: string;
  x: number;
  y: number;
  h: number;
}

export interface CartaoDoCatalogo {
  nome: string;
  cidade: string;
  uf: string;
  telefones: string[];
  links: string[];
  descricao: string;
}

export const OFERTAS_DO_PLUS = ["site", "prumo", "iris", "estampa"] as const;
export type OfertaDoPlus = (typeof OFERTAS_DO_PLUS)[number];

export interface LeadPlus {
  id: string;
  empresa: string;
  nicho: string;
  cidade: string;
  uf: string;
  whatsapp: string;
  /** Fixo (10 dígitos): o WhatsApp Business roda em fixo, mas o número precisa ser conferido antes. */
  fixo: boolean;
  site?: string;
  instagram?: string;
  oferta: OfertaDoPlus;
  descricao: string;
  /** Outras empresas que usam o mesmo WhatsApp (uma conversa só por número). */
  tambem?: string[];
}

export interface ExcluidoDoPlus {
  nome: string;
  cidade: string;
  motivo: string;
}

/** Entrou no catálogo sem telefone legível: não dá para abrir uma conversa, fica guardado para completar à mão. */
export interface SemTelefoneDoPlus {
  nome: string;
  cidade: string;
  uf: string;
  descricao: string;
  site?: string;
  instagram?: string;
}

// ------------------------------------------------------------------ leitura do PDF

const LIMITE_DO_RODAPE = 45;
const COLUNAS = [120, 310];
const ALTURA_DO_NOME = 9;
const ALTURA_DO_TELEFONE = 7.6;
const SALTO_ENTRE_LINHAS_DO_NOME = 13;

const coluna = (x: number) => (x < COLUNAS[0] ? 0 : x < COLUNAS[1] ? 1 : 2);
const ehTelefone = (s: string) => /^[\d\s().+-]+$/.test(s) && s.replace(/\D/g, "").length >= 8;
const ehCabecalhoDeCidade = (s: string) => /^CIDADE:/i.test(s.trim());
const ehCabecalhoDeEstado = (s: string) => /^E S T A D O/i.test(s.trim());

interface Cidade {
  cidade: string;
  uf: string;
}

function cidadeDoCabecalho(texto: string): Cidade | null {
  const m = /^CIDADE:\s*(.+?)\s*-\s*([A-Z]{2})\s*$/i.exec(texto.trim());
  return m ? { cidade: m[1].trim(), uf: m[2].toUpperCase() } : null;
}

interface Rascunho {
  nome: string[];
  telefones: string[];
  blocosDeLink: string[][];
  descricao: string[];
  y: number;
  ultimaLinhaDoNome: number;
}

export function lerCatalogo(paginas: ItemDoPdf[][]): CartaoDoCatalogo[] {
  const cartoes: CartaoDoCatalogo[] = [];
  let vigente: Cidade = { cidade: "", uf: "" };
  for (const itens of paginas) {
    const corpo = itens.filter((i) => i.y > LIMITE_DO_RODAPE && i.s.trim());
    // Do mais baixo para o mais alto: o primeiro acima de um cartão é o cabeçalho mais próximo dele.
    const cabecalhos = corpo
      .filter((i) => ehCabecalhoDeCidade(i.s))
      .flatMap((i) => { const c = cidadeDoCabecalho(i.s); return c ? [{ y: i.y, ...c }] : []; })
      .sort((a, b) => a.y - b.y);
    const doCartao = corpo.filter((i) => !ehCabecalhoDeCidade(i.s) && !ehCabecalhoDeEstado(i.s));
    const rascunhos: Array<{ r: Rascunho; cidade: Cidade }> = [];
    for (const c of [0, 1, 2]) {
      const daColuna = doCartao.filter((i) => coluna(i.x) === c).sort((a, b) => b.y - a.y);
      let atual: Rascunho | null = null;
      for (const item of daColuna) {
        const texto = item.s.trim();
        if (item.h >= ALTURA_DO_NOME) {
          if (atual && atual.telefones.length === 0 && atual.blocosDeLink.length === 0 && atual.descricao.length === 0
            && atual.ultimaLinhaDoNome - item.y <= SALTO_ENTRE_LINHAS_DO_NOME) {
            atual.nome.push(texto);
            atual.ultimaLinhaDoNome = item.y;
            continue;
          }
          atual = { nome: [texto], telefones: [], blocosDeLink: [], descricao: [], y: item.y, ultimaLinhaDoNome: item.y };
          const acima = cabecalhos.find((h) => h.y > item.y);
          rascunhos.push({ r: atual, cidade: acima ? { cidade: acima.cidade, uf: acima.uf } : vigente });
          continue;
        }
        if (!atual) continue;
        if (item.h >= ALTURA_DO_TELEFONE) {
          if (ehTelefone(texto)) {
            atual.telefones.push(texto);
          } else {
            // Linhas seguidas de link são o mesmo endereço quebrado; um endereço novo começa em http, www ou @.
            const bloco = atual.blocosDeLink[atual.blocosDeLink.length - 1];
            if (bloco && !/^(https?:|www\.|@)/i.test(texto) && !/\s/.test(texto) && !/\s/.test(bloco[bloco.length - 1])) bloco.push(texto);
            else atual.blocosDeLink.push([texto]);
          }
        } else {
          atual.descricao.push(texto);
        }
      }
    }
    for (const { r, cidade } of rascunhos) {
      // A capa ("Catálogo de Negócios Maçonicos", o lema) vem antes de qualquer cidade: não é empresa.
      if (!cidade.cidade) continue;
      cartoes.push({
        nome: r.nome.join(" ").replace(/\s+/g, " ").trim(),
        cidade: cidade.cidade,
        uf: cidade.uf,
        telefones: r.telefones,
        links: r.blocosDeLink.map((b) => b.join("")).flatMap((b) => b.split(/(?=https?:\/\/)/)).map((b) => b.trim()).filter(Boolean),
        descricao: r.descricao.join(" ").replace(/\s+/g, " ").trim(),
      });
    }
    // O último cabeçalho da página segue valendo no topo da seguinte.
    const ultimo = cabecalhos[0];
    if (ultimo) vigente = { cidade: ultimo.cidade, uf: ultimo.uf };
  }
  return cartoes;
}

// ------------------------------------------------------------------ telefone

/**
 * O número como o WhatsApp o quer (55 + DDD + número), ou null quando não dá para confiar nele.
 * Aceita "(081)9.8147.8194" (zero de operadora), "55 41 999755873" e "210993405288" (zero perdido depois do DDD).
 */
export function normalizarTelefone(bruto: string): { whatsapp: string; fixo: boolean } | null {
  let d = bruto.replace(/\D/g, "");
  if (d.startsWith("55") && d.length >= 12) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 12 && d[2] === "0") d = d.slice(0, 2) + d.slice(3);
  if (d.length === 11 && d[2] === "9") return /^[1-9][1-9]/.test(d) ? { whatsapp: `55${d}`, fixo: false } : null;
  if (d.length === 10 && /^[2-5]/.test(d[2]) && /^[1-9][1-9]/.test(d)) return { whatsapp: `55${d}`, fixo: true };
  // Celular antigo de 8 dígitos começando em 6 a 9 (sem o nono dígito): trata como inválido, não adivinha.
  return null;
}

// ------------------------------------------------------------------ classificação

const semAcento = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Marcas e filiais: o dono não decide o marketing, e o catálogo traz o consultor de vendas como se fosse empresa. */
const NAO_PROSPECTAR = [
  [/\bitau\b|unibanco/, "banco (agência de rede)"],
  [/\btoyota\b|\bnissan\b|\bhonda\b/, "concessionária de montadora (vendedor, não dono)"],
  [/\btoken\b/, "token/criptoativo"],
  [/colet[aâ]nea|livro/, "livro, não empresa"],
] as const;

// Roupa, não caneca nem brinde: o CRM de estamparia é de pedido de roupa (o mesmo recorte de prumo-ofertas.json).
const ESTAMPARIA = /camiset|camisas? personaliz|estamparia|serigraf|\bsilk|uniforme|bordad|\bdtf\b/;
const IRIS = /psicolog|psicanal|neuropsic|fonoaudi|\bterapia|terapeut|autis|psicopedag|hipnoterap|saude mental|desenvolvimento emocional/;

const NICHOS: Array<[RegExp, string]> = [
  [ESTAMPARIA, "Estamparia e personalizados"],
  [/advoca|advogad|juridic|oab|direito/, "Advocacia"],
  [/contab|fiscal|tribut|abertura de empresas|bpo/, "Contabilidade"],
  [/seguro|corretor(a)? de seguros/, "Seguros"],
  [/psicolog|psicanal|neuropsic|fonoaudi|terapia|terapeut|hipnoterap|saude mental/, "Psicologia e terapias"],
  [/engenharia|construc|construtora|reforma|obras|drywall|pintura|esquadria|topograf|agrimens|vidrac|marcenaria|gesso|forro/, "Construção e engenharia"],
  [/imovei|imobili|corretagem|avaliacao imobiliaria/, "Imobiliário"],
  [/informatica|tecnologia|software|sistemas|sites?|ti|t.i.|redes de computadores|automacao|ciber|celular/, "Tecnologia"],
  [/marketing|publicidade|comunicacao|design|grafica|agencia|audio|video|musica/, "Marketing e comunicação"],
  [/odonto|dental|clinica|medic|saude|fisioterap|laborator|nutri|vacina|farmac|drogaria|estetica/, "Saúde"],
  [/escola|colegio|cursos?|idiomas|educac|ensino|mentoria|oratoria/, "Educação"],
  [/restaurante|lanches|pastel|bolos?|doce|cachaca|chopp|cafe|vinho|alimenti|churrasc|conserva|pizza/, "Alimentação"],
  [/mecanica|autopecas|automotiv|guincho|veiculo|motos|caminho|turbo|funilaria|transporte|logistica|mudancas|fretamento/, "Automotivo e transporte"],
  [/energia|solar|eletric|fotovoltaic|refrigeracao|ar condicionado|climatiz/, "Energia e climatização"],
  [/agro|agricol|rural|commodities|bioestimul|pecuaria/, "Agro"],
  [/roupa|moda|confecc|ternos?|paramentos|barbear|joias|perfum|vestuario|calcados|pijama/, "Moda e vestuário"],
  [/academia|jiu|judo|karate|treinamento|pilates|personal/, "Esporte e bem-estar"],
];

/** O nome decide primeiro ("Liberty T.I." é tecnologia mesmo que a descrição fale em saúde); depois, nome e descrição. */
function nichoDe(nome: string, descricao: string): string {
  const doNome = NICHOS.find(([re]) => re.test(semAcento(nome)))?.[1];
  return doNome ?? NICHOS.find(([re]) => re.test(semAcento(`${nome} ${descricao}`)))?.[1] ?? "Outros";
}

const ehInstagram = (url: string) => /instagram\.com|^@|^instagram:/i.test(url);
const ehAgregador = (url: string) => /linktr\.ee|bio\.link|beacons\.ai|wa\.me|api\.whatsapp|facebook\.com|fb\.com/i.test(url);

/** O link vira https://...; "www.x.com.br" e "x.com.br" também valem. Vazio quando não parece endereço. */
function enderecoHttps(bruto: string): string {
  const s = bruto.trim().replace(/^[^\w@]+/, "");
  if (/^https?:\/\//i.test(s)) return s.replace(/^http:\/\//i, "https://");
  if (/^www\./i.test(s) || /^[a-z0-9-]+(\.[a-z0-9-]+)*\.(com|net|org|br|app|io|dev|site|online)(\/|$)/i.test(s)) return `https://${s}`;
  return "";
}

function dadosDosLinks(links: string[], descricao: string): { site?: string; instagram?: string } {
  let site: string | undefined;
  let instagram: string | undefined;
  for (const link of links) {
    if (ehInstagram(link)) {
      const m = /instagram\.com\/([A-Za-z0-9._]+)/i.exec(link);
      if (m && !instagram) instagram = m[1];
      continue;
    }
    const url = enderecoHttps(link);
    if (url && !ehAgregador(url) && !site) site = url.slice(0, 300);
  }
  if (!instagram) {
    const m = /instagram:?\s*@([A-Za-z0-9._]+)/i.exec(descricao);
    if (m) instagram = m[1];
  }
  return { ...(site ? { site } : {}), ...(instagram ? { instagram } : {}) };
}

/** Quanto mais completo o cartão, mais vale quando duas entradas são a mesma empresa. */
const completude = (c: CartaoDoCatalogo) => c.descricao.length + c.links.length * 40 + c.telefones.length * 10;

export function idDoPlus(whatsapp: string): string {
  return `p${createHash("sha1").update(`plus:${whatsapp}`).digest("hex").slice(0, 10)}`;
}

/**
 * Cartões -> leads. Um lead por WhatsApp: a mesma empresa em duas categorias (Viaconta, Colégio Visão) e dois
 * negócios do mesmo dono no mesmo número viram um só, com os outros nomes em `tambem`. Quem não tem número
 * legível ou é marca/filial/livro fica fora, com o motivo, para o relatório conferir.
 */
export function prepararPlus(cartoes: CartaoDoCatalogo[]): { leads: LeadPlus[]; excluidos: ExcluidoDoPlus[]; semTelefone: SemTelefoneDoPlus[] } {
  const excluidos: ExcluidoDoPlus[] = [];
  const semTelefone: SemTelefoneDoPlus[] = [];
  const porNumero = new Map<string, { melhor: CartaoDoCatalogo; fixo: boolean; nomes: string[] }>();
  for (const cartao of cartoes) {
    const nome = cartao.nome.trim();
    if (!nome) continue;
    const base = `${nome} ${cartao.descricao}`;
    const barrado = NAO_PROSPECTAR.find(([re]) => re.test(semAcento(base)));
    if (barrado) { excluidos.push({ nome, cidade: cartao.cidade, motivo: barrado[1] }); continue; }
    let numero: ReturnType<typeof normalizarTelefone> = null;
    for (const t of cartao.telefones) { numero = normalizarTelefone(t); if (numero) break; }
    if (!numero) {
      const { site, instagram } = dadosDosLinks(cartao.links, cartao.descricao);
      semTelefone.push({ nome, cidade: cartao.cidade, uf: cartao.uf, descricao: cartao.descricao.slice(0, 300), ...(site ? { site } : {}), ...(instagram ? { instagram } : {}) });
      continue;
    }
    const atual = porNumero.get(numero.whatsapp);
    if (!atual) { porNumero.set(numero.whatsapp, { melhor: cartao, fixo: numero.fixo, nomes: [nome] }); continue; }
    if (!atual.nomes.some((n) => semAcento(n) === semAcento(nome))) atual.nomes.push(nome);
    if (completude(cartao) > completude(atual.melhor)) atual.melhor = cartao;
  }
  const leads: LeadPlus[] = [];
  for (const [whatsapp, { melhor, fixo, nomes }] of porNumero) {
    const texto = semAcento(`${melhor.nome} ${melhor.descricao}`);
    const { site, instagram } = dadosDosLinks(melhor.links, melhor.descricao);
    const oferta: OfertaDoPlus = ESTAMPARIA.test(texto) ? "estampa" : IRIS.test(texto) ? "iris" : site ? "prumo" : "site";
    const outros = nomes.filter((n) => semAcento(n) !== semAcento(melhor.nome));
    leads.push({
      id: idDoPlus(whatsapp),
      empresa: melhor.nome,
      nicho: nichoDe(melhor.nome, melhor.descricao),
      cidade: melhor.cidade,
      uf: melhor.uf,
      whatsapp,
      fixo,
      ...(site ? { site } : {}),
      ...(instagram ? { instagram } : {}),
      oferta,
      descricao: melhor.descricao.slice(0, 300),
      ...(outros.length ? { tambem: outros } : {}),
    });
  }
  // Estável e legível: por estado, cidade e nome.
  leads.sort((a, b) => a.uf.localeCompare(b.uf) || a.cidade.localeCompare(b.cidade, "pt-BR") || a.empresa.localeCompare(b.empresa, "pt-BR"));
  return { leads, excluidos, semTelefone };
}
