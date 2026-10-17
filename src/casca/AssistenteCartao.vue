<script setup lang="ts">
/**
 * Um cartão proposto pelo Assistente (RULES 28: ele propõe, o Rômulo faz). Nada escreve sem o
 * toque, e quem escreve é a rota que já existe, com a guarda de mesma origem (regra 10):
 *  - `pedido_ao_time`: o MESMO caminho do Pedir (`handleDelegation` do estado dos agentes, com as
 *    mesmas guardas). Sem a agenda neste processo não há para onde mandar: o cartão diz por quê;
 *  - `anotacao_no_crm`: o POST /api/operations/crm/registro da Ficha, com o corpo dela;
 *  - `mensagem_ao_lead`: só "Copiar" (regras 11 e 17). Nunca abre o WhatsApp nem anota envio.
 *  - `sugestao_do_copiloto` (fase 2): a sugestão guardada do copiloto, relida e montada com o preço do
 *    cardápio por AssistenteSugestao.vue; também só "Copiar".
 * Depois do toque, `marcarDesfecho` avisa o servidor, que só conta.
 */
import { computed, onBeforeUnmount, ref } from 'vue'
import type { CartaoDoAssistente } from '../operations/assistente-contrato'
import { useAgentes } from '../agentes/estado'
import AssistenteSugestao from './AssistenteSugestao.vue'
import { chaveParaRegistro, copiarTexto, estadoDoCartao, horaCurta, leadDoCartao, modoDoTurno, useAssistente } from './assistente'

/** `leadAberto`: o lead da Ficha aberta agora (o contexto do endereço), para avisar quando o cartão é de outro. */
const props = defineProps<{ cartao: CartaoDoAssistente; agentes: boolean; leadAberto?: { produto: string; id: string } | null }>()

const lead = computed(() => (props.cartao.tipo === 'pedido_ao_time' ? null : leadDoCartao(props.cartao.dados, props.leadAberto)))

const ag = useAgentes()
const as = useAssistente()

const estado = computed(() => estadoDoCartao(props.cartao, as.desfechos.value[props.cartao.id]))
const proposto = computed(() => estado.value === 'proposto')

const descartar = () => as.marcarDesfecho(props.cartao.id, 'descartado')

// ------------------------------------------------------------ pedido ao time

const MODOS = [
  { valor: 'auto', rotulo: 'Auto' },
  { valor: 'foco', rotulo: 'Foco' },
  { valor: 'baixa', rotulo: 'Baixa' },
] as const
type ModoDoCartao = (typeof MODOS)[number]['valor']

const demanda = ref(props.cartao.tipo === 'pedido_ao_time' ? props.cartao.dados.demanda : '')
const modo = ref<ModoDoCartao>(props.cartao.tipo === 'pedido_ao_time' ? props.cartao.dados.modo : 'auto')

// As guardas do Pedir (PedirFolha.vue), ditas por extenso: handleDelegation sai calado nelas.
const motivoDoTime = computed(() => {
  if (ag.isLoading.value) return 'Um pedido está em andamento. Espere a resposta para mandar outro.'
  if (ag.modalAberto.value) return 'Feche a outra folha antes de pedir.'
  if (!ag.squadAtiva.value) return ag.erroRoster.value ? `Sem squads: ${ag.erroRoster.value}` : 'Carregando as squads…'
  return ''
})
const podeMandar = computed(() => props.agentes && !motivoDoTime.value && demanda.value.trim() !== '')

function mandarParaOTime() {
  if (!podeMandar.value) return
  as.pedidoDoCartao.value = props.cartao.id
  void ag.handleDelegation({ demanda: demanda.value.trim(), modo: modoDoTurno(modo.value) })
  as.marcarDesfecho(props.cartao.id, 'confirmado')
}
/** O turno que este cartão mandou: só ele mostra o resultado (outro pedido pode ter vindo depois). */
const turno = computed(() => (as.pedidoDoCartao.value === props.cartao.id ? ag.ultimoPedido.value : null))

// ------------------------------------------------------------ anotação em Vendas

const ROTULO_DA_ANOTACAO = { nota: 'Nota', proximo_passo: 'Próximo passo' } as const
const dataDaAnotacao = ref(props.cartao.tipo === 'anotacao_no_crm' ? props.cartao.dados.data ?? '' : '')
const anotando = ref(false)
const anotado = ref('')
const erroDaAnotacao = ref('')

