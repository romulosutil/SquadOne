<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { itensDaProposta, textoDaProposta, type QuemResponde, type SugestaoDoCopiloto } from './copiloto'
import { nomeDaOferta } from './jornada'
import { dataHora } from './crm-formato'
import type { CrmLead } from './types'

// "Sugestão do copiloto" (15/10/2026, fase 1 em sombra): a próxima mensagem, o que oferecer e
// o rascunho da proposta, pedidos a um modelo com o dossiê do lead (server/copiloto.ts). Nada
// aqui envia nem marca envio: copiar só copia (e conta, para medir se a sugestão serve). O
// envio continua à mão pelo WhatsApp. A Ficha só monta este bloco com o copiloto ligado e o
// lead entre o "respondeu" e a proposta (copilotoServe).
const props = defineProps<{ lead: CrmLead }>()
// A Ficha monta o "Mandar a proposta" com os itens da sugestão (mandar-proposta.ts): sabe da nova sem reler.
const emit = defineEmits<{ sugestao: [s: SugestaoDoCopiloto | null] }>()

interface SugestaoNaFicha {
  hashDoDossie: string
  quando: string
  provedor: string
  sugestao: SugestaoDoCopiloto
  avisos: string[]
  guardada: boolean
  raioX: 'com texto' | 'só o link' | 'sem Raio-X'
}

/** Quem está do outro lado, na leitura do copiloto (16/10/2026): robô e recepção não decidem a compra. */
const QUEM: Record<QuemResponde, string> = {
  decisor: 'Quem decide', recepcao: 'A recepção (não decide)', robo: 'O atendimento automático', nao_sei: 'Não dá para saber ainda',
}

const sugestao = ref<SugestaoNaFicha | null>(null)
const estado = ref<'lendo' | 'pronto' | 'gerando'>('lendo')
const erro = ref('')
const copiado = ref<'' | 'mensagem' | 'proposta'>('')
const anuncio = ref('')
const mensagemEl = ref<HTMLElement | null>(null)
const propostaEl = ref<HTMLElement | null>(null)
let temporizador = 0

const proposta = computed(() => (sugestao.value ? itensDaProposta(sugestao.value.sugestao) : []))
const textoProposta = computed(() => (sugestao.value ? textoDaProposta(props.lead.empresa, sugestao.value.sugestao) : ''))
const alvo = () => ({ produto: props.lead.produto, id: props.lead.id })

async function lerGuardada() {
  estado.value = 'lendo'
  erro.value = ''
  try {
    const q = new URLSearchParams(alvo())
    const r = await fetch(`/api/operations/crm/copiloto/sugestao?${q}`)
    const dados = await r.json().catch(() => ({}))
    sugestao.value = r.ok ? (dados.sugestao ?? null) : null
    emit('sugestao', sugestao.value?.sugestao ?? null)
    if (!r.ok && r.status !== 409) erro.value = dados.error ?? 'Não consegui ler a sugestão guardada.'
  } catch {
    sugestao.value = null
  } finally {
    estado.value = 'pronto'
  }
}

async function pedir(forcar: boolean) {
  if (estado.value === 'gerando') return
  estado.value = 'gerando'
  erro.value = ''
  anuncio.value = 'Pedindo a sugestão ao copiloto: leva até 2 minutos.'
  try {
    const r = await fetch('/api/operations/crm/copiloto/sugestao', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...alvo(), forcar }),
    })
    const dados = await r.json().catch(() => ({}))
    if (!r.ok) {
      erro.value = dados.falha
        ? `${dados.error} ${dados.falha.motivo === 'preco_proibido' ? 'A sugestão trazia preço de serviço sob proposta e foi descartada; peça de novo.' : `(${dados.falha.detalhe})`}`
        : dados.error ?? 'O copiloto não respondeu agora.'
      anuncio.value = erro.value
      return
    }
    sugestao.value = dados
    emit('sugestao', dados.sugestao ?? null)
    anuncio.value = 'Sugestão pronta.'
  } catch {
    erro.value = 'Sem conexão com a Central.'
    anuncio.value = erro.value
  } finally {
    estado.value = 'pronto'
  }
}

function selecionar(el: HTMLElement | null): boolean {
  const selecao = window.getSelection()
  if (!el || !selecao) return false
  const faixa = document.createRange()
  faixa.selectNodeContents(el)
  selecao.removeAllRanges()
  selecao.addRange(faixa)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

async function copiar(oQue: 'mensagem' | 'proposta') {
  const s = sugestao.value
  if (!s) return
  const texto = oQue === 'mensagem' ? s.sugestao.mensagem : textoProposta.value
  let ok = false
  try {
    if (!navigator.clipboard) throw new Error('sem clipboard')
    await navigator.clipboard.writeText(texto)
    ok = true
  } catch {
    ok = selecionar(oQue === 'mensagem' ? mensagemEl.value : propostaEl.value)
  }
  window.clearTimeout(temporizador)
  copiado.value = ok ? oQue : ''
  anuncio.value = ok ? `Copiado: ${oQue === 'mensagem' ? 'a mensagem' : 'o rascunho da proposta'}.` : 'Texto selecionado: copie pelo menu ou com Ctrl+C.'
  temporizador = window.setTimeout(() => { copiado.value = '' }, 1600)
  // A medição da sombra: quantas sugestões o Rômulo usa. Falhar aqui não atrapalha a cópia.
  fetch('/api/operations/crm/copiloto/copiou', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...alvo(), hash: s.hashDoDossie, oQue }),
  }).catch(() => {})
}

