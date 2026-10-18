<script setup lang="ts">
/**
 * O corpo do cartão "Sugestão do copiloto" (fase 2 da RULES 28, 17/10/2026): o que era a aba Copiloto
 * da Ficha, agora dentro do painel. O cartão só traz a referência (lead e hash do dossiê); a sugestão é
 * relida aqui, do mesmo GET que a Ficha usava (/api/operations/crm/copiloto/sugestao, nunca chama o
 * modelo), e os itens da proposta ganham o preço do CARDÁPIO (itensDaProposta/textoDaProposta): o
 * preço nunca passa pelo Assistente nem pelo modelo. Só "Copiar" (regras 11 e 17); cada cópia é medida
 * no /copiloto/copiou, como na Ficha.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { itensDaProposta, textoDaProposta, type QuemResponde, type SugestaoDoCopiloto } from '../operations/copiloto'
import { nomeDaOferta } from '../operations/jornada'
import { copiarTexto, horaCurta } from './assistente'

const props = defineProps<{ dados: { produto: string; id: string; empresa: string; hashDoDossie: string }; proposto: boolean }>()
const emit = defineEmits<{ copiou: []; descartar: [] }>()

interface SugestaoGuardada {
  hashDoDossie: string
  quando: string
  provedor: string
  sugestao: SugestaoDoCopiloto
  avisos: string[]
}

/** Quem está do outro lado, na leitura do copiloto: robô e recepção não decidem a compra. */
const QUEM: Record<QuemResponde, string> = {
  decisor: 'Quem decide', recepcao: 'A recepção (não decide)', robo: 'O atendimento automático', nao_sei: 'Não dá para saber ainda',
}

const lida = ref<SugestaoGuardada | null>(null)
const estado = ref<'lendo' | 'pronto' | 'sem' | 'erro'>('lendo')
const erro = ref('')
const copiado = ref<'' | 'mensagem' | 'proposta' | 'falhou'>('')
let temporizador: number | undefined

const itens = computed(() => (lida.value ? itensDaProposta(lida.value.sugestao) : []))
const rascunho = computed(() => (lida.value ? textoDaProposta(props.dados.empresa, lida.value.sugestao) : ''))
/** A conversa andou depois da resposta do Assistente: o cartão mostra a sugestão de agora, e diz. */
const mudou = computed(() => Boolean(lida.value && lida.value.hashDoDossie !== props.dados.hashDoDossie))

async function ler() {
  estado.value = 'lendo'
  erro.value = ''
  try {
    const q = new URLSearchParams({ produto: props.dados.produto, id: props.dados.id })
    const r = await fetch(`/api/operations/crm/copiloto/sugestao?${q}`, { cache: 'no-store' })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) {
      // 409: o lead saiu do trecho do copiloto (do "respondeu" à proposta) ou do funil.
      estado.value = r.status === 409 || r.status === 404 ? 'sem' : 'erro'
      erro.value = typeof corpo.error === 'string' ? corpo.error : `HTTP ${r.status}`
      lida.value = null
      return
    }
    lida.value = corpo.sugestao ?? null
    estado.value = lida.value ? 'pronto' : 'sem'
  } catch {
    estado.value = 'erro'
    erro.value = 'A Central não respondeu.'
  }
}

async function copiar(oQue: 'mensagem' | 'proposta') {
  const s = lida.value
  if (!s) return
  const ok = await copiarTexto(oQue === 'mensagem' ? s.sugestao.mensagem : rascunho.value)
  copiado.value = ok ? oQue : 'falhou'
  window.clearTimeout(temporizador)
  temporizador = window.setTimeout(() => { copiado.value = '' }, ok ? 1600 : 6000)
  if (!ok) return
  emit('copiou')
  // A medição do copiloto: quantas sugestões o Rômulo usa. Falhar aqui não atrapalha a cópia.
  fetch('/api/operations/crm/copiloto/copiou', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ produto: props.dados.produto, id: props.dados.id, hash: s.hashDoDossie, oQue }),
  }).catch(() => {})
}

watch(() => `${props.dados.produto}:${props.dados.id}`, () => { void ler() }, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(temporizador))
</script>

