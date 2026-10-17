<script setup lang="ts">
/**
 * Painel do Assistente da Central (RULES 28, 17/10/2026): no `operations` com a flag, é o que o
 * ＋, a lateral e o Ctrl+K abrem no lugar do Pedir. Conversa com o Gemini (e o Hermes nas
 * perguntas de estratégia); para agir, só cartões que o Rômulo confirma (AssistenteCartao.vue).
 *
 * Duas molduras, o mesmo conteúdo:
 *  - desktop (a partir de 64 rem): painel fixo à direita, `role="complementary"`, montado FORA do
 *    `#app` (Teleport). A Ficha do lead é uma folha que deixa o `#app` inerte; fora dele o painel
 *    continua usável ao lado dela. A casca abre espaço com `html.com-assistente` (casca.css), e
 *    o fundo das folhas não cobre o painel. Duas defesas contra a folha aberta: o `focusin` não
 *    sobe do painel (a folha puxaria o foco de volta) e o Esc dentro dele fecha o painel, não a Ficha;
 *  - celular: uma `Sheet` que empilha por cima da Ficha (pilhaDeFolhas), como as outras folhas.
 *
 * A resposta do modelo é texto interpolado, nunca HTML (regra 23). O contexto de cada pergunta é
 * a página e, com a Ficha aberta, só `{ produto, id }` do lead.
 */
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, Teleport, watch } from 'vue'
import Sheet from '../components/Sheet.vue'
import AssistenteCartao from './AssistenteCartao.vue'
import { useDitado } from './ditado'
import { pilhaDeFolhas } from './pilhaDeFolhas'
import {
  LIMITE_DO_TEXTO,
  atalhosDoContexto,
  contextoDoEndereco,
  copiarTexto,
  enterEnvia,
  horaCurta,
  rotuloDoCerebro,
  textoDaEtapa,
  textoDaFalha,
  useAssistente,
  usoDeHoje,
} from './assistente'

defineProps<{ agentes: boolean }>()
const emit = defineEmits<{ fechar: [] }>()

const as = useAssistente()

// ------------------------------------------------------------ moldura

const consulta = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 64rem)') : null
const largo = ref(consulta?.matches ?? false)
const aoMudarLargura = (e: MediaQueryListEvent) => { largo.value = e.matches }

/** A moldura do desktop: o aside fora do `#app`, com o título e o "Fechar" de texto (BP-FOLHA). */
const MolduraLateral = defineComponent({
  name: 'MolduraLateral',
  props: { titulo: { type: String, required: true }, cheia: Boolean },
  emits: ['fechar'],
  setup(p, { slots, emit: emitir }) {
    return () =>
      h(Teleport, { to: 'body' }, [
        h(
          'aside',
          {
            class: 'assistente',
            role: 'complementary',
            'aria-label': 'Assistente',
            // A folha aberta (a Ficha) escuta o focusin no document e puxa o foco de volta para ela.
            onFocusin: (e: FocusEvent) => e.stopPropagation(),
          },
          [
            h('header', { class: 'assistente__topo' }, [
              h('h2', null, p.titulo),
              h('button', { type: 'button', class: 'folha__fechar', onClick: () => emitir('fechar') }, 'Fechar'),
            ]),
            h('div', { class: 'assistente__corpo' }, slots.default?.()),
            h('footer', { class: 'assistente__rodape' }, slots.rodape?.()),
          ]
        ),
      ])
  },
})
const Moldura = computed(() => (largo.value ? MolduraLateral : Sheet))

// ------------------------------------------------------------ contexto

// O CRM escreve `?lead=` com o próprio history, fora do roteador da casca: com o painel aberto ao
// lado, o endereço e o nome da Ficha são relidos a cada segundo (barato, e só enquanto ele está aberto).
const endereco = ref({ caminho: window.location.pathname, busca: window.location.search })
const empresaDaFicha = ref('')
function lerEndereco() {
  const { pathname, search } = window.location
  if (pathname !== endereco.value.caminho || search !== endereco.value.busca) endereco.value = { caminho: pathname, busca: search }
  // O nome vem do título da Ficha já desenhada (CrmFicha: #crm-ficha-titulo), para não buscar o
  // retrato de Vendas de novo só por ele. Ao servidor vai só produto e id.
  empresaDaFicha.value = document.getElementById('crm-ficha-titulo')?.textContent?.trim() ?? ''
}
const contexto = computed(() => contextoDoEndereco(endereco.value.caminho, endereco.value.busca))
const atalhos = computed(() => atalhosDoContexto(contexto.value.pagina, { empresa: empresaDaFicha.value }))

