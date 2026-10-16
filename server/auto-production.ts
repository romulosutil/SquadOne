import type { Dirent } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Leitura das pastas do Site antes da venda em ~/auto-site (somente leitura).
//
// Desde 30/09/2026 a Central não guarda etapa própria dos leads: o estado de
// cada lead vem da planilha "Leads — Site antes da venda" (retrato do fluxo
// "08 · CRM" do n8n, lido por server/crm.ts). As pastas servem para duas
// coisas: mostrar o que o gerador ainda está produzindo (coluna "Novo · na
// fila" do CRM) e conferir se a pasta está onde a planilha diz — diferença
// vira nota de divergência, nunca correção silenciosa. Os marcos manuais que
// a antiga Produção Auto gravava em auto-production.json deixaram de ser lidos.

const IMAGE_EXTENSIONS = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".webp"]);
const SLUG = /^[a-z0-9][a-z0-9._-]{0,179}$/i;
const PLACE_ID_NO_CONTEUDO = /place_id:\**\s*([A-Za-z0-9_-]{10,200})/;

/** Onde a pasta mora. "" é a raiz de ~/auto-site (em andamento). */
export const LUGARES_DAS_PASTAS = ["", "_em-conversa", "_recusados", "_concluidos", "_fechados", "_descartados"] as const;
export type LugarDaPasta = (typeof LUGARES_DAS_PASTAS)[number];

export interface ArtefatosDaPasta {
  conteudo: boolean;
  fotos: number;
  capa: boolean;
  gerado: boolean;
  publicado: boolean;
  falha: boolean;
}

/**
 * O que o Raio-X achou, na ordem de peso da página (deploy/dell/raio-x.py, `achados`, desde 15/10/2026).
 * São os ids que o diagnóstico calcula; id que não está aqui é descartado na leitura.
 */
export const IDS_DOS_ACHADOS = [
  "posicao-na-busca", "sem-site", "site-fora-do-ar", "site-sem-nome", "site-e-rede-social",
  "site-sem-celular-ou-whatsapp", "nota-baixa", "poucas-avaliacoes", "sem-horario", "fotos-de-terceiros",
] as const;
export type IdDoAchado = (typeof IDS_DOS_ACHADOS)[number];

/** Um ponto do Raio-X com os números que o sustentam. Número que o Raio-X não leu fica ausente, nunca 0. */
export interface AchadoDoRaioX {
  id: IdDoAchado;
  /** A busca de onde vêm a posição e a comparação ("dentista em Anápolis"). */
  consulta?: string;
  /** posicao-na-busca: o lugar do lead (ausente = fora dos `lidos` primeiros). */
  posicao?: number;
  lidos?: number;
  nota?: number;
  notasDoTopo?: number[];
  avaliacoes?: number;
  /** As avaliações no meio da lista dos primeiros da busca (a mediana). */
  medianaDaBusca?: number;
  avaliacoesDoTopo?: number[];
  /** site-e-rede-social: "o Instagram", "o Facebook"... */
  rede?: string;
  dominio?: string;
  celular?: boolean;
  whatsapp?: boolean;
  /** Dos `topoLidos` primeiros da busca, quantos mostram site próprio no perfil. */
  topoComSite?: number;
  topoLidos?: number;
}

const numeroOuNada = (v: unknown, maximo = 1e7) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= maximo ? v : undefined);
const numerosOuNada = (v: unknown, maximo?: number) => {
  if (!Array.isArray(v) || !v.length || v.length > 10) return undefined;
  const n = v.map((x) => numeroOuNada(x, maximo));
  return n.every((x) => x !== undefined) ? (n as number[]) : undefined;
};
const simOuNao = (v: unknown) => (typeof v === "boolean" ? v : undefined);

/** `raio_x_achados` do recibo (ou do leads.json do Raio-X à mão), validado. Vazio ou ilegível = ausente. */
export function achadosDoRecibo(valor: unknown): AchadoDoRaioX[] | undefined {
  if (!Array.isArray(valor)) return undefined;
  const ids: readonly string[] = IDS_DOS_ACHADOS;
  const saida: AchadoDoRaioX[] = [];
  for (const item of valor.slice(0, 10)) {
    const v = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    if (typeof v.id !== "string" || !ids.includes(v.id)) continue;
    const campos: Omit<AchadoDoRaioX, "id"> = {
      consulta: textoLimpo(v.consulta, 120),
      posicao: numeroOuNada(v.posicao, 1000),
      lidos: numeroOuNada(v.lidos, 1000),
      nota: numeroOuNada(v.nota, 5),
      notasDoTopo: numerosOuNada(v.notas_do_topo, 5),
      avaliacoes: numeroOuNada(v.avaliacoes),
      medianaDaBusca: numeroOuNada(v.mediana_da_busca),
      avaliacoesDoTopo: numerosOuNada(v.avaliacoes_do_topo),
      rede: textoLimpo(v.rede, 40),
      dominio: textoLimpo(v.dominio, 120),
      celular: simOuNao(v.celular),
      whatsapp: simOuNao(v.whatsapp),
      topoComSite: numeroOuNada(v.topo_com_site, 100),
      topoLidos: numeroOuNada(v.topo_lidos, 100),
    };
    saida.push({ id: v.id as IdDoAchado, ...Object.fromEntries(Object.entries(campos).filter(([, x]) => x !== undefined)) });
  }
  return saida.length ? saida : undefined;
}

