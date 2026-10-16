/**
 * A conversa de um lead no WhatsApp (16/10/2026). O observador (deploy/dell/whatsapp-observador/)
 * grava cada mensagem de lead em `<WHATSAPP_CONVERSAS_DIR>/<chave>.jsonl` (0600), uma por linha:
 * `{em, direcao: "entrada" | "saida", texto, origem, id?}`. Antes disso o CRM só tinha a
 * classificação e um trecho de 200 caracteres, e quem lia a ficha (ou o Hermes, ou o Jev) tinha
 * de adivinhar em que ponto da conversa o lead estava.
 *
 * `lerLinhasDaConversa` é PURO (texto -> mensagens): linha ilegível é pulada, nunca derruba a
 * leitura. A Central só lê; quem escreve é o observador.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface MensagemDaConversa {
  em: string;
  direcao: "entrada" | "saida";
  texto: string;
}

export const MAX_MENSAGENS_NA_FICHA = 60;
const MAX_TEXTO = 2000;

export function pastaDasConversas(env: Record<string, string | undefined> = process.env, home = os.homedir()): string {
  return (env.WHATSAPP_CONVERSAS_DIR ?? "").trim() || path.join(home, ".local", "share", "whatsapp-conversas");
}

/** A chave do arquivo: a mesma que o observador usa (só [A-Za-z0-9_:.-], até 200). */
export function nomeDoArquivo(chave: string): string | null {
  const limpa = chave.replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 200);
  return limpa && !limpa.startsWith(".") ? `${limpa}.jsonl` : null;
}

export function lerLinhasDaConversa(conteudo: string, max = MAX_MENSAGENS_NA_FICHA): MensagemDaConversa[] {
  const vistas = new Set<string>();
  const mensagens: MensagemDaConversa[] = [];
  for (const linha of conteudo.split("\n")) {
    if (!linha.trim()) continue;
    let m: any;
    try {
      m = JSON.parse(linha);
    } catch {
      continue;
    }
    if ((m?.direcao !== "entrada" && m?.direcao !== "saida") || !Number.isFinite(Date.parse(m?.em))) continue;
    const id = typeof m.id === "string" ? m.id : "";
    if (id && vistas.has(id)) continue;
    if (id) vistas.add(id);
    mensagens.push({ em: new Date(m.em).toISOString(), direcao: m.direcao, texto: typeof m.texto === "string" ? m.texto.slice(0, MAX_TEXTO) : "" });
  }
  mensagens.sort((a, b) => Date.parse(a.em) - Date.parse(b.em));
  return mensagens.slice(-max);
}

/** null = sem arquivo (o observador ainda não viu mensagem deste lead desde que passou a guardar). */
export async function lerConversa(chave: string, pasta = pastaDasConversas()): Promise<MensagemDaConversa[] | null> {
  const nome = nomeDoArquivo(chave);
  if (!nome) return null;
  try {
    return lerLinhasDaConversa(await fs.readFile(path.join(pasta, nome), "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}