// ------------------------------------------------------------ conversa

const texto = ref('')
const campo = ref<HTMLTextAreaElement | null>(null)
const fim = ref<HTMLElement | null>(null)

const ditado = useDitado((t) => {
  texto.value = texto.value.trim() ? `${texto.value.trim()} ${t}` : t
})

const desligado = computed(() => as.estado.value?.ligado === false || as.erroDoEstado.value?.tipo === 'desligado')
const ocupado = computed(() => !!as.enviando.value || !!as.pendente.value)
const vazia = computed(() => !as.mensagens.value.length && !as.enviando.value)
const enviandoNaLista = computed(() => {
  const e = as.enviando.value
  return e && !(e.id && as.mensagens.value.some((m) => m.id === e.id)) ? e : null
})
const motivo = computed(() =>
  desligado.value ? textoDaFalha('desligado').titulo : ocupado.value ? 'Espere a resposta para perguntar de novo.' : ''
)
const podeEnviar = computed(() => !motivo.value && texto.value.trim() !== '')

/** O que a região viva diz: a etapa enquanto prepara; depois, que a resposta chegou. */
const anuncio = ref('')
watch(
  () => as.pendente.value,
  (agora, antes) => {
    if (antes && !agora) anuncio.value = 'Resposta do Assistente chegou.'
  }
)
const textoVivo = computed(() =>
  as.pendente.value ? textoDaEtapa(as.pendente.value.etapa) : as.enviando.value ? 'Enviando…' : anuncio.value
)

async function perguntar(t: string) {
  if (desligado.value || ocupado.value || !t.trim()) return
  ditado.parar()
  lerEndereco()
  const c = contexto.value
  anuncio.value = ''
  const doCampo = t === texto.value
  if (doCampo) texto.value = ''
  const ok = await as.mandar(t, { pagina: c.pagina, ...(c.lead ? { lead: c.lead } : {}) })
  // Falhou: o texto volta ao campo, para não ter de escrever de novo.
  if (!ok && doCampo && !texto.value) texto.value = t
}

const enviarDoCampo = () => {
  if (podeEnviar.value) void perguntar(texto.value)
}
const aoTeclarNoCampo = (e: KeyboardEvent) => {
  if (enterEnvia(e)) {
    e.preventDefault()
    enviarDoCampo()
  }
}

function novaConversa() {
  ditado.parar()
  anuncio.value = ''
  as.novaConversa()
  focarCampo()
}

const copiada = ref('')
let temporizador: number | undefined
async function copiarResposta(id: string, t: string) {
  const ok = await copiarTexto(t)
  copiada.value = ok ? id : `falhou:${id}`
  window.clearTimeout(temporizador)
  temporizador = window.setTimeout(() => { copiada.value = '' }, ok ? 1600 : 6000)
}

// Rola até o fim quando chega mensagem, a etapa muda ou uma pergunta sai.
watch(
  () => [as.mensagens.value.length, as.pendente.value?.etapa, !!as.enviando.value],
  async () => {
    await nextTick()
    const reduzir = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    fim.value?.scrollIntoView({ block: 'end', behavior: reduzir ? 'auto' : 'smooth' })
  }
)

// ------------------------------------------------------------ foco e teclado (desktop)

function focarCampo() {
  if (!largo.value) return
  // setTimeout e não só nextTick: a paleta (Ctrl+K) que abriu o painel devolve o foco a quem a
  // abriu num setTimeout ao fechar; este roda depois e fica com ele.
  void nextTick(() => setTimeout(() => campo.value?.focus()))
}
watch(() => as.focar.value, focarCampo)

