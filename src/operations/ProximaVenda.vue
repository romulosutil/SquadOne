<script setup lang="ts">
/**
 * "Próxima venda" (16/10/2026): o primeiro cartão da Hoje no Dell. Uma ação por vez, a mais perto
 * de virar dinheiro (proxima-venda.ts), com o porquê, como vender nesse momento e a mensagem já
 * escrita para revisar. O toque abre o WhatsApp com o texto; quem envia é o Rômulo.
 *
 * Mesmas regras do CRM: tocar no link já anota a 2ª mensagem, o follow-up e o envio do Plus
 * (anotacao-de-envio.ts) e conta o primeiro contato na trava de ritmo (trava-de-ritmo.ts, mesma
 * chave de localStorage do CRM, então as duas telas somam). "Enviei, próxima" e "Pular" só mexem
 * nesta tela: o funil continua sendo a planilha (RULES 11).
 *
 * Fora do expediente, o primeiro contato espera como nas telas do CRM (OT-02, 16/10/2026): a mesma
 * janela (trava-de-horario.ts), o mesmo aviso com a taxa medida e o mesmo "Liberar" por lead. Desde
 * 17/10/2026 (AC-21) o "Liberar" é um só, do dia, guardado no servidor (liberados.ts): vale na
 * Triagem e na Ficha, e recarregar não trava de novo. O ritmo continua sem "Liberar".
 *
 * 17/10/2026 (AC-16): no celular o botão do WhatsApp ficava em y≈761 de 844, colado na barra, depois da
 * citação, do "Como" e do rascunho. Agora vem logo depois do porquê; a mensagem fica em "Ver a
 * mensagem", aberta a partir de 64 rem (no desktop ela segue à vista antes do toque) e fechada abaixo.
 * O filtro de nicho só aparece com mais de um nicho de verdade (a mesma palavra é um nicho só).
 *
 * A fila única (OT-01, 16/10/2026): o "Enviei" e o "Pular" vão ao servidor (GET/POST
 * /api/operations/crm/venda, o mesmo arquivo do vendedor do Telegram), então valem em qualquer
 * navegador e no Telegram; o localStorage fica só de reserva quando o servidor não responde. A folha
 * "Enviar um por um" saiu: o filtro por nicho e o passo do vídeo (A/B do vídeo) vieram para cá.
 * O desfecho (OT-06): quem disse não ganha "Marcar a recusa" em um toque.
 *
 * 17/10/2026 (AC-01, AC-02, AC-04): a Ficha abre na própria página quando quem monta o cartão sabe
 * abrir (o CrmPanel passa `@abrir`); na Hoje o link segue para /crm?lead=. Todo número da fila sai de
 * resumoDoDia (o mesmo da aba "A fazer"). O status do toque ficou visível, e a falha da anotação
 * fica em destaque até "Entendi", com o botão da Ficha ao lado.
 *
 * 17/10/2026 (AC-06): o servidor é a fonte única do dia, para esta tela e o vendedor do Telegram.
 * O toque num primeiro contato vai a /crm/venda/primeiro e a trava conta o retrato mais os primeiros
 * do servidor (os do Telegram inclusive); o localStorage fica só de reforço até o servidor
 * confirmar. A anotação do toque vai a /crm/venda/anotar, uma vez por ação no dia: o "Enviei"
 * atrasado no Telegram não anota de novo, e "Enviei, próxima" daqui fecha o aviso aberto lá.
 *
 * 17/10/2026 (hierarquia de Vendas): "não sei o que fazer e em que ordem". O cartão tinha até cinco
 * botões em fileira e uns dez elementos antes da decisão. Agora é UM primário, o que a ação pede
 * (Abrir no WhatsApp, Marcar a recusa) e, depois do toque, "Enviei, próxima" no lugar dele (é o passo
 * seguinte, não um botão a mais); ao lado só o "Pular". Ficha, "Vídeo enviado" e reabrir o WhatsApp
 * vão para "Mais ações" (BP-R3). A conversa, a leitura do copiloto, o "Como", o vídeo e a mensagem
 * pronta ficam numa dobra só, "Por quê e como", fechada, que abre sozinha quando não há texto pronto
 * (o passo é escrever, e o como é o que falta). As duas travas viram um recado só (recado-de-travas.ts)
 * com o quando, e o "Liberar" é um link nele. Lógica e endpoints iguais: só a ordem da tela mudou.
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { estadoDoVideo, gravarVideos, lerVideos, marcarVideo, passoDoVideo, type EnviosAbertos } from './fila-de-envio'
import {
  chamadaDaAcao, filaDaTela, filaDeVenda, gravarResolvidas as gravarNoStorage, lerResolvidas as lerDoStorage, nichoDo, nichosDoPrimeiro, noExpedienteDeVenda,
  resumoDaFila, resumoDoDia, textoDosPrimeiros, type AcaoDeVenda, type Resolvidas, type ResumoDoDia, type SugestaoDeVenda,
} from './proxima-venda'
import { planoDoDia } from './plano-do-dia'
import { diagnosticoDeVenda } from './por-que-nao-vende'
import { absorverDia, liberadosDoDia as liberados, liberarLead } from './liberados'
import { liberadoNaFila, recadoDasTravas, rotuloDoLiberar } from './recado-de-travas'
import RecadoDeTravas from './RecadoDeTravas.vue'
import { avisoDeHorario } from './resultados'
import {
  gravarPrimeiros, instantesDePrimeiroContato, lerPrimeiros, marcarPrimeiro, ritmoDoEnvio, somarPrimeiros, type PrimeirosContatos,
} from './trava-de-ritmo'
import type { CrmVisao } from './types'

const props = defineProps<{
  visao: CrmVisao | null
  erro?: string
  /**
   * Quem monta o cartão abre a Ficha na mesma página (o CrmPanel, com `@abrir`). Sem ele (a Hoje), o
   * link /crm?lead= troca de rota e o CrmPanel lê o lead ao montar. É prop, e não emit, porque só
   * assim dá para saber se alguém escuta: na A fazer o pushState da casca não remonta o CrmPanel e a
   * folha nunca abria (AC-01, 17/10/2026).
   */
  onAbrir?: (leadId: string) => void
}>()
const emit = defineEmits<{ registrado: []; resumo: [ResumoDoDia] }>()

