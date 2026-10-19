<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onBeforeUnmount, provide, ref, watch } from 'vue'
import type { Dominio, SquadView } from '../types'
import type { CrmVisao } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import type { OperacaoDaSala } from './operacao'
import { agruparPendencias, leadsDaSala, pedidoDaSala, pendenciasDaSala } from './comando'
import { proximoDaJornada } from '../operations/jornada'
import { useAgentes } from '../agentes/estado'
import SalaOperacao from '../components/SalaOperacao.vue'
import AcompanhamentoObservado from './AcompanhamentoObservado.vue'
import RevisarResposta from './RevisarResposta.vue'
import { lerRascunhoDaVenda, voltarAosPassos } from './rascunhos'
import AjustarProximoPasso from './AjustarProximoPasso.vue'
import { focarNaSala } from './foco'
import { retomadasDaSala, passosFuturosDaSala, rotuloDoPasso } from '../operations/retomadas'
import { ultimoRetornoRegistrado } from '../operations/retorno-da-venda'
import { acompanharVenda } from './andamento'
import SpriteDaSala from './SpriteDaSala.vue'
import ConversaDoAgente from './ConversaDoAgente.vue'
import type { TimeLido } from '../casca/hoje'
import { useConversaDoAgente } from '../casca/assistente'

const CrmPanel = defineAsyncComponent(() => import('../operations/CrmPanel.vue'))
const props = defineProps<{
  sala: Dominio; squad: SquadView; visao: CrmVisao | null; erro: string
  fila: AcaoDeVenda[]; operacao?: OperacaoDaSala
  conversar?: { pessoaId: string; clique: number } | null
  time?: TimeLido | null
}>()
const emit = defineEmits<{ registrado: [] }>()
const ag = useAgentes()
const aba = ref<'pendencias' | 'conversa'>('conversa')
const ficha = ref<string | null>(null)
const mostrarOperacao = ref(false)
const leadSelecionado = ref<string | null>(null)
const leadAtual = computed(() => props.visao?.leads.find(l => l.id === leadSelecionado.value) ?? null)
function conversarSobre(id: string) { leadSelecionado.value = id; aba.value = 'conversa' }
const fluxo = ref<HTMLElement | null>(null)
const painelDaConversa = ref<InstanceType<typeof ConversaDoAgente> | null>(null)
async function focarFluxo() {
  await nextTick()
  focarNaSala(fluxo.value)
}
function voltarParaConversa() { acompanhamento.value = null; void focarFluxo() }
async function responderAoRetorno() {
  if (!leadAtual.value || !ultimoRetornoRegistrado(leadAtual.value)) return
  voltarParaConversa()
  await nextTick()
  await painelDaConversa.value?.prepararResposta()
}
const acompanhamento = ref<{ id: string; produto: string; mensagem: string; abertura: number } | null>(null)
function acompanhar(mensagem = '') {
  const lead = leadAtual.value
  if (!lead) return
  acompanhamento.value = { id: lead.id, produto: lead.produto, mensagem, abertura: Date.now() }
  void focarFluxo()
}
provide(acompanharVenda, (lead, mensagem) => { if (lead.id === leadAtual.value?.id && lead.produto === leadAtual.value.produto) acompanhar(mensagem) })
const busca = ref('')
const demanda = ref('')
const pessoaId = ref(props.sala.po.id)
const enviando = ref(false)
const erroDoPedido = ref('')
const pedidoEnviado = ref<string | null>(null)
const pessoas = computed(() => [props.sala.po, ...props.sala.integrantes])
const pessoaAtual = computed(() => pessoas.value.find(p => p.id === pessoaId.value) ?? props.sala.po)
const conversaAtual = computed(() => useConversaDoAgente(props.squad.id, props.sala.id, pessoaAtual.value.id, leadAtual.value ?? undefined))
const sinalDaConversa = computed(() => aba.value === 'conversa' ? '' : conversaAtual.value.pendente.value ? 'Preparando resposta' : conversaAtual.value.enviando.value ? 'Recebendo comando' : '')
const agendaDaSquad = computed(() => props.time?.squads.find(s => s.id === props.squad.id))
const blocos = computed(() => agendaDaSquad.value?.emBlocoAgora.filter(b => b.pessoaId === pessoaAtual.value.id) ?? [])
const proxima = computed(() => agendaDaSquad.value?.proxima?.pessoaId === pessoaAtual.value.id ? agendaDaSquad.value.proxima : null)
const hora = (v: string) => new Date(v).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
const ordemAtual = computed(() => Math.max(0, props.squad.dominios.flatMap(d => [d.po, ...d.integrantes]).findIndex(p => p.id === pessoaAtual.value.id, leadAtual.value ?? undefined)))
watch(() => props.conversar, (c) => {
  if (!c || !pessoas.value.some(p => p.id === c.pessoaId)) return
  pessoaId.value = c.pessoaId
  aba.value = 'conversa'
}, { immediate: true })
function conversarCom(id: string) { pessoaId.value = id; aba.value = 'conversa' }
const lido = computed(() => props.visao?.estado === 'ok')
const leads = computed(() => lido.value ? leadsDaSala(props.sala.id, props.visao!.leads) : [])
const pendencias = computed(() => pendenciasDaSala(props.sala.id, leads.value, props.fila))
const agoraDaSala = ref(new Date())
let relogio: ReturnType<typeof setInterval> | undefined
onMounted(() => { relogio = setInterval(() => { agoraDaSala.value = new Date() }, 60_000) })
onBeforeUnmount(() => clearInterval(relogio))
const retomadas = computed(() => retomadasDaSala(leads.value, agoraDaSala.value))
const limiteRetomadas = ref(3)
const futuros = computed(() => passosFuturosDaSala(leads.value, agoraDaSala.value))
const limiteFuturos = ref({ amanha: 3, depois: 3 })
const periodosFuturos = computed(() => [
  { chave: 'amanha' as const, titulo: 'Amanhã', passos: futuros.value.filter(p => p.quando === 'amanha') },
  { chave: 'depois' as const, titulo: 'Próximos dias', passos: futuros.value.filter(p => p.quando === 'depois') },
].filter(p => p.passos.length))
watch(() => props.sala.id, () => { limiteFuturos.value = { amanha: 3, depois: 3 }; limiteRetomadas.value = 3 })
const ajuste = ref<{ id: string; modo: 'concluir' | 'reagendar' } | null>(null)
watch(() => props.sala.id, () => { ajuste.value = null })
const tituloSala = ref<HTMLElement | null>(null)
async function fecharAjuste() { ajuste.value = null; await nextTick(); focarNaSala(tituloSala.value) }
const leadDoAjuste = computed(() => props.visao?.leads.find(l => l.id === ajuste.value?.id))
const grupos = computed(() => agruparPendencias(pendencias.value).filter(g => !retomadas.value.some(r => r.lead.id === g.principal.leadId) && !futuros.value.some(r => r.lead.id === g.principal.leadId)))
async function prepararRetomada(id: string, modo: 'retomada' | 'amanha' | 'resposta' = 'retomada') {
  rascunhoAberto.value = null
  acompanhamento.value = null
  conversarSobre(id)
  await nextTick()
  await focarFluxo()
  await painelDaConversa.value?.prepararResposta(modo === 'resposta' ? undefined : modo)
}
const rascunhoAberto = ref<string | null>(null)
const ancoraRascunho = ref<HTMLElement | null>(null)
const leadDoRascunho = computed(() => props.visao?.leads.find(l => l.id === rascunhoAberto.value))
const rascunhoAtual = computed(() => leadDoRascunho.value ? lerRascunhoDaVenda(leadDoRascunho.value) : null)
async function abrirRascunho(id: string) { ajuste.value = null; rascunhoAberto.value = id; aba.value = 'pendencias'; await nextTick(); focarNaSala(ancoraRascunho.value) }
async function fecharRascunho() { rascunhoAberto.value = null; await nextTick(); focarNaSala(tituloSala.value) }
watch(() => props.sala.id, () => { rascunhoAberto.value = null })
provide(voltarAosPassos, () => { rascunhoAberto.value = null; aba.value = 'pendencias'; nextTick(() => focarNaSala(tituloSala.value)) })
const limite = ref(20)
watch(busca, () => { limite.value = 20 })
const filtrados = computed(() => leads.value.filter((l) => l.empresa.toLocaleLowerCase().includes(busca.value.trim().toLocaleLowerCase())))
const ultimo = computed(() => ag.ultimoPedido.value?.demanda === pedidoEnviado.value ? ag.ultimoPedido.value : null)
const bloqueio = computed(() => enviando.value || ag.isLoading.value || ag.modalAberto.value || !demanda.value.trim())
const alertas = computed(() => props.operacao?.robos.filter(r => r.tom === 'falha' || r.tom === 'atencao') ?? [])

