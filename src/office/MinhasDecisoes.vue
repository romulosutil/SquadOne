<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import type { Pessoa } from '../types'
import type { CrmVisao } from '../operations/types'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import type { recomendacoesDoTime } from '../operations/recomendacoes-do-time'
import { decisoesDoEscritorio, novaRespostaEnviada, respostaJaAtendida, proximaDecisaoPorPrioridade, nomesDasOfertas, type Decisao, type EstadoDaDecisao } from './decisoes'
import MissaoDaConversa from './MissaoDaConversa.vue'

const props = defineProps<{ visao: CrmVisao | null; erro: string; acoes: AcaoDeVenda[]; conversas?: readonly { lead: import('../operations/types').CrmLead; rotulo: string }[]; agora: number; agente?: Pessoa; alertas: ReturnType<typeof recomendacoesDoTime>; atualizando: boolean; conferidoEm: number | null }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; ocupado: [valor: boolean]; atualizar: []; agentes: [] }>()
const filtro = ref<EstadoDaDecisao>('agora'), busca = ref(''), oferta = ref(''), pagina = ref(1)
const selecionada = ref<Decisao | null>(null), ocupado = ref(false)
const interacaoRegistrada = ref(false)
const avancoPendente = shallowRef<{ id: string; leitura: CrmVisao | null; observado?: boolean } | null>(null)
const avisoDoAvanco = ref('')
const topo = ref<HTMLElement | null>(null)
const decisoes = computed(() => decisoesDoEscritorio(props.visao?.leads ?? [], props.acoes, props.agora, props.conversas))
const estados = [
  { id: 'agora', nome: 'Precisa de você' },
  { id: 'acompanhando', nome: 'Em acompanhamento' },
  { id: 'encerrada', nome: 'Encerradas' },
] as const
const contagens = computed(() => Object.fromEntries(estados.map(e => [e.id, decisoes.value.filter(d => d.estado === e.id).length])))
const normalizar = (texto: string) => texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR')
const filtradas = computed(() => decisoes.value.filter(d => d.estado === filtro.value && (!oferta.value || d.lead.produto === oferta.value) && normalizar(d.lead.empresa).includes(normalizar(busca.value.trim()))))
const paginas = computed(() => Math.max(1, Math.ceil(filtradas.value.length / 8)))
const visiveis = computed(() => filtradas.value.slice((pagina.value - 1) * 8, pagina.value * 8))
const clienteNaLeitura = computed(() => props.visao?.leads.some(l => l.id === selecionada.value?.lead.id) ?? false)
const atual = computed<Decisao | null>(() => selecionada.value ? decisoes.value.find(d => d.lead.id === selecionada.value!.lead.id) ?? { ...selecionada.value, acao: null, estado: 'acompanhando', motivo: 'Cliente ausente da leitura atual' } : null)
const indice = computed(() => filtradas.value.findIndex(d => d.lead.id === atual.value?.lead.id))
const proxima = computed(() => proximaDecisaoPorPrioridade(decisoes.value, atual.value?.lead.id))
watch(() => atual.value?.estado, (estado, anterior) => { if (anterior === 'agora' && estado && estado !== 'agora') interacaoRegistrada.value = true })
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
const dataDaLeitura = computed(() => props.visao?.geradoEm ? new Date(props.visao.geradoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : props.conferidoEm ? new Date(props.conferidoEm).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }) : '')
</script>

