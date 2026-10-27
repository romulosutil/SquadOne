<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import type { Pessoa } from '../types'
import type { CrmVisao } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import type { recomendacoesDoTime } from '../operations/recomendacoes-do-time'
import { proximoPassoDoTime, type TrabalhoDoTime } from '../operations/proximo-passo-do-time'
import { orientacaoDoAtendimento } from '../operations/atendimento-cliente'
import { fonteDoCrm } from './operacao'
import { FASES_DO_ESCRITORIO, faseDoEscritorio, movimentosDoEscritorio, pendenciasDaJornada, type FaseDoEscritorio, type MovimentoDoEscritorio } from './jornada-do-escritorio'
import TimelineDoEscritorio from './TimelineDoEscritorio.vue'
import MinhasDecisoes from './MinhasDecisoes.vue'
import FrenteComercial from '../operations/FrenteComercial.vue'
import JornadaDoCliente from './JornadaDoCliente.vue'
import { acompanhamentosEstamparia } from './acompanhamento-estamparia'
const props = defineProps<{ visao: CrmVisao | null; erro: string; acoes: AcaoDeVenda[]; agora: number; agente?: Pessoa; alertas: ReturnType<typeof recomendacoesDoTime>; atualizando: boolean; conferidoEm: number | null; frente: TrabalhoDoTime | null; erroFrente?: string; filtroInicial?: 'tudo' | 'voce' | 'acompanhadas'; leadInicial?: string | null; faseInicial?: FaseDoEscritorio | null }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; ocupado: [valor: boolean]; atualizar: [] }>()
const filtro = ref(props.filtroInicial ?? 'tudo'), fase = ref<FaseDoEscritorio | null>(props.faseInicial ?? null), limite = ref(20), cliente = ref<string | null>(props.leadInicial ?? null)
const mostrarOperacao = ref(false)
const raiz = ref<HTMLElement | null>(null)
let posicaoDaFila = 0
watch(cliente, async (id, anterior) => {
  const corpo = raiz.value?.closest<HTMLElement>('.folha__corpo')
  if(id && !anterior) posicaoDaFila = corpo?.scrollTop ?? 0
  await nextTick()
  corpo?.scrollTo({top:id ? 0 : posicaoDaFila,behavior:'auto'})
})
watch(() => props.leadInicial, id => { if (id) cliente.value = id })
watch(() => props.faseInicial, valor => { fase.value=valor ?? null })
watch(() => props.filtroInicial, valor => { filtro.value = valor ?? 'tudo'; fase.value = null; cliente.value = null })
watch([filtro, fase], () => { limite.value = 20 })
const leads = computed(() => props.visao?.leads ?? [])
const acompanhadas = computed(() => acompanhamentosEstamparia(leads.value))
const porId = computed(() => new Map(leads.value.map(l => [l.id, l])))
const clienteEmPreparo = computed(() => cliente.value && porId.value.get(cliente.value)?.etapa === 'novo' ? porId.value.get(cliente.value)! : null)
const pendentes = computed(() => pendenciasDaJornada(leads.value, props.acoes, props.agora))
const idsPendentes = computed(() => pendentes.value.map(d => d.lead.id))
const eventos = computed(() => movimentosDoEscritorio(leads.value, props.agora))
const passo = computed(() => proximoPassoDoTime(props.frente, props.erroFrente, props.agora))
const fonte = computed(() => fonteDoCrm(props.visao, props.erro, props.agora))
const erroAtual = computed(() => props.erro || (fonte.value.estado !== 'ok' ? fonte.value.motivo : fonte.value.velho ? 'Leitura de Vendas desatualizada. Atualize antes de agir.' : ''))
const contagens = computed(() => new Map(FASES_DO_ESCRITORIO.map(f => [f.id, leads.value.filter(l => faseDoEscritorio(l, props.agora) === f.id).length])))
const movimentos = computed(() => {
  if (fase.value && filtro.value === 'tudo') {
    const ultimos = new Map<string, MovimentoDoEscritorio>()
    for (const evento of eventos.value) if (!ultimos.has(evento.leadId)) ultimos.set(evento.leadId, evento)
    return leads.value.filter(l => faseDoEscritorio(l, props.agora) === fase.value).map(lead => {
      const ultimo = ultimos.get(lead.id)
      return { id: `fase:${lead.id}`, leadId: lead.id, empresa: lead.empresa, em: ultimo?.em ?? '', titulo: ultimo ? `Último movimento: ${ultimo.titulo}` : 'Situação atual na fonte; histórico sem data disponível.', setor: `Fase atual · ${FASES_DO_ESCRITORIO.find(f => f.id === fase.value)!.nome}`, fase: fase.value!, responsavel: ultimo?.responsavel }
    })
  }
  const lista: MovimentoDoEscritorio[] = filtro.value === 'tudo' ? eventos.value : pendentes.value.map(d => {
    const plano = orientacaoDoAtendimento(d.lead, leads.value, props.agora).plano
    return { id: `pendente:${d.lead.id}`, leadId: d.lead.id, empresa: d.lead.empresa, em: '', titulo: plano.acao, setor: 'Sua vez', fase: faseDoEscritorio(d.lead, props.agora), responsavel: plano.responsavel }
  })
  return lista.filter(m => !fase.value || porId.value.has(m.leadId) && faseDoEscritorio(porId.value.get(m.leadId)!, props.agora) === fase.value)
})
function abrirCliente(id: string) { cliente.value = id }
</script>
<template>
  <section ref="raiz" class="jornada-escritorio" aria-label="Jornada do time e dos clientes">
    <template v-if="clienteEmPreparo"><button class="botao botao--leve" type="button" @click="cliente = null">← Voltar à jornada</button><h2>{{ clienteEmPreparo.empresa }}</h2><JornadaDoCliente :lead="clienteEmPreparo" :agora="agora" /><p v-if="erroAtual" class="recado recado--atencao">{{ erroAtual }}</p><p>{{ frente?.fila.some(c => c.id === clienteEmPreparo!.id && c.estado === 'pronto') ? 'Na fila de preparação do time. O primeiro contato ainda precisa ser confirmado.' : 'Sem próximo passo de preparação confirmado nesta leitura.' }}</p><button class="botao botao--leve" type="button" @click="emit('ficha', clienteEmPreparo.id)">Consultar ficha</button></template>
    <MinhasDecisoes v-else-if="cliente" :key="cliente" :lead-inicial="cliente" compacto :visao="visao" :erro="erroAtual" :acoes="acoes" :agora="agora" :agente="agente" :alertas="alertas" :atualizando="atualizando" :conferido-em="conferidoEm" @fila="cliente = null" @ficha="emit('ficha', $event)" @registrado="emit('registrado')" @ocupado="emit('ocupado', $event)" @atualizar="emit('atualizar')" @agentes="cliente = null" />
    <template v-else>
      <p v-if="erroAtual" class="recado recado--atencao" role="status">{{ erroAtual }}</p>
      <div v-if="filtro !== 'acompanhadas'" class="jornada-escritorio__time"><span class="sobretitulo">Time agora</span><strong>{{ passo.titulo }}</strong><span v-if="passo.tom === 'atencao'" class="texto-2 texto-pequeno">{{ passo.acao }}</span><span class="texto-2 texto-pequeno">{{ passo.condicao || passo.quando }}</span></div>
      <nav v-if="filtro !== 'acompanhadas'" class="jornada-escritorio__fases" aria-label="Filtrar pela fase atual do cliente"><button v-for="f in FASES_DO_ESCRITORIO" :key="f.id" type="button" :aria-pressed="fase === f.id" @click="fase = fase === f.id ? null : f.id"><span>{{ f.id }}</span><strong>{{ f.nome }}</strong><small>{{ visao ? contagens.get(f.id) : '…' }}</small></button></nav>
      <div class="jornada-escritorio__filtros" role="group" aria-label="Mostrar na jornada"><button class="botao botao--leve" type="button" :aria-pressed="filtro === 'tudo'" @click="filtro = 'tudo'">Últimos movimentos</button><button class="botao botao--leve" type="button" :aria-pressed="filtro === 'voce'" @click="filtro = 'voce'">Sua vez · {{ visao ? pendentes.length : '…' }}</button><button v-if="acompanhadas.length || filtro === 'acompanhadas'" class="botao botao--leve" type="button" :aria-pressed="filtro === 'acompanhadas'" @click="fase=null;filtro='acompanhadas'">Estamparia · {{ acompanhadas.length }} acompanhadas</button><button v-if="fase" class="botao botao--leve" type="button" @click="fase = null">Todas as fases ×</button></div>
      <template v-if="filtro === 'acompanhadas'"><h3>Próximos passos · Estamparia</h3><ul v-if="acompanhadas.length" class="jornada-escritorio__acompanhadas" aria-label="Próximo passo de cada conversa de Estamparia"><li v-for="a in acompanhadas" :key="a.id"><button type="button" @click="abrirCliente(a.id)"><strong>{{ a.empresa }}</strong><small>{{ a.responsavel }}</small><span><b>Próximo passo:</b> {{ a.acao }}</span></button></li></ul><p v-else role="status">Conferindo o acompanhamento das conversas anteriores…</p></template>
      <div v-if="filtro === 'tudo' && pendentes[0] && !fase" class="jornada-escritorio__proxima"><div><span class="sobretitulo">Sua próxima decisão</span><strong>{{ pendentes[0].lead.empresa }}</strong><span>{{ pendentes[0].motivo }}</span></div><button class="botao botao--primario" type="button" @click="abrirCliente(pendentes[0].lead.id)">Continuar jornada →</button></div>
      <TimelineDoEscritorio v-if="filtro !== 'acompanhadas' && movimentos.length" :movimentos="movimentos.slice(0, limite)" :pendentes="idsPendentes" @cliente="abrirCliente" />
      <p v-else-if="filtro !== 'acompanhadas'" class="texto-2" role="status">{{ !visao ? 'Conferindo a jornada…' : filtro === 'voce' ? 'Nenhuma decisão nesta seleção.' : 'Sem movimentos datados nesta seleção. As fases mostram a situação atual, inclusive quando falta histórico.' }}</p>
      <button v-if="filtro !== 'acompanhadas' && movimentos.length > limite" class="botao botao--leve" type="button" @click="limite += 20">Ver movimentos anteriores</button>
      <details class="dobra" @toggle="mostrarOperacao = ($event.target as HTMLDetailsElement).open"><summary>Operação e avaliações do time</summary><FrenteComercial v-if="mostrarOperacao" /></details>
    </template>
  </section>
