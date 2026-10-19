<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { aplicarCohort, gravarCohort, lerCohort, motivosDoLead, semCriterios, type Cohort } from './cohort'
import CrmCohort from './CrmCohort.vue'
import CrmConfirmarConvite from './CrmConfirmarConvite.vue'
import { SIGLA_DO_PRODUTO, hora } from './crm-formato'
import { alvosDoLote, corpoDaLeitura, desfechoDaResposta, lerEmSerie, textoDoAndamento, textoDoResumo, type Andamento } from './leitura-de-sinais'
import { recadoDasTravas, rotuloDoLiberar } from './recado-de-travas'
import RecadoDeTravas from './RecadoDeTravas.vue'
import { envioTravado, type EnviosLiberados } from './trava-de-horario'
import type { EstadoDoRitmo } from './trava-de-ritmo'
import {
  DESFAZER_MS, corpoDoRegistro, decidir, detalheSemPrioridade, dispensado, esquecerDecisao, gravarDecisoes, lerDecisoes, loteDaTriagem, mesmoLote,
  motivoDoConviteTravado, podarDecisoes, prioridadesDiferem, textoDaPrioridade, type DecisoesDaTriagem, type RegistroDaTriagem,
} from './triagem'
import type { CrmGrupoHoje, CrmItemHoje, CrmLead } from './types'

