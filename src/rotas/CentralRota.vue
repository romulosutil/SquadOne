<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import GameMap from '../components/GameMap.vue'
import Sheet from '../components/Sheet.vue'
import SalaComando from '../office/SalaComando.vue'
import MissaoDaConversa from '../office/MissaoDaConversa.vue'
import FrenteComercial from '../operations/FrenteComercial.vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { useAgentes } from '../agentes/estado'
import { useOverview } from '../casca/overview'
import { andarDaCentral, gravarAndar, lerAndar } from '../casca/central'
import type { BalaoDaSala } from '../office/baloes'
import { fonteDoCrm, operacaoDaSala, temOperacao, type OperacaoDaSala } from '../office/operacao'
import { conversasParaVoce } from '../operations/conversas-para-conduzir'
import { recomendacoesDoTime } from '../operations/recomendacoes-do-time'
import { acaoDoLead, filaDaTela, type Resolvidas, type SugestaoDeVenda } from '../operations/proxima-venda'
import { lerFrente, useFrente } from '../casca/frente'
import type { CrmProduto, CrmVisao } from '../operations/types'
import type { TimeLido } from '../casca/hoje'
import type { Capacidades } from '../casca/destinos'
import { navegar, interceptarLink } from '../casca/rota'
import '../estilos/operacao.css'

