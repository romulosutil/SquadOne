<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
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
let returnFocus: HTMLElement | null = null

const summaryCards = computed(() => overview.value ? [
  { label: 'Em preparação', value: overview.value.summary.preparing, tone: 'paper' },
  { label: 'Prontos no worker', value: overview.value.summary.ready, tone: 'blue' },
  { label: 'Aguardando envio', value: overview.value.summary.awaitingSend, tone: 'yellow' },
  { label: 'Enviados', value: overview.value.summary.awaitingConfirmation, tone: 'paper' },
  { label: 'Confirmados', value: overview.value.summary.confirmed, tone: 'mint' },
  { label: 'Requer atenção', value: overview.value.summary.attention, tone: 'coral' },
] : [])

const funnel = computed(() => overview.value ? [
  { label: 'Material recebido', value: overview.value.funnel.materialReceived, kind: 'local' },
  { label: 'Conteúdo e imagens', value: overview.value.funnel.contentAndImages, kind: 'local' },
  { label: 'Site gerado', value: overview.value.funnel.generated, kind: 'local' },
  { label: 'Pronto no worker', value: overview.value.funnel.ready, kind: 'manual' },
  { label: 'Enviado ao cliente', value: overview.value.funnel.sent, kind: 'manual' },
  { label: 'Confirmado', value: overview.value.funnel.confirmed, kind: 'manual' },
] : [])

const awaitingSend = computed(() => overview.value?.clients.filter((client) => client.readyAt && !client.sentAt) ?? [])
const attentionClients = computed(() => overview.value?.clients.filter((client) => client.alerts.length) ?? [])

const formatDateTime = (value?: string) => value
  ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Ainda não registrado'

const dateTimeLocalNow = () => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - offset).toISOString().slice(0, 16)
}

const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toLocaleUpperCase('pt-BR')

