<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CrmLead } from '../operations/types'
import type { Pessoa } from '../types'
import AjustarProximoPasso from './AjustarProximoPasso.vue'
import AndamentoDaVenda from './AndamentoDaVenda.vue'
import ContextoDaDecisao from './ContextoDaDecisao.vue'
import AcompanhamentoObservado from './AcompanhamentoObservado.vue'
import type { FatoDaVenda } from './andamento'
import { marcosDaMissao } from './missao'
import { agoraDaFicha, type AcaoDeVenda } from '../operations/proxima-venda'
import { whatsappParaRevisao, hashDoContexto } from '../operations/revisao-resposta'
import { nomesDasOfertas, type EstadoDaDecisao } from './decisoes'
import { procedimentoDaDecisao, type MensagemDaDecisao } from './procedimento-da-decisao'
import { planoDoLead } from '../operations/bi-operacao'

const props = defineProps<{ lead: CrmLead; agente?: Pessoa; disponivel: boolean; registroDisponivel?: boolean; motivo: string; acao?: AcaoDeVenda | null; estado?: EstadoDaDecisao }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; interagiu: []; ocupado: [valor: boolean]; fila: [] }>()
const procedimento = computed(() => procedimentoDaDecisao(props.lead))
const plano = computed(() => planoDoLead(props.lead))
const preparo = ref<MensagemDaDecisao | null>(null), preparando = ref(false), erroDoPreparo = ref('')
const acaoEfetiva = computed(() => preparo.value ? preparo.value.acao : props.acao)
const mensagem = computed(() => procedimento.value.tipo === 'interno' ? '' : preparo.value?.mensagem ?? '')
const passo = ref(props.estado === 'agora' || !props.estado || procedimento.value.tipo === 'robo' ? 1 : 3)
const passos = [{ nome: 'Entender', detalhe: 'Contexto da conversa' }, { nome: 'Agir', detalhe: 'Sua próxima ação' }, { nome: 'Acompanhar', detalhe: 'Leitura automática da conversa' }]
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
const linkDaAcao = computed(() => plano.value.tipo === 'agir' && props.disponivel && props.estado !== 'encerrada' && procedimento.value.tipo !== 'interno' && preparo.value?.podeAbrir && !mudou.value ? whatsappParaRevisao(props.lead.links.whatsapp, mensagem.value) : '')
const registroDisponivel = computed(() => props.disponivel && props.registroDisponivel !== false && props.estado !== 'encerrada')
function mudarOcupado(valor: boolean) { ocupado.value = valor; emit('ocupado', valor) }
function revisarContexto() { contextoRevisado.value = contexto(); abriu.value = false; passo.value = 1; preparo.value = null; void prepararMensagem() }
let controleDoPreparo: AbortController | undefined
let validadeDoPreparo: ReturnType<typeof setTimeout> | undefined
async function prepararMensagem() {
  if (plano.value.tipo !== 'agir') return
  controleDoPreparo?.abort()
  const controle = new AbortController(); controleDoPreparo = controle
  preparando.value = true; erroDoPreparo.value = ''
  try {
    const contextoHash = await hashDoContexto(props.lead)
    const r = await fetch('/api/operations/crm/decisao/mensagem', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controle.signal, body: JSON.stringify({ produto: props.lead.produto, id: props.lead.id, contextoHash }) })
    const dados = await r.json()
    if (!r.ok) throw new Error(dados.error ?? 'Não foi possível preparar a mensagem.')
    if (controle.signal.aborted || await hashDoContexto(props.lead) !== contextoHash) return
    preparo.value = dados
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
    <header class="missao-conversa__cabeca"><span class="sobretitulo">{{ nomesDasOfertas[lead.produto] }} · {{ agente?.nome ?? 'Seu time' }}</span><h2 id="missao-titulo">{{ lead.empresa }}</h2><span class="etiqueta">{{ motivo }}</span></header>
    <nav class="missao-conversa__passos" aria-label="Passos desta decisão"><button v-for="(etapa, i) in passos" :key="etapa.nome" type="button" :aria-current="passo === i + 1 ? 'step' : undefined" :disabled="ocupado" @click="passo = i + 1"><span>{{ i + 1 }}</span><span class="missao-conversa__nome-passo"><strong>{{ etapa.nome }}</strong><small>{{ etapa.detalhe }}</small></span></button></nav>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">Sem leitura recente desta conversa. A atualização tenta novamente automaticamente.</p>
    <p v-if="preparando && passo === 2" class="texto-2 texto-pequeno" role="status">Preparando a mensagem com a conversa e o próximo passo deste cliente…</p>
    <div v-if="erroDoPreparo" class="recado recado--atencao" role="alert"><p>{{ erroDoPreparo }}</p><button type="button" class="botao botao--leve" :disabled="preparando || ocupado" @click="prepararMensagem">Preparar novamente</button></div>
    <div v-if="mudou && passo !== 3" class="recado recado--atencao" role="status"><p>A conversa ou a próxima ação mudou desde que você abriu esta decisão.</p><button class="botao botao--leve" type="button" :disabled="ocupado" @click="revisarContexto">Revisar contexto atualizado</button></div>

    <section v-if="passo === 1" class="missao-conversa__secao" aria-label="Entender o contexto">
      <div class="missao-conversa__resumo"><span class="sobretitulo">1 · Situação atual</span><h3>{{ situacao }}</h3><p>{{ lead.proximoPasso ? `Próxima ação registrada para ${formatarData(lead.proximoPasso.data)}.` : lead.conversa?.ultima.direcao === 'saida' ? 'Confira o que já foi respondido antes de fazer outro contato.' : 'Leia a troca abaixo para decidir como continuar.' }}</p></div>
      <ContextoDaDecisao :lead="lead" />
      <div v-if="lead.proximoPasso" class="missao-conversa__plano"><span class="sobretitulo">Próximo passo registrado · {{ formatarData(lead.proximoPasso.data) }}</span><p>{{ lead.proximoPasso.texto }}</p></div>
      <details class="dobra"><summary>Orientação e avanços da venda</summary><div class="missao-conversa__procedimento"><h4>{{ procedimento.titulo }}</h4><ol><li v-for="p in procedimento.passos" :key="p">{{ p }}</li></ol><p><strong>Resultado esperado:</strong> {{ procedimento.resultadoEsperado }}</p></div><ul class="missao-conversa__marcos"><li v-for="m in marcos" :key="m.id"><strong>{{ m.nome }}</strong><span>{{ m.detalhe ?? (m.observado ? 'Registrado' : 'Sem registro') }}</span></li></ul></details>
      <div class="missao-conversa__acoes"><button type="button" class="botao botao--primario" :disabled="ocupado" @click="passo = estado === 'agora' || procedimento.tipo === 'robo' ? 2 : 3">{{ estado === 'agora' || procedimento.tipo === 'robo' ? 'Entendi, ver próxima ação →' : 'Ver acompanhamento →' }}</button><button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('ficha', lead.id)">Ver contexto completo</button></div>
    </section>

    <section v-if="passo === 2" class="missao-conversa__secao" aria-label="Decidir e agir">
      <div class="missao-conversa__objetivo"><span class="sobretitulo">2 · {{ plano.tipo === 'aguardar' ? 'Aguardar' : plano.tipo === 'conferir' ? 'Resolver contexto' : 'Agir' }} · {{ plano.responsavel }}</span><h3>{{ plano.acao }}</h3><p><strong>Quando:</strong> {{ plano.prazo }}</p><p><strong>Evidência:</strong> {{ plano.evidencia }}</p><p v-if="plano.condicao"><strong>Antes de agir:</strong> {{ plano.condicao }}</p><p><strong>Resultado esperado:</strong> {{ plano.resultado }}</p><p v-if="preparo?.proximaAcao && !mudou"><strong>Orientação da resposta preparada:</strong> {{ agora.frase }}</p></div>
      <ContextoDaDecisao :lead="lead" />
      <div v-if="preparo?.leitura && !mudou" class="missao-conversa__leitura"><strong>Como a conversa foi interpretada</strong><p>{{ preparo.leitura }}</p><p class="texto-2 texto-pequeno">Confira esta interpretação com os trechos acima antes de enviar.</p></div>
      <template v-if="plano.tipo === 'agir' && (estado === 'agora' || procedimento.tipo === 'robo')">
        <p v-if="procedimento.tipo === 'robo'" class="recado">Só use o pedido de encaminhamento se o menu não indicar outro procedimento. Se já estiver na fila de atendimento, aguarde. A retomada é conferida na ficha.</p>
        <p v-if="preparo?.motivo" class="recado">{{ preparo.motivo }}</p>
        <div v-if="mensagem && !mudou" class="missao-conversa__rascunho"><span class="sobretitulo">{{ preparo?.origem === 'copiloto' ? 'Resposta preparada com a conversa' : 'Mensagem padrão · confira se cabe nesta conversa' }}</span><p>{{ mensagem }}</p></div>
        <p v-if="acaoEfetiva?.conferirHistorico" class="recado">Confira e confirme o histórico na ficha antes de retomar este contato.</p>
        <p v-else-if="acaoEfetiva?.primeiroContato" class="recado">O primeiro contato precisa da conferência de horário e ritmo na ficha.</p>
        <div class="missao-conversa__acoes">
          <a v-if="linkDaAcao && !ocupado" class="botao" :class="{ 'botao--primario': !abriu }" :href="linkDaAcao" target="_blank" rel="noopener" @click="acompanharEnvio">{{ abriu ? 'Reabrir mensagem no WhatsApp ↗' : 'Revisar no WhatsApp ↗' }}</a>
          <button v-if="!linkDaAcao && !preparando" type="button" class="botao botao--primario" :disabled="ocupado" @click="emit('ficha', lead.id)">{{ acaoEfetiva?.conferirHistorico ? 'Conferir histórico na ficha' : 'Conduzir pela ficha' }}</button>
        </div>
        <p v-if="procedimento.tipo !== 'interno'" class="texto-2 texto-pequeno">Envie pelo WhatsApp. O time acompanha o texto que realmente sair, incluindo suas edições, assim que a integração o capturar.</p>
      </template>
      <button v-else type="button" class="botao botao--primario" @click="plano.tipo === 'conferir' ? emit('ficha', lead.id) : passo = 3">{{ plano.tipo === 'conferir' ? 'Conferir contexto na ficha →' : 'Ver acompanhamento →' }}</button>
      <button type="button" class="botao botao--leve" :disabled="ocupado" @click="passo = 3">Acompanhar conversa →</button>
    </section>

    <section v-if="passo === 3" class="missao-conversa__secao" aria-label="Acompanhar resultado">
      <div class="missao-conversa__resumo"><span class="sobretitulo">3 · Acompanhar</span><h3>{{ estado === 'encerrada' ? 'Esta conversa foi encerrada' : 'Conversa acompanhada automaticamente' }}</h3><p class="texto-2">{{ estado === 'encerrada' ? 'Consulte o resultado e o histórico na ficha de Vendas.' : 'Envios e respostas capturados aparecem automaticamente. Você só precisa complementar o que faltar ou definir uma próxima ação.' }}</p></div>
      <AcompanhamentoObservado :lead="lead" :saida-ao-abrir="abriu ? saidaAoAbrir : undefined" />
      <p v-if="disponivel && props.registroDisponivel === false" class="texto-2 texto-pequeno">O acompanhamento continua disponível. Complementos e próximos passos aguardam a conexão de registro.</p>
      <ContextoDaDecisao :lead="lead" />
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
.missao-conversa__cabeca { display: grid; justify-items: start; gap: var(--esp-2); }
.missao-conversa h2 { font-size: var(--tam-titulo-bloco); margin: 0; overflow-wrap: anywhere; }
.missao-conversa h3 { font-size: var(--tam-nome); margin: var(--esp-2) 0; }
.missao-conversa__resumo h3 { font-size: var(--tam-secao); font-weight: var(--peso-titulo); line-height: 1.25; }
.missao-conversa__resumo > p { color: var(--texto-2); max-width: var(--largura-leitura); }
.missao-conversa__nome-passo { display: grid; text-align: left; gap: var(--esp-1); }
.missao-conversa__nome-passo small { font-size: var(--tam-mini); font-weight: var(--peso-texto); }
.missao-conversa__plano, .missao-conversa__leitura { border-top: var(--divisor); padding-top: var(--esp-4); }
.missao-conversa__escolhas { display: grid; gap: var(--esp-2); }
.missao-conversa__escolhas h4 { margin: 0 0 var(--esp-2); font-size: var(--tam-texto); }
.missao-conversa__escolhas button { display: grid; gap: var(--esp-1); justify-items: start; text-align: left; padding: var(--esp-3) var(--esp-4); }
.missao-conversa__escolhas button span { color: var(--texto-2); font-size: var(--tam-apoio); font-weight: var(--peso-texto); }
.missao-conversa .missao-conversa__escolhas .botao { justify-content: start; text-align: left; }
.missao-conversa p { margin: var(--esp-2) 0 0; overflow-wrap: anywhere; }
.missao-conversa__passos { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--esp-2); border-bottom: var(--divisor); padding-bottom: var(--esp-3); }
.missao-conversa__passos button { display: flex; align-items: center; justify-content: center; gap: var(--esp-2); min-height: var(--toque); padding: var(--esp-2); border: 0; border-radius: var(--raio-controle); color: var(--texto-2); background: var(--superficie-2); font: inherit; font-size: var(--tam-apoio); cursor: pointer; }
.missao-conversa__passos button[aria-current="step"] { color: var(--destaque-texto); background: var(--destaque); }
.missao-conversa__passos button > span { font-variant-numeric: tabular-nums; }
.missao-conversa__objetivo { padding: var(--esp-4); background: var(--realce); border-radius: var(--raio-controle); }
.missao-conversa__rascunho { padding: var(--esp-4); background: var(--superficie-2); border-radius: var(--raio-controle); }
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
@media(max-width:47.99rem) { .missao-conversa__passos button { font-size: var(--tam-mini); gap: var(--esp-1); } .missao-conversa__nome-passo small { display: none; } }
</style>
