<script setup lang="ts">
import { computed } from 'vue'
import type { DellCheck, DellStatus } from './types'

const props = defineProps<{ status: DellStatus | null; loading: boolean; error: string }>()

const GRUPOS: Array<[DellCheck['grupo'], string]> = [
  ['servicos', 'Serviços'],
  ['fluxos', 'Fluxos do n8n'],
  ['dados', 'Dados e rotinas'],
  ['containers', 'Containers'],
  ['maquina', 'Máquina'],
]
const ROTULO = { ok: 'Ok', atencao: 'Atenção', falha: 'Falhou' } as const

// Pendências (trabalho humano) têm painel próprio e não contam como problema do Dell.
const checks = computed(() => (props.status?.verificacoes ?? []).filter(c => c.grupo !== 'pendencias'))
const falhas = computed(() => checks.value.filter(c => c.estado === 'falha'))
const atencoes = computed(() => checks.value.filter(c => c.estado === 'atencao'))
const porGrupo = computed(() => GRUPOS
  .map(([id, nome]) => ({ id, nome, itens: checks.value.filter(c => c.grupo === id) }))
  .filter(g => g.itens.length))

const titulo = computed(() => {
  if (props.error) return 'Não consegui ler o estado do Dell'
  if (!props.status) return props.loading ? 'Conferindo o Dell…' : 'Sem leitura do Dell'
  if (falhas.value.length) return `${falhas.value.length} ${falhas.value.length === 1 ? 'coisa precisa' : 'coisas precisam'} de você`
  // Sem retrato do monitor não há como afirmar que está tudo bem (RULES 2).
  if (!props.status.geradoEm) return 'Ainda sem leitura do Dell'
  return 'Tudo certo no Dell'
})
const tom = computed(() => props.error || falhas.value.length ? 'falha' : !props.status || atencoes.value.length ? 'atencao' : 'ok')
const quando = computed(() => props.status?.geradoEm
  ? `conferido às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(props.status.geradoEm))}`
  : '')
const desde = (c: DellCheck) => c.desde && c.estado !== 'ok'
  ? ` · desde ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(c.desde))}`
  : ''
</script>

<template>
  <section class="ops-panel dell-status" :class="`is-${tom}`" aria-labelledby="dell-status-title">
    <div class="dell-status__hero" role="status" aria-live="polite">
      <span class="dell-status__sinal" aria-hidden="true">{{ tom === 'ok' ? '✓' : tom === 'falha' ? '!' : '…' }}</span>
      <div>
        <h1 id="dell-status-title">{{ titulo }}</h1>
        <p>{{ error || (falhas.length ? 'O Hermes já avisou no WhatsApp. Abra o item para resolver.' : atencoes.length ? `${atencoes.length} ${atencoes.length === 1 ? 'item' : 'itens'} para ficar de olho.` : 'Serviços, fluxos, containers e rotinas respondendo.') }}</p>
      </div>
      <small v-if="quando">{{ quando }}</small>
    </div>

    <ul v-if="falhas.length || atencoes.length" class="dell-status__pendencias">
      <li v-for="c in [...falhas, ...atencoes]" :key="c.id" :class="`is-${c.estado}`">
        <span class="dell-dot" :class="`is-${c.estado}`" aria-hidden="true" />
        <div>
          <strong>{{ c.nome }}</strong>
          <small>{{ c.detalhe }}{{ desde(c) }}</small>
        </div>
        <a v-if="c.link" :href="c.link" target="_blank" rel="noopener">Abrir <span class="ops-visually-hidden">{{ c.nome }}</span>↗</a>
      </li>
    </ul>

    <details v-if="porGrupo.length" class="dell-status__tudo">
      <summary>Ver tudo que é conferido ({{ checks.length }})</summary>
      <div v-for="g in porGrupo" :key="g.id" class="dell-status__grupo">
        <h2>{{ g.nome }}</h2>
        <ul>
          <li v-for="c in g.itens" :key="c.id">
            <span class="dell-dot" :class="`is-${c.estado}`" aria-hidden="true" />
            <span class="ops-visually-hidden">{{ ROTULO[c.estado] }}:</span>
            <strong>{{ c.nome }}</strong>
            <small>{{ c.detalhe }}</small>
            <a v-if="c.link" :href="c.link" target="_blank" rel="noopener">Abrir <span class="ops-visually-hidden">{{ c.nome }}</span>↗</a>
          </li>
        </ul>
      </div>
    </details>
  </section>
</template>