const props = defineProps<{ capacidades: Capacidades }>()
const ag = useAgentes()
const { roster } = ag
const { overview, resumo } = useOverview()
const agora = ref(Date.now())
const visaoDoCrm = ref<CrmVisao | null>(null)
const erroDoCrm = ref('')
const resolvidas = ref<Resolvidas>({})
const timeLido = ref<TimeLido | null>(null)
const pedidoAntigo = new URLSearchParams(window.location.search).get('abrir')
const painel = ref<'agentes' | 'decisoes' | 'agente' | null>(null)
const pessoaSelecionada = ref<{ salaId: string; pessoaId: string; clique: number } | null>(null)
// A leitura do time é compartilhada com o painel do FrenteComercial (casca/frente.ts): uma por ciclo.
const { frente, erro: erroFrente } = useFrente()
const sugestoes = ref<Map<string, SugestaoDeVenda>>(new Map())
function armazenamento(): Storage | null { try { return window.localStorage } catch { return null } }
async function lerCrm(signal: AbortSignal) {
  try {
    const r = await fetch('/api/operations/crm', { cache: 'no-cache', signal })
    if (!r.ok) throw new Error('A fonte de vendas não respondeu.')
    visaoDoCrm.value = await r.json(); erroDoCrm.value = ''
  } catch (e) { if (!signal.aborted) erroDoCrm.value = e instanceof Error ? e.message : 'Não foi possível ler as conversas.' }
}
// O "Enviei"/"Pular" do dia vem do servidor (o mesmo arquivo do vendedor do Telegram); sem ele, a lista inteira.
async function lerVenda(signal: AbortSignal) {
  try { const r = await fetch('/api/operations/crm/venda', { cache: 'no-store', signal }); if (r.ok) resolvidas.value = (await r.json()).resolvidas ?? {} } catch { /* Mantém o último retrato. */ }
}
async function lerTime(signal: AbortSignal) {
  if (!props.capacidades.agentes) return
  try { const r = await fetch('/api/time', { signal }); if (r.ok) timeLido.value = await r.json() } catch { /* Não interrompe a conversa. */ }
}
async function lerSugestoes(signal: AbortSignal) {
  try {
    const r = await fetch('/api/operations/crm/copiloto/prontas', { cache: 'no-store', signal })
    if (!r.ok) return
    const corpo = await r.json() as { sugestoes?: Record<string, SugestaoDeVenda> }
    sugestoes.value = new Map(Object.entries(corpo.sugestoes ?? {}))
  } catch { /* A fila continua com a leitura observada do WhatsApp. */ }
}
async function lerTudo(signal: AbortSignal) {
  agora.value = Date.now()
  await Promise.allSettled([lerCrm(signal), lerVenda(signal), lerTime(signal), lerFrente(signal), lerSugestoes(signal)])
  return !erroDoCrm.value
}
const { atualizando, conferidoEm, sincronizar } = useAtualizacaoViva(lerTudo)
const filaPrioritaria = computed(() => filaDaTela(visaoDoCrm.value, { agora: agora.value, sugestoes: sugestoes.value }, resolvidas.value))
// A mesma lista da aba "Conversas para você" de Vendas: conversas, combinados e os passos da fila de venda.
const conversasPrioritarias = computed(() => conversasParaVoce(visaoDoCrm.value, agora.value, resolvidas.value))
const recomendacoes = computed(() => !erroFrente.value && frente.value?.ativo && frente.value.estado !== 'sem-sinal' ? recomendacoesDoTime({ avaliados: frente.value.avaliados ?? 0, selecionados: frente.value.selecionados ?? 0, enviados: frente.value.enviados ?? 0, setores: frente.value.setores ?? [] }) : [])
const ofertas: { id: CrmProduto; nome: string }[] = [
  { id: 'site', nome: 'Site' }, { id: 'prumo', nome: 'PRUMO' }, { id: 'iris', nome: 'Iris' },
  { id: 'plus', nome: 'Plus' }, { id: 'estampa', nome: 'Estamparia' },
]
const acoesDoCrm = computed(() => erroDoCrm.value || visaoDoCrm.value?.estado !== 'ok' ? [] : filaPrioritaria.value.filter(a => !a.primeiroContato))
const proximaAcaoDoCrm = computed(() => acoesDoCrm.value[0] ?? null)
const pendenciasPorOferta = computed(() => ofertas.map(o => ({ ...o, total: acoesDoCrm.value.filter(a => a.produto === o.id).length })))
const totaisDoFunil = computed(() => {
  const leads = visaoDoCrm.value?.estado === 'ok' ? visaoDoCrm.value.leads : []
  return {
    novo: leads.filter(l => l.etapa === 'novo').length,
    contato: leads.filter(l => l.etapa === 'contato').length,
    proposta: leads.filter(l => l.etapa === 'proposta').length,
    ganho: leads.filter(l => l.etapa === 'ganho').length,
    perdido: leads.filter(l => l.etapa === 'perdido').length,
    conversa: leads.filter(l => !!l.conversa?.ultimaEntrada).length,
  }
})
const dellLido = computed(() => overview.value ? resumo.value : null)
const andarEscolhido = ref<string | null>(lerAndar(armazenamento()))
const squads = computed(() => props.capacidades.agentes ? roster.value?.squads ?? [] : [])
const andar = computed(() => squads.value.find(s => s.id === andarDaCentral(squads.value, andarEscolhido.value, salas => temOperacao(salas))) ?? null)
function escolherAndar(id: string) { andarEscolhido.value = id; gravarAndar(armazenamento(), id) }
const semAndar = computed(() => ag.erroRoster.value || 'Lendo a equipe…')
const operacoes = computed<Record<string, OperacaoDaSala>>(() => {
  const fontes = { crm: fonteDoCrm(visaoDoCrm.value, erroDoCrm.value, agora.value), dell: overview.value?.dell ?? null, agora: agora.value }
  return Object.fromEntries((andar.value?.dominios ?? []).flatMap(d => { const op = operacaoDaSala(d.id, fontes); return op ? [[d.id, op]] : [] }))
})
const agenteDaMissao = computed(() => squads.value.flatMap(s => s.dominios).find(d => d.id === 'prumo--geral')?.po)
const baloes = computed<Record<string, BalaoDaSala>>(() => conversasPrioritarias.value.length && agenteDaMissao.value ? { [agenteDaMissao.value.id]: { texto: 'Sua vez', tom: 'amarelo', destaque: true } } : {})
const missaoId = ref<string | null>(null)
const guardandoContexto = ref(false)
watch(painel, p => { if (p === 'decisoes') missaoId.value = conversasPrioritarias.value[0]?.lead.id ?? null })
const leadDaMissao = computed(() => conversasPrioritarias.value.find(m => m.lead.id === missaoId.value)?.lead ?? conversasPrioritarias.value[0]?.lead ?? null)
// A ação da fila de venda para o lead da missão (a mesma da Próxima venda e da Ficha): o cartão mostra o
// passo, a mensagem pronta e o link, em vez de só abrir a conversa.
const acaoDaMissao = computed(() => {
  const item = conversasPrioritarias.value.find(m => m.lead.id === leadDaMissao.value?.id)
  if (item?.acao) return item.acao
  return visaoDoCrm.value?.estado === 'ok' && leadDaMissao.value ? acaoDoLead(visaoDoCrm.value, leadDaMissao.value.id, agora.value, sugestoes.value.get(leadDaMissao.value.id)) : null
})
const motivoDaMissao = computed(() => conversasPrioritarias.value.find(m => m.lead.id === leadDaMissao.value?.id)?.rotulo ?? 'Andamento atualizado')
const turnoDoTime = computed(() => erroFrente.value ? 'Time sem leitura recente' : !frente.value ? 'Lendo o time…' : frente.value.cicloParado ? 'Time ativo, mas o ciclo está parado' : ({ avaliando: 'Turno do time · avaliando', enviando: 'Turno do time · iniciando contato', 'fora-do-horario': 'Fila pronta · próximo expediente', pausado: 'Primeiros contatos pausados', bloqueado: 'Time precisa de atenção', pronto: 'Time acompanhando a fila', concluido: 'Rodada do time concluída' }[frente.value.estado] ?? 'Time acompanhando'))
function abrirFichaDaMissao(id: string) { painel.value = null; navegar(`/crm?lead=${encodeURIComponent(id)}`) }
const resumoAgentes = computed(() => ({
  resumo: erroFrente.value || (frente.value ? `${frente.value.selecionados} selecionados · ${frente.value.enviados} enviados` : 'Lendo o time…'),
  detalhe: erroFrente.value ? 'Aguardando a integração' : frente.value?.cicloParado ? 'Ciclo do time parado' : frente.value?.estado === 'avaliando' ? 'Time avaliando os próximos contatos' : frente.value?.estado === 'pausado' ? 'Primeiros contatos pausados' : frente.value?.fila.find(c => c.estado === 'pronto') ? `Próximo WhatsApp: ${frente.value.fila.find(c => c.estado === 'pronto')!.empresa}` : frente.value?.detalhe ?? 'Decisões e trabalho do time',
}))
const resumoDecisoes = computed(() => ({
  resumo: erroDoCrm.value ? 'Sem leitura recente' : !visaoDoCrm.value ? 'Lendo as conversas…' : `${acoesDoCrm.value.length} ações de Vendas · ${recomendacoes.value.length} alertas da prospecção`,
  detalhe: proximaAcaoDoCrm.value?.titulo ?? recomendacoes.value[0]?.titulo ?? 'Veja o que precisa de você',
}))
const estadoSemMissao = computed(() => erroDoCrm.value ? 'Não foi possível conferir suas conversas. O time tentará novamente.' : !visaoDoCrm.value ? 'Conferindo o que precisa de você…' : 'Nenhuma conversa pede sua ação agora.')
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
onBeforeUnmount(() => { clearInterval(relogio); atrasos.forEach(clearTimeout) })
</script>

