<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import GameMap from '../components/GameMap.vue'
import Sheet from '../components/Sheet.vue'
import LinhaDeProducao from '../office/LinhaDeProducao.vue'
import { movimentosDoEscritorio, pendenciasDaJornada, type FaseDoEscritorio } from '../office/jornada-do-escritorio'
import { estacoesDaProducao, passagensConfirmadas, type PassagemDaProducao } from '../office/linha-de-producao'
import { useMovimentoDoEscritorio } from '../office/movimento'
import type { ResumoCrmEscritorio } from '../office/resumo-crm'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { useSinalDoCrm } from '../casca/sinal-do-crm'
import { useFrente, lerFrente } from '../casca/frente'
import { useAgentes } from '../agentes/estado'
import { useOverview } from '../casca/overview'
import { andarDaCentral, gravarAndar, lerAndar } from '../casca/central'
import type { BalaoDaSala } from '../office/baloes'
import { fonteDoCrm, operacaoDaSala, temOperacao, type OperacaoDaSala } from '../office/operacao'
import { conversasParaConduzir } from '../operations/conversas-para-conduzir'
import { recomendacoesDoTime } from '../operations/recomendacoes-do-time'
import { proximoPassoDoTime } from '../operations/proximo-passo-do-time'
import { filaDaTela, type Resolvidas, type SugestaoDeVenda } from '../operations/proxima-venda'
import type { CrmVisao, CrmLead } from '../operations/types'
import type { ResumoAtendimentoEstamparia } from '../office/modelo'
import type { TimeLido } from '../casca/hoje'
import type { Capacidades } from '../casca/destinos'
import { navegar, interceptarLink } from '../casca/rota'
import '../estilos/operacao.css'

const SalaComando = defineAsyncComponent(() => import('../office/SalaComando.vue'))
const JornadaDoEscritorio = defineAsyncComponent(() => import('../office/JornadaDoEscritorio.vue'))

