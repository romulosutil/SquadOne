<script setup lang="ts">
import { ref, watch } from 'vue'
import Sheet from '../../components/Sheet.vue'
import { mesLongo } from './formato'

// "Explicar este mês" (fase 8d, RULES 24): nada de finanças vai ao modelo sem
// pedido, e o pedido mostra antes, literalmente, o que vai sair. A folha abre
// com os dois toggles desligados (só categorias e %), o texto da prévia vem
// do servidor e é o MESMO que ele manda ao Gemini — o envio leva o hash da
// prévia, e o servidor recusa (409) se o texto mudou. Mudar um toggle recarrega
// a prévia e invalida o hash. Fechar descarta tudo; nada fica guardado. A
// resposta é texto interpolado, nunca v-html (RULES 23).
const props = defineProps<{ mes: string; visao: 'competencia' | 'caixa' }>()

const aberta = ref(false)
const comValores = ref(false)
const comEstabelecimentos = ref(false)
const pacote = ref('')
const hash = ref('')
const caracteres = ref(0)
const carregandoPrevia = ref(false)
const enviando = ref(false)
const erro = ref('')
const explicacao = ref('')
// Cada prévia pedida ganha um número: a resposta de uma prévia velha (toggle
// trocado no meio, folha fechada) não sobrescreve a atual.
let geracao = 0

async function postar(caminho: string, corpo: unknown): Promise<{ status: number; dados: Record<string, any> }> {
  const resposta = await fetch(`/api/financas${caminho}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  return { status: resposta.status, dados: await resposta.json().catch(() => ({})) }
}

const pedido = () => ({ mes: props.mes, visao: props.visao, comValores: comValores.value, comEstabelecimentos: comEstabelecimentos.value })

async function carregarPrevia() {
  const minha = ++geracao
  carregandoPrevia.value = true
  pacote.value = ''
  hash.value = ''
  caracteres.value = 0
  explicacao.value = ''
  erro.value = ''
  try {
    const { status, dados } = await postar('/explicar/previa', pedido())
    if (minha !== geracao) return
    if (status !== 200) throw new Error(dados.error ?? `HTTP ${status}`)
    pacote.value = dados.pacote
    hash.value = dados.hash
    caracteres.value = dados.caracteres
  } catch (e) {
    if (minha === geracao) erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    if (minha === geracao) carregandoPrevia.value = false
  }
}

async function enviar() {
  if (!hash.value || carregandoPrevia.value || enviando.value) return
  const minha = geracao
  enviando.value = true
  erro.value = ''
  explicacao.value = ''
  try {
    const { status, dados } = await postar('/explicar', { ...pedido(), hash: hash.value })
    if (minha !== geracao) return
    if (status === 409 && dados.previaDesatualizada) {
      // Os dados mudaram (uma leitura da Pluggy, uma categoria): mostra o texto novo e espera outro clique.
      await carregarPrevia()
      erro.value = 'Os dados mudaram desde a prévia. O texto abaixo é o novo: confira e envie de novo.'
      return
    }
    if (status !== 200) throw new Error(dados.error ?? `HTTP ${status}`)
    explicacao.value = dados.explicacao
  } catch (e) {
    if (minha === geracao) erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    enviando.value = false
  }
}

function abrir() {
  aberta.value = true
  void carregarPrevia()
}

function fechar() {
  geracao += 1
  aberta.value = false
  comValores.value = false
  comEstabelecimentos.value = false
  pacote.value = ''
  hash.value = ''
  caracteres.value = 0
  explicacao.value = ''
  erro.value = ''
  carregandoPrevia.value = false
}

watch([comValores, comEstabelecimentos], () => {
  if (aberta.value) void carregarPrevia()
})
</script>

<template>
  <div class="fin-explicar">
    <button type="button" class="fin-botao" @click="abrir">Explicar este mês</button>
    <Sheet
      v-if="aberta"
      titulo="Explicar este mês"
      :subtitulo="`${mesLongo(mes)}, visão de ${visao === 'caixa' ? 'caixa' : 'competência'}. Só sai quando você enviar.`"
      :bloqueada="enviando"
      @fechar="fechar"
    >
      <fieldset class="fin-explicar__opcoes" :disabled="enviando">
        <legend>O que incluir</legend>
        <label><input v-model="comValores" type="checkbox" /> Incluir valores em R$</label>
        <label><input v-model="comEstabelecimentos" type="checkbox" /> Incluir estabelecimentos</label>
      </fieldset>

      <section class="fin-explicar__previa" aria-labelledby="fin-explicar-titulo">
        <h3 id="fin-explicar-titulo">Isto é exatamente o que vai sair para o Gemini</h3>
        <p v-if="carregandoPrevia" class="fin-sub" role="status">Montando o texto…</p>
        <template v-else-if="pacote">
          <p class="fin-sub">{{ caracteres }} caracteres. Nada é gravado, nem o texto nem a resposta.</p>
          <pre tabindex="0" aria-label="Texto que vai para o Gemini">{{ pacote }}</pre>
        </template>
      </section>

      <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }}</p>

      <section v-if="explicacao" class="fin-explicar__resposta" aria-labelledby="fin-explicar-resposta">
        <h3 id="fin-explicar-resposta">O que o Gemini respondeu</h3>
        <p>{{ explicacao }}</p>
      </section>
      <p class="fin-sub" role="status" aria-live="polite">{{ enviando ? 'Esperando o Gemini…' : '' }}</p>

      <template #rodape>
        <button type="button" class="fin-botao fin-botao--primario" :disabled="carregandoPrevia || enviando || !hash" @click="enviar">
          {{ enviando ? 'Enviando…' : 'Enviar ao Gemini' }}
        </button>
      </template>
    </Sheet>
  </div>
</template>
