<script setup lang="ts">
import type { LocalProject } from './types'

defineProps<{ projects: LocalProject[]; loading: boolean; ideUrl: string }>()
const emit = defineEmits<{ add: []; edit: [project: LocalProject] }>()

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
const openUrl = (project: LocalProject, ideUrl: string) => {
  if (project.kind === 'url') return project.target
  const url = new URL(ideUrl)
  url.searchParams.set('folder', project.target)
  return url.href
}
</script>

<template>
  <section class="ops-panel ops-projects" aria-labelledby="projects-title">
    <div class="ops-section-heading">
      <div><span>Seus atalhos</span><h2 id="projects-title">Projetos</h2></div>
      <button type="button" class="ops-button ops-button--outline" @click="emit('add')">＋ Adicionar projeto</button>
    </div>

    <p v-if="loading" class="ops-loading" role="status">Carregando projetos locais…</p>
    <div v-else-if="!projects.length" class="ops-empty">
      <span aria-hidden="true">＋</span>
      <h3>Nenhum projeto configurado</h3>
      <p>Adicione um caminho Linux para abrir na IDE ou uma URL segura para acessar no navegador.</p>
      <button type="button" class="ops-button ops-button--primary" @click="emit('add')">Adicionar primeiro projeto</button>
    </div>
    <div v-else class="ops-project-list">
      <article v-for="project in projects" :key="project.id">
        <span class="ops-project-glyph" aria-hidden="true">{{ initials(project.name) }}</span>
        <div><h3>{{ project.name }}</h3><p>{{ project.target }}</p></div>
        <span class="ops-project-kind">{{ project.kind === 'url' ? 'Link' : 'Pasta Linux' }}</span>
        <div class="ops-project-actions">
          <a :href="openUrl(project, ideUrl)" target="_blank" rel="noopener">
            {{ project.kind === 'url' ? 'Abrir link' : 'Abrir na IDE' }}
          </a>
          <button type="button" :aria-label="`Editar projeto ${project.name}`" @click="emit('edit', project)">Editar</button>
        </div>
      </article>
    </div>
  </section>
</template>
