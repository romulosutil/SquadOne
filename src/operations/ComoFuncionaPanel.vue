<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { linkExterno, quantidadeDaFila, seloDoPasso } from './alertas'
import { DELL_LIGADO, FLUXOS, O_TEMPO_TODO, ROTULO_DO_ONDE, UM_DIA, blueprintDoFluxo, fluxoDoEndereco, linkDoBlueprint } from './fluxos'
import type { PassoDoFluxo } from './fluxos'
import type { DellCheck } from './types'

// "Como funciona": um fluxo por vez (pedido do Rômulo), com onde roda, quando
// e o que é com ele; "Um dia" junta os horários. O conteúdo é estático
// (fluxos.ts); o retrato vivo só acrescenta "Falhou agora" e "N esperando".
const props = defineProps<{ checks: DellCheck[] }>()

const CHAVE = 'central:como-funciona'
const ABAS = [...FLUXOS.map(f => ({ id: f.id, nome: f.nome })), { id: 'dia', nome: 'Um dia' }]

function lerAba(): string {
  try {
    const salvo = window.localStorage.getItem(CHAVE)
    if (salvo && ABAS.some(a => a.id === salvo)) return salvo
  } catch { /* sem armazenamento: começa do primeiro */ }
  return ABAS[0].id
}

// Vindo do robô de uma sala do Escritório (?fluxo=&passo=): abre o fluxo dele e
// leva ao passo, que fica em destaque. O endereço manda sobre a aba guardada.
const pedido = fluxoDoEndereco(window.location.search)
const atual = ref(pedido?.fluxo ?? lerAba())
const alvo = ref<number | null>(pedido?.passo ?? null)
onMounted(() => {
  if (alvo.value === null) return
  // Depois do foco que a casca dá ao conteúdo ao trocar de rota (rota.ts).
  window.setTimeout(() => {
    const el = document.getElementById(`como-passo-${alvo.value}`)
    el?.scrollIntoView({ block: 'center' })
    el?.focus({ preventScroll: true })
  })
})
const fluxo = computed(() => FLUXOS.find(f => f.id === atual.value) ?? null)
const codigoDoBlueprint = computed(() => (fluxo.value ? blueprintDoFluxo(fluxo.value) : null))
const porId = computed(() => new Map(props.checks.map(c => [c.id, c])))
const comVoce = (id: string) => FLUXOS.find(f => f.id === id)?.passos.filter(p => p.comVoce).length ?? 0
const selo = (passo: PassoDoFluxo) => seloDoPasso(passo.verificacao ? porId.value.get(passo.verificacao) : undefined)
const esperando = (passo: PassoDoFluxo) => passo.fila ? quantidadeDaFila(porId.value.get(passo.fila)) : null
const falhouNoFluxo = (id: string) => FLUXOS.find(f => f.id === id)?.passos
  .some(p => p.verificacao && porId.value.get(p.verificacao)?.estado === 'falha') ?? false

function escolher(id: string, focar = false) {
  if (id !== atual.value) alvo.value = null
  atual.value = id
  try { window.localStorage.setItem(CHAVE, id) } catch { /* só conveniência */ }
  if (focar) nextTick(() => document.getElementById(`como-aba-${id}`)?.focus())
}

// Setas, Home e End andam entre as abas (padrão de abas da WAI-ARIA).
function teclas(evento: KeyboardEvent) {
  const i = ABAS.findIndex(a => a.id === atual.value)
  const destino = evento.key === 'ArrowRight' || evento.key === 'ArrowDown' ? (i + 1) % ABAS.length
    : evento.key === 'ArrowLeft' || evento.key === 'ArrowUp' ? (i - 1 + ABAS.length) % ABAS.length
      : evento.key === 'Home' ? 0 : evento.key === 'End' ? ABAS.length - 1 : -1
  if (destino < 0) return
  evento.preventDefault()
  escolher(ABAS[destino].id, true)
}
</script>

