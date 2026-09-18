<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AutoClient, AutoEventType, AutoProductionOverview } from './types'

const overview = ref<AutoProductionOverview | null>(null)
const loading = ref(true)
const error = ref('')
const liveMessage = ref('')
const selected = ref<AutoClient | null>(null)
const detailsOpen = ref(false)
const eventOpen = ref(false)
const eventType = ref<AutoEventType>('ready')
const eventAt = ref('')
const channel = ref('WhatsApp')
const recipient = ref('')
const eventError = ref('')
const saving = ref(false)
const detailsDialog = ref<HTMLDialogElement | null>(null)
const eventDialog = ref<HTMLDialogElement | null>(null)
const detailsClose = ref<HTMLButtonElement | null>(null)
const eventAtInput = ref<HTMLInputElement | null>(null)
const search = ref('')
const stage = ref('all')
const sort = ref('priority')
const page = ref(1)
const streamState = ref<'connecting' | 'connected' | 'reconnecting'>('connecting')
let returnFocus: HTMLElement | null = null
let searchTimer = 0
let refreshTimer = 0
let eventSource: EventSource | null = null
let requestNumber = 0

const summaryCards = computed(() => overview.value ? [
  { label: 'Em preparação', value: overview.value.summary.preparing, tone: 'paper' },
  { label: 'Avisados pelo Hermes', value: overview.value.summary.ready, tone: 'blue' },
  { label: 'Aguardando envio', value: overview.value.summary.awaitingSend, tone: 'yellow' },
  { label: 'Enviados', value: overview.value.summary.awaitingConfirmation, tone: 'paper' },
  { label: 'Confirmados', value: overview.value.summary.confirmed, tone: 'mint' },
  { label: 'Requer atenção', value: overview.value.summary.attention, tone: 'coral' },
] : [])

const funnel = computed(() => overview.value ? [
  { label: 'Material recebido', value: overview.value.funnel.materialReceived, kind: 'local' },
  { label: 'Conteúdo e imagens', value: overview.value.funnel.contentAndImages, kind: 'local' },
  { label: 'Site gerado', value: overview.value.funnel.generated, kind: 'local' },
  { label: 'Aviso do Hermes', value: overview.value.funnel.ready, kind: 'evidence' },
  { label: 'Enviado ao cliente', value: overview.value.funnel.sent, kind: 'manual' },
  { label: 'Confirmado', value: overview.value.funnel.confirmed, kind: 'manual' },
] : [])

const awaitingSend = computed(() => overview.value?.actionClients ?? [])
const attentionClients = computed(() => overview.value?.attentionClients ?? [])
const connections = computed(() => overview.value ? [
  { key: 'folder', label: 'Pasta auto', ...overview.value.automation.folder },
  { key: 'syncthing', label: 'Linux · Syncthing', ...(overview.value.automation.syncthing ?? { state: 'unknown', detail: 'Não verificado', evidence: 'health check' }) },
  { key: 'runner', label: 'Runner', ...overview.value.automation.runner },
  { key: 'hermes', label: 'Hermes', ...overview.value.automation.hermes },
  { key: 'whatsapp', label: 'WhatsApp', ...overview.value.automation.whatsapp },
] : [])

const formatDateTime = (value?: string) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Ainda não registrado'

const dateTimeLocalNow = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('pt-BR')
const artifactProgress = (client: AutoClient) => [
  client.artifacts.content,
  client.artifacts.photos > 0,
  client.artifacts.cover,
  client.artifacts.generated,
  client.artifacts.publishedRecord,
].filter(Boolean).length

