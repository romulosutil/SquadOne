<script setup lang="ts">
/**
 * Mais (/mais): o que não cabe na barra inferior (RULES 13: dashboards e detalhe moram fora da
 * Hoje). Desde 16/10/2026 em três grupos, pelo motivo de abrir ("pra que tem isso aqui?" era a
 * pergunta de quem via uma lista de sete coisas iguais):
 *  - Usar: o que se abre no dia a dia;
 *  - Entender: como a operação funciona, fechado até pedir;
 *  - Manutenção: ferramentas, o que o Dell confere e o design system, fechado.
 * Saiu o link "Agentes do SquadOne (ainda no Easypanel)": nesta Central ele dava 404.
 * Ainda em 16/10/2026 (OT-11 do blueprint de serviço, "menos entradas repetidas no menu"): o
 * Usar repetia destinos que a barra já mostrava. Agora vem de `atalhosDoMais`, só o que a barra
 * DESTA tela não alcança: no desktop o trilho lateral tem tudo e o grupo some; no celular sobram
 * Agenda, Escritório e Entrada. Lançamentos saiu: é aba de Finanças, um toque depois dela.
 * Os painéis da Central usam mais.css, só com tokens.
 * 17/10/2026 (auditoria da Central): o Roteiro de venda saiu das abas de Vendas e mora no
 * Entender (AC-20; `/crm?ver=roteiro` manda para `?abrir=roteiro`), e o "Desconectar o Google"
 * saiu da Agenda para a Manutenção (AC-25): raro e derruba a agenda inteira.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AccessPanel from '../operations/AccessPanel.vue'
import ComoFuncionaPanel from '../operations/ComoFuncionaPanel.vue'
import CrmColinha from '../operations/CrmColinha.vue'
import DellConferePanel from '../operations/DellConferePanel.vue'
import { useOverview } from '../casca/overview'
import { atalhosDoMais, type Capacidades, type Destino } from '../casca/destinos'
import { useAgentes } from '../agentes/estado'
import { conectado } from '../auth/google'
import { secaoDoMais } from '../casca/mais'
import '../operations/mais.css'
// O roteiro usa as peças do CRM (crm-colinha, crm-trecho...): sem o crm.css ele sairia cru aqui.
import '../operations/crm.css'

const props = defineProps<{ capacidades: Capacidades }>()
const { overview, resumo } = useOverview()
const ops = computed(() => props.capacidades.perfil === 'operations')

// A mesma pergunta da casca (casca.css e App.vue): a partir de 64rem quem navega é o trilho
// lateral. Acompanha o giro do tablet e a janela redimensionada, senão o Usar ficaria errado
// até recarregar.
const consulta = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 64rem)') : null
const largo = ref(consulta?.matches ?? false)
const aoMudarLargura = (e: MediaQueryListEvent) => (largo.value = e.matches)
onMounted(() => {
  consulta?.addEventListener('change', aoMudarLargura)
  // O link "Ver em Mais › Manutenção" da Hoje e o "Roteiro" de Vendas: a navegação sobe a página
  // antes de montar esta rota, então rolar até a seção fica para depois de ela existir.
  if (pedeManutencao) void nextTick(() => document.getElementById('manutencao')?.scrollIntoView({ block: 'start' }))
  if (pedeRoteiro) void nextTick(() => document.getElementById('roteiro')?.scrollIntoView({ block: 'start' }))
})
onBeforeUnmount(() => {
  consulta?.removeEventListener('change', aoMudarLargura)
  window.clearTimeout(desarmar)
})

const DICA: Partial<Record<Destino['id'], string>> = {
  agenda: 'os compromissos que os agentes marcaram, e a conexão com o Google',
  escritorio: 'squads, salas e quem trabalha em cada uma (lista ou mapa)',
  entrada: 'mande um texto ou arquivo e a Mel guarda no lugar certo',
}
const usar = computed(() =>
  atalhosDoMais(props.capacidades, largo.value).map((d) => ({ href: d.href, rotulo: d.rotulo, dica: DICA[d.id] ?? '' }))
)
const pedido = secaoDoMais(window.location.search)
const pedeFluxo = pedido.fluxo
/** `?abrir=manutencao`: a Hoje manda para cá com a seção e a lista do Dell já abertas (AC-17). */
const pedeManutencao = pedido.abrir === 'manutencao'
/** `?abrir=roteiro`: o antigo `/crm?ver=roteiro` (AC-20) abre o Entender com o roteiro à mostra. */
const pedeRoteiro = pedido.abrir === 'roteiro'
// O roteiro é longo (cardápio, momentos, objeções, CDL): só monta quando a dobra abre.
const roteiroAberto = ref(pedeRoteiro)
const aoAlternarRoteiro = (e: Event) => {
  if ((e.target as HTMLDetailsElement).open) roteiroAberto.value = true
}