const agora = ref(Date.now())
let relogio = 0
/** Os toques de primeiro contato deste navegador: reforço até o servidor confirmar, nunca a fonte. */
const primeiros = ref<PrimeirosContatos>({})
/** Os primeiros contatos do dia no servidor (Central e Telegram): a fonte da trava de ritmo. */
const primeirosDoServidor = ref<Record<string, { em: number }>>({})
/** Os leads cujo primeiro contato é do time comercial (19/10/2026): a fila não os oferece. */
const primeirosDoTime = ref<ReadonlySet<string>>(new Set())
/** Chaves resolvidas nesta tela ("Enviei" ou "Pular"), com o instante; valem até o fim do dia. */
const resolvidas = ref<Resolvidas>({})
const verFila = ref(false)
const copiado = ref(false)
const tocado = ref<string | null>(null)
const status = ref('')
/**
 * A anotação que não chegou à aba CRM. Fica à parte do status (que o próximo toque troca) até o
 * "Entendi": é o único recado que pede uma ação, e o "Enviei, próxima" logo depois o apagava.
 */
const falha = ref<{ leadId: string; texto: string } | null>(null)
/** As sugestões que o copiloto fez sozinho para a conversa de agora (leadId -> mensagem). */
const sugestoes = ref<Map<string, SugestaoDeVenda>>(new Map())
const verPadrao = ref(false)
/** Primeiro contato de um nicho só (a chave de chaveDoNicho); vazio = todos. */
const nicho = ref('')
/**
 * A dobra "Por quê e como" (17/10/2026): fechada quando há mensagem pronta (o botão já a leva ao
 * WhatsApp, onde ela se revisa) e aberta quando o passo é escrever à mão, porque aí o "Como" e a
 * conversa são o que falta para agir. Volta a esse padrão a cada ação nova; o toque do Rômulo vale
 * até a ação mudar.
 */
const comoAberto = ref(false)
/** "Vídeo enviado" do braço com vídeo (A/B do vídeo): lembrado neste navegador por 30 min. */
const videos = ref<EnviosAbertos>({})

/** O que o servidor lembra do dia (o mesmo do Telegram); falhou, fica o que esta tela sabe. */
async function lerDoServidor() {
  try {
    const r = await fetch('/api/operations/crm/venda', { cache: 'no-store' })
    if (!r.ok) return
    lerDia(await r.json())
  } catch { /* sem servidor: a reserva local */ }
}

