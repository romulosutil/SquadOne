<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { hora } from './crm-formato'
import {
  estadoDoVideo, filaDeEnvio, gravarVideos, lerVideos, marcarVideo, nichosDaFila, ordemComPulados, passoDoVideo, type EnviosAbertos,
} from './fila-de-envio'
import { ROTULO_DE_LIBERAR, envioTravado, type EnviosLiberados } from './trava-de-horario'
import type { CrmItemHoje, CrmLead } from './types'

// "Enviar um por um" (08/10/2026): os sites prontos, um de cada vez, com o demo
// e a mensagem à vista ANTES do toque — o toque no link rastreado já marca o
// envio na planilha, então conferir depois é tarde. A folha não grava nada: o
// envio é o clique no link do n8n, como na lista (RULES 10 e 11).
// `aviso`: fora do expediente de quem recebe, com a taxa medida (resultados.ts, avisoDeHorario).
// Desde 14/10/2026 o aviso também TRAVA: fora do expediente o link de envio só aparece depois do
// "Liberar" daquele lead (trava-de-horario.ts). Enviar continua possível, a decisão é do Rômulo,
// mas deixou de ser um toque distraído: depois das 18h, 0 de 29 envios tiveram resposta.
const props = defineProps<{ itens: CrmItemHoje[]; leads: Map<string, CrmLead>; envios: EnviosAbertos; aviso?: string | null; liberados: EnviosLiberados }>()
const emit = defineEmits<{ enviado: [leadId: string]; abrir: [leadId: string, origem: HTMLElement | null]; liberar: [leadId: string] }>()

const nicho = ref<string | null>(null)
const pulados = ref<string[]>([])
/**
 * O lead cujo WhatsApp acabou de abrir: o cartão fica até "Próximo". Guarda o item e o lead
 * do momento do toque: no braço com vídeo, o cartão não some com o retrato novo enquanto o
 * vídeo não for marcado (a planilha confirma o envio da mensagem, não o do vídeo).
 */
const aberto = ref<{ leadId: string; em: number; item: CrmItemHoje; lead: CrmLead } | null>(null)
const titulo = ref<HTMLElement | null>(null)

function armazenamento(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}
// A/B do vídeo (fila-de-envio.ts): marca só deste navegador, 30 min, nunca na planilha.
const videos = ref<EnviosAbertos>(lerVideos(armazenamento(), Date.now()))

const nichos = computed(() => nichosDaFila(props.itens, props.leads, props.envios))
const fila = computed(() => ordemComPulados(filaDeEnvio(props.itens, props.leads, props.envios, nicho.value), pulados.value))
const total = computed(() => filaDeEnvio(props.itens, props.leads, props.envios).length)
const abertosNestaTela = computed(() => Object.keys(props.envios).length)

// O cartão aberto fica até "Próximo"; se a planilha confirmar antes (o lead sai
// dos prontos no retrato novo), a folha passa direto ao seguinte.
const atual = computed(() => {
  const a = aberto.value
  if (a) {
    const lead = props.leads.get(a.leadId)
    const item = props.itens.find(i => i.leadId === a.leadId)
    if (lead && item) return { item, lead, enviar: lead.links.enviar ?? '', abertoEm: a.em as number | null }
    if (estadoDoVideo(a.lead, videos.value) === 'pendente') return { item: a.item, lead: a.lead, enviar: '', abertoEm: a.em as number | null }
  }
  const primeiro = fila.value[0]
  return primeiro ? { ...primeiro, abertoEm: null as number | null } : null
})

async function focarCartao() {
  await nextTick()
  titulo.value?.focus()
}

// O link some depois do toque (o envio já foi marcado): o foco vai para "Próximo"
// (ou, no braço com vídeo, para "Vídeo enviado"), que entra na tela no lugar dele,
// em vez de cair no corpo da página.
const botaoProximo = ref<HTMLButtonElement | null>(null)
const botaoVideo = ref<HTMLButtonElement | null>(null)

const passo = computed(() => (atual.value ? passoDoVideo(atual.value.lead) : null))
const video = computed(() => (atual.value ? estadoDoVideo(atual.value.lead, videos.value) : null))

async function aoEnviar() {
  const a = atual.value
  if (!a) return
  aberto.value = { leadId: a.item.leadId, em: Date.now(), item: a.item, lead: a.lead }
  emit('enviado', a.item.leadId)
  await nextTick()
  ;(botaoVideo.value ?? botaoProximo.value)?.focus()
}

const travado = computed(() => (atual.value ? envioTravado(props.aviso, props.liberados, atual.value.item.leadId) : false))
const linkDeEnviar = ref<HTMLAnchorElement | null>(null)

// O botão que destrava some e dá lugar ao link: o foco acompanha, em vez de cair no corpo da página.
async function liberarAtual() {
  const a = atual.value
  if (!a) return
  emit('liberar', a.item.leadId)
  await nextTick()
  linkDeEnviar.value?.focus()
}

async function videoEnviado() {
  const a = atual.value
  if (!a) return
  videos.value = marcarVideo(videos.value, a.lead.id, Date.now())
  gravarVideos(armazenamento(), videos.value)
  await nextTick()
  botaoProximo.value?.focus()
}

function proximo() {
  aberto.value = null
  focarCartao()
}

function pular() {
  const a = atual.value
  if (!a) return
  pulados.value = [...pulados.value.filter(id => id !== a.item.leadId), a.item.leadId]
  focarCartao()
}