export interface PastaDoLead {
  slug: string;
  lugar: LugarDaPasta;
  placeId?: string;
  nome?: string;
  siteUrl?: string;
  publicadoEm?: string;
  /** `apagado_em` do recibo: o `site-demos-limpeza` apagou o projeto na Vercel e o link do demo morreu. */
  apagadoEm?: string;
  /** `raio_x_url`/`raio_x_em` do recibo. Sem `siteUrl`, é o Raio-X avulso de quem ainda não tem demo (14/10/2026). */
  raioXUrl?: string;
  raioXEm?: string;
  /** `raio_x_achados` do recibo (15/10/2026): os pontos da página em dado. Raio-X mais antigo não tem. */
  raioXAchados?: AchadoDoRaioX[];
  /** Demo sob pedido: o botão "Gerar demo" gravou PEDIDO-DEMO.json e o gerador ainda não terminou. */
  demoPedidoEm?: string;
  artefatos: ArtefatosDaPasta;
  falhaMensagem?: string;
  alteradaEm: string;
}

export type EstadoDoGerador = "processando" | "ocioso" | "atencao" | "desconhecido";

export interface GeradorDeSites {
  estado: EstadoDoGerador;
  detalhe: string;
  atualizadoEm?: string;
  pendentes?: number;
}

export interface LeituraDasPastas {
  pastas: PastaDoLead[];
  gerador: GeradorDeSites;
}

async function entradasOuVazio(diretorio: string): Promise<Dirent[]> {
  try {
    return await fs.readdir(diretorio, { withFileTypes: true });
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return [];
    throw error;
  }
}

