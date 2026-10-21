<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CrmLead } from '../operations/types'
import type { Pessoa } from '../types'
import AjustarProximoPasso from './AjustarProximoPasso.vue'
import AndamentoDaVenda from './AndamentoDaVenda.vue'
import { marcosDaMissao, movimentoDaMissao } from './missao'
import { diaEmSP } from '../operations/retomadas'
import { agoraDaFicha, textoDaAnotacaoDeVenda, type AcaoDeVenda } from '../operations/proxima-venda'
import { textoParaATela } from '../operations/marcadores-da-conversa'
import { whatsappParaRevisao, hashDoContexto } from '../operations/revisao-resposta'
import { nomesDasOfertas, type EstadoDaDecisao } from './decisoes'
import { procedimentoDaDecisao, type MensagemDaDecisao } from './procedimento-da-decisao'

const props = defineProps<{ lead: CrmLead; agente?: Pessoa; disponivel: boolean; motivo: string; acao?: AcaoDeVenda | null; estado?: EstadoDaDecisao }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; ocupado: [valor: boolean]; fila: [] }>()
const procedimento = computed(() => procedimentoDaDecisao(props.lead))
const preparo = ref<MensagemDaDecisao | null>(null), preparando = ref(false), erroDoPreparo = ref('')
const acaoEfetiva = computed(() => preparo.value?.acao ?? props.acao)
const mensagem = computed(() => preparo.value?.mensagem ?? '')
const passo = ref(props.estado === 'agora' || !props.estado || procedimento.value.tipo === 'robo' ? 1 : 3)
const passos = ['Entender', 'Agir', 'Acompanhar']
const marcos = computed(() => marcosDaMissao(props.lead))
const movimento = computed(() => movimentoDaMissao(props.lead, acaoEfetiva.value, diaEmSP(new Date())))
const agora = computed(() => procedimento.value.tipo === 'robo'
  ? { frase: procedimento.value.titulo, como: 'Use o menu ou aguarde o atendimento. O pedido de encaminhamento só cabe quando ainda não há uma pessoa na conversa.' }
  : movimento.value.doCombinado ? { frase: movimento.value.titulo, como: movimento.value.passos.join(' ') }
  : !acaoEfetiva.value && props.estado === 'agora'
  ? { frase: props.lead.proximoPasso?.texto || 'Confira a resposta e escolha como continuar a conversa.', como: 'Abra a ficha para revisar o histórico e definir a próxima ação.' }
  : agoraDaFicha(props.lead, acaoEfetiva.value ?? null))
