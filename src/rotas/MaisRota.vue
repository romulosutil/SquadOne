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
 * Ainda em 17/10/2026 (Central de comando, "os menus são Central + Assistente + Vendas"): no Dell o
 * Mais encolheu para a Manutenção, fora dos menus (a engrenagem do topo e do trilho). O "Usar"
 * sumiu: Agenda, Finanças, Escritório e Entrada viraram faixas da Central. No lugar, os atalhos do
 * que só se abre para mexer: o Escritório completo (contratar, editar, arquivar), Organizar
 * Finanças e o design system; e a conexão com o Google ganhou o Conectar e o Tasks.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import FrenteComercial from '../operations/FrenteComercial.vue'
import '../estilos/operacao.css'
import AccessPanel from '../operations/AccessPanel.vue'
import ComoFuncionaPanel from '../operations/ComoFuncionaPanel.vue'
import CrmColinha from '../operations/CrmColinha.vue'
import DellConferePanel from '../operations/DellConferePanel.vue'
import { useOverview } from '../casca/overview'
import type { Capacidades } from '../casca/destinos'
import { useAgentes } from '../agentes/estado'
import { ampliarAcesso, conectado, conectando, tasksLiberado } from '../auth/google'
import { secaoDoMais } from '../casca/mais'
import SeletorDeTema from '../casca/SeletorDeTema.vue'
import '../operations/mais.css'
// O roteiro usa as peças do CRM (crm-colinha, crm-trecho...): sem o crm.css ele sairia cru aqui.
import '../operations/crm.css'

const props = defineProps<{ capacidades: Capacidades }>()
const { overview, resumo } = useOverview()
const ops = computed(() => props.capacidades.perfil === 'operations')

onMounted(() => {
  const alvo = new URLSearchParams(window.location.search).get('abrir') ?? window.location.hash.slice(1)
  if (alvo === 'primeiros-contatos' || alvo === 'equipe') void nextTick(() => document.getElementById(alvo)?.scrollIntoView({ block: 'start' }))
  // O "Ver em Manutenção" da Central e o "Roteiro" de Vendas: a navegação sobe a página
  // antes de montar esta rota, então rolar até a seção fica para depois de ela existir.
  if (pedeManutencao) void nextTick(() => document.getElementById('manutencao')?.scrollIntoView({ block: 'start' }))
  if (pedeRoteiro) void nextTick(() => document.getElementById('roteiro')?.scrollIntoView({ block: 'start' }))
})
onBeforeUnmount(() => window.clearTimeout(desarmar))

/** No Dell esta tela é a Manutenção; no Easypanel continua o Mais da barra. */
const titulo = computed(() => 'Mais')
/** O que só se abre para mexer: rotas que existem e saíram dos menus. */
const atalhos = computed(() => [
  ...(props.capacidades.agentes && ops.value
    ? [{ href: '/squadone', rotulo: 'Escritório completo', dica: 'squads, salas e quem trabalha em cada uma: contratar, editar, arquivar e andar' }]
    : []),
  ...(ops.value ? [{ href: '/financas/organizar', rotulo: 'Organizar Finanças', dica: 'categorias, orçamento e regras' }] : []),
  { href: '/design-system', rotulo: 'Design system', dica: 'tokens e peças do app, para quem mexe no visual' },
])
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

const equipe = computed(() => ag?.roster.value?.squads.flatMap(s => s.dominios.map(d => ({ ...d, squad: s.nome }))) ?? [])
</script>

