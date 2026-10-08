<script setup lang="ts">
import { computed, ref } from 'vue'
import { SIGLA_DO_PRODUTO, hora } from './crm-formato'
import { estadoDoEnvio, filaDeEnvio, ordenarComEnvios, type EnviosAbertos } from './fila-de-envio'
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmItemHoje, CrmLead } from './types'

// "Hoje": só o que depende do Rômulo, na ordem do servidor (server/crm.ts,
// montarHoje). Cada linha é uma ação e o link que a resolve.
// Em "Sites prontos para enviar", o que esta tela já abriu no WhatsApp vai para o
// fim com a hora do toque até a planilha confirmar (fila-de-envio.ts).
const props = defineProps<{ grupos: CrmGrupoHoje[]; leads: Map<string, CrmLead>; envios: EnviosAbertos; agora: number }>()
const emit = defineEmits<{
  abrir: [leadId: string, origem: HTMLElement | null]
  enviado: [leadId: string]
  fila: []
}>()

const LIMITE = 5
const abertos = ref<Set<CrmGrupoHojeId>>(new Set())
const visiveis = computed(() => props.grupos.filter(g => g.itens.length))
const total = computed(() => visiveis.value.reduce((soma, g) => soma + g.itens.length, 0))
const paraEnviar = computed(() => filaDeEnvio(props.grupos.find(g => g.id === 'enviar')?.itens ?? [], props.leads, props.envios).length)

const ordenados = (grupo: CrmGrupoHoje) => (grupo.id === 'enviar' ? ordenarComEnvios(grupo.itens, props.envios) : grupo.itens)
const itens = (grupo: CrmGrupoHoje) => abertos.value.has(grupo.id) ? ordenados(grupo) : ordenados(grupo).slice(0, LIMITE)
const alternar = (id: CrmGrupoHojeId) => {
  const proximo = new Set(abertos.value)
  if (proximo.has(id)) proximo.delete(id)
  else proximo.add(id)
  abertos.value = proximo
}

const abertoEm = (item: CrmItemHoje): number | undefined => props.envios[item.leadId]
const estado = (item: CrmItemHoje) => {
  const t = abertoEm(item)
  return t === undefined ? null : estadoDoEnvio(t, props.agora)
}
const horaDoToque = (item: CrmItemHoje) => {
  const t = abertoEm(item)
  return t === undefined ? '' : hora(new Date(t).toISOString())
}
const ehEnvio = (item: CrmItemHoje, url: string) => url === props.leads.get(item.leadId)?.links.enviar
// Já aberto: o link de envio some (o toque já marcou na planilha) e fica o resto.
const links = (grupo: CrmGrupoHoje, item: CrmItemHoje) =>
  grupo.id === 'enviar' && abertoEm(item) !== undefined ? item.links.filter(l => !ehEnvio(item, l.url)) : item.links
function aoTocar(item: CrmItemHoje, url: string) {
  if (ehEnvio(item, url)) emit('enviado', item.leadId)
}
</script>

<template>
  <div class="crm-hoje">
    <p v-if="!total" class="crm-vazio"><strong>Nada esperando você hoje.</strong> Nenhum follow-up, resposta, prospect, proposta ou site pronto neste filtro.</p>
    <section v-for="grupo in visiveis" :key="grupo.id" class="crm-grupo" :class="`is-${grupo.id}`" :aria-labelledby="`crm-grupo-${grupo.id}`">
      <header class="crm-grupo__cabeca">
        <h2 :id="`crm-grupo-${grupo.id}`">{{ grupo.titulo }}</h2>
        <strong :aria-label="`${grupo.itens.length} ${grupo.itens.length === 1 ? 'item' : 'itens'}`">{{ grupo.itens.length }}</strong>
      </header>
      <p class="crm-grupo__explicacao">{{ grupo.explicacao }}</p>
      <button v-if="grupo.id === 'enviar' && paraEnviar > 1" type="button" class="botao botao--primario crm-grupo__fila" @click="emit('fila')">
        Enviar um por um <span>({{ paraEnviar }})</span>
      </button>
      <ul class="crm-lista">
        <li v-for="item in itens(grupo)" :key="`${grupo.id}-${item.leadId}`" class="crm-item" :class="{ 'is-aberto': grupo.id === 'enviar' && abertoEm(item) !== undefined }">
          <div class="crm-item__quem">
            <button type="button" class="crm-item__empresa" :data-lead="item.leadId" @click="emit('abrir', item.leadId, $event.currentTarget as HTMLElement)">
              {{ leads.get(item.leadId)?.empresa ?? item.leadId }}
              <span class="so-leitor">: abrir a ficha</span>
            </button>
            <span class="crm-tag" :class="`is-${leads.get(item.leadId)?.produto}`">{{ SIGLA_DO_PRODUTO[leads.get(item.leadId)?.produto ?? 'site'] }}</span>
          </div>
          <p class="crm-item__acao"><strong>{{ item.acao }}</strong> <span>{{ item.detalhe }}</span></p>
          <p v-if="grupo.id === 'enviar' && estado(item)" class="crm-item__aberto" :class="`is-${estado(item)}`">
            <template v-if="estado(item) === 'aguardando'">Aberto no WhatsApp às {{ horaDoToque(item) }} nesta tela. A planilha confirma no próximo retrato.</template>
            <template v-else>Aberto às {{ horaDoToque(item) }} e a planilha ainda não confirmou: veja na conversa se a mensagem saiu.</template>
          </p>
          <div v-if="links(grupo, item).length" class="crm-item__links">
            <a v-for="link in links(grupo, item)" :key="link.url" :href="link.url" target="_blank" rel="noopener" @click="aoTocar(item, link.url)">{{ link.rotulo }} <span aria-hidden="true">↗</span></a>
          </div>
        </li>
      </ul>
      <button v-if="grupo.itens.length > LIMITE" type="button" class="crm-mais" :aria-expanded="abertos.has(grupo.id)" @click="alternar(grupo.id)">
        {{ abertos.has(grupo.id) ? 'Mostrar menos' : `Ver todos os ${grupo.itens.length}` }}
      </button>
    </section>
  </div>
</template>
