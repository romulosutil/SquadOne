<script setup lang="ts">
import { computed, ref } from 'vue'
import { anotadoEm, ordenarComAnotados, textoDaAnotacao, tipoDoGrupo, tipoDoLink, type EnviosAnotados, type TipoDeEnvioAnotado } from './anotacao-de-envio'
import { SIGLA_DO_PRODUTO, hora } from './crm-formato'
import { estadoDoEnvio, filaDeEnvio, ordenarComEnvios, type EnviosAbertos } from './fila-de-envio'
import { ROTULO_DE_LIBERAR, ehPrimeiroContato, envioTravado, type EnviosLiberados } from './trava-de-horario'
import { textoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'
import type { CrmGrupoHoje, CrmGrupoHojeId, CrmItemHoje, CrmLead } from './types'

// "Hoje": só o que depende do Rômulo, na ordem do servidor (server/crm.ts,
// montarHoje). Cada linha é uma ação e o link que a resolve.
// Em "Primeiro contato para enviar", o que esta tela já abriu no WhatsApp vai para o
// fim com a hora do toque até a planilha confirmar (fila-de-envio.ts).
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente os links que ENVIAM a primeira
// mensagem (envio do Site, convite do PRUMO, reenvio do só-robô) saem da linha e dão lugar a um "Liberar".
// `anotados` (anotacao-de-envio.ts): o toque em "Mandar o link"/"Mandar o follow-up" anota o envio;
// até o retrato confirmar, a linha diz a hora e vai para o fim do grupo.
// `ritmo` (trava-de-ritmo.ts, 15/10/2026): com o intervalo, a hora ou o dia cheios, os mesmos links
// de primeiro contato somem de todas as linhas, sem "Liberar"; o aviso no topo diz até quando.
const props = defineProps<{
  grupos: CrmGrupoHoje[]; leads: Map<string, CrmLead>; envios: EnviosAbertos; agora: number; aviso?: string | null; liberados: EnviosLiberados
  anotados: EnviosAnotados; ritmo: EstadoDoRitmo
  /** Quantas linhas por grupo antes do "ver todos" (a Triagem usa lotes de 10, OT-05). */
  limite?: number
}>()
const emit = defineEmits<{
  abrir: [leadId: string, origem: HTMLElement | null]
  enviado: [leadId: string]
  liberar: [leadId: string]
  anotar: [leadId: string, tipo: TipoDeEnvioAnotado]
  primeiro: [leadId: string]
  fila: []
}>()

const LIMITE_PADRAO = 5
const LIMITE = computed(() => props.limite ?? LIMITE_PADRAO)
const abertos = ref<Set<CrmGrupoHojeId>>(new Set())
const visiveis = computed(() => props.grupos.filter(g => g.itens.length))
const total = computed(() => visiveis.value.reduce((soma, g) => soma + g.itens.length, 0))
const paraEnviar = computed(() => filaDeEnvio(props.grupos.find(g => g.id === 'enviar')?.itens ?? [], props.leads, props.envios).length)

const ordenados = (grupo: CrmGrupoHoje) => (grupo.id === 'enviar' ? ordenarComEnvios(grupo.itens, props.envios)
  : ordenarComAnotados(grupo.itens, grupo.id, props.anotados))
/** "2ª mensagem anotada às 14:02", só enquanto o retrato não confirma. */
const anotacao = (grupo: CrmGrupoHoje, item: CrmItemHoje) => {
  const tipo = tipoDoGrupo(grupo.id)
  const t = tipo ? anotadoEm(props.anotados, item.leadId, tipo) : undefined
  return tipo && t !== undefined ? textoDaAnotacao(tipo, hora(new Date(t).toISOString())) : ''
}
const itens = (grupo: CrmGrupoHoje) => abertos.value.has(grupo.id) ? ordenados(grupo) : ordenados(grupo).slice(0, LIMITE.value)
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
// Envio do Site, convite do PRUMO e o reenvio do só-robô (trava-de-horario.ts, linksDePrimeiroContato).
const primeiroContato = (item: CrmItemHoje, url: string) => ehPrimeiroContato(props.leads.get(item.leadId), url)
const temPrimeiroContato = (item: CrmItemHoje) => item.links.some(l => primeiroContato(item, l.url))
const segurado = computed(() => props.ritmo.motivo !== null)
// Com o ritmo segurando, o "Liberar" do horário não destravaria nada: sai também.
const travado = (item: CrmItemHoje) =>
  !segurado.value && envioTravado(props.aviso, props.liberados, item.leadId) && temPrimeiroContato(item)
const haTravados = computed(() => props.grupos.some(g => g.itens.some(travado)))
const haSegurados = computed(() => segurado.value && props.grupos.some(g => g.itens.some(temPrimeiroContato)))
// Já aberto: o link de envio some (o toque já marcou na planilha) e fica o resto.
// Travado ou segurado: o link de primeiro contato some, o resto (demo, conversa) segue à mão.
// A ordem (16/10/2026): a ação que manda texto pronto primeiro, porque é o que resolve a linha (no
// Revisar ela vinha por último, depois de "Ver o site" e do Maps). Com ela na linha, a conversa sem
// texto sai: eram dois botões para o mesmo WhatsApp ("Pedir o responsável" e "Abrir conversa"), e a
// conversa continua na Ficha, em "Abrir em outro lugar".
const daAcao = (item: CrmItemHoje, url: string) => {
  const l = props.leads.get(item.leadId)?.links
  return Boolean(l) && [l!.enviar, l!.convite, l!.segunda, l!.followup, l!.gerarDemo].includes(url)
}
const links = (grupo: CrmGrupoHoje, item: CrmItemHoje) => {
  const sem = grupo.id === 'enviar' && abertoEm(item) !== undefined ? item.links.filter(l => !ehEnvio(item, l.url)) : item.links
  const livres = travado(item) || segurado.value ? sem.filter(l => !primeiroContato(item, l.url)) : sem
  const acao = livres.filter(l => daAcao(item, l.url))
  const conversa = props.leads.get(item.leadId)?.links.whatsapp
  const resto = livres.filter(l => !daAcao(item, l.url) && !(acao.length && l.url === conversa))
  return [...acao, ...resto]
}
// Com contorno, a que resolve a linha; sem nenhuma (o "Próximo passo" só tem a conversa), a primeira.
const ehAcaoDaLinha = (item: CrmItemHoje, lista: CrmItemHoje['links'], i: number) =>
  daAcao(item, lista[i].url) || (i === 0 && !lista.some(l => daAcao(item, l.url)))
// "(marca como enviado)" sai do rótulo: o grupo já diz uma vez que o toque anota o envio.
const rotulo = (texto: string) => texto.replace(/\s*\(marca como enviado\)/, '')
const anotaNoToque = (grupo: CrmGrupoHoje) => grupo.itens.some(i => i.links.some(l => /marca como enviado/.test(l.rotulo)))
function aoTocar(item: CrmItemHoje, url: string) {
  if (ehEnvio(item, url)) emit('enviado', item.leadId)
  if (primeiroContato(item, url)) emit('primeiro', item.leadId)
  // O link abre o WhatsApp sozinho (target=_blank); a anotação vai em paralelo, sem segurar nada.
  const tipo = tipoDoLink(props.leads.get(item.leadId), url)
  if (tipo) emit('anotar', item.leadId, tipo)
}
</script>

<template>
  <div class="crm-hoje">
    <p v-if="aviso && haTravados" class="crm-aviso" role="note"><strong>Melhor deixar para o expediente.</strong> {{ aviso }} Os envios de primeiro contato ficam travados até você liberar.</p>
    <p v-if="haSegurados" class="crm-aviso" role="status"><strong>Devagar com os primeiros contatos.</strong> {{ textoDoRitmo(ritmo) }}</p>
    <p v-if="!total" class="crm-vazio"><strong>Nada esperando você hoje.</strong> Nenhum follow-up, resposta, prospect, proposta ou site pronto neste filtro.</p>
    <section v-for="grupo in visiveis" :key="grupo.id" class="crm-grupo" :class="`is-${grupo.id}`" :aria-labelledby="`crm-grupo-${grupo.id}`">
      <header class="crm-grupo__cabeca">
        <h2 :id="`crm-grupo-${grupo.id}`">{{ grupo.titulo }}</h2>
        <strong :aria-label="`${grupo.itens.length} ${grupo.itens.length === 1 ? 'item' : 'itens'}`">{{ grupo.itens.length }}</strong>
      </header>
      <p class="crm-grupo__explicacao">{{ grupo.explicacao }}<template v-if="anotaNoToque(grupo) && !/marca o envio/.test(grupo.explicacao)"> Tocar em Enviar já marca o envio.</template></p>
      <button v-if="grupo.id === 'enviar' && paraEnviar > 1" type="button" class="botao botao--primario crm-grupo__fila" @click="emit('fila')">
        Enviar um por um <span>({{ paraEnviar }})</span>
      </button>
      <ul class="crm-lista">
        <li v-for="item in itens(grupo)" :key="`${grupo.id}-${item.leadId}`" class="crm-item" :class="{ 'is-aberto': (grupo.id === 'enviar' && abertoEm(item) !== undefined) || anotacao(grupo, item), 'is-urgente': item.urgente && !anotacao(grupo, item) }">
          <div class="crm-item__quem">
            <button type="button" class="crm-item__empresa" :data-lead="item.leadId" @click="emit('abrir', item.leadId, $event.currentTarget as HTMLElement)">
              {{ leads.get(item.leadId)?.empresa ?? item.leadId }}
              <span class="so-leitor">: abrir a ficha</span>
            </button>
            <span class="crm-tag" :class="`is-${leads.get(item.leadId)?.produto}`">{{ SIGLA_DO_PRODUTO[leads.get(item.leadId)?.produto ?? 'site'] }}</span>
          </div>
          <p class="crm-item__acao"><strong>{{ item.acao }}</strong> <span>{{ item.detalhe }}</span></p>
          <p v-if="anotacao(grupo, item)" class="crm-item__aberto is-aguardando">{{ anotacao(grupo, item) }} nesta tela. A planilha confirma em alguns minutos.</p>
          <p v-if="grupo.id === 'enviar' && estado(item)" class="crm-item__aberto" :class="`is-${estado(item)}`">
            <template v-if="estado(item) === 'aguardando'">Aberto no WhatsApp às {{ horaDoToque(item) }} nesta tela. A planilha confirma em alguns minutos.</template>
            <template v-else>Aberto às {{ horaDoToque(item) }} e a planilha ainda não confirmou: veja na conversa se a mensagem saiu.</template>
          </p>
          <div v-if="links(grupo, item).length || travado(item)" class="crm-item__links">
            <button v-if="travado(item)" type="button" class="botao botao--leve" @click="emit('liberar', item.leadId)">{{ ROTULO_DE_LIBERAR }}</button>
            <a v-for="(link, i) in links(grupo, item)" :key="link.url" :class="{ 'is-acao': ehAcaoDaLinha(item, links(grupo, item), i) }" :href="link.url" target="_blank" rel="noopener" @click="aoTocar(item, link.url)">{{ rotulo(link.rotulo) }} <span aria-hidden="true">↗</span></a>
          </div>
        </li>
      </ul>
      <button v-if="grupo.itens.length > LIMITE" type="button" class="crm-mais" :aria-expanded="abertos.has(grupo.id)" @click="alternar(grupo.id)">
        {{ abertos.has(grupo.id) ? 'Mostrar menos' : `Ver todos os ${grupo.itens.length}` }}
      </button>
    </section>
  </div>
</template>