async function anotar() {
  const c = props.cartao
  if (c.tipo !== 'anotacao_no_crm' || anotando.value) return
  if (c.dados.tipo === 'proximo_passo' && !dataDaAnotacao.value) {
    erroDaAnotacao.value = 'Diga quando: o próximo passo precisa de data.'
    return
  }
  anotando.value = true
  erroDaAnotacao.value = ''
  try {
    // O corpo da Ficha (CrmFicha.vue, registrar): o id é a chave do lead, sem o prefixo do produto.
    const r = await fetch('/api/operations/crm/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        produto: c.dados.produto,
        id: chaveParaRegistro(c.dados.produto, c.dados.id),
        tipo: c.dados.tipo,
        texto: c.dados.texto,
        data: c.dados.tipo === 'proximo_passo' ? dataDaAnotacao.value : '',
      }),
    })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    const hora = typeof corpo.em === 'string' ? horaCurta(corpo.em) : ''
    anotado.value = `Gravado na planilha${hora ? ` às ${hora}` : ''}; aparece em Vendas em alguns segundos.`
    as.marcarDesfecho(c.id, 'confirmado')
  } catch (e) {
    erroDaAnotacao.value = `Não foi gravado: ${e instanceof Error ? e.message : String(e)}`
  } finally {
    anotando.value = false
  }
}

// ------------------------------------------------------------ mensagem ao lead

const copiado = ref<'' | 'ok' | 'falhou'>('')
let temporizador: number | undefined
async function copiarMensagem() {
  if (props.cartao.tipo !== 'mensagem_ao_lead') return
  const ok = await copiarTexto(props.cartao.dados.texto)
  copiado.value = ok ? 'ok' : 'falhou'
  window.clearTimeout(temporizador)
  temporizador = window.setTimeout(() => { copiado.value = '' }, ok ? 1600 : 6000)
  if (ok && proposto.value) as.marcarDesfecho(props.cartao.id, 'confirmado')
}
onBeforeUnmount(() => window.clearTimeout(temporizador))

const TITULO: Record<CartaoDoAssistente['tipo'], string> = {
  pedido_ao_time: 'Pedido ao time',
  anotacao_no_crm: 'Anotar em Vendas',
  mensagem_ao_lead: 'Mensagem para o lead',
  sugestao_do_copiloto: 'Sugestão do copiloto',
}

/** A primeira cópia da sugestão confirma o cartão (só mede, como a mensagem ao lead). */
function copiouASugestao() {
  if (proposto.value) as.marcarDesfecho(props.cartao.id, 'confirmado')
}
const ROTULO_DO_ESTADO = { proposto: 'Proposto', confirmado: 'Feito', descartado: 'Descartado' } as const
</script>

