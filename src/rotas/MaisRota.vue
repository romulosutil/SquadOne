<script setup lang="ts">
/**
 * Mais (/mais): o que não cabe na barra inferior (RULES 13: dashboards e detalhe moram fora da
 * Hoje). Desde 16/10/2026 em três grupos, pelo motivo de abrir ("pra que tem isso aqui?" era a
 * pergunta de quem via uma lista de sete coisas iguais):
 *  - Usar: o que se abre no dia a dia;
 *  - Entender: como a operação funciona, fechado até pedir;
 *  - Manutenção: ferramentas, o que o Dell confere e o design system, fechado.
 * Saiu o link "Agentes do SquadOne (ainda no Easypanel)": nesta Central ele dava 404.
 * Os painéis da Central usam mais.css, só com tokens.
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

const usar = computed(() => [
  ...(props.capacidades.agentes
    ? [
        { href: '/agenda', rotulo: 'Agenda', dica: 'os compromissos que os agentes marcaram, e a conexão com o Google' },
        { href: '/squadone', rotulo: 'Escritório', dica: 'squads, salas e quem trabalha em cada uma (lista ou mapa)' }
      ]
    : []),
  ...(ops.value
    ? [
        { href: '/financas/lancamentos', rotulo: 'Lançamentos', dica: 'cada gasto e entrada, com filtro, para corrigir a categoria' },
        { href: '/entrada/', rotulo: 'Entrada', dica: 'mande um texto ou arquivo e a Mel guarda no lugar certo' }
      ]
    : [])
])
const pedeFluxo = new URLSearchParams(window.location.search).has('fluxo')
const falhas = computed(() => (overview.value?.dell.verificacoes ?? []).filter((c) => c.estado === 'falha').length)
</script>

<template>
  <div class="mais">
    <section class="mais__bloco" aria-labelledby="mais-titulo">
      <h1 id="mais-titulo">Mais</h1>
      <h2 class="mais__grupo">Usar</h2>
      <ul class="mais__links">
        <li v-for="l in usar" :key="l.href">
          <a :href="l.href"><strong>{{ l.rotulo }}</strong><small>{{ l.dica }}</small></a>
        </li>
      </ul>
    </section>

    <!-- O link do robô do Escritório (?fluxo=&passo=) abre direto no fluxo dele. -->
    <details v-if="ops" class="mais__bloco mais__dobra" :open="pedeFluxo">
      <summary><span class="mais__grupo">Entender</span><small>como a operação funciona: cada robô, quando roda e o que espera de você</small></summary>
      <ComoFuncionaPanel :checks="overview?.dell.verificacoes ?? []" />
    </details>

    <details class="mais__bloco mais__dobra" :open="falhas > 0">
      <summary>
        <span class="mais__grupo">Manutenção</span>
        <small>ferramentas do Dell, o que ele confere<template v-if="falhas"> ({{ falhas }} com falha)</template> e o design system</small>
      </summary>
      <div class="mais__ops">
        <AccessPanel v-if="ops" :tools="overview?.tools ?? []" />
        <DellConferePanel v-if="ops" :status="overview?.dell ?? null" />
        <ul class="mais__links">
          <li><a href="/design-system"><strong>Design system</strong><small>tokens e peças do app, para quem mexe no visual</small></a></li>
        </ul>
      </div>
    </details>
  </div>
</template>

<style>
.mais { display: grid; gap: var(--esp-4); width: 100%; max-width: 56rem; margin: 0 auto; }
.mais__bloco { display: grid; gap: var(--esp-3); padding: var(--esp-4); border: var(--linha); background: var(--superficie); box-shadow: var(--sombra); color: var(--texto); }
.mais__bloco h1 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); letter-spacing: -0.02em; }
.mais__grupo { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
.mais__dobra > summary { display: grid; gap: var(--esp-0); min-height: var(--toque); cursor: pointer; }
.mais__dobra > summary small { color: var(--texto-2); font-weight: var(--peso-medio); }
.mais__links { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.mais__links a { display: grid; gap: var(--esp-0); min-height: var(--toque); padding: var(--esp-3) var(--esp-4); border: var(--linha-fina); background: var(--superficie-2); color: var(--texto); text-decoration: none; }
.mais__links a:hover { background: var(--hover); }
.mais__links small { color: var(--texto-2); font-weight: var(--peso-medio); }
.mais__ops { display: grid; gap: var(--esp-4); }
</style>