/** O dia como o servidor devolve (GET e os POST de /crm/venda): o que se resolveu e os primeiros. */
function lerDia(corpo: { resolvidas?: Record<string, { em: number; pulou: boolean }>; primeiros?: Record<string, { em: number }>; doTime?: unknown } | null) {
  if (corpo?.resolvidas) {
    resolvidas.value = { ...resolvidas.value, ...corpo.resolvidas }
    gravarResolvidas()
  }
  if (corpo?.primeiros && typeof corpo.primeiros === 'object') primeirosDoServidor.value = corpo.primeiros
  // Só o GET traz `doTime`; os POST devolvem o dia sem ele e não apagam o que se leu.
  if (Array.isArray(corpo?.doTime)) primeirosDoTime.value = new Set(corpo.doTime.filter((id): id is string => typeof id === 'string'))
  absorverDia(corpo)
}

async function lerSugestoes() {
  try {
    const r = await fetch('/api/operations/crm/copiloto/prontas', { cache: 'no-store' })
    if (!r.ok) return
    const corpo = await r.json() as { sugestoes?: Record<string, SugestaoDeVenda> }
    sugestoes.value = new Map(Object.entries(corpo.sugestoes ?? {}))
  } catch {
    // sem copiloto: a fila segue com o texto pronto da esteira
  }
}

function armazenamento(): Storage | null {
  try { return window.localStorage } catch { return null }
}
function lerResolvidas() {
  const lidas = lerDoStorage(armazenamento(), Date.now())
  if (Object.keys(lidas).length) resolvidas.value = lidas
}
function gravarResolvidas() {
  gravarNoStorage(armazenamento(), resolvidas.value, Date.now())
}

onMounted(() => {
  primeiros.value = lerPrimeiros(armazenamento(), Date.now())
  lerResolvidas()
  videos.value = lerVideos(armazenamento(), Date.now())
  void lerDoServidor()
  void lerSugestoes()
  relogio = window.setInterval(() => {
    agora.value = Date.now()
    void lerSugestoes()
    void lerDoServidor()
  }, 30_000)
})
onBeforeUnmount(() => {
  window.clearInterval(relogio)
})

// O retrato mais os primeiros do servidor (as duas superfícies) e o reforço local, um por lead.
const ritmo = computed(() => ritmoDoEnvio(
  instantesDePrimeiroContato(props.visao?.leads ?? [], somarPrimeiros(primeirosDoServidor.value, primeiros.value)), agora.value))
const expediente = computed(() => noExpedienteDeVenda(agora.value))
const pulados = computed(() => new Set(Object.entries(resolvidas.value).filter(([, r]) => r.pulou).map(([k]) => k)))
const feitos = computed(() => new Set(Object.entries(resolvidas.value).filter(([, r]) => !r.pulou).map(([k]) => k)))
const ritmoLivre = computed(() => ritmo.value.motivo === null)
const fila = computed<AcaoDeVenda[]>(() => filaDaTela(props.visao, {
  ritmo: ritmo.value, noExpediente: expediente.value, agora: agora.value,
  liberados: liberados.value, sugestoes: sugestoes.value, nicho: nicho.value, primeirosDoTime: primeirosDoTime.value,
}, resolvidas.value))
/** A contagem do dia: o "N na fila", o "Ver a fila inteira (N)" e a aba "A fazer N" (via `resumo`). */
const resumo = computed(() => resumoDoDia(fila.value, props.visao?.estado === 'ok' ? props.visao : null, ritmo.value))
watch(resumo, (r) => emit('resumo', r), { immediate: true })
/**
 * Fora do expediente e com o ritmo livre: o primeiro contato que sairia agora, para o "Liberar"
 * dizer de quem é (a fila calculada como se o expediente estivesse aberto).
 */
const candidatoForaDoExpediente = computed<AcaoDeVenda | null>(() => {
  if (expediente.value || !ritmoLivre.value || props.visao?.estado !== 'ok') return null
  const comoSeAberto = filaDeVenda(props.visao, { primeiroLiberado: true, agora: agora.value, primeirosDoTime: primeirosDoTime.value }, pulados.value)
  return comoSeAberto.find((a) => a.primeiroContato && !feitos.value.has(a.chave) && !liberados.value.has(a.leadId)) ?? null
})
async function liberar(a: AcaoDeVenda) {
  status.value = `${a.empresa}: liberado fora do expediente hoje, em toda tela.`
  if (!(await liberarLead(a.leadId))) status.value = `${a.empresa}: liberado só nesta aba (o servidor não guardou).`
}
const porId = computed(() => new Map((props.visao?.leads ?? []).map((l) => [l.id, l])))
/** Os nichos de quem espera o primeiro contato (um por palavra, sem caixa nem acento), do maior para o menor. */
const nichos = computed(() => nichosDoPrimeiro((props.visao?.hoje.find((g) => g.id === 'enviar')?.itens ?? [])
  .flatMap((i) => { const lead = porId.value.get(i.leadId); return lead ? [nichoDo(lead)] : [] })))