async function delegar() {
  if (bloqueio.value) return
  enviando.value = true
  erroDoPedido.value = ''
  try {
    if (ag.squadAtiva.value?.id !== props.squad.id && !await ag.trocarSquad(props.squad.id)) {
      erroDoPedido.value = 'Não foi possível selecionar esta squad. O pedido não foi enviado.'
      return
    }
    const pessoa = pessoas.value.find((p) => p.id === pessoaId.value) ?? props.sala.po
    const texto = pedidoDaSala(props.sala, pessoa, demanda.value)
    pedidoEnviado.value = texto
    await ag.handleDelegation({ demanda: texto, modo: 'auto' })
    if (ag.ultimoPedido.value?.demanda === texto && ag.ultimoPedido.value.estado === 'feito') demanda.value = ''
  } catch (e) {
    erroDoPedido.value = e instanceof Error ? e.message : 'Não foi possível enviar o pedido.'
  } finally { enviando.value = false }
}
</script>

<template>
  <section id="sala-comando" class="sala-comando" tabindex="0" aria-labelledby="sala-comando-titulo">
    <header class="sala-comando__cabeca">
      <div class="sala-comando__sprite"><SpriteDaSala :sprite="pessoaAtual.sprite" :hue="pessoaAtual.hue" :ordem="ordemAtual" /></div>
      <div class="sala-comando__identidade">
      <p class="sobretitulo">{{ squad.nome }} · {{ pessoaAtual.papel }}</p>
      <h3 ref="tituloSala" id="sala-comando-titulo" tabindex="-1">{{ sala.nome }}</h3>
      
      <p v-if="sinalDaConversa" class="texto-2 texto-pequeno" role="status">{{ sinalDaConversa }}</p>
      </div>
    </header>
    <div v-if="alertas.length" class="recado recado--atencao">
      <p v-for="r in alertas" :key="r.id"><strong>{{ r.nome }}</strong> · {{ r.texto }}</p>
      <button type="button" class="botao botao--leve" @click="aba = 'conversa'; mostrarOperacao = true">Conferir operação</button>
    </div>
    <div class="sala-comando__navegacao">
      <button v-if="aba === 'pendencias'" type="button" class="botao botao--leve" @click="aba = 'conversa'">← Voltar a {{ pessoaAtual.nome }}</button>
      <button v-else-if="leads.length" type="button" class="botao botao--leve" @click="aba = 'pendencias'">Conversas de clientes <span class="etiqueta">{{ grupos.length + retomadas.length + futuros.length }}</span></button>
      <span v-if="aba === 'conversa'" class="etiqueta">{{ conversaAtual.pendente.value ? 'Analisando seu pedido' : conversaAtual.enviando.value ? 'Recebendo mensagem' : 'Canal direto com ' + pessoaAtual.nome }}</span>
    </div>
    <div v-if="aba === 'pendencias'" class="sala-comando__corpo">
      <p v-if="!lido" class="recado" role="status">Sem sinal de Vendas: {{ erro || visao?.mensagem || 'aguardando o retrato das planilhas' }}.</p>
      <template v-else>
        <p v-if="erro" class="recado recado--atencao" role="status">A atualização falhou: {{ erro }}. Mostrando o último retrato lido.</p>
        <p v-if="operacao?.jornada?.estado === 'ok' && operacao.jornada.velho" class="recado recado--atencao">Retrato desatualizado. Confira o contexto antes de agir.</p>
        <p v-if="!ajuste && !rascunhoAberto" class="texto-2 texto-pequeno sala-comando__orientacao">Escolha a conversa que precisa avançar. O time observa o andamento nas integrações.</p>
        <AjustarProximoPasso v-if="ajuste && leadDoAjuste" :key="`${ajuste.id}-${ajuste.modo}`" :lead="leadDoAjuste" :modo="ajuste.modo" @registrado="emit('registrado')" @fechar="fecharAjuste" />
        <section v-if="leadDoRascunho && rascunhoAtual" ref="ancoraRascunho" class="sala-comando__rascunho" tabindex="-1" aria-label="Rascunho guardado na sala">
          <h4>Revisar rascunho guardado</h4>
          <RevisarResposta :key="`${leadDoRascunho.id}-${rascunhoAtual.contextoHash}`" :lead="leadDoRascunho" :mensagem="rascunhoAtual.texto" :contexto-hash="rascunhoAtual.contextoHash" :preparada-para="rascunhoAtual.para" @atualizar="emit('registrado')" @ficha="ficha = leadDoRascunho.id" />
          <button type="button" class="botao botao--leve" @click="prepararRetomada(leadDoRascunho.id, futuros.some(p => p.lead.id === leadDoRascunho?.id && p.quando === 'amanha') ? 'amanha' : futuros.some(p => p.lead.id === leadDoRascunho?.id) ? 'resposta' : 'retomada')">Pedir nova preparação ao agente</button>
          <button type="button" class="botao botao--leve" @click="fecharRascunho">Voltar aos próximos passos</button>
        </section>
        <section v-if="retomadas.length && !ajuste && !rascunhoAberto" class="sala-comando__retomadas" aria-label="Próximos passos para hoje e atrasados">
          <h4>Hoje e atrasados · {{ retomadas.length }}</h4>
          <p class="texto-2 texto-pequeno">Próximos passos de hoje e atrasados. Confira o combinado antes de retomar.</p>
          <ol class="sala-comando__lista">
            <li v-for="r in retomadas.slice(0, limiteRetomadas)" :key="r.lead.id" class="sala-comando__item">
              <strong>{{ r.lead.empresa }}</strong><span class="etiqueta">{{ r.quando === 'hoje' ? 'Hoje' : 'Atrasado' }} · {{ r.data.split('-').reverse().join('/') }}</span>
              <p>{{ r.texto }}</p><p v-if="r.conferir" class="texto-2 texto-pequeno">Houve interação depois do plano ou falta a data do registro. Revise o contexto antes de enviar.</p>
              <button v-if="lerRascunhoDaVenda(r.lead)" type="button" class="botao" @click="abrirRascunho(r.lead.id)">Revisar rascunho guardado</button>
              <button v-else type="button" class="botao" @click="prepararRetomada(r.lead.id)">{{ rotuloDoPasso(r.texto) }}</button>
              <div class="sala-comando__botoes"><button type="button" class="botao botao--leve" @click="ajuste = { id: r.lead.id, modo: 'reagendar' }">Reagendar</button></div>
              <a v-if="r.lead.links.whatsapp" :href="r.lead.links.whatsapp" target="_blank" rel="noopener">Ler conversa no WhatsApp ↗</a>
            </li>
          </ol>
          <button v-if="retomadas.length > limiteRetomadas" type="button" class="botao botao--leve" @click="limiteRetomadas += 3">Mostrar mais retornos · {{ retomadas.length - limiteRetomadas }} restantes</button>
        </section>
        <p v-if="!retomadas.length && !ajuste && !rascunhoAberto" class="texto-2 texto-pequeno" role="status">Nenhum próximo passo datado para hoje ou atrasado nesta leitura.</p>
        <template v-if="!ajuste && !rascunhoAberto">
          <section v-for="periodo in periodosFuturos" :key="periodo.chave" class="sala-comando__retomadas" :aria-label="`Próximos passos · ${periodo.titulo}`">
            <h4>{{ periodo.titulo }} · {{ periodo.passos.length }}</h4>
            <p class="texto-2 texto-pequeno">Prepare-se antes. Confira o combinado antes de antecipar contato.</p>
            <ol class="sala-comando__lista">
              <li v-for="p in periodo.passos.slice(0, limiteFuturos[periodo.chave])" :key="p.lead.id" class="sala-comando__item">
                <strong>{{ p.lead.empresa }}</strong><span class="etiqueta">{{ p.data.split('-').reverse().join('/') }}</span><p>{{ p.texto }}</p>
                <p v-if="p.conferir" class="texto-pequeno">Houve interação depois deste plano ou falta a data do registro. Confira o contexto antes de esperar até esse dia.</p>
                <button v-if="lerRascunhoDaVenda(p.lead)" type="button" class="botao" @click="abrirRascunho(p.lead.id)">Revisar rascunho guardado</button>
                <button v-else-if="p.quando === 'amanha'" type="button" class="botao" @click="prepararRetomada(p.lead.id, 'amanha')">{{ rotuloDoPasso(p.texto, true) }}</button>
                <button v-else type="button" class="botao botao--primario" @click="conversarSobre(p.lead.id); focarFluxo()">Conversar sobre este passo</button>
                <p v-if="lerRascunhoDaVenda(p.lead)" class="texto-2 texto-pequeno">Guardado neste aparelho; o contexto será conferido antes de usar.</p>
                <div class="sala-comando__botoes"><button type="button" class="botao botao--leve" @click="ajuste = { id: p.lead.id, modo: 'reagendar' }">Reagendar</button><button v-if="p.quando === 'amanha'" type="button" class="botao botao--leve" @click="conversarSobre(p.lead.id); focarFluxo()">Conversar com {{ pessoaAtual.nome }} sobre este lead</button></div>
                <a v-if="p.lead.links.whatsapp" :href="p.lead.links.whatsapp" target="_blank" rel="noopener">Ler conversa no WhatsApp ↗</a>
              </li>
            </ol>
            <button v-if="periodo.passos.length > limiteFuturos[periodo.chave]" type="button" class="botao botao--leve" @click="limiteFuturos[periodo.chave] += 3">Mostrar mais de {{ periodo.titulo.toLocaleLowerCase() }} · {{ periodo.passos.length - limiteFuturos[periodo.chave] }} restantes</button>
          </section>
          <p v-if="!futuros.length" class="texto-2 texto-pequeno">Nenhum próximo passo futuro registrado nesta sala.</p>
        </template>
        <details v-if="grupos.length && !ajuste && !rascunhoAberto" class="dobra" :open="!retomadas.length && !futuros.length"><summary>Outras pendências · {{ grupos.length }}</summary>
        <ol v-if="grupos.length" class="sala-comando__lista">
          <li v-for="g in grupos" :key="g.principal.leadId">
            <button type="button" class="sala-comando__item" @click="conversarSobre(g.principal.leadId)">
              <strong>{{ g.principal.empresa }}</strong><span>{{ g.principal.titulo }}</span><small>{{ g.principal.porque }}</small>
              <span class="sala-comando__acao">Conversar e agir na sala →</span>
            </button>
            <details v-if="g.acoes.length > 1" class="dobra"><summary>{{ g.acoes.length }} pendências deste lead</summary><p v-for="a in g.acoes" :key="a.chave">{{ a.titulo }} · {{ a.porque }}</p></details>
            
            <a v-if="leads.find(l => l.id === g.principal.leadId)?.links.whatsapp" class="sala-comando__whatsapp" :href="leads.find(l => l.id === g.principal.leadId)!.links.whatsapp" target="_blank" rel="noopener">Ler conversa no WhatsApp<span class="so-leitor"> · {{ g.principal.empresa }}</span> ↗</a>
          </li>
        </ol>
        </details>
        <details v-if="!ajuste && !rascunhoAberto" class="dobra">
          <summary>Consultar todos os leads · {{ leads.length }}</summary>
          <p class="texto-2 texto-pequeno">Inclui os encerrados. O mapa conta os leads em aberto.</p>
          <label class="sala-comando__campo">Buscar empresa <input v-model="busca" type="search" /></label>
          <ul class="sala-comando__lista">
            <li v-for="l in filtrados.slice(0, limite)" :key="l.id"><button type="button" class="sala-comando__item" @click="conversarSobre(l.id)"><strong>{{ l.empresa }}</strong><small>{{ proximoDaJornada(l).acao }}</small><span class="sala-comando__acao">Conversar na sala →</span></button></li>
          </ul>
          <p v-if="!filtrados.length" role="status">Nenhum lead neste recorte.</p>
          <button v-if="filtrados.length > limite" type="button" class="botao botao--leve" @click="limite += 20">Mostrar mais · {{ Math.min(limite, filtrados.length) }} de {{ filtrados.length }}</button>
        </details>
      </template>
    </div>
    <div v-if="pessoas.length > 1 && aba !== 'pendencias'" class="escolhas" role="group" aria-label="Agente da conversa"><button v-for="p in pessoas" :key="p.id" type="button" :aria-pressed="pessoaId === p.id" @click="conversarCom(p.id)">{{ p.nome }}</button></div>
    <aside v-if="leadSelecionado && aba !== 'pendencias'" class="sala-comando__contexto" aria-label="Lead em contexto">
      <p class="texto-2 texto-pequeno">Conversando sobre</p><strong>{{ leadAtual?.empresa ?? 'Lead indisponível no retrato atual' }}</strong>
      <button v-if="leadAtual" type="button" class="botao botao--leve" @click="acompanhar()">Ver acompanhamento do time</button>
      <details><summary>Mais ações deste lead</summary><div class="sala-comando__contexto-acoes">
        <button type="button" class="botao botao--leve" @click="ficha = leadSelecionado">Detalhes do lead</button>
        <a v-if="leadAtual?.links.whatsapp" class="botao botao--leve" :href="leadAtual.links.whatsapp" target="_blank" rel="noopener" aria-label="Ler conversa no WhatsApp" title="Abrir conversa no WhatsApp, sem texto preparado">Ler WhatsApp ↗</a>
        <button type="button" class="botao botao--leve" aria-label="Trocar lead" @click="aba = 'pendencias'">Trocar lead</button>
        <button type="button" class="botao botao--leve" aria-label="Retirar lead da conversa" title="Conversar com o agente sem um lead selecionado" @click="leadSelecionado = null">Conversa geral</button>
      </div></details>
    </aside>
    <details v-if="aba !== 'pendencias' && leadAtual?.proximoPasso?.texto" class="dobra"><summary>Próximo passo atual · {{ leadAtual.proximoPasso.data.split('-').reverse().join('/') }}</summary><p>{{ leadAtual.proximoPasso.texto }}</p><div class="sala-comando__botoes"><button type="button" class="botao botao--leve" @click="ajuste = { id: leadAtual.id, modo: 'reagendar' }; aba = 'pendencias'">Reagendar</button></div></details>
    <section v-show="aba !== 'pendencias'" ref="fluxo" class="sala-comando__fluxo" tabindex="-1" :aria-label="leadAtual ? `Conversa e ações de ${leadAtual.empresa}` : `Conversa com ${pessoaAtual.nome}`">
    <div v-if="aba !== 'pendencias' && leadAtual && acompanhamento?.id === leadAtual.id && acompanhamento.produto === leadAtual.produto" id="andamento-na-sala"><AcompanhamentoObservado :lead="leadAtual" /><button type="button" class="botao botao--leve" @click="voltarParaConversa">Voltar à conversa com o agente</button></div>
    <KeepAlive :max="24"><ConversaDoAgente ref="painelDaConversa" v-show="!acompanhamento || !(acompanhamento.id === leadAtual?.id && acompanhamento.produto === leadAtual?.produto)" v-if="aba !== 'pendencias' && (!leadSelecionado || leadAtual)" :key="JSON.stringify([pessoaAtual.id, leadAtual?.produto, leadSelecionado])" :lead="leadAtual" :squad-id="squad.id" :sala-id="sala.id" :pessoa="pessoaAtual" :trabalho="false" @conversar="aba = 'conversa'" @ficha="ficha = leadSelecionado" @registrado="emit('registrado')" /></KeepAlive>
    </section>
    <details v-if="aba === 'conversa'" class="dobra sala-comando__agenda"><summary>Agenda de {{ pessoaAtual.nome }}<template v-if="blocos.length || proxima"> · {{ blocos.length ? 'há um bloco na última leitura' : 'próximo compromisso' }}</template></summary>
      <template v-if="agendaDaSquad && time">
        <p class="texto-2 texto-pequeno">Google Calendar · leitura em {{ hora(time.lidoEm) }}. Agenda programada não comprova execução.</p>
        <p v-for="(b, i) in blocos" :key="i"><strong>Bloco na última leitura:</strong> {{ b.titulo }}</p>
        <p v-if="proxima"><strong>Próximo compromisso:</strong> {{ proxima.titulo }} · {{ hora(proxima.inicio) }}</p>
        <p v-if="!blocos.length && !proxima" class="texto-2 texto-pequeno">Esta leitura resumida não mostra um compromisso para este agente. Confira a agenda completa para outros horários.</p>
      </template>
      <p v-else class="texto-2">Sem leitura da agenda desta equipe.</p>
      <a class="botao botao--leve" href="/agenda">Conferir agenda completa</a>
    </details>
    <details v-if="aba === 'conversa'" class="dobra"><summary>Agendar ou delegar um trabalho</summary>
    <form class="sala-comando__corpo" @submit.prevent="delegar">
      <label class="sala-comando__campo">Responsável indicado
        <select v-model="pessoaId" :disabled="enviando"><option v-for="p in pessoas" :key="p.id" :value="p.id">{{ p.nome }} · {{ p.papel }}</option></select>
      </label>
      <p class="texto-2 texto-pequeno">{{ pessoas.find(p => p.id === pessoaId)?.escopo }}</p>
      <label class="sala-comando__campo">O que precisa ser feito?
        <textarea v-model="demanda" rows="4" maxlength="2000" :disabled="enviando" placeholder="Descreva o trabalho e o resultado esperado…" required />
      </label>
      <p class="texto-2 texto-pequeno">A equipe organiza o pedido em agenda ou tarefas e pode indicar outro responsável. Delegar não envia mensagens nem executa a venda.</p>
      <button type="submit" class="botao botao--primario" :disabled="bloqueio">{{ enviando ? 'Organizando trabalho…' : 'Delegar trabalho' }}</button>
      <p v-if="ag.isLoading.value && !enviando" role="status">Há um pedido em andamento. Aguarde para delegar outro.</p>
      <p v-if="erroDoPedido" class="recado recado--erro" role="alert">{{ erroDoPedido }}</p>
      <div v-if="ultimo" class="recado" role="status">
        <strong>{{ ultimo.estado === 'rodando' ? 'Pedido em andamento' : ultimo.estado === 'erro' ? 'O pedido encontrou um problema' : 'Pedido processado' }}</strong>
        <p v-for="(linha, i) in ultimo.linhas" :key="i">{{ linha }}</p>
        <p v-for="(problema, i) in ultimo.problemas" :key="`p${i}`">{{ problema }}</p>
        <p v-if="ultimo.propostas">{{ ultimo.propostas }} proposta(s) para revisar nas pendências do escritório.</p>
      </div>
    </form></details>
    <details v-if="aba === 'conversa'" :open="mostrarOperacao" class="dobra"><summary>Operação e integrações</summary><SalaOperacao v-if="operacao" :operacao="operacao" :nome-da-sala="sala.nome" /><p v-else>Sem operação vinculada.</p></details>
    <a class="link-discreto" href="/mais#equipe">Ver equipe e responsabilidades →</a>
    <CrmPanel v-if="ficha" :key="ficha" :ficha-inicial="ficha" @fechar="ficha = null" @registrado="emit('registrado')" />
  </section>
