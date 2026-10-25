<script setup lang="ts">
import { destaquesComerciais, planoComercialDoLead } from "../operations/prioridade-comercial"
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { Pessoa } from '../types'
import type { CrmVisao } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import type { recomendacoesDoTime } from '../operations/recomendacoes-do-time'
import { decisoesDoEscritorio, novaRespostaEnviada, respostaJaAtendida, proximaDecisaoPorPrioridade, nomesDasOfertas, type Decisao, type EstadoDaDecisao } from './decisoes'
import MissaoDaConversa from './MissaoDaConversa.vue'
import { avisosPorPrioridade, lerNovasRespostas, type LeituraDasRespostas, type RespostaParaAviso } from './avisos-de-resposta'
import PainelOperacional from '../components/PainelOperacional.vue'
import { orientacaoDoAtendimento } from '../operations/atendimento-cliente'

const props = defineProps<{ visao: CrmVisao | null; erro: string; acoes: AcaoDeVenda[]; conversas?: readonly { lead: import('../operations/types').CrmLead; rotulo: string; prioridade?: number }[]; agora: number; agente?: Pessoa; alertas: ReturnType<typeof recomendacoesDoTime>; atualizando: boolean; conferidoEm: number | null }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; ocupado: [valor: boolean]; atualizar: []; agentes: [] }>()
const filtro = ref<EstadoDaDecisao>('agora'), busca = ref(''), oferta = ref(''), pagina = ref(1)
const selecionada = ref<Decisao | null>(null), ocupado = ref(false)
const interacaoRegistrada = ref(false)
const avancoPendente = shallowRef<{ id: string; leitura: CrmVisao | null; observado?: boolean } | null>(null)
const avisoDoAvanco = ref('')
const respostasParaAvisar = ref<RespostaParaAviso[]>([])
let leituraDasRespostas: LeituraDasRespostas | null = null
const topo = ref<HTMLElement | null>(null)
const decisoes = computed(() => decisoesDoEscritorio(props.visao?.leads ?? [], props.acoes, props.agora, props.conversas))
const preparacoes = computed(() => destaquesComerciais(props.visao?.leads ?? [],props.agora).flatMap(item=>{
  const decisao=decisoes.value.find(d=>d.lead.id===item.leadId&&d.lead.produto===item.produto)
  return decisao?[{...item,decisao,adiada:props.conversas?.some(c=>c.lead.id===item.leadId&&(c.prioridade??0)>=10)??false}]:[]
}))
const dataDaEvidencia=(em:string|null)=>em?new Date(em).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'Data não confirmada'
const avisosDeResposta = computed(() => avisosPorPrioridade(respostasParaAvisar.value, decisoes.value))
function dispensarAviso(id: string) { respostasParaAvisar.value = respostasParaAvisar.value.filter(a => a.id !== id) }
watch([() => props.visao, () => props.atualizando, () => props.erro], () => {
  if (props.erro || props.atualizando || props.visao?.estado !== 'ok') return
  const resultado = lerNovasRespostas(props.visao.leads, leituraDasRespostas, Date.now())
  leituraDasRespostas = resultado.leitura
  const avisos = new Map(respostasParaAvisar.value.map(a => [a.id, a]))
  for (const aviso of resultado.novas) avisos.set(aviso.id, aviso)
  respostasParaAvisar.value = [...avisos.values()]
}, { immediate: true })
const estados = [
  { id: 'agora', nome: 'Precisa de você', curto: 'Precisa de você' },
  { id: 'acompanhando', nome: 'Em acompanhamento', curto: 'Acompanhar' },
  { id: 'encerrada', nome: 'Encerradas', curto: 'Encerradas' },
] as const
const contagens = computed(() => Object.fromEntries(estados.map(e => [e.id, decisoes.value.filter(d => d.estado === e.id).length])))
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
const filtradas = computed(() => decisoes.value.filter(d => d.estado === filtro.value && (!oferta.value || d.lead.produto === oferta.value) && normalizar(d.lead.empresa).includes(normalizar(busca.value.trim()))))
const paginas = computed(() => Math.max(1, Math.ceil(filtradas.value.length / 8)))
const visiveis = computed(() => filtradas.value.slice((pagina.value - 1) * 8, pagina.value * 8))
const clienteNaLeitura = computed(() => props.visao?.leads.some(l => l.id === selecionada.value?.lead.id) ?? false)
const atual = computed<Decisao | null>(() => selecionada.value ? decisoes.value.find(d => d.lead.id === selecionada.value!.lead.id) ?? { ...selecionada.value, acao: null, estado: 'acompanhando', motivo: 'Cliente ausente da leitura atual' } : null)
const atendimentoAtual = computed(() => atual.value ? orientacaoDoAtendimento(atual.value.lead, props.visao?.leads ?? [], props.agora) : undefined)
const indice = computed(() => filtradas.value.findIndex(d => d.lead.id === atual.value?.lead.id))
const proxima = computed(() => proximaDecisaoPorPrioridade(decisoes.value, atual.value?.lead.id))
watch(() => atual.value?.estado, (estado, anterior) => {
  if (anterior === 'agora' && estado && estado !== 'agora') interacaoRegistrada.value = true
  if (estado === 'agora' && anterior !== 'agora') interacaoRegistrada.value = false
})
watch([filtro, busca, oferta], () => { pagina.value = 1 })
watch(paginas, valor => { pagina.value = Math.min(pagina.value, valor) })
async function focarTopo() { await nextTick(); topo.value?.focus(); topo.value?.scrollIntoView({ block: 'start' }) }
function abrir(d: Decisao) { if (ocupado.value) return; avancoPendente.value = null; avisoDoAvanco.value = ''; selecionada.value = d; interacaoRegistrada.value = false; void focarTopo() }
function voltar() { if (ocupado.value) return; avancoPendente.value = null; avisoDoAvanco.value = ''; selecionada.value = null; void focarTopo() }
function mudarOcupado(valor: boolean) { ocupado.value = valor; emit('ocupado', valor) }
function confirmarInteracao() {
  interacaoRegistrada.value = true
  if (atual.value) avancoPendente.value = { id: atual.value.lead.id, leitura: props.visao }
}
watch(() => atual.value?.lead, (lead, anterior) => {
  if (!novaRespostaEnviada(anterior, lead) || !lead || avancoPendente.value) return
  interacaoRegistrada.value = true
  avancoPendente.value = { id: lead.id, leitura: props.visao, observado: true }
})
// A saída observada já veio da releitura; o registro manual ainda precisa aguardar uma nova leitura.
watch([() => props.visao, () => props.atualizando, () => props.erro, ocupado, avancoPendente], () => {
  const pendente = avancoPendente.value
  if (!pendente || ocupado.value || props.atualizando || props.erro || props.visao?.estado !== 'ok' || !pendente.observado && props.visao === pendente.leitura) return
  avancoPendente.value = null
  if (atual.value?.lead.id !== pendente.id) return
  if (pendente.observado && !respostaJaAtendida(atual.value.lead)) { interacaoRegistrada.value = false; return }
  const destino = proximaDecisaoPorPrioridade(decisoes.value, pendente.id)
  if (destino) { abrir(destino); avisoDoAvanco.value = pendente.observado ? 'Resposta detectada no WhatsApp. Próximo cliente aberto por prioridade.' : 'Interação registrada. Próximo cliente aberto por prioridade.' }
}, { flush: 'post' })
const dataDaLeitura = computed(() => props.conferidoEm ? new Date(props.conferidoEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '')
</script>

<template>
  <section class="minhas-decisoes" aria-label="Controle das minhas decisões">
    <div ref="topo" class="minhas-decisoes__topo" tabindex="-1">
      <p class="texto-2 texto-pequeno">{{ dataDaLeitura ? `Última leitura · ${dataDaLeitura}` : 'Conferindo suas decisões…' }}</p>
      <button class="botao botao--leve" type="button" :disabled="atualizando || ocupado" @click="emit('atualizar')">{{ atualizando ? 'Atualizando…' : 'Atualizar' }}</button>
    </div>
    <div v-if="erro || visao?.estado !== 'ok'" class="recado recado--atencao" role="status">{{ erro || visao?.mensagem || 'Carregando as conversas e os próximos passos…' }}<p v-if="visao?.leads.length">Você está vendo a última leitura disponível. Atualize antes de registrar uma decisão.</p></div>
    <aside v-if="avisosDeResposta.length && !erro && visao?.estado === 'ok'" class="minhas-decisoes__avisos" aria-label="Novas respostas no WhatsApp" role="status" aria-live="polite" aria-atomic="false">
      <strong>{{ avisosDeResposta.length === 1 ? 'Nova resposta no WhatsApp' : 'Novas respostas no WhatsApp' }}</strong>
      <ul><li v-for="aviso in avisosDeResposta" :key="aviso.id"><div><strong>{{ aviso.empresa }} respondeu</strong><span>{{ atualizando ? 'Atualizando prioridade…' : `Prioridade ${aviso.posicao} de ${aviso.total} na fila` }}</span></div><button class="botao botao--leve" type="button" :aria-label="`Dispensar aviso de ${aviso.empresa}`" @click="dispensarAviso(aviso.id)">Dispensar</button></li></ul>
      <p v-if="atual" class="texto-pequeno">O atendimento atual continua aberto.</p>
    </aside>

    <template v-if="atual">
      <nav class="minhas-decisoes__navegacao" aria-label="Navegação entre decisões">
        <button type="button" class="botao botao--leve" :disabled="ocupado" @click="voltar">← Voltar à fila</button>
        <span class="texto-2 texto-pequeno">{{ indice >= 0 ? `${indice + 1} de ${filtradas.length} nesta fila` : 'Situação atualizada' }}</span>
        <button v-if="proxima" class="botao botao--leve" type="button" :disabled="ocupado || atualizando" @click="abrir(proxima)">Próxima por prioridade →</button>
      </nav>
      <p v-if="avisoDoAvanco" class="recado recado--ok" role="status">{{ avisoDoAvanco }}</p>
      <p v-if="avancoPendente && !erro" class="texto-2 texto-pequeno" role="status">{{ avancoPendente.observado ? 'Resposta detectada no WhatsApp. Abrindo o próximo cliente…' : 'Interação registrada. Atualizando a fila para abrir o próximo cliente…' }}</p>
      <div v-if="interacaoRegistrada && !avancoPendente" class="minhas-decisoes__proxima" role="status"><div><span class="sobretitulo">{{ atualizando ? 'Atualizando prioridades…' : 'Interação registrada' }}</span><template v-if="proxima"><h3>Próxima: {{ proxima.lead.empresa }}</h3><p>{{ proxima.motivo }}</p></template><template v-else><h3>Nenhuma outra decisão pendente agora.</h3><p>Você pode terminar o acompanhamento deste cliente ou voltar à fila.</p></template></div><button v-if="proxima" class="botao botao--primario" type="button" :disabled="ocupado || atualizando || !!erro || visao?.estado !== 'ok'" @click="abrir(proxima)">Conduzir próxima decisão →</button></div>
      <MissaoDaConversa :key="atual.lead.id" :lead="atual.lead" :orientacao="atendimentoAtual?.plano" :procedimento-inicial="atendimentoAtual?.procedimento" :agente="agente" :disponivel="clienteNaLeitura && !erro && visao?.estado === 'ok'" :registro-disponivel="visao?.registro.disponivel" :motivo="atual.motivo" :acao="atual.acao" :estado="atual.estado" @ficha="emit('ficha', $event)" @interagiu="confirmarInteracao" @registrado="emit('registrado')" @ocupado="mudarOcupado" @fila="voltar" />
      <div v-if="interacaoRegistrada && !avancoPendente && proxima" class="minhas-decisoes__continuar"><p class="texto-2 texto-pequeno">A seguir · {{ proxima.lead.empresa }} · {{ proxima.motivo }}</p><button class="botao botao--primario" type="button" :disabled="ocupado || atualizando || !!erro || visao?.estado !== 'ok'" @click="abrir(proxima)">Conduzir próxima decisão →</button></div>
    </template>
    <template v-else-if="visao?.estado === 'ok' || visao?.leads.length">
      <div class="minhas-decisoes__introducao"><h3>Quem precisa de você agora?</h3><p>Abra um cliente para ver o próximo passo, quando agir e como conduzir a conversa.</p></div>
      <aside v-if="preparacoes.length && !erro && visao?.estado === 'ok'" class="minhas-decisoes__preparacao" aria-label="Preparação para a primeira venda">
        <h3>Preparação para a primeira venda</h3>
        <p class="texto-2 texto-pequeno">Prioridades de revisão interna. O histórico orienta a preparação; qualquer envio depende da sua decisão e das restrições da conversa.</p>
        <ol><li v-for="item in preparacoes" :key="`${item.produto}:${item.leadId}`">
          <button type="button" @click="abrir(item.decisao)"><strong>{{ item.decisao.lead.empresa }}</strong><small v-if="item.adiada">Adiada na fila de hoje · Preparação interna disponível</small><span>{{ item.plano.acao }}</span><small>{{ item.plano.evidencia.estado === 'historica' ? 'Indício histórico' : item.plano.evidencia.estado === 'pendente' ? 'Evidência a conferir' : 'Evidência atual' }} · {{ dataDaEvidencia(item.plano.em) }} · Sem envio automático</small></button>
        </li></ol>
      </aside>
      <div class="minhas-decisoes__estados" role="group" aria-label="Situação das decisões">
        <button v-for="e in estados" :key="e.id" type="button" :aria-label="`${contagens[e.id]} ${e.nome}`" :aria-pressed="filtro === e.id" @click="filtro = e.id"><strong>{{ contagens[e.id] }}</strong><span>{{ e.curto }}</span></button>
      </div>
      <PainelOperacional :titulo="estados.find(e => e.id === filtro)?.nome ?? 'Clientes'" :descricao="`${filtradas.length} ${filtradas.length === 1 ? 'cliente' : 'clientes'} · ${filtro === 'agora' ? 'Respostas e próximos passos em ordem de prioridade.' : filtro === 'acompanhando' ? 'Esperas e combinados para acompanhar.' : 'Resultados e histórico para consultar.'}`">
      <details class="dobra minhas-decisoes__busca"><summary>{{ busca || oferta ? 'Busca e filtros aplicados' : 'Buscar ou filtrar clientes' }}</summary>
      <div class="minhas-decisoes__filtros">
        <label class="rotulo">Buscar cliente<input v-model="busca" class="campo" type="search" placeholder="Nome da empresa" /></label>
        <label class="rotulo">Oferta<select v-model="oferta" class="campo"><option value="">Todas as ofertas</option><option v-for="(nome, id) in nomesDasOfertas" :key="id" :value="id">{{ nome }}</option></select></label>
      </div>
      </details>
      <ol v-if="visiveis.length" class="minhas-decisoes__lista">
        <li v-for="(d, i) in visiveis" :key="d.lead.id">
          <button type="button" :class="{ 'minhas-decisoes__recomendada': filtro === 'agora' && pagina === 1 && i === 0 }" @click="abrir(d)">
            <span class="minhas-decisoes__ordem">{{ (pagina - 1) * 8 + i + 1 }}</span>
            <span class="minhas-decisoes__cliente"><small>{{ nomesDasOfertas[d.lead.produto] }}<template v-if="filtro === 'agora' && pagina === 1 && i === 0"> · Comece por aqui</template></small><strong>{{ d.lead.empresa }}</strong><span>{{ d.motivo }}</span><small v-if="d.lead.atendimentoComercial">{{ planoComercialDoLead(d.lead,agora).resultado }}</small><small v-if="d.lead.proximoPasso && d.estado !== 'encerrada'">Próximo passo · {{ d.lead.proximoPasso.data.split('-').reverse().join('/') }} · {{ d.lead.proximoPasso.texto }}</small></span>
            <span class="minhas-decisoes__abrir">{{ filtro === 'agora' ? 'Conduzir' : 'Consultar' }} <span aria-hidden="true">→</span></span>
          </button>
        </li>
      </ol>
      <div v-else-if="visao?.estado === 'ok' && !erro" class="minhas-decisoes__vazio" role="status"><strong>{{ busca || oferta ? 'Nenhum cliente com estes filtros.' : filtro === 'agora' ? 'Nenhuma decisão pendente agora.' : filtro === 'acompanhando' ? 'Nenhuma conversa em acompanhamento.' : 'Ainda não há conversas encerradas.' }}</strong><p>{{ busca || oferta ? 'Experimente outro nome ou consulte todas as ofertas.' : filtro === 'agora' ? 'Consulte os acompanhamentos e seus próximos passos na aba acima.' : 'Novos registros de Vendas aparecem aqui após a atualização.' }}</p><button v-if="busca || oferta" type="button" class="botao botao--leve" @click="busca = ''; oferta = ''">Limpar filtros</button></div>
      <nav v-if="paginas > 1" class="minhas-decisoes__paginacao" aria-label="Páginas da fila"><button class="botao botao--leve" type="button" :disabled="pagina === 1" @click="pagina--; focarTopo()">← Anterior</button><span>Página {{ pagina }} de {{ paginas }}</span><button class="botao botao--leve" type="button" :disabled="pagina === paginas" @click="pagina++; focarTopo()">Próxima →</button></nav>
      </PainelOperacional>
      <details v-if="alertas.length" class="dobra"><summary>Alertas da prospecção · {{ alertas.length }}</summary><article v-for="a in alertas" :key="a.id" class="recado"><strong>{{ a.titulo }}</strong><p>{{ a.evidencia }}</p><p>{{ a.proximoPasso }}</p></article><button type="button" class="botao botao--leve" @click="emit('agentes')">Ver andamento do time</button></details>
    </template>
  </section>
</template>

<style scoped>
.minhas-decisoes__preparacao { display:grid; gap:var(--esp-3); padding:var(--esp-4); border:var(--divisor); border-radius:var(--raio-controle); background:var(--superficie-2); }
.minhas-decisoes__preparacao ol { display:grid; gap:var(--esp-2); padding:0; margin:0; list-style:none; }
.minhas-decisoes__preparacao button { display:grid; gap:var(--esp-1); width:100%; min-height:var(--toque); padding:var(--esp-3); text-align:left; font:inherit; color:var(--texto); background:var(--superficie); border:var(--divisor); border-radius:var(--raio-controle); cursor:pointer; overflow-wrap:anywhere; }
.minhas-decisoes__preparacao small { color:var(--texto-2); }
.minhas-decisoes { display: grid; gap: var(--esp-4); min-width: 0; }
.minhas-decisoes__topo, .minhas-decisoes__navegacao, .minhas-decisoes__titulo-fila, .minhas-decisoes__paginacao { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-2); }
.minhas-decisoes p, .minhas-decisoes h3 { margin: 0; }
.minhas-decisoes h3 { font-size: var(--tam-secao); }
.minhas-decisoes__avisos { position: sticky; top: 0; z-index: var(--camada-fixa); display: grid; gap: var(--esp-2); padding: var(--esp-3) var(--esp-4); background: var(--realce); border: var(--linha-fina); border-radius: var(--raio-controle); }
.minhas-decisoes__avisos > strong { font-size: var(--tam-apoio); }
.minhas-decisoes__avisos ul { display: grid; gap: var(--esp-2); max-height: min(25dvh, calc(var(--esp-16) * 2)); overflow-y: auto; padding: 0; margin: 0; list-style: none; }
.minhas-decisoes__avisos li { display: flex; align-items: center; justify-content: space-between; gap: var(--esp-3); }
.minhas-decisoes__avisos li > div { display: grid; gap: var(--esp-1); min-width: 0; overflow-wrap: anywhere; }
.minhas-decisoes__avisos li span { font-size: var(--tam-apoio); }
.minhas-decisoes__avisos p { color: var(--texto-2); }
.minhas-decisoes__proxima { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-4); padding: var(--esp-4); background: var(--realce); border-radius: var(--raio-controle); }
.minhas-decisoes__proxima > div { display: grid; gap: var(--esp-2); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.minhas-decisoes__continuar { display: grid; gap: var(--esp-3); border-top: var(--divisor); padding-top: var(--esp-4); }
.minhas-decisoes__introducao { display: grid; gap: var(--esp-3); }
.minhas-decisoes__introducao > p { color: var(--texto-2); }
.minhas-decisoes__introducao ol { display: flex; flex-wrap: wrap; gap: var(--esp-5); padding: 0; margin: 0; list-style: none; font-size: var(--tam-apoio); }
.minhas-decisoes__introducao li { display: flex; align-items: center; gap: var(--esp-2); }
.minhas-decisoes__introducao li strong { display: grid; place-items: center; width: var(--esp-6); height: var(--esp-6); background: var(--superficie-2); border-radius: var(--raio-pilula); }
.minhas-decisoes__estados { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--esp-2); }
.minhas-decisoes__estados button { display: grid; text-align: left; gap: var(--esp-1); border: var(--contorno-painel); border-radius: var(--raio-controle); padding: var(--esp-4); color: var(--texto); background: var(--superficie); font: inherit; cursor: pointer; min-height: var(--toque); }
.minhas-decisoes__estados button[aria-pressed="true"] { background: var(--realce); color: var(--texto); box-shadow: inset 0 -3px 0 var(--destaque); }
.minhas-decisoes__estados strong { font-size: var(--tam-secao); font-variant-numeric: tabular-nums; }
.minhas-decisoes__estados span { font-size: var(--tam-apoio); font-weight: var(--peso-medio); overflow-wrap: anywhere; }
.minhas-decisoes__filtros { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap: var(--esp-3); }
.minhas-decisoes__filtros .rotulo { min-width: 0; }
.minhas-decisoes__filtros .campo { width: 100%; min-width: 0; }
.minhas-decisoes__lista { list-style: none; padding: 0; margin: 0; }
.minhas-decisoes__lista li + li { border-top: var(--divisor); }
.minhas-decisoes__lista button { display: flex; align-items: center; gap: var(--esp-4); padding: var(--esp-4); width: 100%; text-align: left; color: var(--texto); background: transparent; border: 0; border-radius: var(--raio-controle); font: inherit; cursor: pointer; }
.minhas-decisoes__lista button:hover { background: var(--hover); }
.minhas-decisoes__lista button.minhas-decisoes__recomendada { background: var(--realce); }
.minhas-decisoes__ordem { color: var(--texto-2); font-size: var(--tam-apoio); font-variant-numeric: tabular-nums; }
.minhas-decisoes__cliente { display: grid; gap: var(--esp-1); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.minhas-decisoes__cliente strong { font-size: var(--tam-nome); }
.minhas-decisoes__cliente > span, .minhas-decisoes__cliente small { color: var(--texto-2); font-size: var(--tam-apoio); }
.minhas-decisoes__abrir { font-size: var(--tam-apoio); font-weight: var(--peso-forte); flex-shrink: 0; }
.minhas-decisoes__vazio { display: grid; gap: var(--esp-3); padding: var(--esp-6); background: var(--superficie-2); border-radius: var(--raio-controle); }
.minhas-decisoes__busca .minhas-decisoes__filtros { padding-block: var(--esp-3); }
@media (max-width: 47.99rem) { .minhas-decisoes__estados button { padding: var(--esp-2); } .minhas-decisoes__estados span { font-size: var(--tam-mini); } .minhas-decisoes__filtros { grid-template-columns: minmax(0, 1fr); } .minhas-decisoes__lista button { gap: var(--esp-2); padding: var(--esp-3) 0; } .minhas-decisoes__lista button.minhas-decisoes__recomendada { padding: var(--esp-3); } .minhas-decisoes__abrir { font-size: var(--tam-mini); } }
</style>