const props = defineProps<{ capacidades: Capacidades }>()
const ag = useAgentes()
const { roster } = ag
const { overview, resumo } = useOverview()
const { animar:animarEntregas, alternar:alternarEntregas } = useMovimentoDoEscritorio()
const agora = ref(Date.now())
// A fonte substitui o retrato inteiro. Não criar proxies para milhares de mensagens imutáveis.
const visaoDoCrm = shallowRef<CrmVisao | null>(null)
const resumoCrm = shallowRef<ResumoCrmEscritorio | null>(null)
const erroDoCrm = ref('')
const resolvidas = ref<Resolvidas>({})
const timeLido = ref<TimeLido | null>(null)
const pedidoAntigo = new URLSearchParams(window.location.search).get('abrir')
const painel = ref<'agentes' | 'decisoes' | 'agente' | 'acompanhadas' | null>(null)
const pessoaSelecionada = ref<{ salaId: string; pessoaId: string; clique: number } | null>(null)
const clienteDaJornada = ref<string | null>(null)
const faseDaJornada = ref<FaseDoEscritorio | null>(null), estacaoSelecionada = ref<FaseDoEscritorio | null>(null)
function abrirJornada(id?: string) { clienteDaJornada.value = id ?? null; faseDaJornada.value = null; painel.value = 'agentes' }
function abrirEtapa(fase: FaseDoEscritorio) { clienteDaJornada.value = null; faseDaJornada.value = fase; painel.value = 'agentes' }
function abrirAcompanhadas() { clienteDaJornada.value=null;faseDaJornada.value=null;painel.value='acompanhadas' }
const { frente, erro: erroFrente } = useFrente()
const sugestoes = ref<Map<string, SugestaoDeVenda>>(new Map())
const atendimentoEstamparia = shallowRef<ResumoAtendimentoEstamparia | null>(null)
async function lerAtendimentoEstamparia(signal: AbortSignal) {
  try {
    const r=await fetch('/api/operations/crm/estamparia/automacao',{signal,cache:'no-store'})
    if(r.status===404){atendimentoEstamparia.value={modo:'aguarda-ativacao',desde:null,responsavel:'Carla',enviadas:0,incertas:0};return}
    if(!r.ok)throw new Error()
    const estado=await r.json() as ResumoAtendimentoEstamparia
    if(!['respostas','pausado'].includes(estado.modo))throw new Error()
    atendimentoEstamparia.value=estado
  } catch { if(!signal.aborted)atendimentoEstamparia.value={modo:'indisponivel',desde:null,responsavel:'Carla',enviadas:0,incertas:0} }
}
function armazenamento(): Storage | null { try { return window.localStorage } catch { return null } }
async function lerCrm(signal: AbortSignal) {
  try {
    // A esteira visível precisa dos marcos por cliente; outras equipes conservam o resumo compacto.
    const completo = producaoAtiva.value || painel.value !== null
    const r = await fetch(completo ? '/api/operations/crm' : '/api/operations/crm/escritorio', { cache: 'no-cache', signal })
    if (!r.ok) throw new Error('A fonte de vendas não respondeu.')
    const corpo = await r.json()
    if (signal.aborted) return
    if (completo && (producaoAtiva.value || painel.value !== null)) visaoDoCrm.value = corpo
    else if (!completo) resumoCrm.value = corpo
    erroDoCrm.value = ''
  } catch (e) { if (!signal.aborted) erroDoCrm.value = e instanceof Error ? e.message : 'Não foi possível ler as conversas.' }
}
async function lerVenda(signal: AbortSignal) {
  try { const r = await fetch('/api/operations/crm/venda', { cache: 'no-store', signal }); if (r.ok) resolvidas.value = (await r.json()).resolvidas ?? {} } catch { /* Mantém o último retrato. */ }
}
async function lerTime(signal: AbortSignal) {
  if (!props.capacidades.agentes) return
  try { const r = await fetch('/api/time', { signal }); if (r.ok) timeLido.value = await r.json() } catch { /* Não interrompe a conversa. */ }
}
async function lerSugestoes(signal: AbortSignal) {
  if (!producaoAtiva.value && painel.value === null) return
  try {
    const r = await fetch('/api/operations/crm/copiloto/prontas', { cache: 'no-store', signal })
    if (!r.ok) return
    const corpo = await r.json() as { sugestoes?: Record<string, SugestaoDeVenda> }
    sugestoes.value = new Map(Object.entries(corpo.sugestoes ?? {}))
  } catch { /* A fila continua com a leitura observada do WhatsApp. */ }
}
async function lerTudo(signal: AbortSignal) {
  agora.value = Date.now()
  await Promise.allSettled([lerVenda(signal), lerTime(signal), lerFrente(signal), lerSugestoes(signal),lerAtendimentoEstamparia(signal)])
}
useAtualizacaoViva(lerTudo)
const { atualizando, conferidoEm, sincronizar } = useAtualizacaoViva(async signal => {
  agora.value = Date.now()
  await lerCrm(signal)
  return !erroDoCrm.value
}, 15_000)
// Mensagens novas não precisam esperar a consulta das outras integrações.
const { conectado: crmAoVivo } = useSinalDoCrm(sincronizar)
const filaPrioritaria = computed(() => filaDaTela(visaoDoCrm.value, { agora: agora.value, sugestoes: sugestoes.value }, resolvidas.value))
const conversasPrioritarias = computed(() => conversasParaConduzir(visaoDoCrm.value?.leads ?? [], agora.value))
const recomendacoes = computed(() => !erroFrente.value && frente.value?.ativo && frente.value.estado !== 'sem-sinal' ? recomendacoesDoTime({ avaliados: frente.value.avaliados ?? 0, selecionados: frente.value.selecionados ?? 0, enviados: frente.value.enviados ?? 0, setores: frente.value.setores ?? [] }) : [])
const acoesDoCrm = computed(() => erroDoCrm.value || visaoDoCrm.value?.estado !== 'ok' ? [] : filaPrioritaria.value.filter(a => !a.primeiroContato))
const decisoesPendentes = computed(() => pendenciasDaJornada(visaoDoCrm.value?.leads ?? [], acoesDoCrm.value, agora.value))
const movimentos = computed(() => movimentosDoEscritorio(visaoDoCrm.value?.leads ?? [], agora.value))
const fonteProducao = computed(() => fonteDoCrm(visaoDoCrm.value,erroDoCrm.value,agora.value))
const producaoDisponivel = computed(() => fonteProducao.value.estado === 'ok' && !fonteProducao.value.velho && Number.isFinite(Date.parse(visaoDoCrm.value?.geradoEm ?? '')))
const avisoProducao = computed(() => erroDoCrm.value || (!visaoDoCrm.value ? 'Conferindo a linha…' : !producaoDisponivel.value ? 'Última leitura · aguardando atualização' : ''))
const estacoes = computed(() => estacoesDaProducao(visaoDoCrm.value?.leads ?? [],decisoesPendentes.value.map(d => d.lead.id),frente.value,agora.value))
watch(estacoes, lista => { if(estacaoSelecionada.value === null && producaoDisponivel.value) estacaoSelecionada.value=lista.find(e => e.comVoce > 0)?.id ?? lista.find(e=>e.fichas.some(f=>f.situacao==='time'))?.id ?? lista.find(e=>e.fichas.length)?.id ?? 1 })
const passagens = ref<PassagemDaProducao[]>([]), textoTransporte = ref('')
const movimentosAgrupados = ref(0)
// Atualizações da fonte não trocam a estação nem a ficha que o usuário está lendo.
let retratoAnterior: readonly CrmLead[] | null = null
const passagensVistas = new Set<string>()
watch([visaoDoCrm,erroDoCrm,producaoDisponivel], () => {
  if (!producaoDisponivel.value) { retratoAnterior=null; passagens.value=[]; textoTransporte.value=''; return }
  const atuais=visaoDoCrm.value!.leads
  const novas=passagensConfirmadas(retratoAnterior,atuais,agora.value).filter(p => !passagensVistas.has(p.id))
  novas.forEach(p => passagensVistas.add(p.id))
  while(passagensVistas.size > 500) passagensVistas.delete(passagensVistas.values().next().value!)
  const vagas = Math.max(0,6-passagens.value.length)
  movimentosAgrupados.value += Math.max(0,novas.length-vagas)
  passagens.value=[...passagens.value,...novas.slice(0,vagas)]
  retratoAnterior=atuais
})
function terminarPassagem(id: string) { passagens.value=passagens.value.filter(p => p.id !== id) }
const totalDecisoes = computed(() => visaoDoCrm.value ? decisoesPendentes.value.length : resumoCrm.value?.decisoes ?? 0)
const totalConversas = computed(() => visaoDoCrm.value ? conversasPrioritarias.value.length : resumoCrm.value?.conversas ?? 0)
const crmLido = computed(() => !!visaoDoCrm.value || !!resumoCrm.value)
const dellLido = computed(() => overview.value ? resumo.value : null)
const andarEscolhido = ref<string | null>(lerAndar(armazenamento()))
const squads = computed(() => props.capacidades.agentes ? roster.value?.squads ?? [] : [])
const andar = computed(() => squads.value.find(s => s.id === andarDaCentral(squads.value, andarEscolhido.value, salas => temOperacao(salas))) ?? null)
const producaoAtiva = computed(() => andar.value?.dominios.some(d => d.id.startsWith('prumo--')) ?? false)
let controleDoPainel: AbortController | undefined
watch([painel, producaoAtiva], () => {
  controleDoPainel?.abort()
  if (!producaoAtiva.value && painel.value === null) visaoDoCrm.value = null
  void lerTudoDoPainel()
})
async function lerTudoDoPainel() {
  await sincronizar()
  if (producaoAtiva.value || painel.value !== null) {
    const controle = new AbortController()
    controleDoPainel = controle
    await Promise.allSettled([lerVenda(controle.signal), lerSugestoes(controle.signal)])
  }
}
watch(() => andar.value?.id, () => { retratoAnterior=null; passagens.value=[]; textoTransporte.value='';movimentosAgrupados.value=0;passagensVistas.clear() })
function escolherAndar(id: string) { andarEscolhido.value = id; gravarAndar(armazenamento(), id) }
const semAndar = computed(() => ag.erroRoster.value || 'Lendo a equipe…')
const operacoes = computed<Record<string, OperacaoDaSala>>(() => {
  const fontes = { crm: fonteDoCrm(visaoDoCrm.value, erroDoCrm.value, agora.value), dell: overview.value?.dell ?? null, agora: agora.value }
  return Object.fromEntries((andar.value?.dominios ?? []).flatMap(d => { const op = operacaoDaSala(d.id, fontes); return op ? [[d.id, op]] : [] }))
})
const agenteDaMissao = computed(() => squads.value.flatMap(s => s.dominios).find(d => d.id === 'prumo--geral')?.po)
const baloes = computed<Record<string, BalaoDaSala>>(() => totalDecisoes.value && agenteDaMissao.value ? { [agenteDaMissao.value.id]: { texto: 'Sua vez', tom: 'amarelo', destaque: true } } : {})
const guardandoContexto = ref(false)
const passoDoTime = computed(() => proximoPassoDoTime(frente.value, erroFrente.value, agora.value))
const turnoDoTime = computed(() => passoDoTime.value.titulo)
function abrirFichaDaMissao(id: string) { painel.value = null; navegar(`/crm?lead=${encodeURIComponent(id)}&detalhe=ficha`) }
const resumoAgentes = computed(() => ({
  resumo: passoDoTime.value.cliente ? 'Carla · próximo contato' : passoDoTime.value.titulo,
  detalhe: passoDoTime.value.cliente?.empresa ?? passoDoTime.value.pausa ?? passoDoTime.value.acao,
}))
const resumoDecisoes = computed(() => ({
  resumo: erroDoCrm.value ? 'Sem leitura recente' : !crmLido.value ? 'Lendo as conversas…' : `${totalDecisoes.value} na sua vez`,
  detalhe: decisoesPendentes.value[0]?.lead.empresa ?? resumoCrm.value?.primeiraEmpresa ?? recomendacoes.value[0]?.titulo ?? 'Veja os acompanhamentos e resultados',
}))
const estadoSemMissao = computed(() => erroDoCrm.value ? 'Não foi possível conferir suas conversas. O time tentará novamente.' : !crmLido.value ? 'Conferindo o que precisa de você…' : 'Nenhuma conversa pede sua ação agora.')
const salaAberta = computed(() => andar.value?.dominios.find(d => d.id === pessoaSelecionada.value?.salaId) ?? null)
const pessoaAberta = computed(() => salaAberta.value ? [salaAberta.value.po, ...salaAberta.value.integrantes].find(p => p.id === pessoaSelecionada.value?.pessoaId) ?? salaAberta.value.po : null)
function abrirAgente(salaId: string, pessoaId: string) { pessoaSelecionada.value = { salaId, pessoaId, clique: Date.now() }; painel.value = 'agente' }
function aoClicarNoPainel(e: MouseEvent) { interceptarLink(e, props.capacidades); if (e.defaultPrevented) painel.value = null }
const atrasos: number[] = []
function relerDepoisDoRegistro() { void sincronizar(); atrasos.push(window.setTimeout(() => void sincronizar(), 5000), window.setTimeout(() => void sincronizar(), 15000)) }
let relogio = 0
onMounted(() => {
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
  if (pedidoAntigo === 'financas') navegar('/financas')
  if (pedidoAntigo === 'agenda' && props.capacidades.agentes) navegar('/agenda')
})
onBeforeUnmount(() => { controleDoPainel?.abort(); clearInterval(relogio); atrasos.forEach(clearTimeout) })
</script>