// O filtro escondido não pode seguir valendo: sobrou um nicho só, ou o escolhido saiu da fila, volta a "todos".
watch(nichos, (lista) => {
  if (nicho.value && (lista.length < 2 || !lista.some((n) => n.chave === nicho.value))) nicho.value = ''
})
const atual = computed(() => fila.value[0] ?? null)
const chamada = computed(() => (atual.value ? chamadaDaAcao(atual.value) : ''))
/**
 * O plano do dia (17/10/2026, "a Central está muito reativa"): o cartão abre dizendo quanto do dia já
 * foi, quanto falta e quanto de janela de envio sobra, em vez de esperar o Rômulo olhar a fila. Com a
 * fila vazia, a próxima coisa a fazer é a do gargalo do funil.
 */
const plano = computed(() => planoDoDia({
  resumo: resumo.value,
  feitas: feitos.value.size,
  agora: agora.value,
  gargalo: props.visao?.estado === 'ok' ? diagnosticoDeVenda(props.visao.leads, agora.value).gargalo : null,
}))
const leadAtual = computed(() => (atual.value ? porId.value.get(atual.value.leadId) ?? null : null))
const passoDoVideoAtual = computed(() => (atual.value?.primeiroContato && leadAtual.value ? passoDoVideo(leadAtual.value) : null))
const videoPendente = computed(() => (leadAtual.value ? estadoDoVideo(leadAtual.value, videos.value) === 'pendente' : false))
function marcarOVideo() {
  if (!leadAtual.value) return
  videos.value = marcarVideo(videos.value, leadAtual.value.id, Date.now())
  gravarVideos(armazenamento(), videos.value)
  status.value = `${leadAtual.value.empresa}: vídeo marcado como enviado.`
}
const depois = computed(() => fila.value.slice(1))
/** O vídeo do A/B ainda por mandar depois do toque: o "Mais ações" avisa no próprio rótulo. */
const videoAFazer = computed(() => Boolean(atual.value && passoDoVideoAtual.value && videoPendente.value && tocado.value === atual.value.chave))
// Cada ação nova volta ao padrão da dobra: aberta só quando não há texto pronto (o passo é escrever).
watch(() => atual.value?.chave, () => { comoAberto.value = Boolean(atual.value && !atual.value.rascunho) }, { immediate: true })
/** Quantos primeiros contatos esperam e quantos o ritmo ainda deixa hoje ("165 … · até 10 hoje"). */
const contagemDosPrimeiros = computed(() => textoDosPrimeiros(resumo.value))
/**
 * As duas travas num recado só, com o próximo passo (recado-de-travas.ts). "Liberado" só quando um lead
 * liberado hoje está de fato na fila (liberadoNaFila): sem ninguém por liberar E sem liberado na fila
 * (todos pulados, feitos ou fora do filtro), o recado diz quando o expediente volta.
 */
const recado = computed(() => recadoDasTravas({
  agora: agora.value, noExpediente: expediente.value, ritmo: ritmo.value, contexto: 'venda',
  liberado: liberadoNaFila({ noExpediente: expediente.value, fila: fila.value, liberados: liberados.value }),
  taxa: expediente.value ? null : avisoDeHorario(props.visao?.leads ?? [], agora.value),
}))

const hrefDaFicha = (leadId: string) => `/crm?lead=${encodeURIComponent(leadId)}`
/**
 * Clique simples com alguém que abre a Ficha aqui: abre a folha e segura o link (a casca vê o
 * `defaultPrevented` e não faz o pushState). Ctrl, Shift, botão do meio ou sem `onAbrir`: o link
 * segue como sempre (aba nova, ou a rota /crm a partir da Hoje).
 */