/**
 * Esc dentro do painel do desktop fecha o painel, não a folha aberta por baixo: a folha escuta o
 * keydown no document em captura; a janela captura antes dele.
 */
function aoTeclarNaJanela(e: KeyboardEvent) {
  if (e.key !== 'Escape' || !largo.value) return
  const painel = document.querySelector('.assistente')
  if (!painel || !(e.target instanceof Node) || !painel.contains(e.target)) return
  e.preventDefault()
  e.stopPropagation()
  if (ditado.ouvindo.value) ditado.parar()
  else emit('fechar')
}

let quemAbriu: HTMLElement | null = null
let relogio: number | undefined

onMounted(() => {
  quemAbriu = document.activeElement instanceof HTMLElement ? document.activeElement : null
  consulta?.addEventListener('change', aoMudarLargura)
  window.addEventListener('keydown', aoTeclarNaJanela, true)
  lerEndereco()
  relogio = window.setInterval(lerEndereco, 1000)
  as.retomar()
  focarCampo()
})

watch(
  largo,
  (eh) => document.documentElement.classList.toggle('com-assistente', eh),
  { immediate: true }
)

onBeforeUnmount(() => {
  as.pausar()
  window.clearInterval(relogio)
  window.clearTimeout(temporizador)
  consulta?.removeEventListener('change', aoMudarLargura)
  window.removeEventListener('keydown', aoTeclarNaJanela, true)
  document.documentElement.classList.remove('com-assistente')
  if (!largo.value) return // no celular, a Sheet devolve o foco
  // Devolve o foco a quem abriu; se ele está sob o `#app` inerte (a Ficha abriu depois), à folha de cima.
  const volta = quemAbriu
  setTimeout(() => {
    if (volta && document.contains(volta) && !volta.closest('[inert]')) volta.focus()
    else if (pilhaDeFolhas.length) [...document.querySelectorAll<HTMLElement>('.folha')].pop()?.focus()
  })
})
</script>