const load = async (announce = false, background = false) => {
  const currentRequest = ++requestNumber
  if (!background) loading.value = true
  error.value = ''
  try {
    const parameters = new URLSearchParams({
      q: search.value,
      stage: stage.value,
      sort: sort.value,
      page: String(page.value),
      pageSize: '15',
    })
    const response = await fetch(`/api/operations/auto?${parameters}`, { cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    if (currentRequest !== requestNumber) return
    overview.value = body
    page.value = body.page.number
    if (selected.value) {
      selected.value = [...body.clients, ...body.actionClients, ...body.attentionClients].find((client: AutoClient) => client.id === selected.value?.id) ?? selected.value
    }
    if (announce) liveMessage.value = `Leitura atualizada. ${body.summary.active} sites na produção ativa.`
  } catch (reason) {
    if (currentRequest !== requestNumber) return
    error.value = reason instanceof Error ? reason.message : String(reason)
    if (announce) liveMessage.value = 'Não foi possível atualizar a leitura da Produção Auto.'
  } finally {
    if (!background && currentRequest === requestNumber) loading.value = false
  }
}

const openDetails = (client: AutoClient, event?: Event) => {
  returnFocus = (event?.currentTarget as HTMLElement | null) ?? document.activeElement as HTMLElement | null
  selected.value = client
  detailsOpen.value = true
}

const closeDetails = () => {
  detailsOpen.value = false
}

const actionFor = (client: AutoClient): AutoEventType | null => {
  if ((client.hermesNotified || client.readyAt) && !client.sentAt) return 'sent'
  if (client.sentAt && !client.confirmedAt) return 'confirmed'
  return null
}

const actionLabel = (type: AutoEventType | null) => ({
  ready: 'Registrar evidência legada',
  sent: 'Marcar como enviado',
  confirmed: 'Confirmar recebimento',
} as const)[type ?? 'ready']

const openEvent = (client: AutoClient, type: AutoEventType, event?: Event) => {
  returnFocus = (event?.currentTarget as HTMLElement | null) ?? document.activeElement as HTMLElement | null
  selected.value = client
  eventType.value = type
  eventAt.value = dateTimeLocalNow()
  channel.value = 'WhatsApp'
  recipient.value = ''
  eventError.value = ''
  eventOpen.value = true
}

const closeEvent = () => {
  if (!saving.value) eventOpen.value = false
}

const submitEvent = async () => {
  if (!selected.value) return
  saving.value = true
  eventError.value = ''
  try {
    const response = await fetch(`/api/operations/auto/clients/${encodeURIComponent(selected.value.id)}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: eventType.value,
        at: new Date(eventAt.value).toISOString(),
        ...(eventType.value === 'sent' ? { channel: channel.value, recipient: recipient.value } : {}),
      }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    const label = actionLabel(eventType.value)
    eventOpen.value = false
    liveMessage.value = `${label} registrado para ${selected.value.name}.`
    await load(false, true)
  } catch (reason) {
    eventError.value = reason instanceof Error ? reason.message : String(reason)
  } finally {
    saving.value = false
  }
}

watch(detailsOpen, async (open) => {
  if (open) {
    detailsDialog.value?.showModal()
    await nextTick()
    detailsClose.value?.focus()
  } else if (detailsDialog.value?.open) {
    detailsDialog.value.close()
    returnFocus?.focus()
  }
})

watch(eventOpen, async (open) => {
  if (open) {
    eventDialog.value?.showModal()
    await nextTick()
    eventAtInput.value?.focus()
  } else if (eventDialog.value?.open) {
    eventDialog.value.close()
    returnFocus?.focus()
  }
})

const changePage = (nextPage: number) => {
  if (!overview.value || nextPage < 1 || nextPage > overview.value.page.pages || nextPage === page.value) return
  page.value = nextPage
  load(false)
}

watch([search, stage, sort], () => {
  page.value = 1
  window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => load(false), 250)
})

onMounted(async () => {
  await load()
  eventSource = new EventSource('/api/operations/auto/events')
  eventSource.addEventListener('connected', () => { streamState.value = 'connected' })
  eventSource.addEventListener('refresh', () => {
    window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(() => load(false, true), 150)
  })
  eventSource.onerror = () => { streamState.value = 'reconnecting' }
})

onBeforeUnmount(() => {
  window.clearTimeout(searchTimer)
  window.clearTimeout(refreshTimer)
  eventSource?.close()
})
</script>

<template>
  <section id="producao-auto" class="auto-production" aria-labelledby="auto-title">
    <div class="auto-masthead">
      <div class="auto-masthead__copy">
        <span class="auto-kicker">Projeto · Dashboard operacional</span>
        <h2 id="auto-title">Produção Auto</h2>
        <p class="auto-subtitle">Uma leitura contínua da pasta auto, do Linux e do Hermes.</p>
      </div>
      <div class="auto-masthead__control">
        <span aria-hidden="true">↻</span>
        <button type="button" :disabled="loading" @click="load(true)">{{ loading ? 'Lendo pasta…' : 'Atualizar leitura' }}</button>
        <small v-if="overview">Última leitura {{ formatDateTime(overview.checkedAt) }}</small>
        <small v-else>Fonte: leitura local</small>
        <small class="auto-stream-state" :class="`is-${streamState}`">{{ streamState === 'connected' ? 'Canal ao vivo conectado' : streamState === 'reconnecting' ? 'Reconectando canal ao vivo' : 'Conectando canal ao vivo' }}</small>
      </div>
    </div>

    <p class="auto-live" aria-live="polite">{{ liveMessage }}</p>
    <div v-if="error" class="auto-error" role="alert">
      <strong>Produção Auto indisponível.</strong><span>{{ error }}</span>
      <button type="button" @click="load(true)">Tentar novamente</button>
    </div>

    <template v-if="overview">
      <section class="auto-bridge" aria-labelledby="auto-bridge-title">
        <div class="auto-section-label"><span>00</span><h3 id="auto-bridge-title">Cadeia de comunicação</h3><strong>Atualização persistente</strong></div>
        <ol class="auto-bridge__flow">
          <li v-for="connection in connections" :key="connection.key" :class="`is-${connection.state}`">
            <span class="auto-bridge__signal" aria-hidden="true"></span>
            <div><strong>{{ connection.label }}</strong><small>{{ connection.detail }}</small><em>{{ connection.evidence }}<template v-if="connection.updatedAt"> · {{ formatDateTime(connection.updatedAt) }}</template></em></div>
          </li>
        </ol>
        <p class="auto-bridge__note"><strong>{{ overview.automation.notifier.notifiedCount }}</strong> sites constam no estado do watcher. Isso prova o envio pelo Hermes, não a leitura da mensagem no WhatsApp.</p>
      </section>

      <section class="auto-summary" aria-labelledby="auto-summary-title">
        <div class="auto-section-label"><span>01</span><h3 id="auto-summary-title">Resumo operacional</h3><strong>{{ overview.summary.active }} sites ativos</strong></div>
        <div class="auto-summary__grid">
          <article v-for="card in summaryCards" :key="card.label" :class="`is-${card.tone}`">
            <strong>{{ card.value }}</strong><span>{{ card.label }}</span>
          </article>
        </div>
        <p class="auto-discarded"><span>Fora da operação ativa</span><strong>{{ overview.summary.discarded }}</strong> descartado{{ overview.summary.discarded === 1 ? '' : 's' }}</p>
      </section>

      <section class="auto-action" aria-labelledby="auto-action-title">
        <header>
          <div><span>Sua ação agora</span><h3 id="auto-action-title">Enviar ao cliente</h3></div>
          <strong>{{ awaitingSend.length }} pendente{{ awaitingSend.length === 1 ? '' : 's' }}</strong>
        </header>
        <div v-if="awaitingSend.length" class="auto-action__list">
          <article v-for="client in awaitingSend" :key="client.id">
            <div class="auto-thumb">
              <span>{{ initials(client.name) }}</span>
              <img v-if="client.thumbnailUrl" :src="client.thumbnailUrl" alt="" @error="($event.currentTarget as HTMLImageElement).hidden = true">
            </div>
            <div class="auto-action__copy"><span>Watcher do Hermes avisou</span><h4>{{ client.name }}</h4><time v-if="client.readyAt" :datetime="client.readyAt">{{ formatDateTime(client.readyAt) }}</time><small>{{ client.hermesNotified ? 'leads-notificados.json · envio automatizado' : 'marco legado · horário registrado' }}</small></div>
            <div class="auto-action__buttons">
              <button class="auto-button auto-button--primary" type="button" @click="openEvent(client, 'sent', $event)">Marcar como enviado</button>
              <button class="auto-text-button" type="button" @click="openDetails(client, $event)">Ver detalhes →</button>
            </div>
          </article>
        </div>
        <p v-else class="auto-empty"><strong>Nenhum envio pendente.</strong> Quando o watcher concluir um aviso pelo Hermes, o cliente aparecerá aqui.</p>
      </section>

      <details class="auto-funnel">
        <summary><span>02</span><strong id="auto-funnel-title">Ver funil de produção</strong><small>Arquivos locais + registros operacionais</small></summary>
        <ol aria-labelledby="auto-funnel-title">
          <li v-for="(step, index) in funnel" :key="step.label" :class="`is-${step.kind}`">
            <span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ step.value }}</strong><em>{{ step.label }}</em>
          </li>
        </ol>
        <div class="auto-legend"><span><i class="is-local" /> arquivos locais</span><span><i class="is-evidence" /> evidência automática</span><span><i class="is-manual" /> registros humanos</span></div>
      </details>

      <section class="auto-clients" aria-labelledby="auto-clients-title">
        <div class="auto-section-label"><span>03</span><h3 id="auto-clients-title">Clientes e sites</h3><strong>{{ overview.page.total }} de {{ overview.summary.active }}</strong></div>
        <form class="auto-client-filters" role="search" @submit.prevent>
          <label><span>Buscar cliente ou pasta</span><input v-model="search" type="search" placeholder="Ex.: clínica, loja, cidade…" autocomplete="off"></label>
          <label><span>Etapa</span><select v-model="stage"><option value="all">Todas</option><option value="preparation">Em preparação</option><option value="generated">Site gerado</option><option value="ready">Avisado pelo Hermes</option><option value="sent">Enviado ao cliente</option><option value="confirmed">Confirmado</option><option value="attention">Com atenção</option></select></label>
          <label><span>Ordenar</span><select v-model="sort"><option value="priority">Prioridade</option><option value="recent">Mais recentes</option><option value="name">Nome A–Z</option></select></label>
        </form>
        <div class="auto-client-table-wrap">
          <table class="auto-client-table">
            <thead><tr><th scope="col">Cliente</th><th scope="col">Etapa</th><th scope="col">Artefatos</th><th scope="col">Última mudança</th><th scope="col">Atenção</th><th scope="col"><span class="ops-visually-hidden">Ações</span></th></tr></thead>
            <tbody>
              <tr v-for="client in overview.clients" :key="client.id" :class="`is-${client.stage}`">
                <th scope="row"><button class="auto-client-link" type="button" @click="openDetails(client, $event)"><span class="auto-client-avatar">{{ initials(client.name) }}</span><span><strong>{{ client.name }}</strong><small>{{ client.id }}</small></span></button></th>
                <td data-label="Etapa"><span :class="`auto-stage auto-stage--${client.stage}`">{{ client.stageLabel }}</span></td>
                <td data-label="Artefatos"><strong class="auto-progress">{{ artifactProgress(client) }}/5</strong><small>{{ client.artifacts.photos }} foto{{ client.artifacts.photos === 1 ? '' : 's' }}</small></td>
                <td data-label="Última mudança"><time :datetime="client.lastModified">{{ formatDateTime(client.lastModified) }}</time></td>
                <td data-label="Atenção"><span v-if="client.alerts.length" class="auto-alert-count">{{ client.alerts.length }} alerta{{ client.alerts.length === 1 ? '' : 's' }}</span><span v-else>—</span></td>
                <td><button v-if="actionFor(client)" class="auto-button auto-button--compact" :class="{ 'auto-button--primary': actionFor(client) === 'sent' }" type="button" @click="openEvent(client, actionFor(client)!, $event)">{{ actionFor(client) === 'sent' ? 'Marcar envio' : 'Confirmar' }}</button><button v-else class="auto-text-button" type="button" @click="openDetails(client, $event)">Detalhes</button></td>
              </tr>
            </tbody>
          </table>
          <p v-if="!overview.clients.length" class="auto-empty"><strong>Nenhum resultado.</strong> Ajuste a busca ou os filtros.</p>
        </div>
        <nav v-if="overview.page.pages > 1" class="auto-pagination" aria-label="Paginação de clientes"><button type="button" :disabled="overview.page.number === 1" @click="changePage(overview.page.number - 1)">← Anterior</button><span>Página <strong>{{ overview.page.number }}</strong> de {{ overview.page.pages }}</span><button type="button" :disabled="overview.page.number === overview.page.pages" @click="changePage(overview.page.number + 1)">Próxima →</button></nav>
      </section>

      <section class="auto-attention" aria-labelledby="auto-attention-title">
        <div class="auto-section-label"><span>04</span><h3 id="auto-attention-title">Requer atenção</h3><strong>{{ overview.summary.attention }}</strong></div>
        <div v-if="attentionClients.length" class="auto-attention__grid">
          <article v-for="client in attentionClients" :key="client.id">
            <span aria-hidden="true">!</span><div><h4>{{ client.name }}</h4><ul><li v-for="alert in client.alerts" :key="alert">{{ alert }}</li></ul></div>
            <button class="auto-text-button" type="button" @click="openDetails(client, $event)">Inspecionar →</button>
          </article>
        </div>
        <p v-else class="auto-empty"><strong>Nenhuma evidência local requer atenção.</strong></p>
        <p class="auto-caution">A Central descreve arquivos encontrados ou ausentes. Ela não confirma publicação nem disponibilidade pública.</p>
      </section>
    </template>

    <dialog ref="detailsDialog" class="auto-drawer" aria-labelledby="auto-details-title" @cancel.prevent="closeDetails" @close="detailsOpen = false">
      <div v-if="selected" class="auto-drawer__shell">
        <header>
          <span>Detalhes da produção</span>
          <button ref="detailsClose" type="button" aria-label="Fechar detalhes" @click="closeDetails">×</button>
        </header>
        <div class="auto-drawer__hero">
          <div class="auto-thumb"><span>{{ initials(selected.name) }}</span><img v-if="selected.thumbnailUrl" :src="selected.thumbnailUrl" alt=""></div>
          <div><h3 id="auto-details-title">{{ selected.name }}</h3><span :class="`auto-stage auto-stage--${selected.stage}`">{{ selected.stageLabel }}</span></div>
        </div>
        <div class="auto-drawer__body">
          <section aria-labelledby="artifact-title"><h4 id="artifact-title">Checklist de artefatos</h4>
            <ul class="auto-detail-checklist">
              <li><span>{{ selected.artifacts.content ? '✓' : '×' }}</span><strong>Conteúdo</strong><small>{{ selected.artifacts.content ? 'content.md encontrado' : 'content.md ausente' }}</small></li>
              <li><span>{{ selected.artifacts.photos ? '✓' : '×' }}</span><strong>Fotos</strong><small>{{ selected.artifacts.photos }} arquivo{{ selected.artifacts.photos === 1 ? '' : 's' }} em Fotos/</small></li>
              <li><span>{{ selected.artifacts.cover ? '✓' : '×' }}</span><strong>Capa</strong><small>{{ selected.artifacts.cover ? 'Logotipo/ contém imagem' : 'imagem ausente em Logotipo/' }}</small></li>
              <li><span>{{ selected.artifacts.generated ? '✓' : '×' }}</span><strong>Site gerado</strong><small>{{ selected.artifacts.generated ? 'index.html encontrado' : 'index.html ausente' }}</small></li>
              <li><span>{{ selected.artifacts.publishedRecord ? '✓' : '×' }}</span><strong>Publicação</strong><small>{{ selected.artifacts.publishedRecord ? 'Registro local de publicação encontrado' : 'publicado.json ausente' }}</small></li>
            </ul>
          </section>
          <section aria-labelledby="files-title"><h4 id="files-title">Histórico local de arquivos</h4>
            <ol class="auto-history"><li v-for="file in selected.fileHistory" :key="`${file.name}-${file.changedAt}`"><span></span><div><strong>{{ file.name }}</strong><small>{{ formatDateTime(file.changedAt) }} · {{ file.origin }}</small></div></li></ol>
          </section>
          <section aria-labelledby="ops-history-title"><h4 id="ops-history-title">Histórico operacional</h4>
            <ol v-if="selected.operationalHistory.length" class="auto-history"><li v-for="entry in selected.operationalHistory" :key="entry.type"><span></span><div><strong>{{ entry.type === 'ready' ? 'Hermes avisou que está pronto' : entry.type === 'sent' ? 'Enviado ao cliente' : 'Cliente confirmou' }}</strong><small>{{ formatDateTime(entry.at) }} · {{ entry.origin }}<template v-if="entry.manual && entry.origin !== 'registro manual'"> · registro manual</template><template v-if="entry.channel"> · {{ entry.channel }}</template><template v-if="entry.recipient"> · {{ entry.recipient }}</template></small></div></li></ol>
            <p v-else class="auto-muted">Nenhum marco operacional registrado.</p>
          </section>
          <div v-if="actionFor(selected)" class="auto-drawer__action"><button class="auto-button auto-button--primary" type="button" @click="openEvent(selected, actionFor(selected)!, $event)">{{ actionLabel(actionFor(selected)) }}</button></div>
        </div>
      </div>
    </dialog>

    <dialog ref="eventDialog" class="auto-event-dialog" aria-labelledby="auto-event-title" @cancel.prevent="closeEvent" @close="eventOpen = false">
      <form method="dialog" @submit.prevent="submitEvent">
        <header><span>Registro operacional</span><button type="button" aria-label="Fechar" @click="closeEvent">×</button></header>
        <div class="auto-event-dialog__body">
          <h3 id="auto-event-title">{{ actionLabel(eventType) }}</h3><p>{{ selected?.name }}</p>
          <p v-if="eventType === 'ready'" class="auto-callout">Marco legado manual. O fluxo atual usa a evidência real de <strong>leads-notificados.json</strong>.</p>
          <label>Data e hora<input ref="eventAtInput" v-model="eventAt" type="datetime-local" required></label>
          <template v-if="eventType === 'sent'">
            <label>Canal de envio<select v-model="channel" required><option>WhatsApp</option><option>E-mail</option><option>Ligação</option><option>Outro</option></select></label>
            <label>Destinatário <small>opcional ou mascarado</small><input v-model="recipient" type="text" maxlength="120" placeholder="Ex.: +55 •••• 4321"></label>
            <p class="auto-muted">Este registro não afirma que o cliente leu, aprovou ou publicou a entrega.</p>
          </template>
          <p v-if="eventError" class="auto-form-error" role="alert">{{ eventError }}</p>
        </div>
        <footer><button type="button" :disabled="saving" @click="closeEvent">Cancelar</button><button class="auto-button auto-button--primary" type="submit" :disabled="saving">{{ saving ? 'Salvando…' : 'Registrar marco' }}</button></footer>
      </form>
    </dialog>
  </section>
</template>
