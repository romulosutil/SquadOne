<script setup lang="ts">
import { computed } from 'vue'
import type { LocalProject } from './types'

const props = defineProps<{ projects: LocalProject[]; loading: boolean; ideUrl: string }>()
const featured = computed(() => props.projects.filter(project => project.pinned).slice(0, 3))
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const openUrl = (project: LocalProject) => {
  if (project.kind === 'url') return project.target
  const url = new URL(props.ideUrl)
  url.searchParams.set('folder', project.target)
  return url.href
}
</script>

<template>
  <section class="ops-home-projects" aria-labelledby="home-projects-title">
    <header class="ops-page-heading"><div><span>Portfólio</span><h2 id="home-projects-title">Projetos fixados</h2><p>Somente os acessos que você quer manter à mão.</p></div><a href="/projetos">Ver catálogo <span aria-hidden="true">→</span></a></header>
    <div class="ops-project-cards ops-project-cards--home">
      <article class="ops-project-card is-dashboard">
        <span class="ops-project-card__glyph" aria-hidden="true">PA</span>
        <div><span class="ops-project-card__type">Dashboard</span><h3>Produção Auto</h3><p>Acompanhe sites, pendências e marcos operacionais.</p></div>
        <a href="/projetos/producao-auto">Abrir painel <span aria-hidden="true">→</span></a>
      </article>
      <p v-if="loading" class="ops-loading" role="status">Carregando projetos fixados…</p>
      <article v-for="project in featured" :key="project.id" class="ops-project-card">
        <span class="ops-project-card__glyph" aria-hidden="true">{{ initials(project.name) }}</span>
        <div><span class="ops-project-card__type">{{ project.category || 'Acesso' }}</span><h3>{{ project.name }}</h3><p>{{ project.description || project.target }}</p></div>
        <a :href="openUrl(project)" target="_blank" rel="noopener">Abrir <span aria-hidden="true">↗</span></a>
      </article>
    </div>
  </section>
</template>