<template>
  <p v-if="estado === 'lendo'" class="texto-2 texto-pequeno" role="status">Lendo a sugestão guardada…</p>
  <p v-else-if="estado === 'sem'" class="texto-2 texto-pequeno">
    O copiloto não tem mais sugestão para a conversa de agora<template v-if="erro"> ({{ erro }})</template>. Ele sugere sozinho quando a última mensagem é do lead.
  </p>
  <p v-else-if="estado === 'erro'" class="recado recado--atencao" role="status">
    Não consegui ler a sugestão: {{ erro }}
    <button type="button" class="botao botao--leve" @click="ler">Tentar de novo</button>
  </p>

  <template v-else-if="lida">
    <p v-if="mudou" class="recado recado--atencao">A conversa andou desde a resposta: esta é a sugestão de agora.</p>
    <template v-if="lida.sugestao.momento">
      <p class="texto-pequeno"><strong>{{ QUEM[lida.sugestao.momento.quem] }}.</strong> {{ lida.sugestao.momento.leitura }}</p>
      <p v-if="lida.sugestao.momento.passo" class="texto-pequeno"><strong>Passo sugerido:</strong> {{ lida.sugestao.momento.passo }}</p>
    </template>

    <p class="texto-pequeno"><strong>Próxima mensagem</strong></p>
    <blockquote class="assistente-cartao__mensagem">{{ lida.sugestao.mensagem }}</blockquote>
    <p v-if="lida.sugestao.porque" class="texto-2 texto-pequeno">{{ lida.sugestao.porque }}</p>

    <template v-if="lida.avisos.length">
      <p class="texto-pequeno"><strong>Confira antes de mandar</strong></p>
      <ul class="assistente-cartao__linhas texto-pequeno"><li v-for="a in lida.avisos" :key="a">{{ a }}</li></ul>
    </template>

    <template v-if="lida.sugestao.ofertas.length">
      <p class="texto-pequeno"><strong>O que oferecer</strong></p>
      <ul class="assistente-cartao__linhas texto-pequeno">
        <li v-for="o in lida.sugestao.ofertas" :key="o.id"><strong>{{ nomeDaOferta(o.id) }}</strong><template v-if="o.porque">: {{ o.porque }}</template></li>
      </ul>
    </template>

    <p class="texto-pequeno"><strong>Rascunho da proposta</strong> <span class="texto-2">(preço do cardápio)</span></p>
    <template v-if="itens.length">
      <ul class="assistente-cartao__linhas texto-pequeno">
        <li v-for="i in itens" :key="i.id">
          <strong>{{ i.nome }}<template v-if="i.preco"> · {{ i.preco }}</template></strong><template v-if="i.sobProposta"> <span class="selo">só na proposta escrita</span></template><template v-if="i.porque">: {{ i.porque }}</template>
        </li>
      </ul>
      <p v-if="lida.sugestao.proposta.observacao" class="texto-2 texto-pequeno">{{ lida.sugestao.proposta.observacao }}</p>
    </template>
    <p v-else class="texto-2 texto-pequeno">Ainda cedo para a proposta: primeiro a conversa.</p>

    <template v-if="lida.sugestao.faltaSaber.length">
      <p class="texto-pequeno"><strong>Falta saber</strong></p>
      <ul class="assistente-cartao__linhas texto-pequeno"><li v-for="t in lida.sugestao.faltaSaber" :key="t">{{ t }}</li></ul>
    </template>

    <p class="texto-2 texto-pequeno">Copie e mande você mesmo: nada é enviado a lead por aqui. {{ lida.provedor }}<template v-if="horaCurta(lida.quando)"> · {{ horaCurta(lida.quando) }}</template></p>
    <div class="acoes">
      <button type="button" class="botao" @click="copiar('mensagem')">{{ copiado === 'mensagem' ? 'Copiado ✓' : 'Copiar a mensagem' }}</button>
      <button v-if="itens.length" type="button" class="botao" @click="copiar('proposta')">{{ copiado === 'proposta' ? 'Copiado ✓' : 'Copiar o rascunho' }}</button>
      <button v-if="proposto" type="button" class="botao botao--leve" @click="emit('descartar')">Descartar</button>
    </div>
    <p v-if="copiado === 'falhou'" class="recado recado--atencao" role="status">Não consegui copiar: selecione o texto à mão.</p>
  </template>
</template>