// Desconectar o Google (AC-25): só com a agenda neste processo e a conexão de pé. Segundo toque
// no próprio botão, sem confirm() (o celular o mostra fora do app); arma e desarma em 6 s.
const ag = props.capacidades.agentes ? useAgentes() : null
const armadoDesconectar = ref(false)
const desconectando = ref(false)
let desarmar = 0
const desconectarGoogle = async () => {
  if (!ag || desconectando.value) return
  if (!armadoDesconectar.value) {
    armadoDesconectar.value = true
    window.clearTimeout(desarmar)
    desarmar = window.setTimeout(() => (armadoDesconectar.value = false), 6000)
    return
  }
  window.clearTimeout(desarmar)
  armadoDesconectar.value = false
  desconectando.value = true
  try {
    await ag.desconectarGoogle()
  } finally {
    desconectando.value = false
  }
}
// O mesmo número da Hoje e do topo (resumoDoDell): abre quando algo precisa do Rômulo, não só
// no vermelho, e quando o retrato parou de chegar (RULES 19: aí o detalhe é o que se tem).
const avisoDoDell = computed(() => {
  if (!ops.value || !overview.value) return ''
  const r = resumo.value
  if (r.semNoticia) return r.textoPrecisam
  return r.precisam.length ? `${r.precisam.length} ${r.precisam.length === 1 ? 'precisa' : 'precisam'} de você` : ''
})
</script>

<template>
  <div class="mais">
    <section class="mais__bloco" aria-labelledby="mais-titulo">
      <h1 id="mais-titulo">Mais</h1>
      <template v-if="usar.length">
        <h2 class="mais__grupo">Usar</h2>
        <ul class="mais__links">
          <li v-for="l in usar" :key="l.href">
            <a :href="l.href"><strong>{{ l.rotulo }}</strong><small v-if="l.dica">{{ l.dica }}</small></a>
          </li>
        </ul>
      </template>
    </section>

    <!-- O link do robô do Escritório (?fluxo=&passo=) abre direto no fluxo dele. -->
    <details v-if="ops" class="mais__bloco mais__dobra" :open="pedeFluxo || pedeRoteiro">
      <summary><span class="mais__grupo">Entender</span><small>como a operação funciona e o roteiro de venda</small></summary>
      <ComoFuncionaPanel :checks="overview?.dell.verificacoes ?? []" />
      <!-- O roteiro inteiro, sem lead: só para consultar e copiar, nunca abre o WhatsApp (AC-20). -->
      <details id="roteiro" class="dobra mais__roteiro" :open="pedeRoteiro" @toggle="aoAlternarRoteiro">
        <summary>Roteiro de venda <small>o que dizer em cada momento, objeções e o cardápio</small></summary>
        <div v-if="roteiroAberto" class="crm-na-folha">
          <CrmColinha produto="todos" />
        </div>
      </details>
    </details>

    <details id="manutencao" class="mais__bloco mais__dobra" :open="pedeManutencao || !!avisoDoDell">
      <summary>
        <span class="mais__grupo">Manutenção</span>
        <small>ferramentas do Dell, o que ele confere<template v-if="avisoDoDell"> ({{ avisoDoDell }})</template><template v-if="ag && conectado">, a conexão com o Google</template> e o design system</small>
      </summary>
      <div class="mais__ops">
        <AccessPanel v-if="ops" :tools="overview?.tools ?? []" />
        <DellConferePanel v-if="ops" :status="overview?.dell ?? null" :resumo="resumo" :aberto="pedeManutencao" />
        <section v-if="ag && conectado" class="mais__google" aria-labelledby="mais-google-titulo">
          <h2 id="mais-google-titulo" class="mais__grupo">Conexão com o Google</h2>
          <p class="texto-2">Desconectar revoga o acesso no Google: a agenda para de ler e de marcar até você conectar de novo pela Agenda.</p>
          <div class="acoes">
            <button
              type="button"
              class="botao botao--perigo"
              :class="{ 'is-armado': armadoDesconectar }"
              :disabled="desconectando"
              @click="desconectarGoogle"
            >
              {{ desconectando ? 'Desconectando…' : armadoDesconectar ? 'Toque de novo para desconectar' : 'Desconectar o Google' }}
            </button>
            <button v-if="armadoDesconectar" type="button" class="botao botao--leve" @click="armadoDesconectar = false">Cancelar</button>
          </div>
        </section>
        <ul class="mais__links">
          <li><a href="/design-system"><strong>Design system</strong><small>tokens e peças do app, para quem mexe no visual</small></a></li>
        </ul>
      </div>
    </details>
  </div>
</template>

<style>
.mais { display: grid; gap: var(--esp-4); width: 100%; max-width: 56rem; margin: 0 auto; }
.mais__bloco { display: grid; gap: var(--esp-3); padding: var(--esp-4); border: var(--linha); background: var(--superficie); box-shadow: var(--sombra); color: var(--texto); }
.mais__bloco h1 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); letter-spacing: -0.02em; }
.mais__grupo { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
.mais__dobra > summary { display: grid; gap: var(--esp-0); min-height: var(--toque); cursor: pointer; }
.mais__dobra > summary small { color: var(--texto-2); font-weight: var(--peso-medio); }
.mais__links { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.mais__links a { display: grid; gap: var(--esp-0); min-height: var(--toque); padding: var(--esp-3) var(--esp-4); border: var(--linha-fina); background: var(--superficie-2); color: var(--texto); text-decoration: none; }
.mais__links a:hover { background: var(--hover); }
.mais__links small { color: var(--texto-2); font-weight: var(--peso-medio); }
.mais__ops { display: grid; gap: var(--esp-4); }
.mais__roteiro > summary small { display: block; color: var(--texto-2); font-weight: var(--peso-medio); }
.mais__google { display: grid; gap: var(--esp-2); }
.mais__google p { margin: 0; }
/* Armado para o segundo toque: muda a palavra e o fundo, para não passar por um toque comum. */
.mais__google .botao.is-armado { background: var(--erro-fundo); }
</style>
