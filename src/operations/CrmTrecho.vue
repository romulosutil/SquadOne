<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue'
import { linkDoWhatsApp, preencher, type LeadDaColinha, type Trecho } from './colinha'
import { aindaSemPrimeiroContato } from './trava-de-horario'

// Um texto pronto da colinha (08/10/2026), o mesmo cartão na ficha do lead e em
// /crm?ver=colinha. Com `lead`, os marcadores viram o nome, o artigo e o link do
// demo (preencher); sem ele (a página, sem nome digitado), ficam à mostra e
// realçados, para ninguém mandar "{NOME}" a um cliente.
// Nada aqui grava nem marca envio: ao contrário do link rastreado do n8n, copiar
// ou abrir o wa.me não muda a planilha (RULES 10 e 11).
const props = defineProps<{
  trecho: Trecho
  lead?: Pick<LeadDaColinha, 'empresa' | 'links'>
  /** Troca o título do trecho: na objeção, o título repetiria a fala que já é o cabeçalho. */
  titulo?: string
  /** Entre variantes (CrmMomento), o botão escolhido já diz o título: aqui ele fica só para o leitor de tela. */
  tituloOculto?: boolean
}>()

const idTitulo = useId()
const mensagem = ref<HTMLElement | null>(null)
const estado = ref<'' | 'copiado' | 'selecionado' | 'falhou'>('')
const anuncio = ref('')
let temporizador = 0

const texto = computed(() => preencher(props.trecho.texto, props.lead))
const temTexto = computed(() => texto.value.trim() !== '')
// O split com grupo de captura devolve texto e marcador alternados: os ímpares são marcadores.
const MARCADOR = /(\{[A-Z]+\}|\[[^\]\n]+\])/
const partes = computed(() => texto.value.split(MARCADOR))
const temColchetes = computed(() => /\[[^\]\n]+\]/.test(texto.value))
const temChaves = computed(() => /\{[A-Z]+\}/.test(texto.value))
// A dica que já fala do n8n diz o mesmo que o aviso geral da esteira: um dos dois basta.
const avisoDaEsteira = computed(() => Boolean(props.trecho.esteira) && !/n8n|esteira/i.test(props.trecho.dica ?? ''))
// Lead que ainda não recebeu a primeira abordagem: abrir o WhatsApp daqui seria um primeiro contato
// por fora das travas de horário e de ritmo (OT-02, 16/10/2026). Fica o Copiar; o envio é o botão da Ficha.
const antesDoPrimeiro = computed(() => aindaSemPrimeiroContato(props.lead))
// Só com número: a página (sem lead) não tem para quem abrir.
const whatsapp = computed(() => (temTexto.value && !antesDoPrimeiro.value ? linkDoWhatsApp(props.lead?.links.whatsapp, texto.value) : ''))

function mostrar(novo: typeof estado.value, falado: string, ms: number) {
  window.clearTimeout(temporizador)
  estado.value = novo
  anuncio.value = falado
  temporizador = window.setTimeout(() => { estado.value = '' }, ms)
}

// Sem a API da área de transferência (contexto sem https, permissão negada), o
// texto fica selecionado: no celular o menu de copiar já aparece em cima dele.
function selecionar(): boolean {
  const alvo = mensagem.value
  const selecao = window.getSelection()
  if (!alvo || !selecao) return false
  const trecho = document.createRange()
  trecho.selectNodeContents(alvo)
  selecao.removeAllRanges()
  selecao.addRange(trecho)
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

async function copiar() {
  try {
    if (!navigator.clipboard) throw new Error('sem clipboard')
    await navigator.clipboard.writeText(texto.value)
    mostrar('copiado', `Copiado: ${props.titulo ?? props.trecho.titulo}.`, 1600)
  } catch {
    if (selecionar()) mostrar('copiado', `Copiado: ${props.titulo ?? props.trecho.titulo}.`, 1600)
    else if (window.getSelection()?.toString()) mostrar('selecionado', 'Texto selecionado: copie pelo menu ou com Ctrl+C.', 6000)
    else mostrar('falhou', 'Não consegui copiar: selecione o texto à mão.', 6000)
  }
}

onBeforeUnmount(() => window.clearTimeout(temporizador))
</script>

<template>
  <article class="crm-colinha__trecho" :aria-labelledby="idTitulo">
    <p class="crm-colinha__trecho-cabeca">
      <strong :id="idTitulo" :class="{ 'so-leitor': tituloOculto }">{{ titulo ?? trecho.titulo }}</strong>
      <span v-if="trecho.esteira" class="crm-tag">esteira</span>
    </p>
    <template v-if="temTexto">
      <!-- Numa linha só: com white-space pre-wrap, a quebra entre as tags apareceria no texto. -->
      <blockquote ref="mensagem" class="crm-colinha__texto"><template v-for="(parte, i) in partes" :key="i"><mark v-if="i % 2" class="crm-colinha__marca">{{ parte }}</mark><template v-else>{{ parte }}</template></template></blockquote>
      <p v-if="temColchetes" class="crm-colinha__pendente">Complete os campos entre colchetes antes de mandar.</p>
      <p v-else-if="temChaves" class="crm-colinha__pendente">Troque os campos entre chaves pelo nome e o link do lead antes de mandar.</p>
      <div class="crm-colinha__botoes">
        <button class="botao" type="button" @click="copiar">{{ estado === 'copiado' ? 'Copiado ✓' : estado === 'selecionado' ? 'Selecionado' : 'Copiar' }}</button>
        <!-- Secundário: o wa.me só existe na Ficha, e lá o primário é a ação de agora (um por tela). -->
        <a v-if="whatsapp" class="botao" :href="whatsapp" target="_blank" rel="noopener">Abrir no WhatsApp <span aria-hidden="true">↗</span></a>
      </div>
      <p v-if="antesDoPrimeiro && lead?.links.whatsapp" class="crm-colinha__dica">Ele ainda não recebeu a primeira mensagem: mande pelo botão de envio da ficha, que respeita o horário e o ritmo.</p>
      <span class="so-leitor" role="status">{{ anuncio }}</span>
    </template>
    <p v-else class="crm-muted">Ainda sem texto pronto.</p>
    <p v-if="trecho.dica" class="crm-colinha__dica">{{ trecho.dica }}</p>
    <p v-if="avisoDaEsteira" class="crm-colinha__dica">A esteira do n8n manda este texto sozinha: mande à mão só se ela não mandou.</p>
  </article>
</template>