<template>
  <component :is="Moldura" titulo="Assistente" :cheia="!largo" @fechar="emit('fechar')">
    <div class="assistente-conteudo">
      <div class="assistente-aviso">
        <p class="texto-2 texto-pequeno">Usa IA (Gemini e Hermes). Confira antes de agir; nada é enviado a lead.</p>
        <button type="button" class="botao botao--leve" :disabled="!!as.enviando.value && !as.enviando.value.id" @click="novaConversa">Nova conversa</button>
      </div>
      <p v-if="usoDeHoje(as.estado.value)" class="texto-2 texto-pequeno">{{ usoDeHoje(as.estado.value) }}</p>

      <p v-if="desligado" class="recado recado--atencao">
        {{ textoDaFalha('desligado').titulo }} {{ textoDaFalha('desligado').oQueFazer }}
      </p>
      <p v-else-if="as.erroDoEstado.value" class="recado recado--atencao">
        Não consegui ler o estado do Assistente ({{ as.erroDoEstado.value.texto }}). Dá para perguntar mesmo assim.
      </p>

      <!-- Conversa vazia: as perguntas prontas da página. -->
      <section v-if="vazia && !desligado && atalhos.length" class="assistente-atalhos" aria-labelledby="assistente-atalhos">
        <h3 id="assistente-atalhos">Perguntas prontas</h3>
        <ul class="lista-acoes">
          <li v-for="a in atalhos" :key="a">
            <button type="button" :disabled="ocupado" @click="perguntar(a)">{{ a }}</button>
          </li>
        </ul>
      </section>
      <p v-else-if="vazia && !desligado && contexto.pagina === 'financas'" class="texto-2 texto-pequeno">
        Finanças não passam pelo Assistente: o que for de dinheiro fica na tela de Finanças.
      </p>

      <ol v-if="!vazia" class="assistente-conversa" aria-label="Conversa">
        <li
          v-for="m in as.mensagens.value"
          :key="m.n"
          class="assistente-msg"
          :class="m.autor === 'romulo' ? 'is-romulo' : 'is-assistente'"
        >
          <p class="assistente-msg__meta">
            {{ m.autor === 'romulo' ? 'Você' : 'Assistente' }}<template v-if="horaCurta(m.quando)"> · {{ horaCurta(m.quando) }}</template><template v-if="m.autor === 'assistente' && rotuloDoCerebro(m.cerebro)"> · {{ rotuloDoCerebro(m.cerebro) }}</template>
          </p>
          <p v-if="m.texto" class="assistente-msg__texto">{{ m.texto }}</p>

          <template v-if="m.autor === 'assistente'">
            <p v-if="m.falha" class="recado recado--erro">
              {{ m.falha.texto || textoDaFalha(m.falha.tipo).titulo }} {{ textoDaFalha(m.falha.tipo).oQueFazer }}
            </p>
            <AssistenteCartao v-for="c in m.cartoes" :key="c.id" :cartao="c" :agentes="agentes" />
            <ul v-if="m.fontes.length" class="assistente-fontes" aria-label="De onde veio">
              <li v-for="(f, i) in m.fontes" :key="i">{{ f.rotulo }}</li>
            </ul>
            <div v-if="m.texto && !m.falha" class="assistente-msg__acoes">
              <button type="button" class="botao botao--leve" @click="copiarResposta(m.id, m.texto)">
                {{ copiada === m.id ? 'Copiado ✓' : 'Copiar' }}
              </button>
              <button
                type="button"
                class="botao botao--leve"
                aria-label="Resposta útil"
                :aria-pressed="as.avaliacoes.value[m.id] === 1"
                @click="as.avaliarResposta(m.id, 1)"
              ><span aria-hidden="true">👍</span></button>
              <button
                type="button"
                class="botao botao--leve"
                aria-label="Resposta não ajudou"
                :aria-pressed="as.avaliacoes.value[m.id] === -1"
                @click="as.avaliarResposta(m.id, -1)"
              ><span aria-hidden="true">👎</span></button>
            </div>
            <p v-if="copiada === `falhou:${m.id}`" class="recado recado--atencao" role="status">Não consegui copiar: selecione o texto à mão.</p>
            <p v-if="as.erroDaAvaliacao.value[m.id]" class="recado recado--atencao" role="status">{{ as.erroDaAvaliacao.value[m.id] }}</p>
          </template>
        </li>
        <li v-if="enviandoNaLista" class="assistente-msg is-romulo is-enviando">
          <p class="assistente-msg__meta">Você · enviando</p>
          <p class="assistente-msg__texto">{{ enviandoNaLista.texto }}</p>
        </li>
      </ol>

      <!-- Existe sempre: o leitor de tela só anuncia mudança numa região que já estava na página. -->
      <p class="assistente-etapa" role="status" aria-live="polite">{{ textoVivo }}</p>

      <div v-if="as.falha.value" class="recado recado--erro" role="alert">
        {{ as.falha.value.texto || textoDaFalha(as.falha.value.tipo).titulo }} {{ textoDaFalha(as.falha.value.tipo).oQueFazer }}
      </div>
      <span ref="fim" aria-hidden="true"></span>
    </div>

    <template #rodape>
      <form class="assistente-form" @submit.prevent="enviarDoCampo">
        <label class="rotulo">
          Pergunte algo
          <textarea
            ref="campo"
            v-model="texto"
            class="campo"
            rows="2"
            :maxlength="LIMITE_DO_TEXTO"
            :disabled="desligado"
            @keydown="aoTeclarNoCampo"
          ></textarea>
        </label>
        <p v-if="ditado.ouvindo.value" class="recado recado--atencao" role="status">
          Ouvindo… {{ ditado.parcial.value }} <small>(o navegador transcreve pelo serviço de voz dele)</small>
        </p>
        <p v-if="ditado.erro.value" class="recado recado--erro" role="alert">{{ ditado.erro.value }}</p>
        <div class="assistente-form__linha">
          <button
            type="button"
            class="botao assistente-form__mic"
            :aria-pressed="ditado.ouvindo.value"
            :disabled="!ditado.suportado || desligado"
            :title="ditado.suportado ? undefined : 'Ditado indisponível neste navegador'"
            @click="ditado.alternar"
          >
            {{ ditado.ouvindo.value ? 'Parar' : 'Ditar' }}<span aria-hidden="true"> 🎙</span>
          </button>
          <span v-if="motivo" class="texto-2 texto-pequeno">{{ motivo }}</span>
          <button type="submit" class="botao botao--primario" :disabled="!podeEnviar">Enviar</button>
        </div>
      </form>
    </template>
  </component>
