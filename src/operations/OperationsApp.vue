<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AgendaPanel from './AgendaPanel.vue'
import HealthPanel from './HealthPanel.vue'
import OperationsHeader from './OperationsHeader.vue'
import ProjectDialog from './ProjectDialog.vue'
import ProjectsPanel from './ProjectsPanel.vue'
import ToolsPanel from './ToolsPanel.vue'
import type { LocalProject, OperationsOverview, ProjectInput } from './types'
import './operations.css'

const overview = ref<OperationsOverview | null>(null)
const projects = ref<LocalProject[]>([])
const loadingOverview = ref(true)
const loadingProjects = ref(true)
const overviewError = ref('')
const dialogOpen = ref(false)
const selectedProject = ref<LocalProject | null>(null)
const savingProject = ref(false)
const projectError = ref('')
let refreshTimer = 0

const ideUrl = computed(() => overview.value?.tools.find(tool => tool.id === 'ide')?.launchUrl ?? 'http://127.0.0.1:8080/')
const squadOneUrl = computed(() => overview.value?.tools.find(tool => tool.id === 'remote')?.launchUrl ?? '')
const nextEvent = computed(() => {
  if (overview.value?.agenda.state !== 'connected') return null
  const now = Date.now()
  return overview.value.agenda.events.find(event => Date.parse(event.end) > now) ?? null
})
const attention = computed(() => {
  if (overviewError.value) {
    return {
      state: 'alert',
      title: 'O estado dos serviços não pôde ser confirmado.',
      detail: 'Use “Tentar novamente” antes de tomar uma decisão operacional.'
    }
  }

  if (loadingOverview.value) {
    return {
      state: 'pending',
      title: 'Atualizando a visão local.',
      detail: 'A Central ainda está consultando agenda e serviços configurados.'
    }
  }

  const unavailable = overview.value?.tools.filter(tool => tool.state === 'unavailable') ?? []
  if (unavailable.length) {
    return {
      state: 'alert',
      title: `${unavailable.length} serviço${unavailable.length === 1 ? '' : 's'} requer${unavailable.length === 1 ? '' : 'em'} atenção.`,
      detail: unavailable.map(tool => tool.label).join(' · ')
    }
  }

  return {
    state: 'ready',
    title: 'Nenhum serviço configurado exige atenção agora.',
    detail: 'Este resumo reflete a última verificação local exibida abaixo.'
  }
})

const loadOverview = async () => {
  loadingOverview.value = true
  overviewError.value = ''
  try {
    const response = await fetch('/api/operations/overview')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    overview.value = body
  } catch (error) {
    overviewError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingOverview.value = false
  }
}

const loadProjects = async () => {
  loadingProjects.value = true
  try {
    const response = await fetch('/api/operations/projects')
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    projects.value = body.projects ?? []
  } catch (error) {
    projectError.value = error instanceof Error ? error.message : String(error)
  } finally {
    loadingProjects.value = false
  }
}

const openProjectDialog = (project: LocalProject | null) => {
  selectedProject.value = project
  projectError.value = ''
  dialogOpen.value = true
}

const closeProjectDialog = () => {
  if (savingProject.value) return
  dialogOpen.value = false
  selectedProject.value = null
  projectError.value = ''
}