// Triagem (/crm?ver=triagem, AC-10 de 17/10/2026): os prospects na Etapa Revisar em lotes de 10 de
// verdade (triagem.ts), cada um com duas decisões, Convidar e Dispensar. Era a lista genérica da
// antiga Hoje com todos os grupos; desde OT-01 só a Triagem a usava, e só com o grupo "revisar".
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente o Convidar fica desligado, com o
// motivo, e o "Liberar" daquele lead ao lado. `ritmo` (trava-de-ritmo.ts): com o intervalo, a hora
// ou o dia cheios, o Convidar fica desligado sem "Liberar". Dispensar nunca trava: não manda nada a ninguém.
// 17/10/2026 (hierarquia de Vendas): dois avisos no topo, dez linhas com três botões cada (Convidar
// desabilitado, "Liberar o envio fora do expediente" e Dispensar) e um parágrafo de explicação. Agora
// a aba abre num botão só, "Triar (N)"; dentro, cada linha tem Convidar (o primário só na primeira que
// espera, BP-R2) e Dispensar; as travas são um recado só (recado-de-travas.ts) com o quando, e o
// "Liberar" é um link nele, uma vez para o lote (o mesmo "Liberar" do dia, lead a lead, liberados.ts).
const props = defineProps<{
  grupo: CrmGrupoHoje; leads: Map<string, CrmLead>; aviso?: string | null; liberados: EnviosLiberados; ritmo: EstadoDoRitmo
  /** O relógio da tela (CrmPanel), para o recado dizer quando volta. */
  agora?: number
  /** Se a aba CRM aceita registro agora (CrmVisao.registro): sem ele, Dispensar não teria onde gravar. */
  registro: { disponivel: boolean; motivo?: string }
  /** Retrato legível: só ele diz quem saiu da Revisar, então só com ele as marcas locais são podadas. */
  confirmavel: boolean
}>()
const emit = defineEmits<{
  abrir: [leadId: string, origem: HTMLElement | null]
  /** O "Liberar" do recado: os do lote que só o horário segura, de uma vez. */
  liberarLote: [leadIds: string[]]
  primeiro: [leadId: string]
  registrado: []
  restantes: [quantos: number]
  /** Terminou (ou parou) uma leitura de sinais que guardou algo no servidor: a visão precisa ser relida. */
  sinaisLidos: []
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

// ------------------------------------------------------------------ filtro por motivo (cohort.ts)

// O cohort só escolhe QUAIS prospects entram nos lotes de 10. Quem convida e quem dispensa segue
// sendo a pessoa, com as mesmas travas: nada abaixo mexe em Convidar, Dispensar ou Desfazer.
const cohort = ref<Cohort>(lerCohort(armazenamento()))
const cohortAtivo = computed(() => !semCriterios(cohort.value))
const naoDecidido = (id: string) => !decisoes.value[id] || decisoes.value[id].tipo === 'adiado'
const verAdiadas = ref(false)
const adiadas = computed(() => props.grupo.itens.filter(i => decisoes.value[i.leadId]?.tipo === 'adiado' && props.leads.get(i.leadId)?.sinal === 'revisar'))
async function adiar(item: CrmItemHoje) { guardar(decidir(decisoes.value, item.leadId, 'adiado', Date.now())); await nextTick(); titulo.value?.focus() }
async function adiarLote() {
  guardar(lote.value.pendentes.reduce((d, i) => decidir(d, i.leadId, 'adiado', Date.now()), decisoes.value))
  await nextTick(); titulo.value?.focus()
}
async function voltarATriagem(item: CrmItemHoje) { guardar(esquecerDecisao(decisoes.value, item.leadId)); await nextTick(); titulo.value?.focus() }
function trocarAdiadas() { verAdiadas.value = !verAdiadas.value; idsDoLote.value = [] }

// Os que ainda estão na Triagem (nem dispensados nesta tela nem no retrato), com o lead de cada um.
const leadsNaTriagem = computed(() => props.grupo.itens
  .filter((i) => !dispensado(decisoes.value, props.leads.get(i.leadId), i.leadId))
  .map((i) => props.leads.get(i.leadId))
  .filter((l): l is CrmLead => l !== undefined))
const aplicado = computed(() => aplicarCohort(leadsNaTriagem.value, cohort.value))
const idsQueBatem = computed(() => new Set(aplicado.value.batem.map((l) => l.id)))
// Sem filtro, o grupo do servidor inteiro, como sempre foi. Com filtro, só quem bate (sem leitura fica de fora).
const itensDaTriagem = computed(() => (cohortAtivo.value ? props.grupo.itens.filter((i) => idsQueBatem.value.has(i.leadId)) : props.grupo.itens))

// As contagens do painel valem para quem ainda espera decisão (convidado desta tela já foi decidido).
const aDecidir = computed(() => leadsNaTriagem.value.filter((l) => naoDecidido(l.id)))
const quantosDoCohort = computed(() => ({
  batem: aplicado.value.batem.filter((l) => naoDecidido(l.id)).length,
  semLeitura: aplicado.value.semLeitura.filter((l) => naoDecidido(l.id)).length,
  total: aDecidir.value.length,
}))
const motivosDe = (item: CrmItemHoje): string[] => {
  const lead = props.leads.get(item.leadId)
  return cohortAtivo.value && lead ? motivosDoLead(lead, cohort.value) : []
}

// ------------------------------------------------------------------ o lote

const idsDoLote = ref<string[]>([])
const lote = computed(() => loteDaTriagem(
  verAdiadas.value ? itensDaTriagem.value.filter(i => decisoes.value[i.leadId]?.tipo === 'adiado') : itensDaTriagem.value,
  props.leads, verAdiadas.value ? Object.fromEntries(Object.entries(decisoes.value).filter(([, d]) => d.tipo !== 'adiado')) : decisoes.value, idsDoLote.value))
// O lote nasce na conta pura; aqui só se guarda, para o próximo cálculo saber qual era.
watch(() => lote.value.ids, (ids) => { if (!mesmoLote(ids, idsDoLote.value)) idsDoLote.value = ids }, { immediate: true })
// O número da aba é o do grupo inteiro (os que esperam decisão), não o do filtro: o filtro é da tela.
const restantesDoGrupo = computed(() => props.grupo.itens.filter((i) => !dispensado(decisoes.value, props.leads.get(i.leadId), i.leadId) && naoDecidido(i.leadId)).length)
watch(restantesDoGrupo, (n) => emit('restantes', n), { immediate: true })

// Mudar o filtro refaz o lote do zero, só com quem bate: o lote em andamento não encolhe nem fica
// com gente que o filtro novo tirou.
function mudarCohort(novo: Cohort) {
  cohort.value = novo
  gravarCohort(armazenamento(), novo)
  idsDoLote.value = []
}
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

const conviteDe = (item: CrmItemHoje) => props.leads.get(item.leadId)?.links.convite ?? ''
const travadoPeloHorario = (item: CrmItemHoje) => envioTravado(props.aviso, props.liberados, item.leadId)
const motivo = (item: CrmItemHoje) =>
  motivoDoConviteTravado({ temConvite: Boolean(conviteDe(item)), ritmo: props.ritmo, travadoPeloHorario: travadoPeloHorario(item) })
// Os do lote que só o horário segura (com convite): o "Liberar" do recado é para eles, de uma vez.
const travadosPeloHorario = computed(() => lote.value.pendentes.filter((i) => Boolean(conviteDe(i)) && travadoPeloHorario(i)).map((i) => i.leadId))
const temConvites = computed(() => lote.value.pendentes.some((i) => Boolean(conviteDe(i))))
// Um recado só para as duas travas. `aviso` presente = fora do expediente (avisoDeHorario, com a taxa).
const recado = computed(() => recadoDasTravas({
  agora: props.agora ?? Date.now(), noExpediente: !props.aviso, ritmo: props.ritmo, contexto: 'triagem',
  liberado: travadosPeloHorario.value.length === 0, taxa: props.aviso,
}))
// A primeira linha que espera e pode convidar agora ganha o primário: um por tela (BP-R2), e é a próxima decisão.
const primeiroConvidavel = computed(() => lote.value.pendentes.find((i) => !motivo(i))?.leadId ?? null)

// "Triar (N)": a aba abre num botão só. Já dentro de um lote (alguma decisão tomada), entra direto.
const triando = ref(true)
watch(decididosNoLote, (n) => { if (n > 0) triando.value = true }, { immediate: true })


// Abrir o destino direto conta só como tentativa no ritmo. O envio exige confirmação explícita.
function convidar(item: CrmItemHoje) {
  emit('primeiro', item.leadId)
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

// ------------------------------------------------------------------ ler os sinais do lote (leitura-de-sinais.ts)

// Só os do lote que está na tela e só quando a pessoa toca: nada automático e nada da fila inteira. Os
// que esperam decisão e têm site próprio sem leitura guardada entram, um de cada vez (POST
// /api/operations/crm/sinais, o mesmo da Ficha). Ao fim a visão é relida: a Prioridade e o filtro por
// motivo passam a enxergar a leitura, e o lote continua o mesmo (loteDaTriagem só troca de lote quando
// ninguém dele espera decisão). Só informa: nada daqui convida, dispensa ou envia.
const tentadosNosSinais = ref<Set<string>>(new Set())
const alvosDeSinais = computed(() => alvosDoLote(lote.value.pendentes.map((i) => i.leadId), props.leads, tentadosNosSinais.value))
const lendoSinais = ref<Andamento | null>(null)
const resumoDosSinais = ref('')
let paradaDosSinais: AbortController | null = null
let aoSair = false

async function lerSinaisDoLote() {
  const alvos = alvosDeSinais.value
  if (!alvos.length || lendoSinais.value) return
  const parada = new AbortController()
  paradaDosSinais = parada
  resumoDosSinais.value = ''
  lendoSinais.value = { feitos: 0, total: alvos.length, empresa: '' }
  const resumo = await lerEmSerie(alvos, {
    async ler(alvo) {
      const resposta = await fetch('/api/operations/crm/sinais', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoDaLeitura(alvo)), signal: parada.signal,
      })
      return desfechoDaResposta(resposta.status, await resposta.json().catch(() => null))
    },
    // A pausa entre sites acaba na hora se a pessoa parar.
    esperar: (ms) => new Promise<void>((pronto) => {
      const fim = () => { window.clearTimeout(t); parada.signal.removeEventListener('abort', fim); pronto() }
      const t = window.setTimeout(fim, ms)
      parada.signal.addEventListener('abort', fim)
    }),
    parou: () => parada.signal.aborted,
    aoAndar: (a) => { lendoSinais.value = a },
  })
  if (paradaDosSinais === parada) paradaDosSinais = null
  lendoSinais.value = null
  // A tela pode ter saído (abort no desmonte): o resumo e a releitura não têm para quem.
  if (aoSair) return
  tentadosNosSinais.value = new Set([...tentadosNosSinais.value, ...resumo.resolvidos])
  resumoDosSinais.value = textoDoResumo(resumo)
  if (resumo.lidos) emit('sinaisLidos')
}