<template>
  <article class="assistente-cartao" :class="{ 'is-fechado': !proposto }" :aria-label="TITULO[cartao.tipo]">
    <header class="assistente-cartao__cabeca">
      <h3>{{ TITULO[cartao.tipo] }}</h3>
      <span class="selo" :class="{ 'selo--ok': estado === 'confirmado' }">{{ ROTULO_DO_ESTADO[estado] }}</span>
    </header>

    <!-- ---------------------------------------------------- pedido ao time -->
    <template v-if="cartao.tipo === 'pedido_ao_time'">
      <template v-if="proposto">
        <label class="rotulo">
          O que pedir
          <textarea v-model="demanda" class="campo" rows="3" maxlength="2000"></textarea>
        </label>
        <div class="segmentado segmentado--auto" role="group" aria-label="Quando marcar">
          <button v-for="m in MODOS" :key="m.valor" type="button" :aria-pressed="modo === m.valor" @click="modo = m.valor">{{ m.rotulo }}</button>
        </div>
        <template v-if="agentes">
          <p class="texto-2 texto-pequeno">Vai para a squad {{ ag.squadAtiva.value?.nome ?? '…' }}, pelo mesmo caminho do Pedir.</p>
          <p v-if="motivoDoTime" class="texto-2 texto-pequeno" role="status">{{ motivoDoTime }}</p>
        </template>
        <p v-else class="recado recado--atencao">
          A agenda dos agentes não roda nesta Central, então o pedido não tem para onde ir daqui. Peça pelo Telegram ou no SquadOne do Easypanel.
        </p>
        <div class="acoes">
          <button v-if="agentes" type="button" class="botao" :disabled="!podeMandar" @click="mandarParaOTime">Mandar para o time</button>
          <button type="button" class="botao botao--leve" @click="descartar">Descartar</button>
        </div>
      </template>
      <template v-else>
        <p class="assistente-cartao__texto">{{ demanda }}</p>
        <div v-if="turno" class="assistente-cartao__resultado" aria-live="polite">
          <p class="texto-pequeno">
            {{ turno.estado === 'rodando' ? 'O time está processando o pedido…' : turno.estado === 'erro' ? 'O pedido não foi processado.' : 'Pedido feito.' }}
          </p>
          <ul v-if="turno.estado !== 'rodando' && turno.linhas.length" class="assistente-cartao__linhas">
            <li v-for="(l, i) in turno.linhas" :key="i">{{ l }}</li>
          </ul>
          <p v-else-if="turno.estado === 'feito'" class="texto-2 texto-pequeno">Nada foi marcado na agenda.</p>
          <p v-for="(p, i) in turno.estado === 'rodando' ? [] : turno.problemas" :key="`p${i}`" class="recado" :class="turno.estado === 'erro' ? 'recado--erro' : 'recado--atencao'">{{ p }}</p>
        </div>
      </template>
    </template>

    <!-- ---------------------------------------------------- anotação em Vendas -->
    <template v-else-if="cartao.tipo === 'anotacao_no_crm'">
      <p class="texto-pequeno"><strong>{{ lead?.rotulo }}</strong> · {{ ROTULO_DA_ANOTACAO[cartao.dados.tipo] }}</p>
      <p v-if="lead?.outroLead" class="recado recado--atencao">Outro lead, não o da Ficha aberta.</p>
      <p class="assistente-cartao__texto">{{ cartao.dados.texto }}</p>
      <template v-if="proposto">
        <label v-if="cartao.dados.tipo === 'proximo_passo'" class="rotulo">
          Quando
          <input v-model="dataDaAnotacao" class="campo" type="date" />
        </label>
        <p v-if="erroDaAnotacao" class="recado recado--erro" role="alert">{{ erroDaAnotacao }}</p>
        <div class="acoes">
          <button type="button" class="botao" :disabled="anotando" @click="anotar">{{ anotando ? 'Gravando…' : 'Anotar' }}</button>
          <button type="button" class="botao botao--leve" :disabled="anotando" @click="descartar">Descartar</button>
        </div>
      </template>
      <p v-else-if="cartao.dados.tipo === 'proximo_passo' && dataDaAnotacao" class="texto-2 texto-pequeno">Para {{ dataDaAnotacao.split('-').reverse().join('/') }}</p>
      <p v-if="anotado" class="recado recado--ok" role="status">{{ anotado }}</p>
    </template>

    <!-- ---------------------------------------------------- mensagem ao lead -->
    <template v-else-if="cartao.tipo === 'mensagem_ao_lead'">
      <p class="texto-pequeno"><strong>{{ lead?.rotulo }}</strong></p>
      <p v-if="lead?.outroLead" class="recado recado--atencao">Outro lead, não o da Ficha aberta.</p>
      <blockquote class="assistente-cartao__mensagem">{{ cartao.dados.texto }}</blockquote>
      <p class="texto-2 texto-pequeno">Copie e mande você mesmo: o Assistente não envia nada a lead.</p>
      <div v-if="estado !== 'descartado'" class="acoes">
        <button type="button" class="botao" @click="copiarMensagem">{{ copiado === 'ok' ? 'Copiado ✓' : 'Copiar' }}</button>
        <button v-if="proposto" type="button" class="botao botao--leve" @click="descartar">Descartar</button>
      </div>
      <p v-if="copiado === 'falhou'" class="recado recado--atencao" role="status">Não consegui copiar: selecione o texto à mão.</p>
    </template>

    <!-- ---------------------------------------------------- sugestão do copiloto (fase 2) -->
    <template v-else-if="cartao.tipo === 'sugestao_do_copiloto'">
      <p class="texto-pequeno"><strong>{{ lead?.rotulo }}</strong></p>
      <p v-if="lead?.outroLead" class="recado recado--atencao">Outro lead, não o da Ficha aberta.</p>
      <AssistenteSugestao v-if="estado !== 'descartado'" :dados="cartao.dados" :proposto="proposto" @copiou="copiouASugestao" @descartar="descartar" />
    </template>
  </article>
</template>

<style>
/* Cartão dentro do painel (que já é o contorno, BP-R1): zona com a faixa do tipo por sombra
   interna, como o .cartao--decisao achatado dentro de um bloco. */
.assistente-cartao {
  display: grid;
  gap: var(--esp-2);
  min-width: 0;
  padding: var(--esp-3) var(--esp-4);
  border-radius: var(--raio-controle);
  background: var(--superficie-2);
  box-shadow: inset var(--faixa) 0 0 var(--acento);
}
.assistente-cartao.is-fechado { box-shadow: inset var(--faixa) 0 0 var(--borda); }
.assistente-cartao > p { margin: 0; }
.assistente-cartao__cabeca { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); }
.assistente-cartao__cabeca h3 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); line-height: 1.25; }
.assistente-cartao__texto { white-space: pre-wrap; overflow-wrap: anywhere; }
.assistente-cartao__mensagem {
  margin: 0;
  padding: var(--esp-2) var(--esp-3);
  border-radius: var(--raio-controle);
  background: var(--superficie);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.assistente-cartao__resultado { display: grid; gap: var(--esp-1); }
.assistente-cartao__resultado > p { margin: 0; }
.assistente-cartao__linhas { display: grid; gap: var(--esp-1); margin: 0; padding: 0 0 0 var(--esp-4); }
</style>