function abrirAFicha(e: MouseEvent, leadId: string) {
  if (!props.onAbrir || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  props.onAbrir(leadId)
}

/** O que a anotação grava, para a falha dizer o que ficou por anotar. */
const O_QUE_ANOTA: Record<NonNullable<AcaoDeVenda['anota']>, string> = {
  proposta: 'a proposta', recusou: 'a recusa', segunda_enviada: 'o envio', followup_enviado: 'o envio', plus_enviado: 'o envio',
}

async function aoTocar(a: AcaoDeVenda) {
  tocado.value = a.chave
  if (a.primeiroContato) {
    // O reforço local segura a trava já; o servidor conta para o Telegram e outro navegador.
    primeiros.value = marcarPrimeiro(primeiros.value, a.leadId, Date.now())
    gravarPrimeiros(armazenamento(), primeiros.value)
    agora.value = Date.now()
    void fetch('/api/operations/crm/venda/primeiro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: a.leadId }),
    }).then(async (r) => { if (r.ok) lerDia(await r.json()) }).catch(() => undefined)
  }
  if (!a.anota) return
  const lead = props.visao?.leads.find((l) => l.id === a.leadId)
  if (!lead) return
  try {
    // Uma vez por ação no dia (o servidor guarda): o toque repetido aqui ou o "Enviei" no Telegram não
    // anotam de novo. A proposta vai sem data: o servidor grava a de hoje (São Paulo), como a Ficha.
    const r = await fetch('/api/operations/crm/venda/anotar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave: a.chave, produto: lead.produto, id: lead.chave, tipo: a.anota }),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const corpo = await r.json().catch(() => ({})) as { jaEstava?: boolean }
    status.value = corpo.jaEstava ? `${a.empresa}: já estava anotado.`
      : a.anota === 'proposta' ? `${a.empresa}: proposta anotada.`
      : a.anota === 'recusou' ? `${a.empresa}: recusa marcada; sai do funil no próximo retrato.` : `${a.empresa}: envio anotado.`
    if (falha.value?.leadId === a.leadId) falha.value = null
    if (!corpo.jaEstava) emit('registrado')
  } catch {
    falha.value = { leadId: a.leadId, texto: `${a.empresa}: não consegui anotar ${O_QUE_ANOTA[a.anota]} — anote na ficha.` }
  }
}

function resolver(a: AcaoDeVenda, pulou: boolean) {
  resolvidas.value = { ...resolvidas.value, [a.chave]: { em: Date.now(), pulou } }
  gravarResolvidas()
  // O servidor é a memória que vale para o Telegram (fecha o aviso aberto lá) e outro navegador;
  // falhar não desfaz a tela.
  const como = pulou ? 'pulada' : a.tipo === 'desfecho' ? 'recusa' : 'enviada'
  void fetch('/api/operations/crm/venda', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: a.chave, como }),
  }).catch(() => undefined)
  tocado.value = null
  copiado.value = false
  verPadrao.value = false
  status.value = pulou ? `${a.empresa}: fica para o fim da fila.` : `${a.empresa}: feito.`
}

/** O desfecho: o toque grava a recusa e a ação sai da fila. */
async function marcarRecusa(a: AcaoDeVenda) {
  await aoTocar(a)
  resolver(a, false)
}

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = true
  } catch {
    copiado.value = false
  }
}

const ROTULO_DO_TIPO: Record<AcaoDeVenda['tipo'], string> = {
  responder: 'Responder', 'mandar-proposta': 'Mandar a proposta', combinado: 'Combinado', 'depois-do-link': 'Depois do link', proposta: 'Proposta', followup: 'Follow-up', desfecho: 'Recusou', primeiro: 'Primeiro contato',
}
</script>

