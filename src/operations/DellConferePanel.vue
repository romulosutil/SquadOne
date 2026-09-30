<script setup lang="ts">
import { computed } from 'vue'
import { soNoDell } from './alertas'
import type { DellCheck, DellStatus } from './types'

// Tudo que o monitor confere, fechado no fim da home: quem quiser o detalhe
// abre; o que pede ação já está em "Precisa de você".
const props = defineProps<{ status: DellStatus | null }>()

const GRUPOS: Array<[DellCheck['grupo'], string]> = [
  ['servicos', 'Serviços'],
  ['fluxos', 'Fluxos do n8n'],
  ['dados', 'Dados, rotinas e backup'],
  ['containers', 'Containers'],
  ['maquina', 'Máquina'],
]

// Pendências são fila de trabalho, não saúde: ficam em "Precisa de você".
const checks = computed(() => (props.status?.verificacoes ?? []).filter(c => c.grupo !== 'pendencias'))
const ok = computed(() => checks.value.filter(c => c.estado === 'ok').length)
const porGrupo = computed(() => GRUPOS
  .map(([id, nome]) => ({ id, nome, itens: checks.value.filter(c => c.grupo === id) }))
  .filter(g => g.itens.length))
const rotulo = (c: DellCheck) => c.estado === 'falha' ? 'Falhou' : c.estado === 'ok' ? 'Ok' : c.sozinho ? 'Resolve sozinho' : 'Vale olhar'
</script>

<template>
  <section v-if="porGrupo.length" class="ops-panel dell-confere" aria-labelledby="dell-confere-title">
    <details>
      <summary><h2 id="dell-confere-title">Tudo que o Dell confere</h2><span>{{ ok }} de {{ checks.length }} ok · abrir</span></summary>
      <div v-for="g in porGrupo" :key="g.id" class="dell-status__grupo">
        <h3>{{ g.nome }}</h3>
        <ul>
          <li v-for="c in g.itens" :key="c.id">
            <span class="dell-dot" :class="`is-${c.estado}`" aria-hidden="true" />
            <strong>{{ c.nome }}</strong>
            <small><span :class="{ 'ops-visually-hidden': c.estado === 'ok' }" class="dell-confere__estado">{{ rotulo(c) }}: </span>{{ c.detalhe }}</small>
            <a v-if="c.link" :href="c.link" target="_blank" rel="noopener">{{ soNoDell(c.link) ? 'No Dell' : 'Abrir' }} <span class="ops-visually-hidden">{{ c.nome }}</span><span aria-hidden="true">↗</span></a>
          </li>
        </ul>
      </div>
    </details>
  </section>
</template>
