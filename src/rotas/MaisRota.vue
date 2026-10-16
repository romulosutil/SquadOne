<script setup lang="ts">
/**
 * Mais (/mais): o que não cabe na barra inferior. Os destinos sem lugar nela
 * (Agenda, Escritório, Lançamentos, Entrada), como a operação funciona, os
 * acessos e tudo que o Dell confere (RULES 13: dashboards e detalhe moram fora
 * da Hoje). Os painéis da Central usam mais.css, só com tokens.
 */
import { computed } from 'vue'
import AccessPanel from '../operations/AccessPanel.vue'
import ComoFuncionaPanel from '../operations/ComoFuncionaPanel.vue'
import DellConferePanel from '../operations/DellConferePanel.vue'
import { useOverview } from '../casca/overview'
import type { Capacidades } from '../casca/destinos'
import '../operations/mais.css'

const props = defineProps<{ capacidades: Capacidades }>()
const { overview } = useOverview()
const ops = computed(() => props.capacidades.perfil === 'operations')

const links = computed(() => [
  ...(props.capacidades.agentes
    ? [
        { href: '/agenda', rotulo: 'Agenda', dica: 'os compromissos que os agentes marcaram, e a conexão com o Google' },
        { href: '/squadone', rotulo: 'Escritório', dica: 'squads, salas e quem trabalha em cada uma (lista ou mapa)' }
      ]
    : ops.value
      ? [{ href: '/squadone', rotulo: 'Agentes do SquadOne', dica: 'ainda no Easypanel, até a agenda ligar neste processo' }]
      : []),
  ...(ops.value
    ? [
        { href: '/financas/lancamentos', rotulo: 'Lançamentos das finanças', dica: 'todas as contas, com filtro' },
        { href: '/entrada/', rotulo: 'Entrada', dica: 'texto e arquivos para a Mel organizar' }
      ]
    : [])
])
</script>

<template>
  <div class="mais">
    <section class="mais__bloco" aria-labelledby="mais-titulo">
      <h1 id="mais-titulo">Mais</h1>
      <ul class="mais__links">
        <li v-for="l in links" :key="l.href">
          <a :href="l.href"><strong>{{ l.rotulo }}</strong><small>{{ l.dica }}</small></a>
        </li>
      </ul>
    </section>

    <div v-if="ops" class="mais__ops">
      <ComoFuncionaPanel :checks="overview?.dell.verificacoes ?? []" />
      <AccessPanel :tools="overview?.tools ?? []" />
      <DellConferePanel :status="overview?.dell ?? null" />
    </div>
  </div>
</template>

<style>
.mais { display: grid; gap: var(--esp-4); width: 100%; max-width: 56rem; margin: 0 auto; }
.mais__bloco { display: grid; gap: var(--esp-3); padding: var(--esp-4); border: var(--linha); background: var(--superficie); box-shadow: var(--sombra); color: var(--texto); }
.mais__bloco h1 { margin: 0; font-size: clamp(1.8rem, 8vw, 2.6rem); font-weight: var(--peso-titulo); letter-spacing: -0.03em; }
.mais__links { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.mais__links a { display: grid; gap: 0.1rem; min-height: 44px; padding: var(--esp-3) var(--esp-4); border: var(--linha-fina); background: var(--superficie-2); color: var(--texto); text-decoration: none; }
.mais__links a:hover { background: var(--destaque); color: var(--destaque-texto); }
.mais__links small { color: inherit; opacity: 0.8; font-weight: var(--peso-medio); }
.mais__ops { display: grid; gap: var(--esp-4); }
</style>