<template>
  <section class="venda" aria-label="Próxima venda">
    <!-- O plano do dia: a tela diz o dia antes de pedir o próximo toque. Só com o funil lido: sem
         retrato não há conta, e o aviso de baixo já diz isso. -->
    <div v-if="visao?.estado === 'ok'" class="venda__plano" :class="{ 'is-urgente': plano.urgente }">
      <p class="venda__manchete">{{ plano.manchete }}</p>
      <div
        v-if="plano.feitas || plano.restantes" class="venda__progresso" role="progressbar" aria-label="Andamento do dia"
        aria-valuemin="0" :aria-valuemax="plano.feitas + plano.restantes" :aria-valuenow="plano.feitas"
      ><span :style="{ '--andamento': plano.progresso }" /></div>
      <p v-if="plano.oQueFalta" class="texto-pequeno">Falta: {{ plano.oQueFalta }}</p>
      <p class="venda__janela texto-pequeno" :class="{ 'is-urgente': plano.urgente }">{{ plano.janela }}</p>
    </div>

    <!-- Em cima do cartão: depois do "Enviei", a ação seguinte toma o lugar e o recado do toque
         anterior continua à vista. A falha fica até o "Entendi"; o status, até o próximo toque. -->
    <p v-if="falha" class="recado recado--erro venda__falha" role="alert">
      <span>{{ falha.texto }}</span>
      <a class="botao" :href="hrefDaFicha(falha.leadId)" @click="abrirAFicha($event, falha.leadId)">Abrir a Ficha</a>
      <button type="button" class="botao botao--leve" @click="falha = null">Entendi</button>
    </p>
    <!-- A região viva fica sempre no DOM (o leitor só anuncia o que muda numa região que já existia);
         vazia, some da vista. -->
    <p class="recado" :class="{ 'so-leitor': !status }" role="status" aria-live="polite">{{ status }}</p>

    <p v-if="erro" class="recado recado--erro">Funil indisponível: {{ erro }}</p>
    <p v-else-if="!visao" class="texto-2" role="status">Lendo o funil…</p>
    <p v-else-if="visao.estado !== 'ok'" class="recado recado--atencao">Sem retrato das planilhas: não dá para dizer quem chamar agora.</p>

    <template v-else-if="atual">
      <article class="venda__atual" :class="{ 'is-quente': atual.quente }">
        <p class="venda__tipo">
          <span class="selo" :class="atual.quente ? 'selo--erro' : ''">{{ ROTULO_DO_TIPO[atual.tipo] }}</span>
          <span class="texto-2 texto-pequeno">{{ atual.contexto }}</span>
        </p>
        <!-- "Envie para X, isto:" (17/10/2026): a chamada é a instrução e a mensagem vem logo abaixo, à
             vista (era uma dobra fechada), com o botão que a envia colado nela. A mensagem tem altura
             máxima, então o botão não desce para baixo da barra no celular (AC-16). -->
        <h2 id="venda-titulo">{{ chamada }}</h2>
        <template v-if="atual.rascunho">
          <div class="venda__origem">
            <p class="texto-2 texto-pequeno">
              <template v-if="atual.copiloto">Sugestão do copiloto, que leu a conversa (revise antes de enviar)<span v-if="atual.copiloto.porque">: {{ atual.copiloto.porque }}</span></template>
              <template v-else>Mensagem pronta (revise antes de enviar)</template>
            </p>
            <button type="button" class="botao botao--leve" @click="copiar(atual.rascunho)">{{ copiado ? 'Copiado' : 'Copiar o texto' }}</button>
          </div>
          <blockquote class="venda__mensagem" tabindex="0" aria-label="Mensagem a enviar">{{ atual.rascunho }}</blockquote>
        </template>
        <p v-else-if="atual.tipo !== 'desfecho'" class="venda__escrever">Sem texto pronto: escreva à mão. <strong>Como:</strong> {{ atual.tatica }}</p>

        <!-- Fazer agora: UM primário, logo depois da mensagem (AC-16), e só o "Pular" ao lado (BP-R3).
             Depois do toque no WhatsApp o passo seguinte é "Enviei, próxima": ele toma o lugar do
             primário em vez de virar mais um botão na fileira. O resto mora em "Mais ações". -->
        <div class="venda__botoes acoes">
          <button v-if="tocado === atual.chave" type="button" class="botao botao--primario" @click="resolver(atual, false)">Enviei, próxima</button>
          <button v-else-if="atual.tipo === 'desfecho'" type="button" class="botao botao--primario" @click="marcarRecusa(atual)">Marcar a recusa</button>
          <a
            v-else-if="atual.link" class="botao botao--primario" :href="atual.link.url" target="_blank" rel="noopener"
            @click="aoTocar(atual)"
          >{{ atual.rascunho ? 'Abrir no WhatsApp com a mensagem' : 'Abrir a conversa no WhatsApp' }} <span aria-hidden="true">↗</span></a>
          <a v-else class="botao botao--primario" :href="hrefDaFicha(atual.leadId)" @click="abrirAFicha($event, atual.leadId)">Abrir a Ficha</a>
          <button type="button" class="botao botao--leve" @click="resolver(atual, true)">Pular</button>
          <details v-if="atual.link || atual.tipo === 'desfecho'" class="mais-acoes">
            <summary>Mais ações<template v-if="videoAFazer"> · falta o vídeo</template></summary>
            <ul class="lista-acoes">
              <li v-if="videoAFazer"><button type="button" @click="marcarOVideo">Vídeo enviado</button></li>
              <li v-if="tocado === atual.chave && atual.link">
                <a :href="atual.link.url" target="_blank" rel="noopener" @click="aoTocar(atual)">Abrir o WhatsApp de novo <span aria-hidden="true">↗</span></a>
              </li>
              <li v-if="atual.tipo === 'desfecho' && atual.link">
                <a :href="atual.link.url" target="_blank" rel="noopener">{{ atual.link.rotulo }} <span aria-hidden="true">↗</span></a>
              </li>
              <li v-if="atual.link || atual.tipo === 'desfecho'"><a :href="hrefDaFicha(atual.leadId)" @click="abrirAFicha($event, atual.leadId)">Abrir a Ficha</a></li>
            </ul>
          </details>
        </div>

        <p v-if="atual.link && atual.tipo !== 'desfecho' && tocado !== atual.chave" class="texto-2 texto-pequeno">Depois de enviar, volte aqui e toque em “Enviei, próxima”.</p>

        <!-- O porquê agora: a situação (a frase única da ação, AC-12) e o que o servidor sabe do momento. -->
        <p class="venda__porque"><strong>{{ atual.titulo }}.</strong> {{ atual.porque }}</p>

        <!-- Uma dobra só para o que é consulta: a conversa, a leitura do copiloto, o "Como", o vídeo e o
             texto padrão da esteira. A mensagem pronta saiu daqui: ela fica à vista, logo depois da
             chamada. Fechada com texto pronto; aberta quando o passo é escrever. -->
        <details class="dobra venda__como" :open="comoAberto" @toggle="comoAberto = ($event.target as HTMLDetailsElement).open">
          <summary>Conversa e como <span class="texto-2 texto-pequeno">{{ atual.rascunho ? (atual.copiloto ? '(com a leitura do copiloto)' : '(com o passo a passo)') : '(escrever à mão)' }}</span></summary>
          <p v-if="atual.conversa" class="venda__conversa" :class="{ 'is-sem': !atual.conversa.startsWith('Última') }">{{ atual.conversa }}</p>
          <p v-if="atual.copiloto?.momento" class="venda__tatica"><strong>Leitura do copiloto:</strong> {{ atual.copiloto.momento.leitura }}</p>
          <p v-if="atual.rascunho || atual.tipo === 'desfecho'" class="venda__tatica"><strong>Como:</strong> {{ atual.tatica }}</p>
          <p v-if="passoDoVideoAtual" class="venda__tatica"><strong>Vídeo:</strong> {{ passoDoVideoAtual }}</p>
          <div v-if="atual.copiloto?.padrao" class="venda__rascunho">
            <button type="button" class="botao botao--leve" :aria-expanded="verPadrao" @click="verPadrao = !verPadrao">
              {{ verPadrao ? 'Esconder o texto padrão' : 'Ver o texto padrão da esteira' }}
            </button>
            <blockquote v-if="verPadrao" class="venda__mensagem is-padrao">{{ atual.copiloto.padrao }}</blockquote>
          </div>
          <p v-if="!atual.rascunho && atual.tipo !== 'desfecho'" class="texto-2 texto-pequeno">O Roteiro da Ficha ajuda a escrever.</p>
        </details>
      </article>

      <p v-if="depois.length" class="venda__depois">
        <span>Depois: {{ resumoDaFila(depois) }}.</span>
        <button type="button" class="botao botao--leve" :aria-expanded="verFila" @click="verFila = !verFila">{{ verFila ? 'Esconder a fila' : `Ver a fila inteira (${resumo.total})` }}</button>
      </p>
      <!-- A fila inteira é a da contagem: a atual em primeiro, marcada, e as seguintes. -->
      <ol v-if="verFila" class="venda__fila">
        <li v-for="(a, i) in fila" :key="a.chave">
          <a :href="hrefDaFicha(a.leadId)" :aria-current="i === 0 ? 'step' : undefined" @click="abrirAFicha($event, a.leadId)">
            <strong>{{ a.titulo }}<span v-if="i === 0" class="texto-2"> · agora</span></strong><small class="texto-2">{{ a.contexto }}</small>
          </a>
        </li>
      </ol>
    </template>

    <template v-else>
      <h2 id="venda-titulo">Nada para mandar agora</h2>
      <p class="texto-2">Ninguém esperando resposta, combinado ou follow-up.</p>
      <!-- Fila vazia não é hora de esperar: o próximo passo é o do gargalo (em "Por que não está vendendo", com quem está parado). -->
      <p v-if="plano.proximoPasso" class="venda__tatica"><strong>Enquanto isso:</strong> {{ plano.proximoPasso }}</p>
    </template>

    <!-- Quando o primeiro contato volta: um recado só (horário e ritmo), com o "Liberar" como link
         quando é o horário que segura, para o lead que sairia agora. -->
    <RecadoDeTravas
      v-if="contagemDosPrimeiros && visao?.estado === 'ok'" :recado="recado" :contagem="`${contagemDosPrimeiros}.`"
      :rotulo-do-liberar="candidatoForaDoExpediente ? rotuloDoLiberar('venda', { empresa: candidatoForaDoExpediente.empresa }) : undefined"
      @liberar="candidatoForaDoExpediente && liberar(candidatoForaDoExpediente)"
    />
    <!-- O filtro de nicho é ajuste, não decisão: dobrado, com o escolhido no título. -->
    <details v-if="nichos.length > 1" class="dobra venda__filtro">
      <summary>Primeiro contato de {{ nichos.find((n) => n.chave === nicho)?.rotulo ?? 'todos os nichos' }}</summary>
      <label class="venda__nicho" for="venda-nicho">Só um nicho
        <select id="venda-nicho" v-model="nicho">
          <option value="">todos os nichos</option>
          <option v-for="n in nichos" :key="n.chave" :value="n.chave">{{ n.rotulo }} ({{ n.quantos }})</option>
        </select>
      </label>
    </details>
  </section>
