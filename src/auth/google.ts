import { ref } from "vue";

/**
 * Cliente da conexão com o Google — agora um invólucro fino sobre o backend.
 *
 * O desenho anterior fazia OAuth aqui no browser com o token client do GIS.
 * Aquilo não emitia refresh token: o access_token morria em ~1h e sumia a cada
 * F5, e "conectar o calendário" era um gesto repetido para sempre.
 *
 * Agora o browser não vê token nenhum. O servidor conduz o authorization code
 * flow, guarda o refresh cifrado no volume e renova sozinho; daqui só saem
 * três perguntas: estou conectado, me leve ao consentimento, me desconecte.
 * O ganho é que a conexão sobrevive a reload, a reinício do container e a
 * deploy.
 */

export const conectado = ref(false);
export const conectando = ref(false);

/**
 * A credencial tem o escopo do Google Tasks? Estado degradado, não conexão:
 * sem ele o Calendar funciona igual e só os passos não viram checklist.
 */
export const tasksLiberado = ref(false);

/**
 * Pergunta ao servidor se existe credencial guardada. Barato e sem efeito
 * colateral: pode ser chamado no mount e depois de qualquer 401.
 */
export async function sincronizarStatus(): Promise<boolean> {
  try {
    const resp = await fetch("/api/auth/status");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    conectado.value = Boolean(dados.conectado);
    tasksLiberado.value = Boolean(dados.tasks);
  } catch (err) {
    console.error("Falha ao ler o status da conexão:", err);
    conectado.value = false;
    tasksLiberado.value = false;
  }
  return conectado.value;
}

/**
 * Sai da SPA e vai para a tela do Google. Não é um popup de propósito: o
 * consentimento agora termina num redirect de volta para `/?auth=...`, e uma
 * navegação de página inteira é o caminho que o Google trata melhor.
 */
export function irParaConsentimento(): void {
  conectando.value = true;
  window.location.href = "/api/auth/google";
}

/**
 * Pede o escopo do Google Tasks: é o MESMO consentimento, agora com os dois
 * escopos. Nunca logout antes — logout revoga o refresh_token no Google e
 * derrubaria o Calendar junto.
 */
export function ampliarAcesso(): void {
  irParaConsentimento();
}

/** Apaga a credencial no servidor e revoga no Google. */
export async function desconectar(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } catch (err) {
    console.error("Falha ao desconectar:", err);
  }
  conectado.value = false;
  tasksLiberado.value = false;
}

/**
 * Lê o `?auth=` que o callback deixou e limpa a URL. Devolve `null` quando não
 * veio de um retorno do Google. Sem a limpeza, um F5 repetiria o aviso.
 */
export function lerRetornoDoConsentimento(): string | null {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("auth");
  if (!auth) return null;
  params.delete("auth");
  const busca = params.toString();
  window.history.replaceState(
    {},
    "",
    window.location.pathname + (busca ? `?${busca}` : ""),
  );
  return auth;
}