async function lerTextoOuNada(arquivo: string, limite = 64 * 1024): Promise<string | undefined> {
  try {
    const handle = await fs.open(arquivo, "r");
    try {
      const buffer = Buffer.alloc(limite);
      const { bytesRead } = await handle.read(buffer, 0, limite, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error: any) {
    if (error?.code === "ENOENT" || error?.code === "EISDIR") return undefined;
    throw error;
  }
}

function textoLimpo(valor: unknown, maximo = 200): string | undefined {
  if (typeof valor !== "string") return undefined;
  const texto = valor.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximo);
  return texto || undefined;
}

function dataIso(valor: unknown): string | undefined {
  if (typeof valor !== "string" || !valor.trim()) return undefined;
  const instante = Date.parse(valor);
  return Number.isFinite(instante) ? new Date(instante).toISOString() : undefined;
}

function urlHttp(valor: unknown): string | undefined {
  if (typeof valor !== "string") return undefined;
  try {
    const url = new URL(valor.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

async function contarImagens(diretorio: string | undefined): Promise<{ total: number; alguma: boolean }> {
  if (!diretorio) return { total: 0, alguma: false };
  const imagens = (await entradasOuVazio(diretorio))
    .filter((entrada) => entrada.isFile() && IMAGE_EXTENSIONS.has(path.extname(entrada.name).toLowerCase()));
  return { total: imagens.length, alguma: imagens.length > 0 };
}

async function lerPasta(raiz: string, lugar: LugarDaPasta, slug: string): Promise<PastaDoLead> {
  const diretorio = path.join(raiz, lugar, slug);
  const entradas = await entradasOuVazio(diretorio);
  const porNome = new Map(entradas.map((entrada) => [entrada.name.toLowerCase(), entrada]));
  const recibo = await lerTextoOuNada(path.join(diretorio, "publicado.json"));
  let dados: Record<string, unknown> = {};
  if (recibo !== undefined) {
    try {
      const parsed = JSON.parse(recibo);
      if (parsed && typeof parsed === "object") dados = parsed as Record<string, unknown>;
    } catch {
      dados = {};
    }
  }
  let placeId = textoLimpo(dados.place_id);
  const temConteudo = porNome.get("content.md")?.isFile() ?? false;
  if (!placeId && temConteudo) {
    placeId = (await lerTextoOuNada(path.join(diretorio, "content.md"), 16 * 1024))?.match(PLACE_ID_NO_CONTEUDO)?.[1];
  }
  const publicado = recibo !== undefined;
  // Fotos e capa só importam enquanto o site não existe (lead na fila do gerador).
  const [fotos, capa] = publicado
    ? [{ total: 0, alguma: false }, { total: 0, alguma: false }]
    : await Promise.all([
        contarImagens(porNome.get("fotos")?.isDirectory() ? path.join(diretorio, porNome.get("fotos")!.name) : undefined),
        contarImagens(porNome.get("logotipo")?.isDirectory() ? path.join(diretorio, porNome.get("logotipo")!.name) : undefined),
      ]);
  const falha = porNome.get("falha.log")?.isFile() ?? false;
  const falhaMensagem = falha
    ? (await lerTextoOuNada(path.join(diretorio, "falha.log"), 4096))?.split(/\r?\n/).map((linha) => linha.trim()).find(Boolean)?.slice(0, 240)
    : undefined;
  const estado = await fs.stat(diretorio);
  // O pedido do botão "Gerar demo" (site-pastas): a data dele; ilegível, a do arquivo.
  let demoPedidoEm: string | undefined;
  if (porNome.get("pedido-demo.json")?.isFile()) {
    const arquivo = path.join(diretorio, porNome.get("pedido-demo.json")!.name);
    try {
      demoPedidoEm = dataIso(JSON.parse((await lerTextoOuNada(arquivo, 4096)) ?? "{}").em);
    } catch {
      demoPedidoEm = undefined;
    }
    demoPedidoEm ??= (await fs.stat(arquivo)).mtime.toISOString();
  }
  return {
    slug,
    lugar,
    ...(placeId ? { placeId } : {}),
    ...(textoLimpo(dados.nome, 120) ? { nome: textoLimpo(dados.nome, 120) } : {}),
    ...(urlHttp(dados.site_url) ? { siteUrl: urlHttp(dados.site_url) } : {}),
    ...(dataIso(dados.publicado_em) ? { publicadoEm: dataIso(dados.publicado_em) } : {}),
    ...(dataIso(dados.apagado_em) ? { apagadoEm: dataIso(dados.apagado_em) } : {}),
    ...(urlHttp(dados.raio_x_url) ? { raioXUrl: urlHttp(dados.raio_x_url) } : {}),
    ...(dataIso(dados.raio_x_em) ? { raioXEm: dataIso(dados.raio_x_em) } : {}),
    ...(achadosDoRecibo(dados.raio_x_achados) ? { raioXAchados: achadosDoRecibo(dados.raio_x_achados) } : {}),
    ...(demoPedidoEm && !urlHttp(dados.site_url) ? { demoPedidoEm } : {}),
    artefatos: {
      conteudo: temConteudo,
      fotos: fotos.total,
      capa: capa.alguma,
      gerado: porNome.get("index.html")?.isFile() ?? false,
      publicado,
      falha,
    },
    ...(falhaMensagem ? { falhaMensagem } : {}),
    alteradaEm: estado.mtime.toISOString(),
  };
}

/** Resumo que o próprio gerador grava em .logs/status.json (ver deploy/dell/gerador-de-sites.py). */
async function lerGerador(raiz: string): Promise<GeradorDeSites> {
  const arquivo = path.join(raiz, ".logs", "status.json");
  const texto = await lerTextoOuNada(arquivo);
  if (texto === undefined) return { estado: "desconhecido", detalhe: "O gerador ainda não publicou status." };
  let dados: Record<string, unknown>;
  try {
    dados = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return { estado: "atencao", detalhe: ".logs/status.json ilegível." };
  }
  const atualizadoEm = (await fs.stat(arquivo)).mtime.toISOString();
  const bruto = typeof dados.estado === "string" ? dados.estado.toLowerCase() : "";
  const pendentes = typeof dados.pendentes === "number" && Number.isFinite(dados.pendentes) ? dados.pendentes : undefined;
  const lead = textoLimpo(dados.lead, 120);
  if (/process|execut|rodando/.test(bruto)) {
    return { estado: "processando", detalhe: lead ? `Gerando o site de ${lead}.` : "Gerando sites agora.", atualizadoEm, ...(pendentes !== undefined ? { pendentes } : {}) };
  }
  if (/ocioso|idle|parado/.test(bruto)) {
    return { estado: "ocioso", detalhe: "Ocioso; roda às 08h (até 4 sites por dia).", atualizadoEm, ...(pendentes !== undefined ? { pendentes } : {}) };
  }
  return { estado: "atencao", detalhe: bruto ? `Estado informado: ${bruto}.` : "Status sem estado reconhecido.", atualizadoEm };
}

/**
 * Todas as pastas de lead em ~/auto-site, na raiz e nas subpastas de destino.
 * Pastas técnicas (.logs, _build...) ficam de fora; nada é escrito.
 */
export async function lerPastasDosLeads(raiz: string): Promise<LeituraDasPastas> {
  const diretorioRaiz = path.resolve(raiz);
  const pastas: PastaDoLead[] = [];
  for (const lugar of LUGARES_DAS_PASTAS) {
    const entradas = await entradasOuVazio(path.join(diretorioRaiz, lugar));
    const slugs = entradas
      .filter((entrada) => entrada.isDirectory() && !entrada.name.startsWith(".") && !entrada.name.startsWith("_") && SLUG.test(entrada.name))
      .map((entrada) => entrada.name);
    pastas.push(...await Promise.all(slugs.map((slug) => lerPasta(diretorioRaiz, lugar, slug))));
  }
  return { pastas, gerador: await lerGerador(diretorioRaiz) };
}