function escolherNicho(novo: string | null) {
  nicho.value = novo
  aberto.value = null
  focarCartao()
}
</script>

<template>
  <div class="crm-fila">
    <p v-if="aviso" class="crm-aviso" role="note"><strong>Melhor deixar para o expediente.</strong> {{ aviso }} Os sites ficam aqui; o envio fica travado até você liberar.</p>
    <div v-if="nichos.length > 1" class="crm-fila__nichos" role="group" aria-label="Nicho">
      <button type="button" :aria-pressed="nicho === null" @click="escolherNicho(null)">Todos <span>{{ total }}</span></button>
      <button v-for="n in nichos" :key="n.nicho" type="button" :aria-pressed="nicho === n.nicho" @click="escolherNicho(n.nicho)">
        {{ n.nicho }} <span>{{ n.quantos }}</span>
      </button>
    </div>

    <p class="crm-fila__progresso" aria-live="polite">
      <template v-if="fila.length">{{ fila.length }} site{{ fila.length === 1 ? '' : 's' }} para enviar{{ nicho ? ` em ${nicho}` : '' }}</template>
      <template v-else>Nada mais para enviar{{ nicho ? ` em ${nicho}` : '' }}</template>
      <template v-if="abertosNestaTela"> · {{ abertosNestaTela }} aberto{{ abertosNestaTela === 1 ? '' : 's' }} nesta tela, esperando a planilha confirmar</template>
    </p>

    <article v-if="atual" class="crm-fila__cartao" :aria-labelledby="`crm-fila-${atual.item.leadId}`">
      <div class="crm-item__quem">
        <h3 :id="`crm-fila-${atual.item.leadId}`" ref="titulo" tabindex="-1">{{ atual.lead.empresa }}</h3>
        <span v-if="atual.lead.abordagem?.site" class="crm-tag">Site {{ atual.lead.abordagem.site }}</span>
        <span v-if="passo" class="crm-tag">Com vídeo</span>
      </div>
      <p class="crm-fila__detalhe">{{ atual.item.detalhe }}</p>
      <div class="crm-item__links crm-fila__ver">
        <a v-if="atual.lead.links.site" :href="atual.lead.links.site" target="_blank" rel="noopener">Ver o demo <span aria-hidden="true">↗</span></a>
        <button type="button" class="botao botao--leve" @click="emit('abrir', atual.item.leadId, $event.currentTarget as HTMLElement)">Abrir a ficha</button>
      </div>

      <figure class="crm-fila__mensagem">
        <figcaption>A mensagem que vai no WhatsApp</figcaption>
        <blockquote v-if="atual.lead.mensagemPronta">{{ atual.lead.mensagemPronta }}</blockquote>
        <p v-else class="crm-nota-pequena">O retrato não trouxe o texto: o WhatsApp abre com a mensagem que o Balcão montou.</p>
      </figure>

      <!-- A/B do vídeo (ab-video.ts): o passo aparece antes do toque, para o vídeo estar à mão. -->
      <p v-if="passo" class="crm-aviso" role="note"><strong>Braço com vídeo (teste A/B).</strong> {{ passo }}</p>

      <template v-if="atual.abertoEm !== null">
        <p class="crm-fila__aberto" role="status">
          <strong>Aberto no WhatsApp às {{ hora(new Date(atual.abertoEm).toISOString()) }}.</strong>
          Mande por lá. O toque já marcou como enviado; a planilha confirma no próximo retrato (até 10 min).
        </p>
        <p v-if="video === 'enviado'" class="crm-fila__aberto" role="status">
          <strong>Vídeo marcado como enviado às {{ hora(new Date(videos[atual.lead.id]).toISOString()) }}.</strong>
          A marca fica só neste navegador; a medição do teste sai da planilha.
        </p>
        <div class="crm-fila__acoes">
          <button v-if="video === 'pendente'" ref="botaoVideo" type="button" class="botao botao--primario" @click="videoEnviado">Vídeo enviado</button>
          <button ref="botaoProximo" type="button" class="botao" :class="{ 'botao--primario': video !== 'pendente' }" @click="proximo">{{ fila.length ? 'Próximo site' : 'Concluir' }} <span aria-hidden="true">→</span></button>
        </div>
      </template>
      <template v-else>
        <div class="crm-fila__acoes">
          <button v-if="travado" type="button" class="botao" @click="liberarAtual">{{ ROTULO_DE_LIBERAR }}</button>
          <a v-else ref="linkDeEnviar" class="crm-fila__enviar" :href="atual.enviar" target="_blank" rel="noopener" @click="aoEnviar">Abrir no WhatsApp <span aria-hidden="true">↗</span></a>
          <button v-if="fila.length > 1" type="button" class="botao" @click="pular">Pular por agora</button>
        </div>
        <p class="crm-nota-pequena">{{ travado ? 'Liberar só destrava o link; nada é enviado nem marcado.' : 'O toque marca o lead como enviado na planilha, como o link da lista.' }}</p>
      </template>
    </article>

    <p v-else class="crm-vazio">
      <strong>Fila vazia.</strong>
      <template v-if="abertosNestaTela"> Os abertos nesta tela somem da lista quando a planilha confirmar o envio.</template>
      <template v-else> Nenhum site pronto com WhatsApp válido esperando envio{{ nicho ? ' neste nicho' : '' }}.</template>
    </p>
  </div>
</template>