const load = async (announce = false) => {
  loading.value = true
  error.value = ''
  try {
    const response = await fetch('/api/operations/auto', { cache: 'no-store' })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`)
    overview.value = body
    if (selected.value) selected.value = body.clients.find((client: AutoClient) => client.id === selected.value?.id) ?? null
    if (announce) liveMessage.value = `Leitura atualizada. ${body.summary.active} sites na produção ativa.`
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
    if (announce) liveMessage.value = 'Não foi possível atualizar a leitura da Produção Auto.'
  } finally {
    loading.value = false
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
  if (!client.readyAt && client.artifacts.generated) return 'ready'
  if (client.readyAt && !client.sentAt) return 'sent'
  if (client.sentAt && !client.confirmedAt) return 'confirmed'
  return null
}

const actionLabel = (type: AutoEventType | null) => ({
  ready: 'Registrar pronto no worker',
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
    overview.value = body
    selected.value = body.clients.find((client: AutoClient) => client.id === selected.value?.id) ?? null
    const label = actionLabel(eventType.value)
    eventOpen.value = false
    liveMessage.value = `${label} registrado para ${selected.value?.name ?? 'o cliente'}.`
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

onMounted(() => load())
</script>

<template>
  <section id="producao-auto" class="auto-production" aria-labelledby="auto-title">
    <div class="auto-masthead">
      <div class="auto-masthead__copy">
        <span class="auto-kicker">Central local · nova seção</span>
        <h2 id="auto-title">Produção<br><em>Auto</em></h2>
        <p class="auto-subtitle">Acompanhamento local dos sites em produção</p>
        <p>Dados derivados da pasta auto e dos registros operacionais locais.</p>
      </div>
      <div class="auto-masthead__control">
        <span aria-hidden="true">↻</span>
        <button type="button" :disabled="loading" @click="load(true)">{{ loading ? 'Lendo pasta…' : 'Atualizar leitura' }}</button>
        <small v-if="overview">Última leitura {{ formatDateTime(overview.checkedAt) }}</small>
        <small v-else>Fonte: leitura local</small>
      </div>
    </div>

    <p class="auto-live" aria-live="polite">{{ liveMessage }}</p>
    <div v-if="error" class="auto-error" role="alert">
      <strong>Produção Auto indisponível.</strong><span>{{ error }}</span>
      <button type="button" @click="load(true)">Tentar novamente</button>
    </div>

    <template v-if="overview">
      <section class="auto-summary" aria-labelledby="auto-summary-title">
        <div class="auto-section-label"><span>01</span><h3 id="auto-summary-title">Resumo operacional</h3><strong>{{ overview.summary.active }} sites ativos</strong></div>
        <div class="auto-summary__grid">
          <article v-for="card in summaryCards" :key="card.label" :class="`is-${card.tone}`">
            <strong>{{ card.value }}</strong><span>{{ card.label }}</span>
          </article>
        </div>
        <p class="auto-discarded"><span>Fora da operação ativa</span><strong>{{ overview.summary.discarded }}</strong> descartado{{ overview.summary.discarded === 1 ? '' : 's' }}</p>
      </section>

      <section class="auto-funnel" aria-labelledby="auto-funnel-title">
        <div class="auto-section-label"><span>02</span><h3 id="auto-funnel-title">Funil de produção</h3></div>
        <ol>
          <li v-for="(step, index) in funnel" :key="step.label" :class="`is-${step.kind}`">
            <span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ step.value }}</strong><em>{{ step.label }}</em>
          </li>
        </ol>
        <div class="auto-legend"><span><i class="is-local" /> arquivos locais</span><span><i class="is-manual" /> registros operacionais</span></div>
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
            <div class="auto-action__copy"><span>Hermes informou</span><h4>{{ client.name }}</h4><time :datetime="client.readyAt">{{ formatDateTime(client.readyAt) }}</time><small>Hermes via WhatsApp · registro manual</small></div>
            <div class="auto-action__buttons">
              <button class="auto-button auto-button--primary" type="button" @click="openEvent(client, 'sent', $event)">Marcar como enviado</button>
              <button class="auto-text-button" type="button" @click="openDetails(client, $event)">Ver detalhes →</button>
            </div>
          </article>
        </div>
        <p v-else class="auto-empty"><strong>Nenhum envio pendente.</strong> Assim que um aviso do Hermes for registrado, o cliente aparecerá aqui.</p>
      </section>

      <section class="auto-clients" aria-labelledby="auto-clients-title">
        <div class="auto-section-label"><span>03</span><h3 id="auto-clients-title">Clientes e sites</h3><strong>{{ overview.clients.length }} pastas</strong></div>
        <div class="auto-client-list">
          <article v-for="client in overview.clients" :key="client.id" :class="`is-${client.stage}`">
            <div class="auto-client__lead">
              <div class="auto-thumb auto-thumb--small">
                <span>{{ initials(client.name) }}</span>
                <img v-if="client.thumbnailUrl" :src="client.thumbnailUrl" alt="" @error="($event.currentTarget as HTMLImageElement).hidden = true">
              </div>
              <div><h4>{{ client.name }}</h4><time :datetime="client.lastModified">Alterado {{ formatDateTime(client.lastModified) }}</time></div>
            </div>
            <ul class="auto-checklist" aria-label="Artefatos locais">
              <li :class="{ 'is-ok': client.artifacts.content }"><span aria-hidden="true">{{ client.artifacts.content ? '✓' : '×' }}</span> Conteúdo</li>
              <li :class="{ 'is-ok': client.artifacts.photos }"><span aria-hidden="true">{{ client.artifacts.photos ? '✓' : '×' }}</span> Fotos <small v-if="client.artifacts.photos">{{ client.artifacts.photos }}</small></li>
              <li :class="{ 'is-ok': client.artifacts.cover }"><span aria-hidden="true">{{ client.artifacts.cover ? '✓' : '×' }}</span> Capa</li>
              <li :class="{ 'is-ok': client.artifacts.generated }"><span aria-hidden="true">{{ client.artifacts.generated ? '✓' : '×' }}</span> Site</li>
              <li :class="{ 'is-ok': client.artifacts.publishedRecord }"><span aria-hidden="true">{{ client.artifacts.publishedRecord ? '✓' : '×' }}</span> Registro</li>
            </ul>
            <div class="auto-client__state"><span :class="`auto-stage auto-stage--${client.stage}`">{{ client.stageLabel }}</span><small v-if="client.alerts.length">{{ client.alerts.length }} alerta{{ client.alerts.length === 1 ? '' : 's' }}</small></div>
            <div class="auto-client__actions">
              <button class="auto-text-button" type="button" @click="openDetails(client, $event)">Ver detalhes</button>
              <button v-if="actionFor(client)" class="auto-button" :class="{ 'auto-button--primary': actionFor(client) === 'sent' }" type="button" @click="openEvent(client, actionFor(client)!, $event)">{{ actionLabel(actionFor(client)) }}</button>
            </div>
          </article>
        </div>
      </section>

      <section class="auto-attention" aria-labelledby="auto-attention-title">
        <div class="auto-section-label"><span>04</span><h3 id="auto-attention-title">Requer atenção</h3><strong>{{ attentionClients.length }}</strong></div>
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
          <p v-if="eventType === 'ready'" class="auto-callout">Origem: <strong>Hermes via WhatsApp</strong><br>Enquanto não há integração confiável, este é um <strong>registro manual</strong>.</p>
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