</template>

<style>
.sala-comando__rascunho { display: grid; gap: var(--esp-3); min-width: 0; }
.sala-comando__botoes { display: flex; flex-wrap: wrap; gap: var(--esp-1); }
.sala-comando__retomadas { display: grid; gap: var(--esp-2); min-width: 0; }
.sala-comando__retomadas .sala-comando__item { cursor: default; }
.sala-comando__fluxo { min-width: 0; scroll-margin-top: var(--esp-3); overflow-anchor: none; }
.sala-comando__navegacao { display: flex; align-items: center; flex-wrap: wrap; gap: var(--esp-2); }
.sala-comando__sprite { display: grid; gap: var(--esp-1); border: var(--linha-fina); border-radius: var(--raio-controle); background: var(--superficie); padding: var(--esp-1); cursor: pointer; font: inherit; font-size: var(--tam-mini); color: var(--texto); }
.sala-comando__contexto { display: grid; gap: var(--esp-1); padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); border-radius: var(--raio-controle); overflow-wrap: anywhere; background: var(--superficie-2); }
.sala-comando__contexto-acoes { display: flex; flex-wrap: wrap; gap: var(--esp-1); }
.sala-comando__contexto-acoes .botao { font-size: var(--tam-apoio); padding: var(--esp-1); }
.sala-comando__ajuda { margin-top: var(--esp-1); }
.sala-comando__agenda { display: grid; gap: var(--esp-2); border: var(--linha-fina); border-radius: var(--raio-controle); padding: var(--esp-3); }
.sala-comando { display: grid; gap: var(--esp-3); min-width: 0; align-content: start; }
.sala-comando__cabeca, .sala-comando__corpo { display: grid; gap: var(--esp-2); min-width: 0; }
.sala-comando__cabeca { display: flex; align-items: center; }
.sala-comando__identidade { display: grid; gap: var(--esp-1); min-width: 0; }
.sala-comando h3 { margin: 0; font-size: var(--tam-secao); }
.sala-comando h4 { margin: 0; }
.sala-comando__lista { display: grid; gap: var(--esp-2); list-style: none; padding: 0; margin: 0; }
.sala-comando__item { display: grid; gap: var(--esp-1); width: 100%; min-height: var(--toque); border: var(--linha-fina); border-radius: var(--raio-controle); padding: var(--esp-3); color: var(--texto); background: var(--superficie-2); text-align: left; font: inherit; cursor: pointer; overflow-wrap: anywhere; }
.sala-comando__item:hover { background: var(--hover); }
.sala-comando__item small { color: var(--texto-2); }
.sala-comando__acao { font-weight: var(--peso-forte); text-decoration: underline; }
.sala-comando__whatsapp { display: inline-flex; align-items: center; min-height: var(--toque); padding: var(--esp-1) var(--esp-2); color: var(--texto); font-size: var(--tam-apoio); text-decoration: underline; }
.sala-comando__campo { display: grid; gap: var(--esp-1); font-weight: var(--peso-forte); }
.sala-comando__campo :is(input, select, textarea) { width: 100%; min-width: 0; min-height: var(--toque); border: var(--linha-fina); border-radius: var(--raio-controle); padding: var(--esp-2); background: var(--superficie); color: var(--texto); font: inherit; }
.sala-comando__campo textarea { resize: vertical; }
.sala-comando .dobra[open] { display: grid; gap: var(--esp-2); }
@media (max-width: 63.99rem) { .sala-comando__escopo { display: none; } }
@media (max-width: 63.99rem) {
  .sala-comando__identidade > :first-child, .sala-comando__identidade > :last-child:not(h3) { display: none; }
  .sala-comando__sprite img, .sala-comando__sprite canvas { max-width: 32px; max-height: 32px; }
  .sala-comando__sprite .sprite-da-sala { width: 40px; height: 40px; min-height: 40px; grid-template-rows: minmax(0, 1fr); }
  .sala-comando__sprite .sprite-da-sala__ator { transform: scale(.625); transform-origin: center bottom; }
  .sala-comando__orientacao, .sala-comando__retomadas[aria-label="Próximos passos para hoje e atrasados"] > p { display: none; }
  .sala-comando__cabeca { gap: var(--esp-2); }
  .sala-comando h3 { font-size: var(--tam-texto); }
  .sala-comando__item { gap: var(--esp-1); padding: var(--esp-2); }
}
</style>