const saveProject = async (input: ProjectInput) => {
  savingProject.value = true
  projectError.value = ''
  const existing = selectedProject.value
  try {
    const response = await fetch(existing ? `/api/operations/projects/${encodeURIComponent(existing.id)}` : '/api/operations/projects', {
      method: existing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input)
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    if (existing) projects.value = projects.value.map(project => project.id === existing.id ? body.project : project)
    else projects.value = [...projects.value, body.project]
    closeProjectDialog()
  } catch (error) {
    projectError.value = error instanceof Error ? error.message : String(error)
  } finally {
    savingProject.value = false
    if (!projectError.value) closeProjectDialog()
  }
}

const removeProject = async (project: LocalProject) => {
  if (!window.confirm(`Excluir o projeto “${project.name}”? O atalho será removido desta Central.`)) return
  savingProject.value = true
  projectError.value = ''
  try {
    const response = await fetch(`/api/operations/projects/${encodeURIComponent(project.id)}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error ?? `HTTP ${response.status}`)
    }
    projects.value = projects.value.filter(item => item.id !== project.id)
    closeProjectDialog()
  } catch (error) {
    projectError.value = error instanceof Error ? error.message : String(error)
  } finally {
    savingProject.value = false
  }
}

const formatTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))

onMounted(async () => {
  await Promise.all([loadOverview(), loadProjects()])
  refreshTimer = window.setInterval(loadOverview, 30_000)
})

onBeforeUnmount(() => window.clearInterval(refreshTimer))
</script>

<template>
  <a class="ops-skip-link" href="#main-content">Pular para o conteúdo</a>
  <div class="ops-shell">
    <OperationsHeader
      :display-name="overview?.displayName ?? ''"
      :tools="overview?.tools ?? []"
      :squad-one-url="squadOneUrl"
      :checked-at="overview?.checkedAt ?? ''"
      :loading="loadingOverview"
      @refresh="loadOverview"
    />

    <p v-if="overviewError" class="ops-global-error" role="alert">
      <strong>A Central não conseguiu atualizar os serviços.</strong> {{ overviewError }}
      <button type="button" @click="loadOverview">Tentar novamente</button>
    </p>

    <main id="main-content" class="ops-workspace" tabindex="-1">
      <section class="ops-now" aria-labelledby="now-title">
        <div class="ops-now__heading"><h2 id="now-title">Agora</h2><span><i aria-hidden="true" /> Modo foco</span></div>
        <div class="ops-now__grid">
          <article class="ops-next-event">
            <template v-if="nextEvent">
              <p>Próximo compromisso</p>
              <div><strong>{{ nextEvent.allDay ? 'Hoje' : formatTime(nextEvent.start) }}</strong><span v-if="!nextEvent.allDay">— {{ formatTime(nextEvent.end) }}</span></div>
              <h3>{{ nextEvent.title }}</h3>
              <p>{{ nextEvent.location || 'Google Calendar' }}</p>
              <div class="ops-now__actions">
                <a v-if="nextEvent.htmlLink" :href="nextEvent.htmlLink" target="_blank" rel="noopener">Abrir compromisso</a>
                <a href="#agenda">Ver o dia</a>
              </div>
            </template>
            <template v-else-if="overview?.agenda.state === 'disconnected'">
              <p>Agenda</p><strong class="ops-now__word">Sem conexão</strong>
              <h3>Conecte o Google na Central</h3>
              <p>A autorização fica somente no Dell e não altera seu login no app público.</p>
              <div class="ops-now__actions">
                <a href="/api/auth/google">Conectar calendário</a>
              </div>
            </template>
            <template v-else>
              <p>Próximo compromisso</p><strong class="ops-now__word">Livre</strong>
              <h3>Nada exige atenção agora</h3>
              <p v-if="loadingOverview">Consultando sua agenda…</p>
              <p v-else>Não há outro compromisso disponível para hoje.</p>
            </template>
          </article>

          <aside class="ops-squadone-card" aria-labelledby="squadone-card-title">
            <p>SquadOne atual <span>Aplicação existente</span></p>
            <h3 id="squadone-card-title">Seu escritório</h3>
            <p>Veja o escritório atual sem sair da Central.</p>
            <div class="ops-office-preview" aria-hidden="true">
              <div class="ops-office-preview__bar">
                <span><i /><i /><i /></span>
                <strong>squadone.app</strong>
                <em>Disponível</em>
              </div>
              <div class="ops-office-preview__viewport">
                <div class="ops-office-preview__appbar"><i /><strong>SquadOne</strong><span>Squad Pessoal</span></div>
                <div class="ops-office-preview__workspace">
                  <div class="ops-office-preview__backpack"><strong>Mochila de Quests</strong><span>Próximas demandas</span></div>
                  <div class="ops-office-preview__rooms"><span>Demandas</span><span>Heitor</span><span>Coisas para fazer</span></div>
                  <div class="ops-office-preview__office"><i /><i /><i /><b /><b /><b /></div>
                </div>
                <div class="ops-office-preview__command"><span>Descreva a demanda…</span><strong>Delegar Quest</strong></div>
              </div>
            </div>
            <a v-if="squadOneUrl" :href="squadOneUrl" target="_blank" rel="noopener" aria-label="Abrir SquadOne em nova aba"><span><strong>Abrir SquadOne</strong><small>Ir para o escritório</small></span><span aria-hidden="true">↗</span></a>
          </aside>
        </div>
        <div class="ops-attention" :class="`is-${attention.state}`" role="status">
          <span aria-hidden="true">{{ attention.state === 'alert' ? '!' : attention.state === 'pending' ? '…' : '✓' }}</span>
          <div><strong>{{ attention.title }}</strong><small>{{ attention.detail }}</small></div>
          <a href="#health">Ver saúde operacional</a>
        </div>
      </section>

      <AgendaPanel :agenda="overview?.agenda ?? null" :loading="loadingOverview" />
      <ProjectsPanel :projects="projects" :loading="loadingProjects" :ide-url="ideUrl" @add="openProjectDialog(null)" @edit="openProjectDialog" />
      <ToolsPanel :tools="overview?.tools ?? []" :loading="loadingOverview" />
      <HealthPanel :tools="overview?.tools ?? []" :checked-at="overview?.checkedAt ?? ''" />
    </main>

    <footer class="ops-footer"><strong>SquadOne</strong><span>Central local · acesso somente por túnel SSH</span></footer>
  </div>

  <ProjectDialog
    :open="dialogOpen"
    :project="selectedProject"
    :saving="savingProject"
    :error="projectError"
    @close="closeProjectDialog"
    @save="saveProject"
    @remove="removeProject"
  />
</template>
