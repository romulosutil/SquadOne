<script setup lang="ts">
import { computed, ref } from 'vue'
import type { LocalProject } from './types'

const props = defineProps<{ projects: LocalProject[]; loading: boolean; ideUrl: string }>()
const emit = defineEmits<{ add: []; edit: [project: LocalProject] }>()
const query = ref('')
const filter = ref<'all' | 'dashboard' | 'access'>('all')
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const matches = (text: string) => text.toLocaleLowerCase('pt-BR').includes(query.value.trim().toLocaleLowerCase('pt-BR'))
const showAuto = computed(() => filter.value !== 'access' && matches('Produção Auto sites dashboard'))
const filtered = computed(() => filter.value === 'dashboard' ? [] : props.projects.filter(project => matches(`${project.name} ${project.description} ${project.category} ${project.target}`)))
const openUrl = (project: LocalProject) => {
  if (project.kind === 'url') return project.target
  const url = new URL(props.ideUrl)
  url.searchParams.set('folder', project.target)
  return url.href
}
</script>

<template>
  <section class="ops-catalog" aria-labelledby="catalog-title">
    <header class="ops-page-hero"><div><span>Portfólio local</span><h2 id="catalog-title">Projetos</h2><p>Um lugar para dashboards completos e acessos rápidos. Cadastre Iris, Silmer, ASMR e os próximos sem aumentar a home.</p></div><button type="button" class="ops-button ops-button--primary" @click="emit('add')">＋ Adicionar projeto</button></header>
    <div class="ops-catalog__controls">
      <label><span class="ops-visually-hidden">Buscar projetos</span><input v-model="query" type="search" placeholder="Buscar por nome, categoria ou destino…"></label>
      <div role="group" aria-label="Filtrar projetos">
        <button v-for="option in ([['all', 'Todos'], ['dashboard', 'Dashboards'], ['access', 'Acessos']] as const)" :key="option[0]" type="button" :aria-pressed="filter === option[0]" @click="filter = option[0]">{{ option[1] }}</button>
      </div>
    </div>
    <p v-if="loading" class="ops-loading" role="status">Carregando catálogo…</p>
    <div v-else class="ops-project-cards">
      <article v-if="showAuto" class="ops-project-card is-dashboard">
        <span class="ops-project-card__glyph" aria-hidden="true">PA</span><div><span class="ops-project-card__type">Dashboard · Produção</span><h3>Produção Auto</h3><p>Leitura dos artefatos locais, fila de ação e marcos de envio.</p></div><a href="/projetos/producao-auto">Abrir painel <span aria-hidden="true">→</span></a>
      </article>
      <article v-for="project in filtered" :key="project.id" class="ops-project-card">
        <span class="ops-project-card__glyph" aria-hidden="true">{{ initials(project.name) }}</span><div><span class="ops-project-card__type">{{ project.category || 'Acesso local' }}<template v-if="project.pinned"> · Fixado</template></span><h3>{{ project.name }}</h3><p>{{ project.description || project.target }}</p></div>
        <div class="ops-project-card__actions"><a :href="openUrl(project)" target="_blank" rel="noopener">Abrir <span aria-hidden="true">↗</span></a><button type="button" :aria-label="`Editar projeto ${project.name}`" @click="emit('edit', project)">Editar</button></div>
      </article>
      <div v-if="!showAuto && !filtered.length" class="ops-empty"><span aria-hidden="true">⌕</span><h3>Nenhum projeto encontrado</h3><p>Ajuste a busca ou adicione um novo acesso ao catálogo.</p></div>
    </div>
  </section>
</template>
