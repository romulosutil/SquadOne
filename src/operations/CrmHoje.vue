<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SIGLA_DO_PRODUTO, hora } from './crm-formato'
import { ROTULO_DE_LIBERAR, envioTravado, type EnviosLiberados } from './trava-de-horario'
import { textoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'
import {
  DESFAZER_MS, corpoDoRegistro, decidir, detalheSemPrioridade, esquecerDecisao, gravarDecisoes, lerDecisoes, loteDaTriagem, mesmoLote,
  motivoDoConviteTravado, podarDecisoes, prioridadesDiferem, textoDaPrioridade, type DecisoesDaTriagem, type RegistroDaTriagem,
} from './triagem'
import type { CrmGrupoHoje, CrmItemHoje, CrmLead } from './types'

// Triagem (/crm?ver=triagem, AC-10 de 17/10/2026): os prospects na Etapa Revisar em lotes de 10 de
// verdade (triagem.ts), cada um com duas decisões, Convidar e Dispensar. Era a lista genérica da
// antiga Hoje com todos os grupos; desde OT-01 só a Triagem a usava, e só com o grupo "revisar".
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente o Convidar fica desligado, com o
// motivo, e o "Liberar" daquele lead ao lado. `ritmo` (trava-de-ritmo.ts): com o intervalo, a hora
// ou o dia cheios, o Convidar fica desligado sem "Liberar". Dispensar nunca trava: não manda nada a ninguém.
const props = defineProps<{
  grupo: CrmGrupoHoje; leads: Map<string, CrmLead>; aviso?: string | null; liberados: EnviosLiberados; ritmo: EstadoDoRitmo
  /** Se a aba CRM aceita registro agora (CrmVisao.registro): sem ele, Dispensar não teria onde gravar. */
  registro: { disponivel: boolean; motivo?: string }
  /** Retrato legível: só ele diz quem saiu da Revisar, então só com ele as marcas locais são podadas. */
  confirmavel: boolean
}>()
const emit = defineEmits<{
  abrir: [leadId: string, origem: HTMLElement | null]
  liberar: [leadId: string]
  primeiro: [leadId: string]
  registrado: []
  restantes: [quantos: number]
}>()

// ------------------------------------------------------------------ decisões locais (triagem.ts)

function armazenamento(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// Lidas já na montagem, antes do primeiro lote: senão ele nasceria com os já decididos dentro.
const decisoes = ref<DecisoesDaTriagem>(lerDecisoes(armazenamento(), Date.now()))
function guardar(novas: DecisoesDaTriagem) {
  decisoes.value = novas
  gravarDecisoes(armazenamento(), novas)
}

// O retrato novo chega como um Map novo (CrmPanel refaz `porId` a cada leitura).
watch(() => [props.leads, props.confirmavel] as const, ([leads, ok]) => {
  if (ok) guardar(podarDecisoes(decisoes.value, leads, Date.now()))
})

// ------------------------------------------------------------------ o lote

const idsDoLote = ref<string[]>([])
const lote = computed(() => loteDaTriagem(props.grupo.itens, props.leads, decisoes.value, idsDoLote.value))
// O lote nasce na conta pura; aqui só se guarda, para o próximo cálculo saber qual era.
watch(() => lote.value.ids, (ids) => { if (!mesmoLote(ids, idsDoLote.value)) idsDoLote.value = ids }, { immediate: true })
watch(() => lote.value.restantes, (n) => emit('restantes', n), { immediate: true })
// Quem do lote já não espera decisão: convidado, dispensado, ou já fora da Revisar pelo retrato.
const decididosNoLote = computed(() => lote.value.ids.length - lote.value.pendentes.length)
const numero = (n: number) => n.toLocaleString('pt-BR')

const comPontuacao = computed(() => prioridadesDiferem(props.grupo.itens, props.leads))
const pontuacao = (item: CrmItemHoje) => props.leads.get(item.leadId)?.triagem?.prioridade

const convidadoEm = (item: CrmItemHoje) => {
  const d = decisoes.value[item.leadId]
  return d?.tipo === 'convidado' ? hora(new Date(d.em).toISOString()) : ''
}

// ------------------------------------------------------------------ convidar

const segurado = computed(() => props.ritmo.motivo !== null)
const conviteDe = (item: CrmItemHoje) => props.leads.get(item.leadId)?.links.convite ?? ''
const travadoPeloHorario = (item: CrmItemHoje) => envioTravado(props.aviso, props.liberados, item.leadId)
const motivo = (item: CrmItemHoje) =>
  motivoDoConviteTravado({ temConvite: Boolean(conviteDe(item)), ritmo: props.ritmo, travadoPeloHorario: travadoPeloHorario(item) })
// O "Liberar" só quando é o horário que segura: com o ritmo cheio, liberar não destravaria nada.
const mostraLiberar = (item: CrmItemHoje) => Boolean(conviteDe(item)) && !segurado.value && travadoPeloHorario(item)
const haTravados = computed(() => lote.value.pendentes.some(mostraLiberar))

// O link abre o WhatsApp sozinho (target=_blank) e o clique no link rastreado já marca o envio na
// planilha (RULES 17); aqui só a marca local e o toque de primeiro contato, para o ritmo andar na hora.
function convidar(item: CrmItemHoje) {
  emit('primeiro', item.leadId)
  guardar(decidir(decisoes.value, item.leadId, 'convidado', Date.now()))
}

// ------------------------------------------------------------------ dispensar e desfazer

const falha = ref('')
const titulo = ref<HTMLElement | null>(null)

async function registrar(lead: CrmLead, tipo: RegistroDaTriagem): Promise<string | null> {
  try {
    const resposta = await fetch('/api/operations/crm/registro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoDoRegistro(lead, tipo)),
    })
    const corpo = await resposta.json().catch(() => ({})) as { error?: string }
    if (!resposta.ok) return corpo.error ?? `HTTP ${resposta.status}`
    return null
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

// Cada Dispensar deixa, no lugar do item, uma linha "dispensado · Desfazer" por alguns segundos.
// `pedido` é o POST do dispensado: o Desfazer espera por ele antes de mandar o desfeito.
interface Desfazivel { empresa: string; pedido: Promise<string | null>; temporizador: number }
const desfazeis = ref<Map<string, Desfazivel>>(new Map())
const botoesDeDesfazer = new Map<string, HTMLButtonElement>()

function tirarDesfazivel(id: string) {
  const d = desfazeis.value.get(id)
  if (!d) return
  window.clearTimeout(d.temporizador)
  const proximo = new Map(desfazeis.value)
  proximo.delete(id)
  desfazeis.value = proximo
  // O foco estava no Desfazer que some: vai para o título, não para o fim da página.
  if (document.activeElement === botoesDeDesfazer.get(id)) titulo.value?.focus()
  botoesDeDesfazer.delete(id)
}

/** O POST de um dispensado, com a marca otimista antes e devolvida se ele falhar. Devolve o erro ou null. */
async function dispensarUm(lead: CrmLead): Promise<string | null> {
  guardar(decidir(decisoes.value, lead.id, 'dispensado', Date.now()))
  const erro = await registrar(lead, 'dispensado')
  if (erro) guardar(esquecerDecisao(decisoes.value, lead.id))
  return erro
}

async function dispensar(item: CrmItemHoje) {
  const lead = props.leads.get(item.leadId)
  if (!lead) return
  falha.value = ''
  const pedido = dispensarUm(lead)
  const temporizador = window.setTimeout(() => tirarDesfazivel(lead.id), DESFAZER_MS)
  desfazeis.value = new Map(desfazeis.value).set(lead.id, { empresa: lead.empresa, pedido, temporizador })
  await nextTick()
  botoesDeDesfazer.get(lead.id)?.focus()
  const erro = await pedido
  if (erro) {
    tirarDesfazivel(lead.id)
    falha.value = `Não consegui dispensar ${lead.empresa}: ${erro}. Ele voltou para a lista.`
  } else {
    emit('registrado')
  }
}

async function desfazer(id: string) {
  const d = desfazeis.value.get(id)
  const lead = props.leads.get(id)
  if (!d || !lead) return
  tirarDesfazivel(id)
  // O dispensado falhou: o item já voltou e não há o que desfazer na planilha.
  if (await d.pedido) return
  guardar(esquecerDecisao(decisoes.value, id))
  const erro = await registrar(lead, 'dispensado_desfeito')
  if (erro) {
    guardar(decidir(decisoes.value, id, 'dispensado', Date.now()))
    falha.value = `Não consegui desfazer: ${erro}. ${lead.empresa} continua dispensado.`
  } else {
    emit('registrado')
  }
}

// Linhas da lista: os itens do lote na ordem dele, com a linha do Desfazer no lugar de quem acabou
// de sair. O Desfazer de quem era do lote anterior (o último dispensado fecha o lote) vem no topo.
type Linha = { tipo: 'item'; item: CrmItemHoje } | { tipo: 'desfazer'; id: string; empresa: string }
const linhas = computed<Linha[]>(() => {
  const itens = new Map(lote.value.itens.map((i) => [i.leadId, i] as [string, CrmItemHoje]))
  const noLote = new Set(lote.value.ids)
  const desfazer = (id: string): Linha => ({ tipo: 'desfazer', id, empresa: desfazeis.value.get(id)!.empresa })
  const doAnterior = [...desfazeis.value.keys()].filter((id) => !noLote.has(id)).map(desfazer)
  const doLote = lote.value.ids.flatMap((id): Linha[] => {
    const item = itens.get(id)
    if (item) return [{ tipo: 'item', item }]
    return desfazeis.value.has(id) ? [desfazer(id)] : []
  })
  return [...doAnterior, ...doLote]
})

// ------------------------------------------------------------------ dispensar os que sobraram

// Confirmação no próprio botão (segundo toque), sem confirm(): o primeiro toque só arma, e desarma
// sozinho se o segundo não vier.
const confirmando = ref(false)
let desarmar = 0
const emSerie = ref<{ feitos: number; total: number } | null>(null)
const resultadoDaSerie = ref('')

function armarOuDispensar() {
  if (!confirmando.value) {
    confirmando.value = true
    window.clearTimeout(desarmar)
    desarmar = window.setTimeout(() => { confirmando.value = false }, DESFAZER_MS)
    return
  }
  window.clearTimeout(desarmar)
  confirmando.value = false
  void dispensarSobras()
}

/** Em série, para não empilhar POSTs no n8n; a falha de um não para os outros e fica listada. */
async function dispensarSobras() {
  const alvo = lote.value.pendentes.map((i) => props.leads.get(i.leadId)).filter((l): l is CrmLead => l !== undefined)
  if (!alvo.length) return
  falha.value = ''
  resultadoDaSerie.value = ''
  // Todos saem da tela de uma vez (otimista); só os que falharem voltam.
  let marcadas = decisoes.value
  for (const l of alvo) marcadas = decidir(marcadas, l.id, 'dispensado', Date.now())
  guardar(marcadas)
  emSerie.value = { feitos: 0, total: alvo.length }
  const falhas: string[] = []
  for (const l of alvo) {
    const erro = await registrar(l, 'dispensado')
    if (erro) {
      guardar(esquecerDecisao(decisoes.value, l.id))
      falhas.push(`${l.empresa} (${erro})`)
    }
    emSerie.value = { feitos: emSerie.value.feitos + 1, total: alvo.length }
  }
  emSerie.value = null
  const certos = alvo.length - falhas.length
  resultadoDaSerie.value = `${certos} de ${alvo.length} dispensado${alvo.length === 1 ? '' : 's'}.`
  if (falhas.length) falha.value = `Não consegui dispensar: ${falhas.join(', ')}. Voltaram para a lista.`
  if (certos) emit('registrado')
}

watch(() => lote.value.ids, () => { confirmando.value = false })

// ------------------------------------------------------------------ links secundários

// Consulta antes de decidir, não decisão: links de texto pequenos, depois dos dois botões.
const rotuloSecundario = (lead: CrmLead | undefined, url: string) =>
  url === lead?.links.site ? 'Site da empresa' : url === lead?.links.maps ? 'Google Maps' : ''
const secundarios = (item: CrmItemHoje) => {
  const lead = props.leads.get(item.leadId)
  return item.links.map((l) => ({ url: l.url, rotulo: rotuloSecundario(lead, l.url) })).filter((l) => l.rotulo)
}

onMounted(() => {
  if (props.confirmavel) guardar(podarDecisoes(decisoes.value, props.leads, Date.now()))
})
onBeforeUnmount(() => {
  window.clearTimeout(desarmar)
  desfazeis.value.forEach((d) => window.clearTimeout(d.temporizador))
})
</script>

<template>
  <div class="crm-hoje crm-triagem">
    <p v-if="aviso && haTravados" class="crm-aviso" role="note"><strong>Melhor deixar para o expediente.</strong> {{ aviso }} O convite fica desligado até você liberar aquele prospect.</p>
    <p v-if="segurado && lote.pendentes.length" class="crm-aviso" role="status"><strong>Devagar com os primeiros contatos.</strong> {{ textoDoRitmo(ritmo) }} Dispensar continua livre.</p>
    <p v-if="falha" class="crm-aviso is-forte crm-triagem__falha" role="alert">
      {{ falha }} <button type="button" class="crm-mais" @click="falha = ''">Entendi</button>
    </p>
    <p v-if="!linhas.length" class="crm-vazio"><strong>Nada para triar.</strong> Tudo o que os caçadores acharam já foi decidido; o que chegar de novo aparece aqui.</p>

    <section v-else class="crm-grupo is-revisar" aria-labelledby="crm-triagem-titulo">
      <header class="crm-grupo__cabeca">
        <h2 id="crm-triagem-titulo" ref="titulo" tabindex="-1">{{ grupo.titulo }}</h2>
        <strong :aria-label="`${numero(lote.restantes)} esperando decisão`">{{ numero(lote.restantes) }}</strong>
      </header>
      <p class="crm-triagem__conta">
        {{ numero(lote.restantes) }} no total · lote de {{ lote.ids.length }}<template v-if="decididosNoLote"> · {{ decididosNoLote }} decidido{{ decididosNoLote === 1 ? '' : 's' }}</template>
      </p>
      <p class="crm-grupo__explicacao">
        Convidar abre o WhatsApp com o convite e já marca o envio; Dispensar tira o prospect da lista. Decididos todos deste lote, aparece o próximo.
        <template v-if="comPontuacao"> A pontuação, de 0 a 100, é a do caçador; a lista vem da maior para a menor.</template>
      </p>
      <p v-if="!registro.disponivel" class="crm-nota-pequena">Dispensar está desligado: nada grava na planilha agora<template v-if="registro.motivo"> ({{ registro.motivo }})</template>.</p>

      <ul class="crm-lista">
        <template v-for="linha in linhas" :key="linha.tipo === 'item' ? linha.item.leadId : `desfazer-${linha.id}`">
          <li v-if="linha.tipo === 'desfazer'" class="crm-item crm-triagem__dispensado">
            <span><strong>{{ linha.empresa }}</strong> dispensado.</span>
            <button :ref="(el) => { if (el) botoesDeDesfazer.set(linha.id, el as HTMLButtonElement) }" type="button" class="botao botao--leve" @click="desfazer(linha.id)">
              Desfazer<span class="so-leitor"> o dispensar de {{ linha.empresa }}</span>
            </button>
          </li>
          <li v-else class="crm-item" :class="{ 'is-aberto': convidadoEm(linha.item) }">
            <div class="crm-item__quem">
              <button type="button" class="crm-item__empresa" :data-lead="linha.item.leadId" @click="emit('abrir', linha.item.leadId, $event.currentTarget as HTMLElement)">
                {{ leads.get(linha.item.leadId)?.empresa ?? linha.item.leadId }}
                <span class="so-leitor">: abrir a ficha</span>
              </button>
              <span class="crm-tag" :class="`is-${leads.get(linha.item.leadId)?.produto}`">{{ SIGLA_DO_PRODUTO[leads.get(linha.item.leadId)?.produto ?? 'site'] }}</span>
              <span v-if="comPontuacao && pontuacao(linha.item) !== undefined" class="crm-sinal">{{ textoDaPrioridade(pontuacao(linha.item)!) }}</span>
            </div>
            <p class="crm-item__acao"><strong>{{ linha.item.acao }}</strong> <span>{{ detalheSemPrioridade(linha.item.detalhe) }}</span></p>
            <p v-if="convidadoEm(linha.item)" class="crm-item__aberto">Convite aberto às {{ convidadoEm(linha.item) }} nesta tela. A planilha confirma em alguns minutos.</p>
            <div v-else class="crm-triagem__decisoes">
              <a v-if="!motivo(linha.item)" class="botao" :href="conviteDe(linha.item)" target="_blank" rel="noopener" @click="convidar(linha.item)">Convidar <span aria-hidden="true">↗</span></a>
              <template v-else>
                <button type="button" class="botao" disabled :aria-describedby="`crm-triagem-motivo-${linha.item.leadId}`">Convidar</button>
                <span :id="`crm-triagem-motivo-${linha.item.leadId}`" class="crm-triagem__motivo">{{ motivo(linha.item) }}</span>
              </template>
              <button v-if="mostraLiberar(linha.item)" type="button" class="botao botao--leve" @click="emit('liberar', linha.item.leadId)">{{ ROTULO_DE_LIBERAR }}</button>
              <button type="button" class="botao botao--leve" :disabled="!registro.disponivel || emSerie !== null" @click="dispensar(linha.item)">
                Dispensar<span class="so-leitor"> {{ leads.get(linha.item.leadId)?.empresa }}</span>
              </button>
            </div>
            <p v-if="secundarios(linha.item).length" class="crm-triagem__links">
              <a v-for="link in secundarios(linha.item)" :key="link.url" :href="link.url" target="_blank" rel="noopener">{{ link.rotulo }} <span aria-hidden="true">↗</span></a>
            </p>
          </li>
        </template>
      </ul>

      <div v-if="lote.pendentes.length || emSerie || resultadoDaSerie" class="crm-triagem__fim">
        <button
          v-if="lote.pendentes.length && !emSerie" type="button" class="botao" :class="{ 'is-armado': confirmando }"
          :disabled="!registro.disponivel" @click="armarOuDispensar"
        >
          {{ confirmando ? `Toque de novo para dispensar ${lote.pendentes.length}` : `Dispensar os que sobraram (${lote.pendentes.length})` }}
        </button>
        <button v-if="confirmando" type="button" class="botao botao--leve" @click="confirmando = false">Cancelar</button>
        <p v-if="emSerie" class="crm-nota-pequena" role="status">Dispensando… {{ emSerie.feitos }} de {{ emSerie.total }}</p>
        <p v-else-if="resultadoDaSerie" class="crm-nota-pequena" role="status">{{ resultadoDaSerie }}</p>
      </div>
    </section>
  </div>
</template>