<template>
  <section class="painel como" aria-labelledby="como-title">
    <div class="como__topo">
      <h2 id="como-title">Como funciona</h2>
      <p>Escolha um fluxo e veja só ele: onde roda, quando roda e o que é com você.</p>
    </div>

    <div class="como__abas" role="tablist" aria-label="Fluxos da operação" @keydown="teclas">
      <button
        v-for="aba in ABAS"
        :id="`como-aba-${aba.id}`"
        :key="aba.id"
        type="button"
        role="tab"
        :aria-selected="aba.id === atual"
        :tabindex="aba.id === atual ? 0 : -1"
        aria-controls="como-painel"
        @click="escolher(aba.id)"
      >
        <span>{{ aba.nome }}</span>
        <small v-if="aba.id !== 'dia'">{{ falhouNoFluxo(aba.id) ? 'falhou agora' : comVoce(aba.id) ? `${comVoce(aba.id)} com você` : 'só automático' }}</small>
        <small v-else>os horários</small>
      </button>
    </div>

    <div id="como-painel" class="como__painel" role="tabpanel" :aria-labelledby="`como-aba-${atual}`" tabindex="0">
      <template v-if="fluxo">
        <p class="como__frase">{{ fluxo.frase }}</p>
        <p class="como__legenda">
          <span>{{ fluxo.passos.filter(p => !p.comVoce).length }} automáticos</span>
          <span class="is-voce">{{ fluxo.passos.filter(p => p.comVoce).length }} com você</span>
        </p>
        <!-- Um link por fluxo (AC-24): a esteira inteira, com os cartões de cada passo, mora no service blueprint (OT-03). -->
        <a
          v-if="codigoDoBlueprint"
          class="como__blueprint"
          :href="linkDoBlueprint(codigoDoBlueprint)"
          target="_blank"
          rel="noopener"
        >Ver no blueprint<span class="so-leitor"> (abre o service blueprint em outra aba)</span></a>
        <ol class="como__trilha">
          <li
            v-for="(passo, i) in fluxo.passos"
            :id="`como-passo-${i}`"
            :key="i"
            class="como__passo"
            :class="{ 'is-voce': passo.comVoce, 'is-ramo': passo.ramo, 'is-alvo': i === alvo }"
            :tabindex="i === alvo ? -1 : undefined"
            :aria-current="i === alvo ? 'step' : undefined"
          >
            <span class="como__no" :class="`is-${passo.onde}`" aria-hidden="true" />
            <div class="como__caixa">
              <p v-if="passo.ramo" class="como__ramo">↳ {{ passo.ramo }}</p>
              <h3>{{ passo.titulo }}</h3>
              <p>{{ passo.texto }}</p>
              <p class="como__marcas">
                <span class="como__marca" :class="`is-${passo.onde}`">{{ ROTULO_DO_ONDE[passo.onde] }}</span>
                <span class="como__marca">{{ passo.quando }}</span>
                <span class="como__marca" :class="passo.comVoce ? 'is-com-voce' : 'is-auto'">{{ passo.comVoce ? 'Com você' : 'Automático' }}</span>
                <span v-if="selo(passo)" class="como__marca" :class="`is-${selo(passo)?.tom}`">{{ selo(passo)?.texto }}</span>
                <span v-if="esperando(passo)" class="como__marca is-fila">{{ esperando(passo) }} esperando</span>
              </p>
              <a v-if="passo.link" class="como__link" :href="passo.link.url" :target="linkExterno(passo.link.url) ? '_blank' : undefined" :rel="linkExterno(passo.link.url) ? 'noopener' : undefined">{{ passo.link.rotulo }}<span class="so-leitor">: {{ passo.titulo }}</span></a>
            </div>
          </li>
        </ol>
      </template>

      <template v-else>
        <p class="como__frase">O que roda a cada hora, no horário de Brasília.</p>
        <p class="como__aviso"><strong>Atenção:</strong> {{ DELL_LIGADO }}</p>
        <ol class="como__dia">
          <li v-for="h in UM_DIA" :key="h.hora">
            <time>{{ h.hora }}</time>
            <ul>
              <li v-for="item in h.itens" :key="item.titulo">
                <span class="como__no is-mini" :class="`is-${item.onde}`" aria-hidden="true" />
                <span><strong>{{ item.titulo }}</strong> <small>· {{ item.nota }}</small></span>
              </li>
            </ul>
          </li>
        </ol>
        <h3 class="como__sempre-titulo">O tempo todo</h3>
        <dl class="como__sempre">
          <div v-for="s in O_TEMPO_TODO" :key="s.quando">
            <dt>{{ s.quando }}</dt>
            <dd>{{ s.texto }}</dd>
          </div>
        </dl>
      </template>
    </div>
  </section>
</template>

<style>
/* Um link de texto só, abaixo da legenda: terciário (BP-R2), o sublinhado diz que é link. */
.como__blueprint { justify-self: start; display: inline-flex; align-items: center; min-height: var(--toque); color: var(--texto); font-size: var(--tam-apoio); font-weight: var(--peso-forte); text-decoration: underline; }
.como__blueprint:hover { background: var(--hover); }
.como__blueprint:focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
</style>