</template>

<style>
/* Painel do desktop (a partir de 64 rem): fixo à direita, fora do #app. A largura sai de
   html.com-assistente (casca.css), que também abre o espaço na casca. */
.assistente {
  position: fixed;
  z-index: var(--camada-folha);
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  width: var(--assistente-largura, 26rem);
  flex-direction: column;
  border-left: var(--linha);
  background: var(--superficie);
  color: var(--texto);
  font-family: var(--fonte);
  font-weight: var(--peso-texto);
  line-height: 1.45;
}
.assistente *, .assistente *::before, .assistente *::after { box-sizing: border-box; }
.assistente :focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
.assistente__topo {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: var(--esp-3);
  padding: var(--esp-4);
  border-bottom: var(--divisor);
}
.assistente__topo h2 { margin: 0; font-size: var(--tam-secao); font-weight: var(--peso-titulo); letter-spacing: -0.02em; }
.assistente__corpo { min-height: 0; flex: 1; padding: var(--esp-4); overflow-y: auto; overscroll-behavior: contain; }
.assistente__rodape { display: flex; flex-shrink: 0; padding: var(--esp-3) var(--esp-4); border-top: var(--divisor); background: var(--superficie-2); }

/* O conteúdo, igual nas duas molduras (o aside do desktop e a Sheet do celular). */
.assistente-conteudo { display: grid; min-width: 0; gap: var(--respiro-interno); }
.assistente-conteudo p { margin: 0; }
.assistente-aviso { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); }
.assistente-aviso p { flex: 1 1 12rem; }
.assistente-atalhos { display: grid; gap: var(--esp-2); }
.assistente-atalhos h3 { margin: 0; font-size: var(--tam-apoio); font-weight: var(--peso-forte); }

.assistente-conversa { display: grid; gap: var(--esp-4); margin: 0; padding: 0; list-style: none; }
.assistente-msg { display: grid; min-width: 0; gap: var(--esp-2); }
/* Rômulo à direita, em fundo; o Assistente ocupa a largura (os cartões precisam dela). */
.assistente-msg.is-romulo {
  justify-self: end;
  max-width: 85%;
  padding: var(--esp-2) var(--esp-3);
  border-radius: var(--raio-controle);
  background: var(--superficie-2);
}
.assistente-msg.is-romulo .assistente-msg__meta { text-align: right; }
.assistente-msg.is-enviando { opacity: 0.7; }
.assistente-msg__meta { color: var(--texto-2); font-size: var(--tam-mini); font-weight: var(--peso-medio); }
.assistente-msg__texto { white-space: pre-wrap; overflow-wrap: anywhere; }
.assistente-fontes { display: flex; flex-wrap: wrap; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.assistente-fontes li {
  padding: var(--esp-0) var(--esp-2);
  border: var(--linha-fina);
  border-radius: var(--raio-pilula);
  background: var(--superficie-2);
  color: var(--texto-2);
  font-size: var(--tam-mini);
  font-weight: var(--peso-medio);
}
.assistente-msg__acoes { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-1); }
.assistente-msg__acoes .botao[aria-pressed="true"] { background: var(--destaque); color: var(--destaque-texto); }
/* Sem display:none quando vazia: região viva escondida não anuncia o que chega nela. */
.assistente-etapa { color: var(--texto-2); font-size: var(--tam-apoio); font-weight: var(--peso-medio); }

.assistente-form { display: grid; min-width: 0; flex: 1 1 100%; gap: var(--esp-2); }
.assistente-form p { margin: 0; }
.assistente-form__linha { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); }
.assistente-form__linha > span { flex: 1 1 8rem; }
.assistente-form__mic[aria-pressed="true"] { background: var(--erro-fundo); }
</style>
