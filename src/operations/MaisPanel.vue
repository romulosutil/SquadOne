<script setup lang="ts">
import AccessPanel from './AccessPanel.vue'
import type { OperationsOverview } from './types'

// "Mais" (celular): o que não cabe na barra inferior. Entrada e acessos; os
// agentes ainda no Easypanel até a mudança da agenda (ARCHITECTURE "Transição", 4).
defineProps<{ overview: OperationsOverview | null }>()
</script>

<template>
  <div class="mais">
    <section class="ops-panel mais__links" aria-labelledby="mais-titulo">
      <h2 id="mais-titulo">Mais</h2>
      <ul>
        <li><a href="/financas/lancamentos">Lançamentos das finanças<small>todas as contas, com filtro</small></a></li>
        <li><a href="/entrada/">Entrada<small>texto e arquivos para a Mel organizar</small></a></li>
        <li><a href="https://aladdin-squadone-app.jicnzg.easypanel.host/" target="_blank" rel="noopener">Agentes do SquadOne<small>ainda no Easypanel, até a mudança para o Dell</small></a></li>
      </ul>
    </section>
    <AccessPanel :tools="overview?.tools ?? []" />
  </div>
</template>