<template>
  <div class="central central-imersiva" :class="{ 'central-imersiva--producao': producaoAtiva }">
    <h1 class="so-leitor">Escritório de agentes · Central de comando</h1>
    <header class="central-imersiva__hud">
      <label class="central-imersiva__andar"><span>Escritório</span><select v-if="squads.length" :value="andar?.id" aria-label="Equipe no escritório" @change="escolherAndar(($event.target as HTMLSelectElement).value)"><option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option></select></label>
      <span class="central-imersiva__sinal" role="status">{{ erroDoCrm ? 'Sem leitura recente' : crmAoVivo && conferidoEm ? 'Ao vivo' : conferidoEm ? 'Atualizado' : 'Conectando…' }}<template v-if="conferidoEm"> · {{ new Date(conferidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</template></span>
    </header>
    <GameMap v-if="andar" :key="andar.id" :squad="andar" imersivo :baloes="baloes" :painel-agentes="resumoAgentes" :painel-decisoes="resumoDecisoes" :estacoes-producao="producaoAtiva ? estacoes : undefined" :estacao-selecionada="estacaoSelecionada" :producao-disponivel="producaoDisponivel" :suspenso="!!painel" :passagem="producaoAtiva ? passagens[0] : null" @estacao="estacaoSelecionada = $event" @etapa="abrirEtapa" @cliente="abrirJornada" @passagem-finalizada="terminarPassagem" @transporte="textoTransporte = $event" @painel="clienteDaJornada = null; faseDaJornada = null; painel = $event" @abrir-agente="abrirAgente" />
    <p v-else class="central-imersiva__carregando" role="status">{{ semAndar }}</p>
    <span class="central-imersiva__explorar" aria-hidden="true">↔ Deslize para explorar o escritório</span>
    <LinhaDeProducao v-if="producaoAtiva" :estacoes="estacoes" :selecionada="estacaoSelecionada" :disponivel="producaoDisponivel" :erro="avisoProducao" :ultimo="movimentos[0]" :entrega="textoTransporte" :atendimento-estamparia="atendimentoEstamparia" :agrupadas="movimentosAgrupados" :animar="animarEntregas" @movimento="alternarEntregas" @selecionar="estacaoSelecionada = $event" @etapa="abrirEtapa" @cliente="abrirJornada" @historico="movimentosAgrupados=0;abrirJornada()" @acompanhamentos="abrirAcompanhadas" />

    <Sheet v-if="painel" :bloqueada="guardandoContexto" flutuante :titulo="painel === 'agente' ? pessoaAberta?.nome ?? 'Agente' : 'Jornada do time e clientes'" :subtitulo="painel === 'agente' ? pessoaAberta?.papel : undefined" @fechar="painel = null">
      <div class="central-imersiva__painel" @click="aoClicarNoPainel">
        <JornadaDoEscritorio v-if="painel !== 'agente'" :lead-inicial="clienteDaJornada" :fase-inicial="faseDaJornada" :filtro-inicial="painel === 'acompanhadas' ? 'acompanhadas' : painel === 'decisoes' ? 'voce' : 'tudo'" :frente="frente" :erro-frente="erroFrente" :visao="visaoDoCrm" :erro="erroDoCrm" :acoes="acoesDoCrm" :agora="agora" :agente="agenteDaMissao" :alertas="recomendacoes" :atualizando="atualizando" :conferido-em="conferidoEm" @ficha="abrirFichaDaMissao" @registrado="relerDepoisDoRegistro" @ocupado="guardandoContexto = $event" @atualizar="sincronizar" />
        <SalaComando v-else-if="salaAberta && andar" :key="salaAberta.id" :sala="salaAberta" :squad="andar" :time="timeLido" :conversar="pessoaSelecionada" :visao="visaoDoCrm" :erro="erroDoCrm" :fila="filaPrioritaria" :operacao="operacoes[salaAberta.id]" @registrado="relerDepoisDoRegistro" />
      </div>
    </Sheet>
  </div>
</template>

<style>
.central-imersiva { position: relative; height: 100%; width: 100%; min-width: 0; overflow: hidden; background: #20283a; }
.central-imersiva--producao { display:grid;grid-template-rows:minmax(0,1fr) auto;padding-bottom:calc(var(--toque) + var(--esp-6) + env(safe-area-inset-bottom,0px));box-sizing:border-box; }
.central-imersiva--producao > .mapa { min-height:0; }
.central-imersiva--producao > .linha-producao { position:relative;z-index:4;max-height:48dvh;overflow-y:auto; }
.central-imersiva__hud { position: absolute; z-index: 4; inset: 14px 18px auto; display: flex; justify-content: space-between; gap: var(--esp-3); pointer-events: none; color: #d9e7eb; }
.central-imersiva__andar { display: flex; align-items: center; gap: var(--esp-2); pointer-events: auto; padding: var(--esp-1) var(--esp-2); border: 1px solid #607489; background: #172130ed; border-radius: var(--raio-selo); font-size: var(--tam-mini); font-weight: var(--peso-forte); }
.central-imersiva__andar select { max-width: 12rem; min-height: var(--toque); color: #f9e6a1; background: #223047; border: 0; font: inherit; padding: 0 var(--esp-1); }
.central-imersiva__sinal { align-self: start; padding: var(--esp-2); background: #172130ed; border-radius: var(--raio-selo); font-size: var(--tam-mini); }
.central-imersiva__sinal::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: var(--esp-2); background: #6edbb5; }
.central-imersiva__dica { position: absolute; z-index: 3; bottom: 10px; left: 0; right: 0; margin: 0; text-align: center; color: #c4d1df; font-size: var(--tam-mini); pointer-events: none; }
.central-imersiva__carregando { display: grid; place-content: center; height: 100%; color: #e7ecf0; }
.central-imersiva__painel { min-width: 0; display: grid; gap: var(--esp-4); }
.central-imersiva__painel .sala-comando { padding: 0; border: 0; max-height: none; overflow: visible; }
.central-imersiva__recomendacoes { display: grid; gap: var(--esp-3); }
.central-imersiva__recomendacoes .recado p { margin-top: var(--esp-2); }
.central-imersiva__ofertas { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.central-imersiva__movimentos { position: absolute; z-index: 4; left: var(--esp-4); bottom: calc(var(--toque) * 2 + var(--esp-12)); width: min(25rem, calc(100% - var(--esp-8))); box-sizing: border-box; padding: var(--esp-3); color: #e6eeeb; background: #172130ed; border: 1px solid #607489; border-radius: var(--raio-controle); --texto-2: #c9d9cd; --superficie-2: #223047; --hover: #223047; --contorno-painel: 1px solid #607489; }
.central-imersiva__movimentos > header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-2); font-size: var(--tam-apoio); }
.central-imersiva__movimentos > header button { min-height: var(--toque); border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer; }
@media (max-width: 47.99rem) { .central-imersiva__movimentos { left: var(--esp-2); width: calc(100% - var(--esp-4)); bottom: calc(var(--toque) * 2 + var(--esp-12) + env(safe-area-inset-bottom, 0px)); } .central-imersiva__movimentos .timeline-escritorio li:nth-child(n+2) { display: none; } }
@media (max-width: 47.99rem) { .central-imersiva__hud { inset: 10px 10px auto; } .central-imersiva__andar > span { display: none; } .central-imersiva__dica { padding: 0 var(--esp-4); font-size: var(--tam-mini); } }
.central-imersiva__explorar { display: none; }
.central-imersiva--producao .central-imersiva__explorar { display:none; }
.central-imersiva__turnos { position: absolute; z-index: 4; bottom: calc(var(--toque) + var(--esp-8)); left: var(--esp-4); right: var(--esp-4); display: flex; flex-wrap: wrap; justify-content: center; gap: var(--esp-2); }
.central-imersiva__turnos button, .central-imersiva__sem-missao { display: flex; align-items: center; gap: var(--esp-2); min-height: var(--toque); padding: var(--esp-2) var(--esp-3); border: 1px solid #607489; border-radius: var(--raio-selo); background: #172130ed; color: #d9e7eb; font: inherit; font-size: var(--tam-mini); font-weight: var(--peso-forte); cursor: pointer; }
.central-imersiva__turnos .central-imersiva__sua-vez { background: var(--destaque); color: var(--destaque-texto); border-color: var(--destaque); }
.central-imersiva__ponto { width: 6px; height: 6px; background: #6edbb5; }
@media(max-width:47.99rem) {
  .central-imersiva__turnos { left: var(--esp-2); right: var(--esp-2); bottom: calc(var(--toque) + var(--esp-8) + var(--esp-2) + env(safe-area-inset-bottom, 0px)); }
  .central-imersiva__turnos button { flex: 1; justify-content: center; }
  .central-imersiva__turnos button:first-child { font-size: var(--tam-mini); }
  .central-imersiva__explorar { display: block; position: absolute; top: calc(var(--esp-16) + var(--esp-2)); left: 0; right: 0; text-align: center; color: #d9e7eb; font-size: var(--tam-mini); pointer-events: none; }
}
</style>
