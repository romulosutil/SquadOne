<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CrmLead } from '../operations/types'
import type { Pessoa } from '../types'
import AjustarProximoPasso from './AjustarProximoPasso.vue'
import AndamentoDaVenda from './AndamentoDaVenda.vue'
import ContextoDaDecisao from './ContextoDaDecisao.vue'
import AcompanhamentoObservado from './AcompanhamentoObservado.vue'
import PainelOperacional from '../components/PainelOperacional.vue'
import OrientacaoDaConversa from './OrientacaoDaConversa.vue'
import { orientaContato } from './orientacao-da-conversa'
import { ROTULO_DA_ETAPA } from '../operations/crm-formato'
import type { FatoDaVenda } from './andamento'
import { marcosDaMissao } from './missao'
import { agoraDaFicha, type AcaoDeVenda } from '../operations/proxima-venda'
import { whatsappParaRevisao, hashDoContexto, impedimentoDaMensagem } from '../operations/revisao-resposta'
import { nomesDasOfertas, type EstadoDaDecisao } from './decisoes'
import { procedimentoDaDecisao, type MensagemDaDecisao } from './procedimento-da-decisao'
import { planoDoLead } from '../operations/bi-operacao'
import type { PlanoBi } from '../operations/bi-operacao'
import type { ProcedimentoDaDecisao } from './procedimento-da-decisao'
import { textoDoAtendimento, guardarTextoDoAtendimento } from './rascunho-atendimento'

const props = defineProps<{ lead: CrmLead; agente?: Pessoa; disponivel: boolean; registroDisponivel?: boolean; motivo: string; acao?: AcaoDeVenda | null; estado?: EstadoDaDecisao; orientacao?: PlanoBi; procedimentoInicial?: ProcedimentoDaDecisao; passoInicial?: 1|2|3 }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; interagiu: []; ocupado: [valor: boolean]; fila: [] }>()
const procedimento = computed(() => props.procedimentoInicial ?? procedimentoDaDecisao(props.lead))
const plano = computed(() => props.orientacao ?? planoDoLead(props.lead))
const preparo = ref<MensagemDaDecisao | null>(null), preparando = ref(false), erroDoPreparo = ref('')
const acaoEfetiva = computed(() => preparo.value ? preparo.value.acao : props.acao)
const mensagem = ref('')
watch(() => preparo.value?.mensagem, (texto, anterior) => { if (!mensagem.value || mensagem.value === anterior) mensagem.value = texto ?? '' })
watch(mensagem, texto => { if (preparo.value) guardarTextoDoAtendimento(props.lead, preparo.value.contextoHash, texto) })
const orientarContato = computed(() => orientaContato(props.lead, plano.value))
const conferirNaFicha = computed(() => plano.value.tipo === 'conferir' || procedimento.value.tipo === 'interno' && plano.value.tipo === 'agir')
const impedimentoDoTexto = computed(() => preparo.value?.mensagem && !mudou.value ? impedimentoDaMensagem(mensagem.value) : '')
const passo = ref<number>(props.passoInicial ?? (props.estado === 'agora' || !props.estado || procedimento.value.tipo === 'robo' ? 1 : 3))
const secaoAtual = ref<HTMLElement | null>(null)
watch(passo, async () => { await nextTick(); secaoAtual.value?.focus({ preventScroll: true }); secaoAtual.value?.scrollIntoView({ block: 'start' }) })
const passos = [{ nome: 'Orientação', detalhe: 'O que fazer e quando' }, { nome: 'Mensagem', detalhe: 'Revisar e abrir WhatsApp' }, { nome: 'Acompanhamento', detalhe: 'O que aconteceu depois' }]
const marcos = computed(() => marcosDaMissao(props.lead))
const agora = computed(() => procedimento.value.tipo === 'interno'
  ? { frase: procedimento.value.titulo, como: procedimento.value.resultadoEsperado }
  : procedimento.value.tipo === 'robo'
  ? { frase: procedimento.value.titulo, como: 'Use o menu ou aguarde o atendimento. O pedido de encaminhamento só cabe quando ainda não há uma pessoa na conversa.' }
  : preparo.value?.proximaAcao
  ? { frase: preparo.value.proximaAcao, como: preparo.value.porque }
  : !acaoEfetiva.value && props.estado === 'agora'
  ? { frase: props.lead.proximoPasso?.texto || 'Confira a resposta e escolha como continuar a conversa.', como: 'Abra a ficha para revisar o histórico e definir a próxima ação.' }
  : agoraDaFicha(props.lead, acaoEfetiva.value ?? null))
