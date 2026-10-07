<script setup lang="ts">
import { computed } from 'vue'
import { soNoDell } from './alertas'
import type { OperationTool } from './types'

const props = defineProps<{ tools: OperationTool[] }>()

// Ordem pelo uso: primeiro onde se trabalha, depois onde se acompanha.
const ORDEM = ['ide', 'n8n', 'hermes', 'syncthing', 'remote'] as const
const ICONE: Record<string, string> = { ide: '>_', n8n: 'n8n', hermes: 'H', syncthing: '⇄', remote: '☁', crm: 'CRM', agentes: 'S1' }
const DICA: Record<string, string> = {
  ide: 'Terminal e arquivos do Dell',
  n8n: 'Fluxos e execuções',
  hermes: 'Conversas e rotinas',
  syncthing: 'Pastas espelhadas com o PC',
  remote: 'O app de agendas no Easypanel',
}

// As ferramentas do Dell (loopback) só abrem no navegador do próprio Dell.
const links = computed(() => [
  { id: 'crm', nome: 'CRM', dica: 'Leads do Site antes da venda e do PRUMO', url: '/crm', fora: false, externo: false },
  // /squadone: o app aqui com a agenda no Dell, o Easypanel antes do cutover (RootApp.vue decide).
  { id: 'agentes', nome: 'Agentes do SquadOne', dica: 'Squads, pessoas e o que cada uma cuida', url: '/squadone', fora: false, externo: false },
  ...ORDEM.map(id => props.tools.find(t => t.id === id)).filter((t): t is OperationTool => Boolean(t)).map(t => ({
    id: t.id, nome: t.id === 'ide' ? 'Terminal' : t.id === 'remote' ? 'SquadOne na nuvem' : t.label,
    dica: `${DICA[t.id] ?? t.description}${soNoDell(t.launchUrl) ? ' · só no Dell' : ''}`,
    url: t.launchUrl, fora: t.state === 'unavailable', externo: true,
  })),
])
</script>

<template>
  <section class="ops-panel access" aria-labelledby="access-title">
    <h2 id="access-title">Abrir</h2>
    <ul>
      <li v-for="l in links" :key="l.id">
        <a :href="l.url" :target="l.externo ? '_blank' : undefined" :rel="l.externo ? 'noopener' : undefined">
          <span class="access__icone" aria-hidden="true">{{ ICONE[l.id] ?? '↗' }}</span>
          <span><strong>{{ l.nome }}</strong><small>{{ l.fora ? 'Sem resposta agora' : l.dica }}</small></span>
          <span v-if="l.fora" class="dell-dot is-falha" aria-hidden="true" />
        </a>
      </li>
    </ul>
  </section>
</template>
