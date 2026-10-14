// Segunda mensagem do PRUMO (09/10/2026): depois do "pode mandar", o Raio-X.
// O formulário de 16 perguntas (o "diagnóstico", passo=diagnostico do convite)
// saiu com o plano de 08/10/2026: o dono não preenche nada, o PRUMO mostra o que
// já viu. Texto da "Segunda mensagem · C · empresa que já tem site" do roteiro
// (prumo/03-captacao/roteiro-raio-x.md), na voz da empresa: lead do PRUMO quase
// sempre já tem site, então não há preço de site aqui (Respondido e Fonte são
// sob proposta: o Respondido depois da conversa, a Fonte depois do Mapa).
// PURO: a colinha (src/) importa daqui.

import { artigoDe } from "./site-mensagem.ts";

export const SEGUNDA_PRUMO =
  "Aqui está: {RAIO_X}\n\nÉ uma página só, feita com o que aparece no Google sobre {ARTIGO} {NOME}: o que já está bom e os pontos que mexeríamos primeiro.\n\nSe quiserem, cuidamos desses pontos. Se não for o momento, é só dizer, sem problema.\n\nO que acharam?";

export const FOLLOWUP_PRUMO =
  "Oi, aqui é o Rômulo de novo, do PRUMO. Deu para ver o Raio-X {ARTIGO} {NOME}?\n{RAIO_X}\n\nSe fizer sentido, em 20 minutos mostramos como resolver o primeiro ponto. E se não for o momento, é só me dizer.";

// Reenvio do só-robô (14/10/2026): o convite chegou à resposta automática do WhatsApp Business e
// ninguém de verdade o viu. Em vez do follow-up do Raio-X (que nem existe para quem não respondeu),
// pede a pessoa certa. Sem "bom dia/boa tarde" (a hora varia), sem "ontem" (pode ter sido há dias),
// sem preço. Só do CRM: o n8n não manda este texto.
export const REENVIO_ROBO_PRUMO =
  "Oi, tudo bem? Aqui é o Rômulo, do PRUMO. Mandei uma mensagem por aqui, mas acho que só chegou o atendimento automático. Pode me indicar quem cuida do marketing e do comercial {ARTIGO} {NOME}? É coisa rápida.";

/**
 * wa.me com o reenvio do só-robô; vazio sem número do Brasil. O texto é só em português: o
 * número precisa do 55 na frente (o CRM já o põe nos de 10 e 11 dígitos), o que deixa os EUA de fora.
 */
export function reenvioDoPrumo(whatsapp: string, empresa: string): string {
  if (!/^55\d{10,11}$/.test(whatsapp)) return "";
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(preencherPrumo(REENVIO_ROBO_PRUMO, empresa, ""))}`;
}

/** Nome como o dono escreve: sem Ltda/ME e fora da caixa alta ("roda mais distribuidora" -> "Roda Mais Distribuidora"). */
export function nomeDaEmpresa(bruto: string): string {
  let nome = bruto.trim();
  for (let i = 0; i < 2; i++) nome = nome.replace(/[\s,.-]+(ltda|me|epp|eireli|s\.?\/?a\.?)\.?$/i, "").trim();
  if (nome === nome.toUpperCase() || nome === nome.toLowerCase()) {
    nome = nome.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase())
      .replace(/ (D[aeo]s?|E|Para|Em) /g, (m) => m.toLowerCase());
  }
  return nome;
}

export function preencherPrumo(modelo: string, empresa: string, raioX: string): string {
  const nome = nomeDaEmpresa(empresa);
  return modelo.split("{ARTIGO}").join(artigoDe(nome)).split("{NOME}").join(nome).split("{RAIO_X}").join(raioX);
}

/** wa.me com a segunda mensagem do PRUMO; vazio sem número ou sem Raio-X em https. */
export function segundaDoPrumo(whatsapp: string, empresa: string, raioX: string): string {
  if (!/^\d{12,13}$/.test(whatsapp) || !raioX.startsWith("https://")) return "";
  return `https://wa.me/${whatsapp}?text=${encodeURIComponent(preencherPrumo(SEGUNDA_PRUMO, empresa, raioX))}`;
}