const situacao = computed(() => procedimento.value.tipo === 'robo' ? 'Ainda falta falar com uma pessoa' : procedimento.value.tipo === 'espera' ? 'Há uma espera a respeitar' : procedimento.value.tipo === 'encerrado' ? 'Conversa encerrada' : procedimento.value.tipo === 'audio' ? 'Há um áudio para ouvir' : procedimento.value.tipo === 'interno' ? 'Há uma tarefa interna para resolver' : props.lead.conversa?.ultima.direcao === 'saida' ? 'Você enviou a última mensagem' : props.lead.conversa ? 'Há uma resposta para conferir' : 'Confira o contexto antes de agir')
function formatarData(valor: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.split('-').reverse().join('/')
  return Number.isFinite(Date.parse(valor)) ? new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Data não informada'
}
const ocupado = ref(false), abriu = ref(false)
const saidaAoAbrir = ref<string | null>(null)
const ajuste = ref<'concluir' | 'reagendar' | null>(null), registrar = ref(false)
const fatoDoRegistro = ref<FatoDaVenda>('passo')
function abrirRegistro(fato: FatoDaVenda) { fatoDoRegistro.value = fato; registrar.value = true; ajuste.value = null; passo.value = 3 }
function acompanharEnvio() { saidaAoAbrir.value = props.lead.conversa?.ultimaSaida ?? (props.lead.conversa?.ultima.direcao === 'saida' ? props.lead.conversa.ultima.em : null); abriu.value = true; passo.value = 3 }
const contexto = () => JSON.stringify([props.lead.etapa, props.lead.resposta, props.lead.conversa, props.lead.eventos, props.lead.proximoPasso, props.lead.proposta, props.lead.links, props.lead.atendimentoComercial, props.acao?.chave, props.acao?.rascunho])
const contextoRevisado = ref(contexto())
const mudou = computed(() => contextoRevisado.value !== contexto())
const linkDaAcao = computed(() => orientarContato.value && props.disponivel && props.estado !== 'encerrada' && preparo.value?.podeAbrir && !mudou.value ? whatsappParaRevisao(props.lead.links.whatsapp, mensagem.value) : '')
const registroDisponivel = computed(() => props.disponivel && props.registroDisponivel !== false && props.estado !== 'encerrada')
function mudarOcupado(valor: boolean) { ocupado.value = valor; emit('ocupado', valor) }
function revisarContexto() { contextoRevisado.value = contexto(); abriu.value = false; passo.value = 1; preparo.value = null; void prepararMensagem() }
let controleDoPreparo: AbortController | undefined
let validadeDoPreparo: ReturnType<typeof setTimeout> | undefined
async function prepararMensagem() {
  if (!props.disponivel || !orientarContato.value) return
  controleDoPreparo?.abort()
  const controle = new AbortController(); controleDoPreparo = controle
  preparando.value = true; erroDoPreparo.value = ''
  try {
    const contextoHash = await hashDoContexto(props.lead)
    const r = await fetch('/api/operations/crm/decisao/mensagem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controle.signal, body: JSON.stringify({ produto: props.lead.produto, id: props.lead.id, contextoHash }) })
    const dados = await r.json()
    if (!r.ok) throw new Error(dados.error ?? 'Não foi possível preparar a mensagem.')
    if (controle.signal.aborted || await hashDoContexto(props.lead) !== contextoHash) return
    const textoGuardado = textoDoAtendimento(props.lead, contextoHash)
    preparo.value = dados
    await nextTick()
    if (controle.signal.aborted) return
    if (textoGuardado !== undefined) mensagem.value = textoGuardado
    clearTimeout(validadeDoPreparo)
    if (dados.podeAbrir) validadeDoPreparo = setTimeout(() => { if (preparo.value) preparo.value.podeAbrir = false; erroDoPreparo.value = 'A conferência da mensagem expirou. Prepare novamente para conferir a conversa atual.' }, 60_000)
  } catch (e) { if (!controle.signal.aborted) erroDoPreparo.value = e instanceof Error ? e.message : 'Não foi possível preparar a mensagem.' }
  finally { if (!controle.signal.aborted) preparando.value = false }
}
onMounted(() => { if (!['encerrado', 'espera', 'audio', 'interno'].includes(procedimento.value.tipo)) void prepararMensagem() })
onBeforeUnmount(() => { controleDoPreparo?.abort(); clearTimeout(validadeDoPreparo) })
watch(() => props.estado, (estado, anterior) => { if (anterior === 'agora' && estado === 'acompanhando' && !registrar.value) passo.value = 3 })
</script>

<template>
  <article class="missao-conversa" aria-labelledby="missao-titulo">
    <header class="missao-conversa__cabeca"><span class="missao-conversa__contexto">{{ nomesDasOfertas[lead.produto] }} · {{ agente?.nome ?? 'Seu time' }}</span><h2 id="missao-titulo">{{ lead.empresa }}</h2><div class="missao-conversa__estado"><span class="etiqueta">{{ ROTULO_DA_ETAPA[lead.etapa] }}</span><span class="missao-conversa__contexto">{{ motivo }}</span></div></header>
    <nav class="missao-conversa__passos" aria-label="Passos desta decisão"><button v-for="(etapa, i) in passos" :key="etapa.nome" type="button" :aria-current="passo === i + 1 ? 'step' : undefined" :disabled="ocupado" @click="passo = i + 1"><span>{{ i + 1 }}</span><span class="missao-conversa__nome-passo"><strong>{{ etapa.nome }}</strong><small>{{ etapa.detalhe }}</small></span></button></nav>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">Sem leitura recente desta conversa. A atualização tenta novamente automaticamente.</p>
    <p v-if="preparando && passo === 2" class="texto-2 texto-pequeno" role="status">Preparando a mensagem com a conversa e o próximo passo deste cliente…</p>
    <div v-if="erroDoPreparo" class="recado recado--atencao" role="alert"><p>{{ erroDoPreparo }}</p><button type="button" class="botao botao--leve" :disabled="preparando || ocupado" @click="prepararMensagem">Preparar novamente</button></div>
    <div v-if="mudou && passo !== 3" class="recado recado--atencao" role="status"><p>A conversa ou a próxima ação mudou desde que você abriu esta decisão.</p><button class="botao botao--leve" type="button" :disabled="ocupado" @click="revisarContexto">Revisar contexto atualizado</button></div>

    <section v-if="passo === 1" ref="secaoAtual" tabindex="-1" class="missao-conversa__secao" aria-label="Entender o contexto">
      <div class="missao-conversa__situacao"><span>Situação da conversa</span><strong>{{ situacao }}</strong></div>
      <OrientacaoDaConversa :plano="plano" :procedimento="procedimento">
        <template #acoes>
          <button type="button" class="botao botao--primario" :disabled="ocupado || !disponivel" @click="orientarContato && estado !== 'encerrada' ? passo = 2 : conferirNaFicha ? emit('ficha', lead.id) : passo = 3">{{ orientarContato && estado !== 'encerrada' ? 'Revisar mensagem →' : conferirNaFicha ? 'Conferir e resolver na ficha →' : 'Ver acompanhamento →' }}</button>
          <button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('ficha', lead.id)">Abrir ficha completa</button>
        </template>
      </OrientacaoDaConversa>
      <PainelOperacional titulo="O que sustenta esta orientação" contexto="Evidências da conversa" descricao="Confira o que já aconteceu antes de escolher a resposta.">
        <ContextoDaDecisao :lead="lead" />
        <details class="dobra"><summary>Avanços registrados · {{ marcos.filter(m => m.observado).length }}</summary><ul class="missao-conversa__marcos"><li v-for="m in marcos" :key="m.id"><strong>{{ m.nome }}</strong><span>{{ m.detalhe ?? (m.observado ? 'Registrado' : 'Sem registro') }}</span></li></ul></details>
      </PainelOperacional>
    </section>

    <section v-if="passo === 2" ref="secaoAtual" tabindex="-1" class="missao-conversa__secao" aria-label="Decidir e agir">
      <PainelOperacional :titulo="orientarContato ? 'Prepare sua mensagem' : conferirNaFicha ? 'Confira o contexto primeiro' : 'Respeite o combinado da conversa'" :contexto="orientarContato ? 'Responder pelo WhatsApp' : 'Antes de fazer contato'" :descricao="plano.acao" :tom="orientarContato ? 'acao' : 'neutro'">
      <div v-if="preparo?.leitura && !mudou" class="missao-conversa__leitura"><strong>Como a conversa foi interpretada</strong><p>{{ preparo.leitura }}</p><p class="texto-2 texto-pequeno">Confira esta interpretação com a conversa disponível antes de enviar.</p></div>
      <template v-if="orientarContato && (estado === 'agora' || procedimento.tipo === 'robo')">
        <p v-if="procedimento.tipo === 'robo'" class="recado">Só use o pedido de encaminhamento se o menu não indicar outro procedimento. Se já estiver na fila de atendimento, aguarde. A retomada é conferida na ficha.</p>
        <p v-if="preparo?.motivo" class="recado">{{ preparo.motivo }}</p>
        <div v-if="preparo?.mensagem && !mudou" class="missao-conversa__rascunho"><label class="rotulo" for="mensagem-revisada">{{ mensagem !== preparo.mensagem ? 'Seu texto revisado' : preparo?.origem === 'copiloto' ? 'Mensagem sugerida para este cliente' : 'Mensagem padrão · adapte à conversa' }}</label><textarea id="mensagem-revisada" v-model="mensagem" class="campo" rows="7" maxlength="2000" :disabled="ocupado" aria-describedby="mensagem-revisada-ajuda" :aria-invalid="!!impedimentoDoTexto" /><p id="mensagem-revisada-ajuda" class="texto-2 texto-pequeno">{{ impedimentoDoTexto || 'Revise aqui. O texto será levado ao WhatsApp para você enviar.' }}</p></div>
        <p v-if="acaoEfetiva?.conferirHistorico" class="recado">Confira e confirme o histórico na ficha antes de retomar este contato.</p>
        <p v-else-if="acaoEfetiva?.primeiroContato" class="recado">O primeiro contato precisa da conferência de horário e ritmo na ficha.</p>
        <div class="missao-conversa__acoes">
          <a v-if="linkDaAcao && !ocupado" class="botao" :class="{ 'botao--primario': !abriu }" :href="linkDaAcao" target="_blank" rel="noopener" @click="acompanharEnvio">{{ abriu ? 'Reabrir mensagem no WhatsApp ↗' : 'Revisar no WhatsApp ↗' }}</a>
          <button v-if="impedimentoDoTexto" type="button" class="botao botao--primario" disabled>Abrir no WhatsApp</button>
          <button v-else-if="!linkDaAcao && !preparando" type="button" class="botao botao--primario" :disabled="ocupado" @click="emit('ficha', lead.id)">{{ acaoEfetiva?.conferirHistorico ? 'Conferir histórico na ficha' : 'Conferir condições na ficha' }}</button>
        </div>
        <p v-if="procedimento.tipo !== 'interno'" class="texto-2 texto-pequeno">Envie pelo WhatsApp. O time acompanha o texto que realmente sair, incluindo suas edições, assim que a integração o capturar.</p>
      </template>
      <template v-else><p class="texto-2">Este passo pede {{ conferirNaFicha ? 'uma conferência interna antes de preparar contato.' : 'acompanhamento da conversa e dos combinados.' }}</p><button type="button" class="botao botao--primario" :disabled="ocupado" @click="conferirNaFicha ? emit('ficha', lead.id) : passo = 3">{{ conferirNaFicha ? 'Conferir contexto na ficha →' : 'Ver acompanhamento →' }}</button></template>
      <button v-if="orientarContato || conferirNaFicha" type="button" class="botao botao--leve" :disabled="ocupado" @click="passo = 3">Acompanhar conversa →</button>
      </PainelOperacional>
      <PainelOperacional titulo="Confira a conversa" contexto="Referência para sua resposta"><ContextoDaDecisao :lead="lead" /></PainelOperacional>
    </section>

    <section v-if="passo === 3" ref="secaoAtual" tabindex="-1" class="missao-conversa__secao" aria-label="Acompanhar resultado">
      <div class="missao-conversa__resumo"><h3>{{ estado === 'encerrada' ? 'Esta conversa foi encerrada' : 'O que aconteceu depois' }}</h3><p class="texto-2">{{ estado === 'encerrada' ? 'Consulte o resultado e o histórico na ficha de Vendas.' : 'O time acompanha as mensagens capturadas. Abrir o WhatsApp prepara a conversa; a confirmação aparece quando o envio é observado.' }}</p></div>
      <OrientacaoDaConversa v-if="procedimento.tipo === 'interno' && plano.tipo === 'aguardar'" :plano="plano" :procedimento="procedimento" />
      <PainelOperacional titulo="Acompanhamento da conversa" contexto="Envios e respostas observados">
      <AcompanhamentoObservado :lead="lead" :saida-ao-abrir="abriu ? saidaAoAbrir : undefined" />
      <p v-if="disponivel && props.registroDisponivel === false" class="texto-2 texto-pequeno">O acompanhamento continua disponível. Complementos e próximos passos aguardam a conexão de registro.</p>
      <ContextoDaDecisao :lead="lead" />
      </PainelOperacional>
      <div v-if="lead.proximoPasso && estado !== 'encerrada'" class="missao-conversa__combinado"><strong>Próximo passo · {{ formatarData(lead.proximoPasso.data) }}</strong><p>{{ lead.proximoPasso.texto }}</p><div v-if="!ajuste && !registrar && registroDisponivel" class="missao-conversa__acoes"><button type="button" class="botao" :disabled="ocupado" @click="ajuste = 'concluir'">Concluir este passo</button><button type="button" class="botao botao--leve" :disabled="ocupado" @click="ajuste = 'reagendar'">Reagendar</button></div><AjustarProximoPasso v-if="ajuste" :key="lead.id + ajuste" :lead="lead" :modo="ajuste" :disponivel="registroDisponivel" @confirmado="emit('interagiu')" @registrado="emit('registrado')" @ocupado="mudarOcupado" @fechar="ajuste = null" /></div>
      <div v-if="registroDisponivel && !registrar && !ajuste" class="missao-conversa__escolhas"><button class="botao botao--leve" type="button" :disabled="ocupado" @click="abrirRegistro('passo')">Definir próxima ação e data <span>Quando houver algo a fazer além de aguardar a resposta</span></button><details class="dobra"><summary>Complementar ou registrar algo por fora</summary><p class="texto-2 texto-pequeno">Use apenas para contexto adicional, ligações, encontros ou outro canal. As mensagens já lidas dispensam registro.</p><button class="botao botao--leve" type="button" :disabled="ocupado" @click="abrirRegistro('complemento')">Complementar contexto</button><button class="botao botao--leve" type="button" :disabled="ocupado" @click="abrirRegistro('envio')">Registrar contato feito por fora</button><button class="botao botao--leve" type="button" :disabled="ocupado" @click="abrirRegistro('retorno')">Registrar retorno recebido por fora</button></details></div>
      <AndamentoDaVenda v-if="registrar" :key="fatoDoRegistro" :lead="lead" :disponivel="registroDisponivel" :fato-inicial="fatoDoRegistro" @confirmado="emit('interagiu')" @registrado="emit('registrado')" @ocupado="mudarOcupado" @responder="emit('ficha', lead.id)" />
      <button v-if="registrar" class="botao botao--leve" type="button" :disabled="ocupado" @click="registrar = false">Fechar registro</button>
      <details class="dobra"><summary>Últimos registros · {{ lead.eventos.length }}</summary><ul class="missao-conversa__historico"><li v-for="(e, i) in lead.eventos.slice(-6).reverse()" :key="i"><strong>{{ e.rotulo }} · {{ formatarData(e.em) }}</strong><p v-if="e.texto">{{ e.texto }}</p></li></ul><p v-if="!lead.eventos.length" class="texto-2">Nenhum evento disponível nesta leitura.</p></details>
      <div class="missao-conversa__acoes"><button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('fila')">← Voltar à fila de decisões</button><button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('ficha', lead.id)">{{ estado === 'encerrada' ? 'Ver resultado na ficha' : 'Registrar desfecho na ficha' }}</button></div>
    </section>
  </article>
</template>

<style scoped>
.missao-conversa, .missao-conversa__secao { display: grid; gap: var(--esp-5); min-width: 0; }
.missao-conversa__secao { outline: none; }
.missao-conversa__cabeca { display: grid; justify-items: start; gap: var(--esp-2); }
.missao-conversa h2 { font-size: var(--tam-titulo-pagina); font-weight: var(--peso-titulo); line-height: 1.15; letter-spacing: -.025em; margin: 0; overflow-wrap: anywhere; }
.missao-conversa__contexto { font-size: var(--tam-apoio); color: var(--texto-2); font-weight: var(--peso-medio); }
.missao-conversa__estado { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); }
.missao-conversa__situacao { display: grid; gap: var(--esp-1); padding-bottom: var(--esp-4); border-bottom: var(--contorno-painel); }
.missao-conversa__situacao > span { color: var(--texto-2); font-size: var(--tam-apoio); }
.missao-conversa__situacao > strong { font-size: var(--tam-nome); font-weight: var(--peso-medio); }
.missao-conversa h3 { font-size: var(--tam-nome); margin: var(--esp-2) 0; }
.missao-conversa__resumo h3 { font-size: var(--tam-secao); font-weight: var(--peso-titulo); line-height: 1.25; }
.missao-conversa__resumo > p { color: var(--texto-2); max-width: var(--largura-leitura); }
.missao-conversa__nome-passo { display: grid; text-align: left; gap: var(--esp-1); }
.missao-conversa__nome-passo small { font-size: var(--tam-mini); font-weight: var(--peso-texto); }
.missao-conversa__plano { border-top: var(--divisor); padding-top: var(--esp-4); }
.missao-conversa__leitura { display: grid; gap: var(--esp-2); }
.missao-conversa__escolhas { display: grid; gap: var(--esp-2); }
.missao-conversa__escolhas h4 { margin: 0 0 var(--esp-2); font-size: var(--tam-texto); }
.missao-conversa__escolhas button { display: grid; gap: var(--esp-1); justify-items: start; text-align: left; padding: var(--esp-3) var(--esp-4); }
.missao-conversa__escolhas button span { color: var(--texto-2); font-size: var(--tam-apoio); font-weight: var(--peso-texto); }
.missao-conversa .missao-conversa__escolhas .botao { justify-content: start; text-align: left; }
.missao-conversa p { margin: var(--esp-2) 0 0; overflow-wrap: anywhere; }
.missao-conversa__passos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--esp-2); border-bottom: var(--divisor); padding-bottom: var(--esp-3); }
.missao-conversa__passos button { display: flex; align-items: center; justify-content: center; gap: var(--esp-2); min-height: var(--toque); padding: var(--esp-2); border: 0; border-radius: var(--raio-controle); color: var(--texto-2); background: var(--superficie-2); font: inherit; font-size: var(--tam-apoio); cursor: pointer; }
.missao-conversa__passos button[aria-current="step"] { color: var(--texto); background: var(--realce); box-shadow: inset 0 -3px 0 var(--destaque); }
.missao-conversa__passos button > span { font-variant-numeric: tabular-nums; }
.missao-conversa__objetivo { padding: var(--esp-4); background: var(--realce); border-radius: var(--raio-controle); }
.missao-conversa__rascunho { display: grid; gap: var(--esp-2); }
.missao-conversa__rascunho textarea { width: 100%; resize: vertical; line-height: 1.6; }
.missao-conversa__rascunho p, .missao-conversa__historico p { white-space: pre-wrap; }
.missao-conversa__combinado { display: grid; gap: var(--esp-3); padding: var(--esp-4); background: var(--superficie-2); border-radius: var(--raio-controle); }
.missao-conversa__marcos { display: grid; gap: var(--esp-3); list-style: none; padding: var(--esp-3) 0; margin: 0; }
.missao-conversa__marcos li { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-2); }
.missao-conversa__marcos span { color: var(--texto-2); }
.missao-conversa blockquote { display: grid; gap: var(--esp-2); margin: 0; padding: var(--esp-4); background: var(--superficie-2); border-radius: var(--raio-controle); }
.missao-conversa__acoes { display: flex; flex-wrap: wrap; gap: var(--esp-3); }
.missao-conversa__historico { display: grid; gap: var(--esp-4); padding-left: var(--esp-5); }
.missao-conversa__procedimento { display: grid; gap: var(--esp-2); padding: var(--esp-4) 0; }
.missao-conversa__procedimento h4 { margin: 0; font-size: var(--tam-texto); }
.missao-conversa__procedimento ol { display: grid; gap: var(--esp-3); padding-left: var(--esp-5); margin: 0; }
.missao-conversa .botao { white-space: normal; }
@media(max-width:47.99rem) { .missao-conversa__passos button { font-size: var(--tam-mini); gap: var(--esp-1); } .missao-conversa__nome-passo small { display: none; } .missao-conversa__acoes .botao--primario { width: 100%; } }
@media(max-width:28rem) { .missao-conversa__passos { grid-template-columns: 1fr; } .missao-conversa__passos button { justify-content: flex-start; gap: var(--esp-3); padding-inline: var(--esp-3); font-size: var(--tam-apoio); } }
</style>
