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
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { corpoDaAnotacao } from './anotacao-de-envio'
import { filaDeVenda, noExpedienteDeVenda, resumoDaFila, type AcaoDeVenda } from './proxima-venda'
import { gravarPrimeiros, instantesDePrimeiroContato, lerPrimeiros, marcarPrimeiro, ritmoDoEnvio, textoDoRitmo, type PrimeirosContatos } from './trava-de-ritmo'
import type { CrmVisao } from './types'

const props = defineProps<{ visao: CrmVisao | null; erro?: string }>()
const emit = defineEmits<{ registrado: [] }>()

const agora = ref(Date.now())
let relogio = 0
const primeiros = ref<PrimeirosContatos>({})
/** Chaves resolvidas nesta tela ("Enviei" ou "Pular"), com o instante; valem até o fim do dia. */
const CHAVE_DO_DIA = 'squadone:venda:resolvidas'
const resolvidas = ref<Record<string, { em: number; pulou: boolean }>>({})
const verFila = ref(false)
const copiado = ref(false)
const tocado = ref<string | null>(null)
const status = ref('')

function armazenamento(): Storage | null {
  try { return window.localStorage } catch { return null }
}
const diaSP = (ms: number) => new Date(ms - 3 * 3600_000).toISOString().slice(0, 10)
function lerResolvidas() {
  try {
    const bruto = JSON.parse(armazenamento()?.getItem(CHAVE_DO_DIA) ?? '{}')
    if (bruto?.dia === diaSP(Date.now()) && bruto.itens && typeof bruto.itens === 'object') resolvidas.value = bruto.itens
  } catch { /* sem storage: só nesta visita */ }
}
function gravarResolvidas() {
  try { armazenamento()?.setItem(CHAVE_DO_DIA, JSON.stringify({ dia: diaSP(Date.now()), itens: resolvidas.value })) } catch { /* idem */ }
}

onMounted(() => {
  primeiros.value = lerPrimeiros(armazenamento(), Date.now())
  lerResolvidas()
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
})
onBeforeUnmount(() => window.clearInterval(relogio))

const ritmo = computed(() => ritmoDoEnvio(instantesDePrimeiroContato(props.visao?.leads ?? [], primeiros.value), agora.value))
const expediente = computed(() => noExpedienteDeVenda(agora.value))
const pulados = computed(() => new Set(Object.entries(resolvidas.value).filter(([, r]) => r.pulou).map(([k]) => k)))
const feitos = computed(() => new Set(Object.entries(resolvidas.value).filter(([, r]) => !r.pulou).map(([k]) => k)))
const fila = computed<AcaoDeVenda[]>(() =>
  filaDeVenda(props.visao?.estado === 'ok' ? props.visao : null, { primeiroLiberado: ritmo.value.motivo === null && expediente.value, agora: agora.value }, pulados.value)
    .filter((a) => !feitos.value.has(a.chave)))
const atual = computed(() => fila.value[0] ?? null)
const depois = computed(() => fila.value.slice(1))
/** Primeiros contatos prontos que a trava ou o relógio seguram agora. */
const esperando = computed(() => (props.visao?.hoje.find((g) => g.id === 'enviar')?.itens.length ?? 0))
const motivoDaEspera = computed(() => {
  if (!esperando.value) return ''
  if (!expediente.value) return `${esperando.value} primeiros contatos prontos: saem de seg a sex, das 8h às 17h30.`
  if (ritmo.value.motivo) return `${esperando.value} primeiros contatos prontos. ${textoDoRitmo(ritmo.value)}`
  return ''
})

async function aoTocar(a: AcaoDeVenda) {
  tocado.value = a.chave
  if (a.primeiroContato) {
    primeiros.value = marcarPrimeiro(primeiros.value, a.leadId, Date.now())
    gravarPrimeiros(armazenamento(), primeiros.value)
    agora.value = Date.now()
  }
  if (!a.anota) return
  const lead = props.visao?.leads.find((l) => l.id === a.leadId)
  if (!lead) return
  try {
    const r = await fetch('/api/operations/crm/registro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpoDaAnotacao(lead, a.anota)),
    })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    status.value = `${a.empresa}: envio anotado no CRM.`
    emit('registrado')
  } catch {
    status.value = `${a.empresa}: não consegui anotar o envio — anote na ficha.`
  }
}

function resolver(a: AcaoDeVenda, pulou: boolean) {
  resolvidas.value = { ...resolvidas.value, [a.chave]: { em: Date.now(), pulou } }
  gravarResolvidas()
  tocado.value = null
  copiado.value = false
  status.value = pulou ? `${a.empresa}: fica para o fim da fila.` : `${a.empresa}: feito.`
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
  responder: 'Responder', combinado: 'Combinado', 'depois-do-link': 'Depois do link', proposta: 'Proposta', followup: 'Follow-up', primeiro: 'Primeiro contato',
}
</script>

