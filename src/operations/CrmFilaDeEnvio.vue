<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { hora } from './crm-formato'
import { filaDeEnvio, nichosDaFila, ordemComPulados, type EnviosAbertos } from './fila-de-envio'
import type { CrmItemHoje, CrmLead } from './types'

// "Enviar um por um" (08/10/2026): os sites prontos, um de cada vez, com o demo
// e a mensagem à vista ANTES do toque — o toque no link rastreado já marca o
// envio na planilha, então conferir depois é tarde. A folha não grava nada: o
// envio é o clique no link do n8n, como na lista (RULES 10 e 11).
const props = defineProps<{ itens: CrmItemHoje[]; leads: Map<string, CrmLead>; envios: EnviosAbertos }>()
const emit = defineEmits<{ enviado: [leadId: string]; abrir: [leadId: string, origem: HTMLElement | null] }>()

const nicho = ref<string | null>(null)
const pulados = ref<string[]>([])
/** O lead cujo WhatsApp acabou de abrir: o cartão fica até "Próximo". */
const aberto = ref<{ leadId: string; em: number } | null>(null)
const titulo = ref<HTMLElement | null>(null)

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
  }
  const primeiro = fila.value[0]
  return primeiro ? { ...primeiro, abertoEm: null as number | null } : null
})

async function focarCartao() {
  await nextTick()
  titulo.value?.focus()
}

// O link some depois do toque (o envio já foi marcado): o foco vai para "Próximo",
// que entra na tela no lugar dele, em vez de cair no corpo da página.
const botaoProximo = ref<HTMLButtonElement | null>(null)

async function aoEnviar() {
  const a = atual.value
  if (!a) return
  aberto.value = { leadId: a.item.leadId, em: Date.now() }
  emit('enviado', a.item.leadId)
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

      <template v-if="atual.abertoEm !== null">
        <p class="crm-fila__aberto" role="status">
          <strong>Aberto no WhatsApp às {{ hora(new Date(atual.abertoEm).toISOString()) }}.</strong>
          Mande por lá. O toque já marcou como enviado; a planilha confirma no próximo retrato (até 10 min).
        </p>
        <div class="crm-fila__acoes">
          <button ref="botaoProximo" type="button" class="botao botao--primario" @click="proximo">{{ fila.length ? 'Próximo site' : 'Concluir' }} <span aria-hidden="true">→</span></button>
        </div>
      </template>
      <template v-else>
        <div class="crm-fila__acoes">
          <a class="crm-fila__enviar" :href="atual.enviar" target="_blank" rel="noopener" @click="aoEnviar">Abrir no WhatsApp <span aria-hidden="true">↗</span></a>
          <button v-if="fila.length > 1" type="button" class="botao" @click="pular">Pular por agora</button>
        </div>
        <p class="crm-nota-pequena">O toque marca o lead como enviado na planilha, como o link da lista.</p>
      </template>
    </article>

    <p v-else class="crm-vazio">
      <strong>Fila vazia.</strong>
      <template v-if="abertosNestaTela"> Os abertos nesta tela somem da lista quando a planilha confirmar o envio.</template>
      <template v-else> Nenhum site pronto com WhatsApp válido esperando envio{{ nicho ? ' neste nicho' : '' }}.</template>
    </p>
  </div>
</template>
