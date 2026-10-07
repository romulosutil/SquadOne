import path from "node:path";

/**
 * Onde o SquadOne guarda o que é dele: `squad.json`, `google-auth.json`, o
 * offset do Telegram e as avaliações. `SQUADONE_DATA_DIR`, padrão `./data`.
 *
 * O padrão é o volume do Easypanel (`/app/data`) e o checkout de dev. No Dell o
 * diretório é `~/.local/share/squadone`, FORA do clone git: o `~/SquadOne` é o
 * checkout de produção da Central, atualizado sozinho pelo `atualizar-central`,
 * e o `~/SquadOne/data` de lá guarda o retrato de 14/09/2026 que não pode virar
 * a agenda (regra 7). Lido a cada chamada: os testes trocam o cwd antes do import.
 */
export function diretorioDeDados(env: NodeJS.ProcessEnv = process.env): string {
  const bruto = (env.SQUADONE_DATA_DIR ?? "").trim();
  return path.resolve(bruto || path.join(process.cwd(), "data"));
}

/** O diretório foi escolhido de propósito (env presente), não caiu no padrão. */
export function dadosExplicitos(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean((env.SQUADONE_DATA_DIR ?? "").trim());
}

/** `filho` está dentro de `pai` (ou é ele). */
export function estaDentro(pai: string, filho: string): boolean {
  const rel = path.relative(path.resolve(pai), path.resolve(filho));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Por que a agenda NÃO liga no perfil operations; null = liga.
 *
 * A agenda (roster, turno, Mochila, ajuste, vigia, bot) só entra no Dell com o
 * roster de PRODUÇÃO num diretório próprio, nunca sobre o retrato de 14/09/2026
 * do `~/SquadOne/data`. Sem esta trava, o primeiro `atualizar-central` depois do
 * merge montaria tudo sobre o retrato velho: um POST criaria agentes e eventos a
 * partir dele, e a vigia avisaria com o roster errado. Por isso a env tem de
 * estar presente E fora do checkout; o resto do runbook vem depois dela.
 */
export function motivoParaAgendaDesligada(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string | null {
  if (!dadosExplicitos(env)) {
    return "SQUADONE_DATA_DIR ausente: no Dell a agenda só liga com o diretório de dados fora do clone (runbook do cutover).";
  }
  if (estaDentro(cwd, diretorioDeDados(env))) {
    return "SQUADONE_DATA_DIR aponta para dentro do checkout: no Dell ele fica fora do clone git (~/.local/share/squadone).";
  }
  return null;
}
