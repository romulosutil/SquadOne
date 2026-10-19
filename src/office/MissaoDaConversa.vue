<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CrmLead } from '../operations/types'
import type { Pessoa } from '../types'
import SpriteDaSala from './SpriteDaSala.vue'
import AjustarProximoPasso from './AjustarProximoPasso.vue'
import { marcosDaMissao, movimentoDaMissao } from './missao'
import type { AcaoDeVenda } from '../operations/proxima-venda'
import { textoParaATela } from '../operations/marcadores-da-conversa'
import { diaEmSP } from '../operations/retomadas'
// `acao`: a mesma da fila de venda (acaoDoLead), calculada na rota. Sem ela o cartão só tinha botões
// genéricos e o Rômulo não sabia o que mandar (19/10/2026, a Jéssica).
const props = defineProps<{ lead: CrmLead; agente?: Pessoa; disponivel: boolean; motivo: string; acao?: AcaoDeVenda | null }>()
const emit = defineEmits<{ ficha: [id: string]; registrado: []; ocupado: [valor: boolean] }>()
const informar = ref(false), texto = ref(''), salvando = ref(false), erro = ref(''), recebido = ref('')
const marcos = computed(() => marcosDaMissao(props.lead))
// O primeiro contato não sai daqui: as travas de ritmo e de horário vivem na Próxima venda e na Ficha.
const linkDaAcao = computed(() => props.acao && !props.acao.primeiroContato ? props.acao.link ?? null : null)
const hoje = diaEmSP(new Date())
const combinado = computed(() => { const p = props.lead.proximoPasso; return p?.texto.trim() && p.data && p.data <= hoje ? p : null })
const movimento = computed(() => movimentoDaMissao(props.lead, props.acao, hoje))
// A mensagem já saiu depois do combinado: o toque que falta é o "Já resolvi", não abrir o WhatsApp de novo.
const resolvidoPrimeiro = computed(() => movimento.value.doCombinado && movimento.value.primario === 'resolvi')
const ajuste = ref<'concluir' | 'reagendar' | null>(null)
const ultima = computed(() => props.lead.conversa?.ultima ?? null)
const rotuloDaUltima = computed(() => ultima.value?.direcao === 'saida' ? 'Última mensagem enviada' : ultima.value?.papel === 'robo' ? 'Última mensagem do robô' : 'Última mensagem recebida')
const anotando = ref(false), anotado = ref(''), statusDaAcao = ref(''), erroDaAcao = ref('')
async function guardar() {
  if (!texto.value.trim() || salvando.value) return
  salvando.value = true; emit('ocupado', true); erro.value = ''; recebido.value = ''
  try {
    const r = await fetch('/api/operations/crm/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto: props.lead.produto, id: props.lead.chave, tipo: 'nota', texto: texto.value.trim(), data: '' }) })
    const corpo = await r.json().catch(() => ({})); if (!r.ok) throw new Error(corpo.error ?? 'Não foi possível guardar esta informação.')
    recebido.value = 'Contexto recebido. O time vai considerar esta informação nas próximas análises.'; texto.value = ''; informar.value = false; emit('registrado')
  } catch (e) { erro.value = (e as Error).message } finally { salvando.value = false; emit('ocupado', false) }
}
/**
 * O essencial do aoTocar da Próxima venda: o toque no link anota o envio (uma vez por ação no dia, o
 * servidor guarda). A proposta não se anota no toque: abrir o WhatsApp não comprova envio, então ela
 * espera o "Enviei a proposta".
 */
async function anotar(a: AcaoDeVenda, confirmou = false) {
  if (!a.anota || anotando.value || anotado.value === a.chave) return
  if (a.anota === 'proposta' && !confirmou) { statusDaAcao.value = 'Proposta preparada. Toque em “Enviei a proposta” só depois de enviar.'; return }
  anotando.value = true; emit('ocupado', true); erroDaAcao.value = ''
  try {
    const r = await fetch('/api/operations/crm/venda/anotar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave: a.chave, produto: props.lead.produto, id: props.lead.chave, tipo: a.anota, texto: a.anota === 'proposta' ? a.rascunho?.slice(0, 1000) ?? '' : '' }) })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const corpo = await r.json().catch(() => ({})) as { jaEstava?: boolean }
    anotado.value = a.chave
    statusDaAcao.value = corpo.jaEstava ? 'Já estava anotado.' : a.anota === 'proposta' ? 'Proposta anotada.' : a.anota === 'recusou' ? 'Recusa marcada.' : 'Envio anotado.'
    if (!corpo.jaEstava) emit('registrado')
  } catch { erroDaAcao.value = 'Não consegui anotar — anote na ficha.' } finally { anotando.value = false; emit('ocupado', false) }
}
</script>
<template>
  <article class="missao-conversa" aria-labelledby="missao-titulo">
    <header class="missao-conversa__cabeca"><div v-if="agente" class="missao-conversa__retrato"><SpriteDaSala :sprite="agente.sprite" :hue="agente.hue" :ordem="0" /></div><div><span class="sobretitulo">{{ agente?.nome ?? 'Seu time' }} · missão comercial</span><h2 id="missao-titulo">{{ lead.empresa }}</h2><span class="etiqueta" data-tom="atencao">{{ motivo }}</span></div></header>
    <!-- Um bloco só com o que fazer, como e os botões (19/10/2026): antes o título era genérico, o
         combinado ficava numa caixa à parte e o WhatsApp no rodapé, depois da jornada. -->
    <section class="missao-conversa__objetivo" aria-labelledby="missao-movimento">
      <div class="missao-conversa__quando"><span class="sobretitulo">Seu próximo movimento</span><span v-if="movimento.quando" class="etiqueta" :data-tom="movimento.atrasado ? 'erro' : 'atencao'">{{ movimento.quando }}</span></div>
      <p id="missao-movimento" class="missao-conversa__acao">{{ movimento.titulo }}</p>
      <ol v-if="movimento.passos.length" class="missao-conversa__passos"><li v-for="(passo, i) in movimento.passos" :key="i">{{ passo }}</li></ol>
      <p v-else-if="movimento.como" class="texto-2 texto-pequeno">{{ movimento.como }}</p>
      <div v-if="movimento.lembrete" class="missao-conversa__rascunho"><span class="sobretitulo">O combinado era</span><p>{{ movimento.lembrete }}</p></div>
      <div v-if="acao?.rascunho" class="missao-conversa__rascunho"><span class="sobretitulo">Mensagem pronta</span><p>{{ acao.rascunho }}</p></div>
      <div class="missao-conversa__acoes">
        <template v-if="resolvidoPrimeiro && !ajuste"><button type="button" class="botao botao--primario" @click="ajuste = 'concluir'">Já resolvi</button></template>
        <a v-if="acao && linkDaAcao" :class="['botao', resolvidoPrimeiro ? '' : 'botao--primario']" :href="linkDaAcao.url" target="_blank" rel="noopener" @click="anotar(acao)">{{ linkDaAcao.rotulo }} <span aria-hidden="true">↗</span></a>
        <button v-if="acao && linkDaAcao && acao.anota === 'proposta'" type="button" class="botao" :disabled="anotando || anotado === acao.chave" @click="anotar(acao, true)">Enviei a proposta</button>
        <button v-if="acao && !linkDaAcao && !acao.primeiroContato && acao.anota === 'recusou'" type="button" class="botao botao--primario" :disabled="anotando || anotado === acao.chave" @click="anotar(acao, true)">Marcar a recusa</button>
        <button v-if="acao?.primeiroContato" type="button" class="botao botao--primario" @click="emit('ficha', lead.id)">Enviar pela Ficha</button>
        <a v-if="lead.links.whatsapp && linkDaAcao?.url !== lead.links.whatsapp" :class="['botao', resolvidoPrimeiro || (acao && (linkDaAcao || acao.primeiroContato)) ? '' : 'botao--primario']" :href="lead.links.whatsapp" target="_blank" rel="noopener">Abrir conversa no WhatsApp <span aria-hidden="true">↗</span></a>
        <template v-if="movimento.doCombinado && !ajuste"><button v-if="!resolvidoPrimeiro" type="button" class="botao" @click="ajuste = 'concluir'">Já resolvi</button><button type="button" class="botao botao--leve" @click="ajuste = 'reagendar'">Remarcar</button></template>
      </div>
      <AjustarProximoPasso v-if="movimento.doCombinado && ajuste" :key="ajuste" :lead="lead" :modo="ajuste" @registrado="emit('registrado')" @fechar="ajuste = null" />
      <p v-if="acao?.primeiroContato" class="texto-2 texto-pequeno">O primeiro contato sai pela Ficha, onde valem o horário e o ritmo de envio.</p>
      <p v-if="statusDaAcao" class="recado recado--ok" role="status">{{ statusDaAcao }}</p><p v-if="erroDaAcao" class="recado recado--erro" role="alert">{{ erroDaAcao }}</p>
    </section>
    <section v-if="combinado && !movimento.doCombinado" class="missao-conversa__combinado"><p>Combinado anotado para {{ combinado.data.split('-').reverse().slice(0, 2).join('/') }}: {{ combinado.texto }}</p><div v-if="!ajuste" class="missao-conversa__acoes"><button type="button" class="botao" @click="ajuste = 'concluir'">Já resolvi</button><button type="button" class="botao botao--leve" @click="ajuste = 'reagendar'">Remarcar</button></div><AjustarProximoPasso v-else :key="ajuste" :lead="lead" :modo="ajuste" @registrado="emit('registrado')" @fechar="ajuste = null" /></section>
    <ol class="missao-conversa__jornada" aria-label="Avanços registrados"><li v-for="m in marcos" :key="m.id" :data-observado="m.observado"><span aria-hidden="true">{{ m.observado ? '✓' : '·' }}</span><strong>{{ m.nome }}</strong><small>{{ m.detalhe ?? (m.observado ? 'Registrado' : 'Por avançar') }}</small></li></ol>
    <blockquote v-if="ultima"><span class="sobretitulo">{{ rotuloDaUltima }}</span>{{ ultima.trecho ? `“${textoParaATela(ultima.trecho)}”` : '(texto não guardado)' }}</blockquote>
    <div class="missao-conversa__acoes">
      <button type="button" class="botao botao--leve" @click="informar = !informar">Informar algo ao time</button><button type="button" class="botao botao--leve" @click="emit('ficha', lead.id)">Ver contexto completo</button>
    </div>
    <form v-if="informar" class="missao-conversa__form" @submit.prevent="guardar"><label class="rotulo">O que o time precisa saber?<textarea v-model="texto" class="campo" rows="3" maxlength="1000" required :disabled="salvando" placeholder="Um combinado por telefone, uma informação nova ou uma mudança de prioridade…" /></label><p class="texto-2 texto-pequeno">O contexto fica ligado a esta conversa.</p><button type="submit" class="botao" :disabled="!disponivel || salvando">{{ salvando ? 'Guardando…' : 'Guardar contexto para o time' }}</button></form>
    <p v-if="recebido" class="recado recado--ok" role="status">{{ recebido }}</p><p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>
    <p class="texto-2 texto-pequeno">O time observa os envios e as respostas nas integrações. A jornada se atualiza com os registros.</p>
  </article>
</template>
<style scoped>
.missao-conversa { display: grid; gap: var(--esp-5); }
.missao-conversa__cabeca { display: flex; align-items: center; gap: var(--esp-4); }
.missao-conversa h2 { font-size: var(--tam-titulo-bloco); margin: var(--esp-1) 0 var(--esp-2); }
.missao-conversa__retrato { display: grid; flex: 0 0 auto; width: calc(var(--esp-16) + var(--esp-8)); min-height: calc(var(--esp-16) + var(--esp-8)); place-items: center; background: #293d49; border-radius: var(--raio-controle); border: var(--linha); }
.missao-conversa__retrato :deep(.sprite-da-sala) { transform: scale(1.4); background: transparent; }
.missao-conversa__objetivo { display: grid; gap: var(--esp-3); padding: var(--esp-4); background: var(--realce); border-radius: var(--raio-controle); }
.missao-conversa__objetivo p { margin: 0; }
.missao-conversa__quando { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-2); }
.missao-conversa__acao { font-size: var(--tam-titulo-bloco); font-weight: var(--peso-forte); line-height: 1.3; overflow-wrap: anywhere; }
.missao-conversa__passos { display: grid; gap: var(--esp-1); margin: 0; padding-left: var(--esp-5); list-style: decimal; }
.missao-conversa__passos li { display: list-item; }
.missao-conversa__rascunho { margin-top: var(--esp-3); padding: var(--esp-3); background: var(--superficie); border: var(--linha-fina); border-radius: var(--raio-controle); }
.missao-conversa__rascunho p { white-space: pre-wrap; overflow-wrap: anywhere; }
.missao-conversa__combinado { display: grid; gap: var(--esp-3); padding: var(--esp-4); background: var(--superficie-2); border-radius: var(--raio-controle); }
.missao-conversa__combinado p { margin: 0; }
.missao-conversa__jornada { display: grid; grid-template-columns: repeat(5,minmax(0,1fr)); gap: var(--esp-2); list-style: none; margin: 0; padding: 0; }
.missao-conversa__jornada li { display: grid; gap: var(--esp-1); justify-items: center; text-align: center; font-size: var(--tam-mini); color: var(--texto-2); }
.missao-conversa__jornada li > span { display: grid; width: var(--toque); height: var(--toque); place-items: center; border: var(--linha-fina); background: var(--superficie-2); border-radius: var(--raio-pilula); font-size: var(--tam-nome); }
.missao-conversa__jornada li[data-observado="true"] > span { background: var(--ok-fundo); color: var(--cor-verde); }
.missao-conversa blockquote { display: grid; gap: var(--esp-2); margin: 0; padding: var(--esp-4); background: var(--superficie-2); border-radius: var(--raio-controle); }
.missao-conversa__acoes { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.missao-conversa__form { display: grid; gap: var(--esp-3); }
@media(max-width:47.99rem) { .missao-conversa__cabeca { align-items: start; } .missao-conversa__retrato { width: var(--esp-16); min-height: var(--esp-16); } .missao-conversa__jornada small { display: none; } .missao-conversa__jornada li { font-size: var(--tam-mini); } }
</style>