</template>

<style>
.venda { display: grid; gap: var(--respiro-interno); min-width: 0; padding: var(--respiro-bloco); border: var(--linha); border-left-width: var(--faixa-forte); border-left-color: var(--destaque); border-radius: var(--raio-bloco); background: var(--superficie); color: var(--texto); }
/* O plano do dia: fundo de zona (sem borda), a manchete em peso forte e a barra do andamento. */
.venda__plano { display: grid; gap: var(--esp-1); padding: var(--esp-3) var(--esp-4); border-radius: var(--raio-controle); background: var(--superficie-2); }
.venda__manchete { font-size: var(--tam-nome); font-weight: var(--peso-titulo); line-height: 1.2; letter-spacing: -0.01em; }
.venda__progresso { height: var(--esp-2); border-radius: var(--raio-pilula); background: var(--superficie); overflow: hidden; }
.venda__progresso span { display: block; width: 100%; height: 100%; border-radius: var(--raio-pilula); background: var(--positivo); transform: scaleX(var(--andamento, 0)); transform-origin: left; transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1); }
.venda__janela.is-urgente { padding: var(--esp-1) var(--esp-2); border-radius: var(--raio-selo); background: var(--erro-fundo); font-weight: var(--peso-forte); }
@media (prefers-reduced-motion: reduce) { .venda__progresso span { transition: none; } }
.venda h2 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); line-height: 1.1; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.venda p { margin: 0; }
.venda__atual { display: grid; gap: var(--esp-3); min-width: 0; }
.venda__tipo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); }
.venda__porque { color: var(--texto); }
.venda__conversa { padding: var(--esp-2) var(--esp-3); border-left: var(--faixa) solid var(--borda); border-radius: var(--raio-controle); background: var(--superficie-2); overflow-wrap: anywhere; }
.venda__conversa.is-sem { background: var(--atencao-fundo); }
.venda__tatica { padding: var(--esp-2) var(--esp-3); border-radius: var(--raio-controle); background: var(--superficie-2); }
.venda__rascunho { display: grid; gap: var(--esp-1); margin: 0; }
.venda__como[open] { display: grid; gap: var(--esp-2); min-width: 0; }
/* A mensagem à vista, logo depois da chamada. Altura máxima curta no celular para o botão do WhatsApp
   não descer para baixo da barra (AC-16); a rolagem é dela, e o foco por teclado a alcança. */