<template>
  <div class="central central-imersiva">
    <h1 class="so-leitor">Escritório de agentes · Central de comando</h1>
    <header class="central-imersiva__hud">
      <label class="central-imersiva__andar"><span>Escritório</span><select v-if="squads.length" :value="andar?.id" aria-label="Equipe no escritório" @change="escolherAndar(($event.target as HTMLSelectElement).value)"><option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option></select></label>
      <span class="central-imersiva__sinal" role="status">{{ conferidoEm ? 'Ao vivo' : 'Conectando…' }}<template v-if="conferidoEm"> · {{ new Date(conferidoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }}</template></span>
    </header>
    <GameMap v-if="andar" :key="andar.id" :squad="andar" imersivo :baloes="baloes" :painel-agentes="resumoAgentes" :painel-decisoes="resumoDecisoes" @painel="painel = $event" @abrir-agente="abrirAgente" />
    <p v-else class="central-imersiva__carregando" role="status">{{ semAndar }}</p>
    <span class="central-imersiva__explorar" aria-hidden="true">↔ Deslize para explorar o escritório</span>
    <div class="central-imersiva__turnos"><button type="button" @click="painel = 'agentes'"><span class="central-imersiva__ponto"></span>{{ turnoDoTime }}</button><button v-if="acoesDoCrm.length || conversasPrioritarias.length || recomendacoes.length" class="central-imersiva__sua-vez" type="button" @click="painel = 'decisoes'">{{ acoesDoCrm.length ? `Sua vez · ${acoesDoCrm.length} ${acoesDoCrm.length === 1 ? 'ação de Vendas' : 'ações de Vendas'}` : conversasPrioritarias.length ? `Sua vez · ${conversasPrioritarias.length} ${conversasPrioritarias.length === 1 ? 'conversa' : 'conversas'}` : `${recomendacoes.length} alertas da prospecção` }}</button><span v-else class="central-imersiva__sem-missao">{{ estadoSemMissao }}</span></div>

    <Sheet v-if="painel" :bloqueada="guardandoContexto" flutuante :titulo="painel === 'agentes' ? 'Decisões e andamento dos agentes' : painel === 'decisoes' ? 'Minhas decisões' : pessoaAberta?.nome ?? 'Agente'" :subtitulo="painel === 'agente' ? pessoaAberta?.papel : 'Seu escritório continua ao fundo'" @fechar="painel = null">
      <div class="central-imersiva__painel" @click="aoClicarNoPainel">
        <template v-if="painel === 'agentes'"><FrenteComercial /><p class="texto-2 texto-pequeno">As avaliações, os envios e as respostas vêm das integrações. Abra um agente no escritório para acompanhar seus pedidos e conversar.</p></template>
        <template v-else-if="painel === 'decisoes'"><section v-if="visaoDoCrm?.estado === 'ok' && !erroDoCrm" class="central-imersiva__recomendacoes" aria-label="Prioridade entre ofertas em Vendas"><h2>Fila de Vendas · todas as ofertas</h2><p class="texto-2 texto-pequeno">A prioridade das suas ações usa etapas, respostas, compromissos e a última conversa observada no WhatsApp. O time avalia os novos primeiros contatos nas cinco ofertas.</p><p class="texto-2 texto-pequeno">Funil observado: {{ totaisDoFunil.novo }} novos · {{ totaisDoFunil.contato }} em contato · {{ totaisDoFunil.proposta }} em proposta · {{ totaisDoFunil.ganho }} ganhos · {{ totaisDoFunil.perdido }} perdidos · {{ totaisDoFunil.conversa }} com entrada observada no WhatsApp.</p><div class="central-imersiva__ofertas"><span v-for="o in pendenciasPorOferta" :key="o.id" class="etiqueta">{{ o.nome }} · {{ o.total }} ações</span></div><article v-if="proximaAcaoDoCrm" class="recado"><strong>Próxima ação: {{ proximaAcaoDoCrm.titulo }}</strong><p>{{ proximaAcaoDoCrm.contexto }}</p><p>{{ proximaAcaoDoCrm.porque }}</p><p v-if="proximaAcaoDoCrm.conversa">{{ proximaAcaoDoCrm.conversa }}</p><p v-if="proximaAcaoDoCrm.copiloto">Leitura do copiloto: {{ proximaAcaoDoCrm.copiloto.porque }}</p><p>{{ proximaAcaoDoCrm.tatica }}</p><button class="botao botao--leve" type="button" @click="abrirFichaDaMissao(proximaAcaoDoCrm.leadId)">Abrir ficha</button></article><p v-else class="texto-2 texto-pequeno">Nenhuma conversa ou compromisso da fila geral pede ação agora. Primeiros contatos aguardam a avaliação e o ritmo próprios.</p></section><section v-if="recomendacoes.length" class="central-imersiva__recomendacoes" aria-label="Alertas da prospecção"><h2>Alertas da prospecção</h2><article v-for="r in recomendacoes" :key="r.id" class="recado"><strong>{{ r.titulo }}</strong><p>{{ r.evidencia }}</p><p>{{ r.proximoPasso }}</p></article><button class="botao botao--leve" type="button" @click="painel = 'agentes'">Ver métricas por setor</button></section><MissaoDaConversa v-if="leadDaMissao" :key="leadDaMissao.id" :lead="leadDaMissao" :agente="agenteDaMissao" :disponivel="visaoDoCrm?.registro.disponivel ?? false" :motivo="motivoDaMissao" :acao="acaoDaMissao" @ficha="abrirFichaDaMissao" @registrado="relerDepoisDoRegistro" @ocupado="guardandoContexto = $event" /><p v-else-if="!recomendacoes.length && !proximaAcaoDoCrm && (erroDoCrm || !visaoDoCrm)" class="recado">{{ estadoSemMissao }}</p><details v-if="conversasPrioritarias.length > 1" class="dobra"><summary>Outras missões · {{ conversasPrioritarias.length - 1 }}</summary><button v-for="m in conversasPrioritarias.filter(m => m.lead.id !== leadDaMissao?.id)" :key="m.lead.id" class="botao botao--leve" type="button" @click="missaoId = m.lead.id">{{ m.lead.empresa }}</button></details></template>
        <SalaComando v-else-if="salaAberta && andar" :key="salaAberta.id" :sala="salaAberta" :squad="andar" :time="timeLido" :conversar="pessoaSelecionada" :visao="visaoDoCrm" :erro="erroDoCrm" :fila="filaPrioritaria" :operacao="operacoes[salaAberta.id]" @registrado="relerDepoisDoRegistro" />
      </div>
    </Sheet>
  </div>
</template>

<style>
.central-imersiva { position: relative; height: 100%; width: 100%; min-width: 0; overflow: hidden; background: #20283a; }
.central-imersiva__hud { position: absolute; z-index: 4; inset: 14px 18px auto; display: flex; justify-content: space-between; gap: var(--esp-3); pointer-events: none; color: #d9e7eb; }
.central-imersiva__andar { display: flex; align-items: center; gap: var(--esp-2); pointer-events: auto; padding: var(--esp-1) var(--esp-2); border: 1px solid #607489; background: #172130ed; border-radius: var(--raio-selo); font-size: var(--tam-mini); font-weight: var(--peso-forte); }
.central-imersiva__andar select { max-width: 12rem; min-height: 32px; color: #f9e6a1; background: #223047; border: 0; font: inherit; padding: 0 var(--esp-1); }
.central-imersiva__sinal { align-self: start; padding: var(--esp-2); background: #172130ed; border-radius: var(--raio-selo); font-size: var(--tam-mini); }
.central-imersiva__sinal::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: var(--esp-2); background: #6edbb5; }
.central-imersiva__dica { position: absolute; z-index: 3; bottom: 10px; left: 0; right: 0; margin: 0; text-align: center; color: #c4d1df; font-size: var(--tam-mini); pointer-events: none; }
.central-imersiva__carregando { display: grid; place-content: center; height: 100%; color: #e7ecf0; }
.central-imersiva__painel { min-width: 0; display: grid; gap: var(--esp-4); }
.central-imersiva__painel .sala-comando { padding: 0; border: 0; max-height: none; overflow: visible; }
.central-imersiva__recomendacoes { display: grid; gap: var(--esp-3); }
.central-imersiva__recomendacoes .recado p { margin-top: var(--esp-2); }
.central-imersiva__ofertas { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
@media (max-width: 47.99rem) { .central-imersiva__hud { inset: 10px 10px auto; } .central-imersiva__andar > span { display: none; } .central-imersiva__dica { padding: 0 var(--esp-4); font-size: var(--tam-mini); } }
.central-imersiva__explorar { display: none; }
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