</template>
<style scoped>
.jornada-escritorio { display: grid; gap: var(--esp-5); min-width: 0; }
.jornada-escritorio__acompanhadas { display:grid;gap:var(--esp-3);list-style:none;padding:0;margin:0; }
.jornada-escritorio__acompanhadas li { min-width:0; }
.jornada-escritorio__acompanhadas button { width:100%;min-height:var(--toque);display:grid;gap:var(--esp-2);text-align:left;border:var(--contorno-painel);border-radius:var(--raio-controle);padding:var(--esp-4);background:var(--superficie);color:var(--texto);font:inherit;cursor:pointer;overflow-wrap:anywhere; }
.jornada-escritorio__acompanhadas small { color:var(--texto-2); }
.jornada-escritorio__acompanhadas button:focus-visible { outline:3px solid var(--destaque);outline-offset:2px; }
.jornada-escritorio__time { display: grid; gap: var(--esp-1); border-bottom: var(--contorno-painel); padding-bottom: var(--esp-4); }
.jornada-escritorio__time > strong { font-size: var(--tam-nome); overflow-wrap: anywhere; }
.jornada-escritorio__fases { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--esp-2); }
.jornada-escritorio__fases button { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: var(--esp-2); min-height: var(--toque); border: var(--contorno-painel); border-radius: var(--raio-controle); padding: var(--esp-3); background: var(--superficie); color: var(--texto); font: inherit; font-size: var(--tam-apoio); text-align: left; cursor: pointer; }
.jornada-escritorio__fases strong { overflow-wrap: anywhere; font-size: var(--tam-apoio); }
.jornada-escritorio__fases button > span { color: var(--texto-2); }
.jornada-escritorio__fases button[aria-pressed='true'], .jornada-escritorio__filtros button[aria-pressed='true'] { background: var(--realce); box-shadow: inset 0 -3px 0 var(--destaque); }
.jornada-escritorio__filtros { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.jornada-escritorio__proxima { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: var(--esp-3); padding: var(--esp-4); border-radius: var(--raio-controle); background: var(--realce); }
.jornada-escritorio__proxima > div { display: grid; gap: var(--esp-1); flex: 1 1 12rem; overflow-wrap: anywhere; }
.jornada-escritorio__proxima strong { font-size: var(--tam-nome); }
.jornada-escritorio__proxima > div > span:last-child { color: var(--texto-2); font-size: var(--tam-apoio); }
@media (max-width: 34rem) { .jornada-escritorio__fases { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