function pararSinais() {
  paradaDosSinais?.abort()
}

// Outro lote, outra conversa: o resumo do anterior sairia do lugar.
watch(() => lote.value.ids, () => { resumoDosSinais.value = '' })

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
  // Sair da tela interrompe a série; o que já foi lido ficou guardado no servidor.
  aoSair = true
  paradaDosSinais?.abort()
  window.clearTimeout(desarmar)
  desfazeis.value.forEach((d) => window.clearTimeout(d.temporizador))
})
</script>

<template>
  <div class="crm-triagem__adiadas">
    <button v-if="adiadas.length || verAdiadas" type="button" class="botao" @click="trocarAdiadas">{{ verAdiadas ? 'Voltar à triagem' : `Avaliar depois (${adiadas.length})` }}</button>
    <p v-if="verAdiadas">Contatos adiados neste aparelho por até 24 horas. Nenhum foi dispensado ou contatado.</p>
  </div>
  <div class="crm-hoje crm-triagem">
    <p v-if="falha" class="crm-aviso is-forte crm-triagem__falha" role="alert">
      {{ falha }} <button type="button" class="crm-mais" @click="falha = ''">Entendi</button>
    </p>
    <p v-if="!linhas.length && !cohortAtivo" class="crm-vazio"><strong>{{ verAdiadas ? 'Nenhum contato adiado.' : adiadas.length ? 'A triagem atual está concluída.' : 'Nada para triar.' }}</strong> {{ verAdiadas ? 'Volte à triagem para continuar avaliando os demais contatos.' : adiadas.length ? `Há ${adiadas.length} contatos em Avaliar depois; você pode retomá-los quando quiser.` : 'Não há contatos pendentes nesta lista.' }}</p>

    <section v-else class="crm-grupo is-revisar" aria-labelledby="crm-triagem-titulo">
      <header class="crm-grupo__cabeca">
        <h2 id="crm-triagem-titulo" ref="titulo" tabindex="-1">Escolha os próximos contatos</h2>
        <strong :aria-label="`${lote.ids.length} neste lote`">{{ lote.ids.length }} neste lote</strong>
      </header>
      <!-- Uma frase: o que fazer com cada um e quando vem o próximo lote. -->
      <p v-if="linhas.length" class="crm-grupo__explicacao">
        Abra a ficha para avaliar. Você pode abrir o convite, dispensar ou avaliar depois. Abrir o WhatsApp não registra envio; confirme somente depois de enviar.<template v-if="comPontuacao"> A pontuação (0 a 100) é do caçador.</template>
      </p>
      <!-- Filtro por motivo (BP-DOBRA, cohort.ts): só escolhe quem entra nos lotes; fechado por padrão. -->
      <CrmCohort :model-value="cohort" :leads="aDecidir" :quantos="quantosDoCohort" @update:model-value="mudarCohort" />
      <p v-if="!linhas.length" class="crm-vazio">
        <strong>Nada para triar neste filtro.</strong>
        <template v-if="quantosDoCohort.semLeitura"> {{ numero(quantosDoCohort.semLeitura) }} prospects talvez batam, mas falta a leitura de algum critério.</template>
        Mude ou limpe o filtro para ver os outros.
      </p>
      <RecadoDeTravas
        v-if="temConvites && !recado.pode" sem-detalhe id="crm-triagem-recado" :recado="recado"
        :rotulo-do-liberar="rotuloDoLiberar('triagem', { quantos: travadosPeloHorario.length })"
        @liberar="emit('liberarLote', travadosPeloHorario)"
      />
      <p v-if="!registro.disponivel" class="crm-nota-pequena">Dispensar está desligado: nada grava na planilha agora<template v-if="registro.motivo"> ({{ registro.motivo }})</template>.</p>

      <!-- A entrada da Triagem: um botão só. Dentro, a lista do lote. -->
      <p v-if="linhas.length" class="crm-triagem__conta">{{ numero(lote.restantes) }} disponíveis · {{ lote.ids.length }} neste lote<template v-if="decididosNoLote"> · {{ decididosNoLote }} decididos</template><template v-if="cohortAtivo"> · com filtro por motivo</template></p>

      <!-- Ler os sinais do site só deste lote (BP-BOTAO: um secundário; "Parar" é leve). O primário segue sendo o Convidar. -->
      <div v-if="triando && linhas.length && (alvosDeSinais.length || lendoSinais || resumoDosSinais)" class="crm-triagem__fim crm-triagem__sinais">
        <template v-if="lendoSinais">
          <p class="crm-nota-pequena" role="status">Lendo os sinais do site… {{ textoDoAndamento(lendoSinais) }}</p>
          <button type="button" class="botao botao--leve" @click="pararSinais">Parar</button>
        </template>
        <template v-else>
          <button v-if="alvosDeSinais.length" type="button" class="botao" @click="lerSinaisDoLote">Conferir sites de {{ alvosDeSinais.length }} leads</button>
          <p v-if="resumoDosSinais" class="crm-nota-pequena" role="status">{{ resumoDosSinais }}</p>
        </template>
      </div>

      <ul v-if="triando" class="crm-lista">
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
            <!-- O motivo à vista: por que este prospect passou pelo filtro (só com o filtro ligado). -->
            <p v-if="motivosDe(linha.item).length" class="crm-item__porque"><strong>Motivo:</strong> {{ motivosDe(linha.item).join(' · ') }}</p>
            <p v-if="convidadoEm(linha.item)" class="crm-item__aberto">Convite aberto às {{ convidadoEm(linha.item) }} nesta tela. A planilha confirma em alguns minutos.</p>
            <div v-else class="crm-triagem__decisoes">
              <a
                v-if="!motivo(linha.item)" class="botao" :class="{ 'botao--primario': primeiroConvidavel === linha.item.leadId }"
                :href="conviteDe(linha.item)" target="_blank" rel="noopener" @click="convidar(linha.item)"
              >Abrir convite no WhatsApp <span aria-hidden="true">↗</span></a>
              <!-- Travado pelas travas do envio: o porquê e o quando estão no recado único, lá em cima.
                   Só a falta de convite é deste prospect e fica ao lado. -->
              <template v-else-if="conviteDe(linha.item)">
                <button type="button" class="botao" disabled aria-describedby="crm-triagem-recado">Abrir convite no WhatsApp</button>
              </template>
              <template v-else>
                <button type="button" class="botao" disabled :aria-describedby="`crm-triagem-motivo-${linha.item.leadId}`">Abrir convite no WhatsApp</button>
                <span :id="`crm-triagem-motivo-${linha.item.leadId}`" class="crm-triagem__motivo">{{ motivo(linha.item) }}</span>
              </template>
              <button type="button" class="botao botao--leve" :disabled="!registro.disponivel || emSerie !== null" @click="dispensar(linha.item)">
                Dispensar<span class="so-leitor"> {{ leads.get(linha.item.leadId)?.empresa }}</span>
              </button>
              <button v-if="!verAdiadas" type="button" class="botao botao--leve" @click="adiar(linha.item)">Avaliar depois<span class="so-leitor"> {{ leads.get(linha.item.leadId)?.empresa }}</span></button>
              <button v-else type="button" class="botao botao--leve" @click="voltarATriagem(linha.item)">Retomar avaliação<span class="so-leitor"> de {{ leads.get(linha.item.leadId)?.empresa }}</span></button>
            </div>
            <CrmConfirmarConvite v-if="leads.get(linha.item.leadId) && !convidadoEm(linha.item)" :lead="leads.get(linha.item.leadId)!" :disponivel="registro.disponivel" @registrado="emit('registrado')" />
            <p v-if="secundarios(linha.item).length" class="crm-triagem__links">
              <a v-for="link in secundarios(linha.item)" :key="link.url" :href="link.url" target="_blank" rel="noopener">{{ link.rotulo }} <span aria-hidden="true">↗</span></a>
            </p>
          </li>
        </template>
      </ul>

      <div v-if="triando && (lote.pendentes.length || emSerie || resultadoDaSerie)" class="crm-triagem__fim">
        <button v-if="!verAdiadas && lote.pendentes.length" type="button" class="botao" :disabled="emSerie !== null" @click="adiarLote">Avaliar este lote depois</button>
        <details class="dobra">
        <summary>Dispensar contatos deste lote</summary>
        <p>Use somente se estes contatos não servirem para a oferta. Para continuar com outro lote sem descartá-los, use Avaliar este lote depois.</p>
        <button
          v-if="lote.pendentes.length && !emSerie" type="button" class="botao" :class="{ 'is-armado': confirmando }"
          :disabled="!registro.disponivel" @click="armarOuDispensar"
        >
          {{ confirmando ? `Toque de novo para dispensar ${lote.pendentes.length}` : `Dispensar os que sobraram (${lote.pendentes.length})` }}
        </button>
        <button v-if="confirmando" type="button" class="botao botao--leve" @click="confirmando = false">Cancelar</button>
        <p v-if="emSerie" class="crm-nota-pequena" role="status">Dispensando… {{ emSerie.feitos }} de {{ emSerie.total }}</p>
        <p v-else-if="resultadoDaSerie" class="crm-nota-pequena" role="status">{{ resultadoDaSerie }}</p>
        </details>
      </div>
    </section>
  </div>
</template>

<style scoped>
.crm-triagem__sinais { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-start; gap: var(--esp-2); min-height: 0; }
.crm-triagem__sinais > .botao { width: auto; white-space: normal; }
</style>