<template>
  <section class="venda" aria-labelledby="venda-titulo">
    <div class="venda__cabeca">
      <span class="venda__kicker">Próxima venda</span>
      <span v-if="atual" class="texto-2 texto-pequeno">{{ fila.length }} na fila</span>
    </div>

    <p v-if="erro" class="recado recado--erro">Funil indisponível: {{ erro }}</p>
    <p v-else-if="!visao" class="texto-2" role="status">Lendo o funil…</p>
    <p v-else-if="visao.estado !== 'ok'" class="recado recado--atencao">Sem retrato das planilhas: não dá para dizer quem chamar agora.</p>

    <template v-else-if="atual">
      <article class="venda__atual" :class="{ 'is-quente': atual.quente }">
        <p class="venda__tipo">
          <span class="selo" :class="atual.quente ? 'selo--erro' : ''">{{ ROTULO_DO_TIPO[atual.tipo] }}</span>
          <span class="texto-2 texto-pequeno">{{ atual.contexto }}</span>
        </p>
        <h2 id="venda-titulo">{{ atual.titulo }}</h2>
        <p class="venda__porque">{{ atual.porque }}</p>
        <p class="venda__tatica"><strong>Como:</strong> {{ atual.tatica }}</p>

        <figure v-if="atual.rascunho" class="venda__rascunho">
          <figcaption class="texto-2 texto-pequeno">Mensagem pronta (revise antes de enviar)</figcaption>
          <blockquote>{{ atual.rascunho }}</blockquote>
        </figure>
        <p v-else class="texto-2 texto-pequeno">Sem texto pronto: este passo é escrever à mão. A colinha da ficha ajuda.</p>

        <div class="venda__botoes">
          <a
            v-if="atual.link" class="botao botao--primario" :href="atual.link.url" target="_blank" rel="noopener"
            @click="aoTocar(atual)"
          >{{ atual.rascunho ? 'Abrir no WhatsApp com a mensagem' : 'Abrir a conversa no WhatsApp' }} <span aria-hidden="true">↗</span></a>
          <button v-if="tocado === atual.chave" type="button" class="botao" @click="resolver(atual, false)">Enviei, próxima</button>
          <button v-if="atual.rascunho" type="button" class="botao botao--leve" @click="copiar(atual.rascunho)">{{ copiado ? 'Copiado' : 'Copiar o texto' }}</button>
          <a class="botao botao--leve" :href="`/crm?lead=${encodeURIComponent(atual.leadId)}`">Ficha</a>
          <button type="button" class="botao botao--leve" @click="resolver(atual, true)">Pular</button>
        </div>
      </article>

      <p v-if="depois.length" class="venda__depois">
        <span>Depois: {{ resumoDaFila(depois) }}.</span>
        <button type="button" class="botao botao--leve" :aria-expanded="verFila" @click="verFila = !verFila">{{ verFila ? 'Esconder a fila' : 'Ver a fila' }}</button>
      </p>
      <ol v-if="verFila" class="venda__fila">
        <li v-for="a in depois.slice(0, 8)" :key="a.chave">
          <a :href="`/crm?lead=${encodeURIComponent(a.leadId)}`"><strong>{{ a.titulo }}</strong><small class="texto-2">{{ a.contexto }}</small></a>
        </li>
      </ol>
    </template>

    <template v-else>
      <h2 id="venda-titulo">Nada para mandar agora</h2>
      <p class="texto-2">Ninguém esperando resposta, combinado ou follow-up.</p>
    </template>

    <p v-if="motivoDaEspera" class="texto-2 texto-pequeno">{{ motivoDaEspera }}</p>
    <p class="so-leitor" role="status" aria-live="polite">{{ status }}</p>
  </section>
</template>

<style>
.venda { display: grid; gap: var(--respiro-interno); min-width: 0; padding: var(--respiro-bloco); border: var(--linha); border-left-width: var(--faixa-forte); border-left-color: var(--destaque); border-radius: var(--raio-bloco); background: var(--superficie); color: var(--texto); }
.venda__cabeca { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--esp-2); }
.venda__kicker { font-size: var(--tam-apoio); font-weight: var(--peso-forte); letter-spacing: 0.06em; text-transform: uppercase; color: var(--texto-2); }
.venda h2 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); line-height: 1.1; letter-spacing: -0.02em; overflow-wrap: anywhere; }
.venda p { margin: 0; }
.venda__atual { display: grid; gap: var(--esp-3); min-width: 0; }
.venda__tipo { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); }
.venda__porque { color: var(--texto); }
.venda__tatica { padding: var(--esp-2) var(--esp-3); border-radius: var(--raio-controle); background: var(--superficie-2); }
.venda__rascunho { display: grid; gap: var(--esp-1); margin: 0; }
.venda__rascunho blockquote { margin: 0; padding: var(--esp-3) var(--esp-4); border-left: var(--faixa) solid var(--positivo); border-radius: var(--raio-controle); background: var(--ok-fundo); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 16em; overflow: auto; }
.venda__botoes { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.venda__depois { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); padding-top: var(--esp-2); border-top: var(--divisor); color: var(--texto-2); }
.venda__fila { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.venda__fila a { display: grid; gap: var(--esp-0); min-height: var(--toque); padding: var(--esp-2) var(--esp-3); border-radius: var(--raio-controle); background: var(--superficie-2); color: var(--texto); text-decoration: none; }
.venda__fila a:hover { background: var(--hover); }
</style>