const ultima = computed(() => props.lead.conversa?.ultima ?? null)
const rotuloDaUltima = computed(() => ultima.value?.direcao === 'saida' ? 'Última mensagem enviada' : ultima.value?.papel === 'robo' ? 'Última mensagem do robô' : 'Última mensagem recebida')
function formatarData(valor: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor.split('-').reverse().join('/')
  return Number.isFinite(Date.parse(valor)) ? new Date(valor).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'Data não informada'
}
const ocupado = ref(false), abriu = ref(false), confirmado = ref(''), status = ref(''), erro = ref(''), incerto = ref(false)
const ajuste = ref<'concluir' | 'reagendar' | null>(null), registrar = ref(false)
const mensagemParaRegistro = ref('')
const contexto = () => JSON.stringify([props.lead.etapa, props.lead.resposta, props.lead.conversa, props.lead.eventos, props.lead.proximoPasso, props.lead.proposta, props.lead.links, props.acao?.chave, props.acao?.rascunho])
const contextoRevisado = ref(contexto())
let hashRevisado = hashDoContexto(props.lead)
const mudou = computed(() => contextoRevisado.value !== contexto())
const linkDaAcao = computed(() => props.disponivel && props.estado !== 'encerrada' && preparo.value?.podeAbrir && !mudou.value ? whatsappParaRevisao(props.lead.links.whatsapp, mensagem.value) : '')
const envioConfirmado = computed(() => !!confirmado.value)
const anotacaoPossivel = computed(() => acaoEfetiva.value?.anota && acaoEfetiva.value.anota !== 'recusou' && !acaoEfetiva.value.primeiroContato && !acaoEfetiva.value.conferirHistorico)
const registroDisponivel = computed(() => props.disponivel && props.estado !== 'encerrada')
const anotacaoDaSessao = 'squadone.decisao.' + props.lead.id
try { incerto.value = sessionStorage.getItem(anotacaoDaSessao) === 'incerto' } catch { /* Continua em memória. */ }
function memorizarIncerto(valor: boolean) { try { if (valor) sessionStorage.setItem(anotacaoDaSessao, 'incerto'); else sessionStorage.removeItem(anotacaoDaSessao) } catch { /* Continua em memória. */ } }
function mudarOcupado(valor: boolean) { ocupado.value = valor; emit('ocupado', valor) }
function revisarContexto() { contextoRevisado.value = contexto(); hashRevisado = hashDoContexto(props.lead); abriu.value = false; passo.value = 1; erro.value = ''; preparo.value = null; void prepararMensagem() }
let controleDoPreparo: AbortController | undefined
let validadeDoPreparo: ReturnType<typeof setTimeout> | undefined
async function prepararMensagem() {
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
watch(() => props.acao?.chave, () => { abriu.value = false })
async function anotar() {
  const a = acaoEfetiva.value
  if (!a || !anotacaoPossivel.value || !registroDisponivel.value || !abriu.value || ocupado.value || incerto.value || envioConfirmado.value || mudou.value) return
  mudarOcupado(true); erro.value = ''
  try {
    if (await hashDoContexto(props.lead) !== await hashRevisado) throw new Error('O contexto mudou. Revise a conversa atualizada antes de confirmar.')
    memorizarIncerto(true)
    const r = await fetch('/api/operations/crm/venda/anotar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: a.chave, produto: props.lead.produto, id: props.lead.chave, tipo: a.anota, texto: textoDaAnotacaoDeVenda({ ...a, rascunho: mensagem.value }) }) })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) { incerto.value = r.status >= 500; if (!incerto.value) memorizarIncerto(false); throw new Error(corpo.error ?? 'Não foi possível confirmar o registro.') }
    const resolucao = await fetch('/api/operations/crm/venda', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: a.chave, como: 'enviada' }) })
    if (!resolucao.ok) { incerto.value = true; throw new Error('O envio foi anotado, mas não foi possível atualizar a fila. Confira o histórico e atualize a leitura antes de repetir.') }
    memorizarIncerto(false); confirmado.value = a.chave
    status.value = corpo.jaEstava ? 'Este envio já estava registrado.' : 'Envio confirmado e registrado.'
    passo.value = 3; emit('registrado')
  } catch (e) { if (e instanceof TypeError) incerto.value = true; erro.value = e instanceof Error ? e.message : 'Não foi possível registrar.' }
  finally { mudarOcupado(false) }
}
</script>