watch(() => `${props.lead.produto}:${props.lead.id}`, lerGuardada, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(temporizador))
</script>

<template>
  <!-- Dobrado (16/10/2026): é ajuda, não o passo; o resumo diz se já há sugestão guardada. Dentro, listas e
       a mensagem em citação, sem caixa: a folha é o único contorno. -->
  <!-- Desde 16/10/2026 mora na aba "Copiloto" de "Como vender": aberto, porque escolher a aba já é o pedido. -->
  <details class="dobra crm-copiloto" open :aria-busy="estado === 'gerando'">
    <summary>Sugestão do copiloto <span class="crm-tag">em teste</span><span v-if="sugestao" class="crm-muted">pronta</span></summary>
    <p class="crm-muted">Lê o lead, a conversa guardada, o Raio-X, a resposta e as suas notas. Não envia nada: confira, copie e mande.</p>

    <template v-if="sugestao">
      <div class="crm-copiloto__parte">
        <template v-if="sugestao.sugestao.momento">
          <h4 class="crm-ficha__rotulo">Quem está respondendo</h4>
          <p class="crm-colinha__dica"><strong>{{ QUEM[sugestao.sugestao.momento.quem] }}.</strong> {{ sugestao.sugestao.momento.leitura }}</p>
          <!-- "Passo sugerido", não "Agora" (AC-12): o "Agora" da Ficha é um só, o da fila. -->
          <p v-if="sugestao.sugestao.momento.passo" class="crm-colinha__dica"><strong>Passo sugerido:</strong> {{ sugestao.sugestao.momento.passo }}</p>
        </template>
        <h4 class="crm-ficha__rotulo">Próxima mensagem</h4>
        <blockquote ref="mensagemEl" class="crm-colinha__texto">{{ sugestao.sugestao.mensagem }}</blockquote>
        <p v-if="sugestao.sugestao.porque" class="crm-colinha__dica">{{ sugestao.sugestao.porque }}</p>
        <div class="crm-colinha__botoes">
          <button class="botao" type="button" @click="copiar('mensagem')">{{ copiado === 'mensagem' ? 'Copiado ✓' : 'Copiar a mensagem' }}</button>
        </div>
      </div>

      <template v-if="sugestao.avisos.length">
        <h4 class="crm-ficha__rotulo">Confira antes de mandar</h4>
        <ul class="crm-ficha__conferir"><li v-for="a in sugestao.avisos" :key="a">{{ a }}</li></ul>
      </template>

      <template v-if="sugestao.sugestao.ofertas.length">
        <h4 class="crm-ficha__rotulo">O que oferecer</h4>
        <ul class="crm-ficha__ofertas">
          <li v-for="o in sugestao.sugestao.ofertas" :key="o.id"><strong>{{ nomeDaOferta(o.id) }}</strong><span v-if="o.porque">{{ o.porque }}</span></li>
        </ul>
      </template>

      <div class="crm-copiloto__parte">
        <h4 class="crm-ficha__rotulo">Rascunho da proposta</h4>
        <template v-if="proposta.length">
          <ul class="crm-ficha__ofertas">
            <li v-for="i in proposta" :key="i.id">
              <strong>{{ i.nome }}<template v-if="i.preco"> · {{ i.preco }}</template><template v-if="i.sobProposta"> <span class="crm-tag">só na proposta escrita</span></template></strong>
              <span v-if="i.porque">{{ i.porque }}</span>
            </li>
          </ul>
          <p v-if="sugestao.sugestao.proposta.observacao" class="crm-colinha__dica">{{ sugestao.sugestao.proposta.observacao }}</p>
          <pre ref="propostaEl" class="so-leitor" aria-hidden="true">{{ textoProposta }}</pre>
          <div class="crm-colinha__botoes">
            <button class="botao" type="button" @click="copiar('proposta')">{{ copiado === 'proposta' ? 'Copiado ✓' : 'Copiar o rascunho' }}</button>
          </div>
        </template>
        <p v-else class="crm-muted">Ainda cedo para a proposta: primeiro a conversa.</p>
      </div>

      <template v-if="sugestao.sugestao.faltaSaber.length">
        <h4 class="crm-ficha__rotulo">Falta saber</h4>
        <ul class="crm-ficha__conferir"><li v-for="t in sugestao.sugestao.faltaSaber" :key="t">{{ t }}</li></ul>
      </template>

      <p class="crm-muted">
        {{ sugestao.provedor }} · {{ dataHora(sugestao.quando) }}<template v-if="sugestao.guardada"> · guardada, o lead não mudou desde então</template>
        <template v-if="sugestao.raioX !== 'com texto'"> · {{ sugestao.raioX === 'só o link' ? 'sem o texto do Raio-X, só o link' : 'sem Raio-X' }}</template>
      </p>
    </template>

    <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
    <div class="crm-colinha__botoes">
      <button v-if="!sugestao" class="botao" type="button" :disabled="estado !== 'pronto'" @click="pedir(false)">
        {{ estado === 'gerando' ? 'Pensando, até 2 min…' : estado === 'lendo' ? 'Lendo…' : 'Pedir sugestão' }}
      </button>
      <button v-else class="botao botao--leve" type="button" :disabled="estado !== 'pronto'" @click="pedir(true)">
        {{ estado === 'gerando' ? 'Pensando, até 2 min…' : 'Gerar de novo' }}
      </button>
    </div>
    <span class="so-leitor" role="status">{{ anuncio }}</span>
  </details>
</template>