<template>
  <section class="minhas-decisoes" aria-label="Controle das minhas decisões">
    <div ref="topo" class="minhas-decisoes__topo" tabindex="-1">
      <p class="texto-2 texto-pequeno">{{ dataDaLeitura ? `Última leitura · ${dataDaLeitura}` : 'Conferindo suas decisões…' }}</p>
      <button class="botao botao--leve" type="button" :disabled="atualizando || ocupado" @click="emit('atualizar')">{{ atualizando ? 'Atualizando…' : 'Atualizar' }}</button>
    </div>
    <div v-if="erro || visao?.estado !== 'ok'" class="recado recado--atencao" role="status">{{ erro || visao?.mensagem || 'Carregando as conversas e os próximos passos…' }}<p v-if="visao?.leads.length">Você está vendo a última leitura disponível. Atualize antes de registrar uma decisão.</p></div>

    <template v-if="atual">
      <nav class="minhas-decisoes__navegacao" aria-label="Navegação entre decisões">
        <button type="button" class="botao botao--leve" :disabled="ocupado" @click="voltar">← Voltar à fila</button>
        <span class="texto-2 texto-pequeno">{{ indice >= 0 ? `${indice + 1} de ${filtradas.length} nesta fila` : 'Situação atualizada' }}</span>
        <button v-if="proxima" class="botao botao--leve" type="button" :disabled="ocupado || atualizando" @click="abrir(proxima)">Próxima por prioridade →</button>
      </nav>
      <p v-if="avisoDoAvanco" class="recado recado--ok" role="status">{{ avisoDoAvanco }}</p>
      <p v-if="avancoPendente && !erro" class="texto-2 texto-pequeno" role="status">{{ avancoPendente.observado ? 'Resposta detectada no WhatsApp. Abrindo o próximo cliente…' : 'Interação registrada. Atualizando a fila para abrir o próximo cliente…' }}</p>
      <div v-if="interacaoRegistrada && !avancoPendente" class="minhas-decisoes__proxima" role="status"><div><span class="sobretitulo">{{ atualizando ? 'Atualizando prioridades…' : 'Interação registrada' }}</span><template v-if="proxima"><h3>Próxima: {{ proxima.lead.empresa }}</h3><p>{{ proxima.motivo }}</p></template><template v-else><h3>Nenhuma outra decisão pendente agora.</h3><p>Você pode terminar o acompanhamento deste cliente ou voltar à fila.</p></template></div><button v-if="proxima" class="botao botao--primario" type="button" :disabled="ocupado || atualizando || !!erro || visao?.estado !== 'ok'" @click="abrir(proxima)">Conduzir próxima decisão →</button></div>
      <MissaoDaConversa :key="atual.lead.id" :lead="atual.lead" :agente="agente" :disponivel="clienteNaLeitura && !erro && visao?.estado === 'ok' && visao.registro.disponivel" :motivo="atual.motivo" :acao="atual.acao" :estado="atual.estado" @ficha="emit('ficha', $event)" @interagiu="confirmarInteracao" @registrado="emit('registrado')" @ocupado="mudarOcupado" @fila="voltar" />
      <div v-if="interacaoRegistrada && !avancoPendente && proxima" class="minhas-decisoes__continuar"><p class="texto-2 texto-pequeno">A seguir · {{ proxima.lead.empresa }} · {{ proxima.motivo }}</p><button class="botao botao--primario" type="button" :disabled="ocupado || atualizando || !!erro || visao?.estado !== 'ok'" @click="abrir(proxima)">Conduzir próxima decisão →</button></div>
    </template>
    <template v-else-if="visao?.estado === 'ok' || visao?.leads.length">
      <div class="minhas-decisoes__introducao"><h3>Uma decisão por vez.</h3><p>Escolha um cliente, entenda o contexto e siga até registrar o que aconteceu.</p><ol aria-label="Como conduzir uma decisão"><li><strong>1</strong> Entender</li><li><strong>2</strong> Agir</li><li><strong>3</strong> Acompanhar</li></ol></div>
      <div class="minhas-decisoes__estados" role="group" aria-label="Situação das decisões">
        <button v-for="e in estados" :key="e.id" type="button" :aria-pressed="filtro === e.id" @click="filtro = e.id"><strong>{{ contagens[e.id] }}</strong><span>{{ e.nome }}</span></button>
      </div>
      <div class="minhas-decisoes__filtros">
        <label class="rotulo">Buscar cliente<input v-model="busca" class="campo" type="search" placeholder="Nome da empresa" /></label>
        <label class="rotulo">Oferta<select v-model="oferta" class="campo"><option value="">Todas as ofertas</option><option v-for="(nome, id) in nomesDasOfertas" :key="id" :value="id">{{ nome }}</option></select></label>
      </div>
      <div class="minhas-decisoes__titulo-fila"><h3>{{ estados.find(e => e.id === filtro)?.nome }}</h3><span class="texto-2 texto-pequeno">{{ filtradas.length }} {{ filtradas.length === 1 ? 'cliente' : 'clientes' }}</span></div>
      <p v-if="filtro === 'agora' && filtradas.length" class="texto-2 texto-pequeno">A ordem considera respostas e próximos passos. Comece pelo primeiro cliente.</p>
      <p v-else-if="filtro === 'acompanhando'" class="texto-2 texto-pequeno">Conversas em espera e próximos passos planejados. Abra para consultar ou ajustar o acompanhamento.</p>
      <p v-else-if="filtro === 'encerrada'" class="texto-2 texto-pequeno">Resultados registrados em Vendas. O histórico de cada cliente continua disponível.</p>
      <ol v-if="visiveis.length" class="minhas-decisoes__lista">
        <li v-for="(d, i) in visiveis" :key="d.lead.id">
          <button type="button" :class="{ 'minhas-decisoes__recomendada': filtro === 'agora' && pagina === 1 && i === 0 }" @click="abrir(d)">
            <span class="minhas-decisoes__ordem">{{ (pagina - 1) * 8 + i + 1 }}</span>
            <span class="minhas-decisoes__cliente"><small>{{ nomesDasOfertas[d.lead.produto] }}<template v-if="filtro === 'agora' && pagina === 1 && i === 0"> · Comece por aqui</template></small><strong>{{ d.lead.empresa }}</strong><span>{{ d.motivo }}</span><small v-if="d.lead.proximoPasso && d.estado !== 'encerrada'">Próximo passo · {{ d.lead.proximoPasso.data.split('-').reverse().join('/') }} · {{ d.lead.proximoPasso.texto }}</small></span>
            <span class="minhas-decisoes__abrir">{{ filtro === 'agora' ? 'Conduzir' : 'Consultar' }} <span aria-hidden="true">→</span></span>
          </button>
        </li>
      </ol>
      <div v-else-if="visao?.estado === 'ok' && !erro" class="minhas-decisoes__vazio" role="status"><strong>{{ busca || oferta ? 'Nenhum cliente com estes filtros.' : filtro === 'agora' ? 'Nenhuma decisão pendente agora.' : filtro === 'acompanhando' ? 'Nenhuma conversa em acompanhamento.' : 'Ainda não há conversas encerradas.' }}</strong><p>{{ busca || oferta ? 'Experimente outro nome ou consulte todas as ofertas.' : filtro === 'agora' ? 'Consulte os acompanhamentos e seus próximos passos na aba acima.' : 'Novos registros de Vendas aparecem aqui após a atualização.' }}</p><button v-if="busca || oferta" type="button" class="botao botao--leve" @click="busca = ''; oferta = ''">Limpar filtros</button></div>
      <nav v-if="paginas > 1" class="minhas-decisoes__paginacao" aria-label="Páginas da fila"><button class="botao botao--leve" type="button" :disabled="pagina === 1" @click="pagina--; focarTopo()">← Anterior</button><span>Página {{ pagina }} de {{ paginas }}</span><button class="botao botao--leve" type="button" :disabled="pagina === paginas" @click="pagina++; focarTopo()">Próxima →</button></nav>
      <details v-if="alertas.length" class="dobra"><summary>Alertas da prospecção · {{ alertas.length }}</summary><article v-for="a in alertas" :key="a.id" class="recado"><strong>{{ a.titulo }}</strong><p>{{ a.evidencia }}</p><p>{{ a.proximoPasso }}</p></article><button type="button" class="botao botao--leve" @click="emit('agentes')">Ver andamento do time</button></details>
    </template>
  </section>