<template>
  <article class="missao-conversa" aria-labelledby="missao-titulo">
    <header class="missao-conversa__cabeca"><span class="sobretitulo">{{ nomesDasOfertas[lead.produto] }} · {{ agente?.nome ?? 'Seu time' }}</span><h2 id="missao-titulo">{{ lead.empresa }}</h2><span class="etiqueta">{{ motivo }}</span></header>
    <nav class="missao-conversa__passos" aria-label="Passos desta decisão"><button v-for="(nome, i) in passos" :key="nome" type="button" :aria-current="passo === i + 1 ? 'step' : undefined" :disabled="ocupado" @click="passo = i + 1"><span>{{ i + 1 }}</span><strong>{{ nome }}</strong></button></nav>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">O registro está indisponível nesta leitura. Atualize a fila para conferir antes de salvar.</p>
    <p v-if="preparando" class="texto-2 texto-pequeno" role="status">Preparando a mensagem com a conversa e o próximo passo deste cliente…</p>
    <div v-if="erroDoPreparo" class="recado recado--atencao" role="alert"><p>{{ erroDoPreparo }}</p><button type="button" class="botao botao--leve" :disabled="preparando || ocupado" @click="prepararMensagem">Preparar novamente</button></div>
    <div v-if="mudou && !envioConfirmado" class="recado recado--atencao" role="status"><p>A conversa ou a próxima ação mudou desde que você abriu esta decisão.</p><button class="botao botao--leve" type="button" :disabled="ocupado" @click="revisarContexto">Revisar contexto atualizado</button></div>

    <section v-if="passo === 1" class="missao-conversa__secao" aria-label="Entender o contexto">
      <div><span class="sobretitulo">1 · Entender</span><h3>Por que este cliente precisa de você?</h3><p>{{ motivo }}</p><p v-if="acaoEfetiva?.porque" class="texto-2">{{ acaoEfetiva.porque }}</p></div>
      <blockquote v-if="ultima"><span class="sobretitulo">{{ rotuloDaUltima }} · {{ formatarData(ultima.em) }}</span><p>{{ ultima.trecho ? '“' + textoParaATela(ultima.trecho) + '”' : 'O texto desta mensagem não foi guardado. Confira a conversa no WhatsApp.' }}</p></blockquote>
      <p v-else class="recado">Ainda não há mensagem observada nesta leitura. Confira a conversa antes de escolher sua ação.</p>
      <div class="missao-conversa__procedimento"><h3>{{ procedimento.titulo }}</h3><ol><li v-for="p in procedimento.passos" :key="p">{{ p }}</li></ol><p><strong>Quando este passo termina:</strong> {{ procedimento.resultadoEsperado }}</p></div>
      <p v-if="lead.proximoPasso"><strong>Próximo passo registrado · {{ formatarData(lead.proximoPasso.data) }}</strong><br />{{ lead.proximoPasso.texto }}</p>
      <details class="dobra"><summary>Ver avanços registrados na venda</summary><ul class="missao-conversa__marcos"><li v-for="m in marcos" :key="m.id"><strong>{{ m.nome }}</strong><span>{{ m.detalhe ?? (m.observado ? 'Registrado' : 'Sem registro') }}</span></li></ul></details>
      <div class="missao-conversa__acoes"><button type="button" class="botao botao--primario" :disabled="ocupado" @click="passo = estado === 'agora' || procedimento.tipo === 'robo' ? 2 : 3">{{ estado === 'agora' || procedimento.tipo === 'robo' ? 'Entendi, ver próxima ação →' : 'Ver acompanhamento →' }}</button><button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('ficha', lead.id)">Ver contexto completo</button></div>
    </section>

    <section v-if="passo === 2" class="missao-conversa__secao" aria-label="Decidir e agir">
      <div class="missao-conversa__objetivo"><span class="sobretitulo">2 · Agir</span><h3>{{ agora.frase }}</h3><p v-if="agora.como">{{ agora.como }}</p></div>
      <template v-if="(estado === 'agora' || procedimento.tipo === 'robo') && !envioConfirmado">
        <p v-if="procedimento.tipo === 'robo'" class="recado">Só use o pedido de encaminhamento se o menu não indicar outro procedimento. Se já estiver na fila de atendimento, aguarde. A retomada é conferida na ficha.</p>
        <p v-if="preparo?.motivo" class="recado">{{ preparo.motivo }}</p>
        <div v-if="mensagem && !mudou" class="missao-conversa__rascunho"><span class="sobretitulo">Mensagem sugerida · revise antes de enviar</span><p>{{ mensagem }}</p></div>
        <p v-if="acaoEfetiva?.conferirHistorico" class="recado">Confira e confirme o histórico na ficha antes de retomar este contato.</p>
        <p v-else-if="acaoEfetiva?.primeiroContato" class="recado">O primeiro contato precisa da conferência de horário e ritmo na ficha.</p>
        <div class="missao-conversa__acoes">
          <a v-if="linkDaAcao && !ocupado && !incerto" class="botao" :class="{ 'botao--primario': !abriu }" :href="linkDaAcao" target="_blank" rel="noopener" @click="abriu = true">{{ abriu ? 'Reabrir mensagem no WhatsApp ↗' : 'Revisar no WhatsApp ↗' }}</a>
          <button v-if="abriu && anotacaoPossivel" type="button" class="botao botao--primario" :disabled="!registroDisponivel || ocupado || incerto || mudou" @click="anotar">{{ ocupado ? 'Registrando…' : 'Enviei esta mensagem · confirmar' }}</button>
          <button v-if="abriu && !anotacaoPossivel" type="button" class="botao botao--primario" :disabled="!registroDisponivel || ocupado" @click="mensagemParaRegistro = mensagem; passo = 3; registrar = true">Enviei · registrar o acontecimento</button>
          <button v-if="!linkDaAcao && !preparando" type="button" class="botao botao--primario" :disabled="ocupado" @click="emit('ficha', lead.id)">{{ acaoEfetiva?.conferirHistorico ? 'Conferir histórico na ficha' : 'Conduzir pela ficha' }}</button>
        </div>
        <p class="texto-2 texto-pequeno">Abrir o WhatsApp prepara a mensagem. Confirme aqui somente depois de enviar; a confirmação registra a mensagem sugerida. Se você mudou o texto, registre o envio pela ficha.</p>
      </template>
      <button v-else type="button" class="botao botao--primario" @click="passo = 3">Ver acompanhamento →</button>
      <button type="button" class="botao botao--leve" :disabled="ocupado" @click="passo = 3">Acompanhar ou definir próximo passo</button>
    </section>

    <section v-if="passo === 3" class="missao-conversa__secao" aria-label="Acompanhar resultado">
      <div><span class="sobretitulo">3 · Acompanhar</span><h3>{{ estado === 'encerrada' ? 'Esta conversa foi encerrada' : envioConfirmado ? 'Ação registrada. O que vem depois?' : 'Deixe o próximo passo claro' }}</h3><p class="texto-2">{{ estado === 'encerrada' ? 'Consulte o resultado e o histórico na ficha de Vendas.' : 'A decisão continua acompanhada até haver uma resposta, um novo compromisso ou um desfecho registrado.' }}</p></div>
      <p v-if="status" class="recado recado--ok" role="status">{{ status }} A leitura da fila será atualizada.</p>
      <div v-if="lead.proximoPasso && estado !== 'encerrada'" class="missao-conversa__combinado"><strong>Próximo passo · {{ formatarData(lead.proximoPasso.data) }}</strong><p>{{ lead.proximoPasso.texto }}</p><div v-if="!ajuste && !registrar && registroDisponivel" class="missao-conversa__acoes"><button type="button" class="botao" :disabled="ocupado" @click="ajuste = 'concluir'">Concluir este passo</button><button type="button" class="botao botao--leve" :disabled="ocupado" @click="ajuste = 'reagendar'">Reagendar</button></div><AjustarProximoPasso v-if="ajuste" :key="lead.id + ajuste" :lead="lead" :modo="ajuste" :disponivel="registroDisponivel" @registrado="emit('registrado')" @ocupado="mudarOcupado" @fechar="ajuste = null" /></div>
      <p v-else-if="estado !== 'encerrada'" class="recado">Nenhum próximo passo registrado. Defina sua ação e a data para saber quando retomar.</p>
      <button v-if="registroDisponivel && !registrar && !ajuste" class="botao botao--primario" type="button" :disabled="ocupado" @click="registrar = true">{{ lead.proximoPasso ? 'Registrar um novo acontecimento' : 'Definir próximo passo' }}</button>
      <AndamentoDaVenda v-if="registrar" :lead="lead" :mensagem="mensagemParaRegistro || undefined" :disponivel="registroDisponivel" :fato-inicial="lead.proximoPasso ? undefined : 'passo'" @registrado="emit('registrado')" @ocupado="mudarOcupado" @responder="emit('ficha', lead.id)" />
      <button v-if="registrar" class="botao botao--leve" type="button" :disabled="ocupado" @click="registrar = false">Fechar registro</button>
      <details class="dobra"><summary>Últimos registros · {{ lead.eventos.length }}</summary><ul class="missao-conversa__historico"><li v-for="(e, i) in lead.eventos.slice(-6).reverse()" :key="i"><strong>{{ e.rotulo }} · {{ formatarData(e.em) }}</strong><p v-if="e.texto">{{ e.texto }}</p></li></ul><p v-if="!lead.eventos.length" class="texto-2">Nenhum evento disponível nesta leitura.</p></details>
      <div class="missao-conversa__acoes"><button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('fila')">← Voltar à fila de decisões</button><button type="button" class="botao botao--leve" :disabled="ocupado" @click="emit('ficha', lead.id)">{{ estado === 'encerrada' ? 'Ver resultado na ficha' : 'Registrar desfecho na ficha' }}</button></div>
    </section>
    <p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>
    <div v-if="incerto" class="recado recado--atencao" role="status"><p>O resultado do registro é incerto. Confira o histórico na ficha antes de tentar novamente.</p><button type="button" class="botao botao--leve" @click="emit('ficha', lead.id)">Conferir histórico na ficha</button><button type="button" class="botao botao--leve" @click="incerto = false; memorizarIncerto(false); abriu = false">Conferi o histórico · liberar nova revisão</button></div>
  </article>
</template>

<style scoped>
.missao-conversa, .missao-conversa__secao { display: grid; gap: var(--esp-5); min-width: 0; }
.missao-conversa__cabeca { display: grid; justify-items: start; gap: var(--esp-2); }
.missao-conversa h2 { font-size: var(--tam-titulo-bloco); margin: 0; overflow-wrap: anywhere; }
.missao-conversa h3 { font-size: var(--tam-nome); margin: var(--esp-2) 0; }
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
.missao-conversa__procedimento { display: grid; gap: var(--esp-2); padding: var(--esp-4); background: var(--superficie-2); border-radius: var(--raio-controle); }
.missao-conversa__procedimento ol { display: grid; gap: var(--esp-3); padding-left: var(--esp-5); margin: 0; }
.missao-conversa .botao { white-space: normal; }
@media(max-width:47.99rem) { .missao-conversa__passos button { font-size: var(--tam-mini); gap: var(--esp-1); } }
</style>