.venda__mensagem { margin: 0; padding: var(--esp-3) var(--esp-4); border-radius: var(--raio-controle); background: var(--ok-fundo); color: var(--texto); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 9.5em; overflow: auto; }
.venda__mensagem.is-padrao { background: var(--superficie-2); }
.venda__origem { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); }
.venda__escrever { padding: var(--esp-3) var(--esp-4); border-radius: var(--raio-controle); background: var(--atencao-fundo); }
@media (min-width: 64rem) { .venda__mensagem { max-height: 16em; } }
.venda__tatica, .venda__porque { overflow-wrap: anywhere; }
.venda__botoes { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.venda__falha { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); overflow-wrap: anywhere; }
.venda__falha span { flex: 1 1 16em; }
.venda__nicho { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); color: var(--texto-2); font-size: var(--tam-apoio); }
.venda__nicho select { min-height: var(--toque); padding: 0 var(--esp-2); border: var(--linha); border-radius: var(--raio-controle); background: var(--superficie); color: var(--texto); }
.venda__depois { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); padding-top: var(--esp-2); border-top: var(--divisor); color: var(--texto-2); }
.venda__fila { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.venda__fila a { display: grid; gap: var(--esp-0); min-height: var(--toque); padding: var(--esp-2) var(--esp-3); border-radius: var(--raio-controle); background: var(--superficie-2); color: var(--texto); text-decoration: none; }
.venda__fila a:hover { background: var(--hover); }
</style>