</template>

<style scoped>
.minhas-decisoes { display: grid; gap: var(--esp-4); min-width: 0; }
.minhas-decisoes__topo, .minhas-decisoes__navegacao, .minhas-decisoes__titulo-fila, .minhas-decisoes__paginacao { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-2); }
.minhas-decisoes p, .minhas-decisoes h3 { margin: 0; }
.minhas-decisoes h3 { font-size: var(--tam-secao); }
.minhas-decisoes__proxima { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-4); padding: var(--esp-4); background: var(--realce); border-radius: var(--raio-controle); }
.minhas-decisoes__proxima > div { display: grid; gap: var(--esp-2); flex: 1; min-width: 0; overflow-wrap: anywhere; }
.minhas-decisoes__continuar { display: grid; gap: var(--esp-3); border-top: var(--divisor); padding-top: var(--esp-4); }
.minhas-decisoes__introducao { display: grid; gap: var(--esp-3); }
.minhas-decisoes__introducao > p { color: var(--texto-2); }
.minhas-decisoes__introducao ol { display: flex; flex-wrap: wrap; gap: var(--esp-5); padding: 0; margin: 0; list-style: none; font-size: var(--tam-apoio); }
.minhas-decisoes__introducao li { display: flex; align-items: center; gap: var(--esp-2); }
.minhas-decisoes__introducao li strong { display: grid; place-items: center; width: var(--esp-6); height: var(--esp-6); background: var(--superficie-2); border-radius: var(--raio-pilula); }
.minhas-decisoes__estados { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--esp-2); }
.minhas-decisoes__estados button { display: grid; text-align: left; gap: var(--esp-1); border: 0; border-radius: var(--raio-controle); padding: var(--esp-4); color: var(--texto); background: var(--superficie-2); font: inherit; cursor: pointer; min-height: var(--toque); }
.minhas-decisoes__estados button[aria-pressed="true"] { background: var(--destaque); color: var(--destaque-texto); box-shadow: inset 0 0 0 var(--linha-espessura) var(--borda); }
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
@media (max-width: 47.99rem) { .minhas-decisoes__estados button { padding: var(--esp-3); } .minhas-decisoes__estados span { font-size: var(--tam-mini); } .minhas-decisoes__filtros { grid-template-columns: minmax(0, 1fr); } .minhas-decisoes__lista button { gap: var(--esp-2); padding: var(--esp-3) 0; } .minhas-decisoes__lista button.minhas-decisoes__recomendada { padding: var(--esp-3); } .minhas-decisoes__abrir { font-size: var(--tam-mini); } }
</style>