<template>
  <div class="mais">
    <section class="mais__bloco" aria-labelledby="mais-titulo">
      <header class="cabecalho-pagina"><div><span class="sobretitulo">Seu escritório</span><h1 id="mais-titulo">{{ titulo }}</h1><p>Agenda, finanças, entrada e configurações, a um toque.</p></div></header>
      <nav v-if="ops" class="mais__acessos" aria-label="Áreas do escritório"><a v-if="capacidades.agentes" class="botao" href="/agenda">Agenda</a><a class="botao" href="/financas">Finanças</a><a class="botao" href="/entrada/">Entrada</a><a class="botao" href="#configuracoes">Configurações</a></nav>
      <h2 id="configuracoes">Configurações</h2>
      <!-- A aparência fica à vista: é a primeira coisa que o dono procura quando o escuro cansa. -->
      <h2 class="mais__grupo">Aparência</h2><SeletorDeTema />
      <ul class="mais__links">
        <li v-for="l in atalhos" :key="l.href">
          <a :href="l.href"><strong>{{ l.rotulo }}</strong><small>{{ l.dica }}</small></a>
        </li>
      </ul>
    </section>

    <section v-if="capacidades.agentes" id="equipe" class="mais__bloco configuracao-equipe">
      <header class="cabecalho-bloco"><div><span class="sobretitulo">Seu time</span><h2>Equipe e responsabilidades</h2></div><a class="botao" href="/squadone">Gerenciar equipe</a></header>
      <p class="texto-2">As responsabilidades ficam aqui. Na Central, você acompanha as decisões e as conversas.</p>
      <details v-for="sala in equipe" :key="sala.id" class="dobra"><summary><strong>{{ sala.po.nome }}</strong> · {{ sala.po.papel }} <span class="etiqueta">{{ sala.squad }} · {{ sala.nome }}</span></summary><p>{{ sala.po.escopo }}</p><ul v-if="sala.integrantes.length"><li v-for="pessoa in sala.integrantes" :key="pessoa.id"><strong>{{ pessoa.nome }} · {{ pessoa.papel }}</strong><p>{{ pessoa.escopo }}</p></li></ul></details>
    </section>

    <section v-if="ops" id="primeiros-contatos"><FrenteComercial configurar /></section>

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
        <span class="mais__grupo">{{ ops ? 'Dell, ferramentas e Google' : 'Conexão com o Google' }}</span>
        <small><template v-if="ops">ferramentas do Dell, o que ele confere<template v-if="avisoDoDell"> ({{ avisoDoDell }})</template><template v-if="ag">, </template></template><template v-if="ag">a conexão com o Google e o Tasks</template></small>
      </summary>
      <div class="mais__ops">
        <AccessPanel v-if="ops" :tools="overview?.tools ?? []" />
        <DellConferePanel v-if="ops" :status="overview?.dell ?? null" :resumo="resumo" :aberto="pedeManutencao" />
        <!-- Conectar e autorizar o Tasks também aqui (a Agenda saiu dos menus no Dell): mesmo consentimento, nunca logout. -->
        <section v-if="ag && !conectado" class="mais__google" aria-labelledby="mais-google-titulo">
          <h2 id="mais-google-titulo" class="mais__grupo">Conexão com o Google</h2>
          <p class="texto-2">Sem conexão: os agentes ainda respondem, mas não leem nem marcam nada na agenda.</p>
          <div class="acoes">
            <button type="button" class="botao" :disabled="conectando" @click="ag.conectarGoogle">
              {{ conectando ? 'Conectando…' : 'Conectar o Google Calendar' }}
            </button>
          </div>
        </section>
        <section v-if="ag && conectado" class="mais__google" aria-labelledby="mais-google-titulo">
          <h2 id="mais-google-titulo" class="mais__grupo">Conexão com o Google</h2>
          <p class="texto-2">
            Google Calendar conectado.<template v-if="tasksLiberado"> Google Tasks autorizado.</template><template v-else> Google Tasks não autorizado: os passos não viram checklist.</template>
            Desconectar revoga o acesso no Google: a agenda para de ler e de marcar até você conectar de novo.
          </p>
          <div v-if="!tasksLiberado" class="acoes">
            <button type="button" class="botao" :disabled="conectando" @click="ampliarAcesso">Autorizar o Google Tasks</button>
          </div>
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
