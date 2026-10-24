<script lang="ts">
// Memória desta sessão: sobrevive à troca de Ficha sem gravar contexto de cliente no navegador.
const rascunhosSpiced = new Map<string, import('./spiced').Spiced>()
interface SessaoQualificacao { rascunho: import('./qualificacao-comercial').QualificacaoComercial; confirmo: boolean; estado: 'pronto'|'salvando'|'aguardando'|'ambiguo'; esperado: string; aviso: string }
const rascunhosQualificacao = new Map<string,SessaoQualificacao>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { camposDoLote, type SugestaoSpiced } from './copiloto'
import { lacunasDoSpiced, qualificadoParaProposta, lerSpiced, spicedVazio, textoDoRegistroSpiced, type Spiced } from './spiced'
import { PREFIXO_QUALIFICACAO_COMERCIAL, OFERTAS_QUALIFICACAO, qualificacaoComercialAtual, qualificacaoComercialVazia, temQualificacaoComercial, textoDaQualificacaoComercial, proximaPerguntaQualificacao, type OfertaQualificacao } from './qualificacao-comercial'

const props = defineProps<{ lead: CrmLead; disponivel: boolean; sugestao?: SugestaoSpiced }>()
const emit = defineEmits<{ registrado: [] }>()
const copia = (s?: Spiced): Spiced => JSON.parse(JSON.stringify(s ?? spicedVazio()))
const chaveInicial = `${props.lead.produto}:${props.lead.id}`
const rascunho = ref<Spiced>(copia(rascunhosSpiced.get(chaveInicial) ?? props.lead.spiced))
const estado = ref<'pronto' | 'salvando' | 'aguardando' | 'falhou'>('pronto')
const aviso = ref('')
const identidade = computed(() => `${props.lead.produto}:${props.lead.id}`)
const confirmadaQualificacao = computed(() => qualificacaoComercialAtual(props.lead))
const temNovaQualificacao = computed(() => temQualificacaoComercial(props.lead))
const prontaParaProposta = computed(() => qualificadoParaProposta(props.lead))
const lacunasQualificacao = computed(() => lacunasDoSpiced(props.lead))
const perguntaQualificacao = computed(() => proximaPerguntaQualificacao(props.lead))
const ofertaNomes: Record<OfertaQualificacao,string> = { 'raio-x':'Raio-X', mapa:'Mapa', encontrado:'Site · Encontrado', respondido:'WhatsApp · Respondido e Acompanhado', anuncios:'Anúncios', 'anuncios-duas':'Anúncios · duas plataformas', redes:'Redes sociais', fonte:'Fonte', 'fonte-em-dia':'Manutenção da Fonte', iris:'Íris', estampa:'CRM de estamparia', pacote:'Pacote com escopo aprovado' }
const criarSessaoQualificacao = (): SessaoQualificacao => ({ rascunho: JSON.parse(JSON.stringify(confirmadaQualificacao.value ?? { ...qualificacaoComercialVazia(), id: crypto.randomUUID() })), confirmo:false, estado:'pronto', esperado:'', aviso:'' })
const sessaoQualificacao = ref<SessaoQualificacao>(rascunhosQualificacao.get(identidade.value) ?? criarSessaoQualificacao())
rascunhosQualificacao.set(identidade.value,sessaoQualificacao.value)
const bloqueadaQualificacao = computed(() => !props.disponivel || sessaoQualificacao.value.estado !== 'pronto')
const previaQualificacao = computed(() => PREFIXO_QUALIFICACAO_COMERCIAL + JSON.stringify(sessaoQualificacao.value.rascunho))
const tamanhoQualificacao = computed(() => previaQualificacao.value.length)
function confirmarQualificacaoNaFonte(s: SessaoQualificacao) {
  if (!s.esperado || !props.lead.eventos.some(e => e.tipo === 'nota' && e.origem === 'manual' && (e.registroTexto ?? e.texto) === s.esperado)) return false
  s.estado='pronto'; s.esperado=''; s.confirmo=false; s.aviso='Qualificação confirmada na aba CRM e na Ficha.'
  return true
}
watch(identidade, (atual, anterior) => {
  rascunhosQualificacao.set(anterior,sessaoQualificacao.value)
  sessaoQualificacao.value=rascunhosQualificacao.get(atual) ?? criarSessaoQualificacao()
  rascunhosQualificacao.set(atual,sessaoQualificacao.value)
  confirmarQualificacaoNaFonte(sessaoQualificacao.value)
})
onBeforeUnmount(() => rascunhosQualificacao.set(identidade.value,sessaoQualificacao.value))
watch(() => props.lead.eventos, () => confirmarQualificacaoNaFonte(sessaoQualificacao.value), {deep:true})
function relerQualificacao() {
  if (bloqueadaQualificacao.value) return
  sessaoQualificacao.value=criarSessaoQualificacao()
  rascunhosQualificacao.set(identidade.value,sessaoQualificacao.value)
}
async function salvarQualificacao() {
  if (bloqueadaQualificacao.value || !sessaoQualificacao.value.confirmo) return
  const atual=identidade.value, s=sessaoQualificacao.value
  let texto: string
  try {
    // Revisão confirmada é imutável; correção de um pedido não enviado conserva o ID.
    s.rascunho={...s.rascunho,id:s.rascunho.id === confirmadaQualificacao.value?.id ? crypto.randomUUID() : s.rascunho.id,em:new Date().toISOString()}
    texto=textoDaQualificacaoComercial(s.rascunho)
  } catch (e) { s.aviso=e instanceof Error ? e.message : 'Confira os dados e a evidência.'; return }
  const {produto,chave:id}=props.lead
  s.estado='salvando'; s.esperado=texto; s.aviso=''
  try {
    const r=await fetch('/api/operations/crm/registro',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({produto,id,tipo:'nota',texto,data:''})})
    const corpo=await r.json().catch(()=>({}))
    if (!r.ok && corpo.naoEnviado === true) {
      if (s.esperado) { s.estado='pronto'; s.esperado=''; s.confirmo=false; s.aviso=`Registro não enviado: ${corpo.error ?? `HTTP ${r.status}`}. Corrija e confirme a revisão novamente; o identificador foi preservado.` }
      return
    }
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    if (identidade.value === atual && confirmarQualificacaoNaFonte(s)) { emit('registrado'); return }
    // Uma confirmação da fonte pode chegar antes da resposta HTTP.
    if (s.esperado) { s.estado='aguardando'; s.aviso='Aguardando a mesma nota reaparecer na fonte. Não repita o registro.' }
    if (identidade.value === atual) emit('registrado')
  } catch (e) {
    if (!s.esperado) return
    s.estado='ambiguo'; s.aviso=`Resultado da gravação não confirmado: ${e instanceof Error ? e.message : String(e)}. Confira a fonte; não repita a operação.`
    if (identidade.value === atual) emit('registrado')
  }
}

const confirmado = computed(() => props.lead.spiced ?? spicedVazio())
const campos = computed(() => [
  { letra: 'S', nome: 'Situação', preenchido: Boolean(confirmado.value.situacao) },
  { letra: 'P', nome: 'Dor', preenchido: Boolean(confirmado.value.dor) },
  { letra: 'I', nome: 'Impacto', preenchido: Boolean(confirmado.value.impacto) },
  { letra: 'C', nome: 'Evento crítico', preenchido: Boolean(confirmado.value.evento_critico.fato && confirmado.value.evento_critico.data) },
  { letra: 'D', nome: 'Decisor', preenchido: confirmado.value.decisao.decisor_confirmado === 'sim' },
])
const sugestoes = computed(() => Object.entries(props.sugestao ?? {}) as Array<[keyof Spiced, NonNullable<SugestaoSpiced[keyof Spiced]>]>)
// O decisor "sim" fica fora do lote: ele destrava a proposta e pede um toque próprio no "Usar decisão no rascunho".
const noLote = computed(() => camposDoLote(props.sugestao))
const decisorFicaAParte = computed(() => noLote.value.length < sugestoes.value.length)
const nomes = { situacao: 'Situação', dor: 'Dor', impacto: 'Impacto', evento_critico: 'Evento crítico', decisao: 'Decisão' }
const bloqueado = computed(() => !props.disponivel || estado.value === 'salvando' || estado.value === 'aguardando')
watch(identidade, (atual, anterior) => {
  if (anterior) rascunhosSpiced.set(anterior, copia(rascunho.value))
  rascunho.value = copia(rascunhosSpiced.get(atual) ?? props.lead.spiced)
  estado.value = 'pronto'; aviso.value = ''
})
onBeforeUnmount(() => rascunhosSpiced.set(identidade.value, copia(rascunho.value)))
watch(() => props.lead.spiced, (atual) => {
  if (estado.value === 'aguardando' && JSON.stringify(atual) === JSON.stringify(rascunho.value)) {
    estado.value = 'pronto'; aviso.value = 'Qualificação confirmada na Ficha.'
  }
})
function usar(campo: keyof Spiced) {
  const s = props.sugestao?.[campo]
  if (s) Object.assign(rascunho.value, { [campo]: JSON.parse(JSON.stringify(s.valor)) })
}
async function confirmarSugestoes() {
  if (bloqueado.value) return
  for (const campo of noLote.value) usar(campo)
  await salvar()
}
function descartar() {
  rascunho.value = copia(props.lead.spiced)
  rascunhosSpiced.delete(identidade.value)
  estado.value = 'pronto'; aviso.value = ''
}
function valorSugerido(campo: keyof Spiced, valor: Spiced[keyof Spiced]): string {
  if (typeof valor === 'string') return valor
  if (campo === 'evento_critico' && 'fato' in valor) return [valor.fato, valor.data].filter(Boolean).join(' · ')
  if ('decisor_confirmado' in valor) return [valor.decisor_confirmado === 'sim' ? 'Decide a compra' : valor.decisor_confirmado === 'nao' ? 'Não decide' : 'Decisor a confirmar', valor.quem, valor.como_paga].filter(Boolean).join(' · ')
  return ''
}
async function salvar() {
  if (bloqueado.value) return
  let texto: string
  try {
    if (!lerSpiced(rascunho.value)) throw new Error('Confira os campos e a data do evento crítico.')
    texto = textoDoRegistroSpiced(rascunho.value)
  } catch (erro) {
    aviso.value = erro instanceof Error ? erro.message : 'Confira a qualificação.'
    estado.value = 'falhou'; return
  }
  const atual = identidade.value
  const { produto, chave: id } = props.lead
  estado.value = 'salvando'; aviso.value = ''
  try {
    const resposta = await fetch('/api/operations/crm/registro', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produto, id, tipo: 'spiced', texto, data: '' }),
    })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    if (identidade.value !== atual) return
    estado.value = 'aguardando'
    aviso.value = 'Gravado na planilha. Aguardando a confirmação aparecer na Ficha.'
    emit('registrado')
  } catch (erro) {
    if (identidade.value !== atual) return
    estado.value = 'falhou'
    aviso.value = `Não foi possível confirmar a gravação: ${erro instanceof Error ? erro.message : String(erro)}. Confira a Ficha antes de tentar novamente.`
  }
}
</script>

<template>
  <section class="crm-spiced" data-blueprint="BP-SPICED" aria-label="Qualificação comercial">
    <h3 class="crm-ficha__rotulo">Qualificação para a proposta</h3>
    <p role="status">{{ prontaParaProposta ? 'Contexto confirmado para revisar uma proposta.' : 'Ainda falta confirmar: ' + lacunasQualificacao.join(', ') + '.' }}</p>
    <p class="crm-nota-pequena">{{ temNovaQualificacao ? 'A revisão comercial registrada governa a qualificação. O SPICED fica como detalhe histórico.' : 'Sem revisão comercial nova. O SPICED registrado continua como referência legada até você confirmar uma revisão abaixo.' }}</p>
    <p v-if="confirmadaQualificacao" class="crm-nota-pequena">Revisão {{ confirmadaQualificacao.id }} · confirmada em {{ confirmadaQualificacao.em }} · fonte: {{ confirmadaQualificacao.fonte }}</p>
    <div v-if="perguntaQualificacao && !prontaParaProposta" class="zona">
      <strong>{{ perguntaQualificacao.alvo === 'cliente' ? 'Próxima pergunta, se houver abertura na conversa' : 'Próxima conferência interna' }}</strong>
      <p>{{ perguntaQualificacao.texto }}</p>
    </div>
    <details class="dobra">
      <summary>Conferir e registrar qualificação comercial</summary>
      <p class="crm-nota-pequena">Registre fatos já confirmados. Quem decide pode ser um grupo de sócios. Uma pergunta de preço vai para Rômulo mesmo se ainda faltarem informações; não significa proposta aceita.</p>
      <form class="crm-form" @submit.prevent="salvarQualificacao">
        <label><span>Necessidade confirmada</span><textarea v-model="sessaoQualificacao.rascunho.necessidade" rows="2" maxlength="160" :disabled="bloqueadaQualificacao" /></label>
        <label><span>Adequação da oferta</span><select v-model="sessaoQualificacao.rascunho.adequacao.estado" :disabled="bloqueadaQualificacao"><option value="pendente">A conferir</option><option value="confirmada">Adequada, confirmei</option><option value="inadequada">Não atende à necessidade</option></select></label>
        <label><span>Oferta considerada</span><select v-model="sessaoQualificacao.rascunho.adequacao.oferta" :disabled="bloqueadaQualificacao"><option value="">Ainda não definida</option><option v-for="id in OFERTAS_QUALIFICACAO" :key="id" :value="id">{{ ofertaNomes[id] }}</option></select></label>
        <label><span>Por que atende; limites e dependências</span><textarea v-model="sessaoQualificacao.rascunho.adequacao.motivo" rows="2" maxlength="160" :disabled="bloqueadaQualificacao" /></label>
        <label><span>Intenção expressa pelo cliente</span><select v-model="sessaoQualificacao.rascunho.intencao" :disabled="bloqueadaQualificacao"><option value="desconhecida">Ainda não confirmada</option><option value="permissao">Permitiu receber material</option><option value="avaliar">Quer avaliar a solução</option><option value="contratar">Quer contratar</option><option value="sem-interesse">Disse que não tem interesse</option></select></label>
        <label><span>Quem participa da decisão e como decidem</span><textarea v-model="sessaoQualificacao.rascunho.decisao" rows="2" maxlength="160" :disabled="bloqueadaQualificacao" /></label>
        <label><span>Próximo passo proposto ou combinado</span><input v-model="sessaoQualificacao.rascunho.proximoPasso.descricao" maxlength="160" :disabled="bloqueadaQualificacao" /></label>
        <label><input v-model="sessaoQualificacao.rascunho.proximoPasso.aceito" type="checkbox" :disabled="bloqueadaQualificacao" /> O cliente aceitou esse próximo passo; conferi a resposta.</label>
        <label><span>Fonte: canal, data e referência da mensagem</span><input v-model="sessaoQualificacao.rascunho.fonte" maxlength="120" :disabled="bloqueadaQualificacao" required /><small>Uma referência legível basta; não precisa incluir link privado.</small></label>
        <label><span>Trecho real que sustenta a revisão</span><textarea v-model="sessaoQualificacao.rascunho.evidencia" rows="2" maxlength="180" :disabled="bloqueadaQualificacao" required /></label>
        <p class="crm-nota-pequena">{{ tamanhoQualificacao }} / 1000 caracteres na nota completa. Preserve fonte e trecho; registre apenas uma síntese fiel que caiba. Nenhum campo será truncado ao salvar.</p>
        <details class="dobra"><summary>Conferir a nota antes de registrar</summary><pre class="crm-spiced__previa">{{ previaQualificacao }}</pre></details>
        <label><input v-model="sessaoQualificacao.confirmo" type="checkbox" :disabled="bloqueadaQualificacao" required /> Conferi os fatos, a fonte e o trecho. Lacunas permanecem lacunas.</label>
        <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="bloqueadaQualificacao || !sessaoQualificacao.confirmo || tamanhoQualificacao > 1000">{{ sessaoQualificacao.estado === 'salvando' ? 'Registrando…' : 'Confirmar revisão comercial' }}</button><button class="botao botao--leve" type="button" :disabled="bloqueadaQualificacao" @click="relerQualificacao">Descartar rascunho e reler a Ficha</button></div>
      </form>
      <p v-if="sessaoQualificacao.aviso" class="recado" role="status">{{ sessaoQualificacao.aviso }}</p>
      <button v-if="sessaoQualificacao.estado === 'aguardando' || sessaoQualificacao.estado === 'ambiguo'" class="botao botao--leve" type="button" @click="emit('registrado')">Atualizar a confirmação da fonte</button>
      <p v-if="sessaoQualificacao.estado === 'ambiguo'" class="crm-nota-pequena">O rascunho e a operação pendente continuam nesta sessão, inclusive ao trocar de cliente. A confirmação depende de reencontrar o mesmo registro na fonte.</p>
    </details>

    <details class="dobra">
      <summary>Detalhamento SPICED avançado e histórico</summary>
    <ul class="crm-spiced__faixa" aria-label="SPICED confirmado pelo Rômulo">
      <li v-for="campo in campos" :key="campo.letra"><strong>{{ campo.letra }}</strong> · {{ campo.nome }}: <span>{{ campo.preenchido ? 'preenchido' : 'falta' }}</span></li>
    </ul>
      <p class="crm-nota-pequena">Sem revisão comercial nova, a regra legada ainda usa dor, impacto e decisor. Uma revisão comercial nova governa mesmo quando o SPICED antigo está completo.</p>
      <p class="crm-nota-pequena">Só o que você confirmar fica na Ficha. As sugestões do copiloto precisam de revisão.</p>
      <div v-for="[campo, sugestao] in sugestoes" :key="campo" class="zona">
        <strong>{{ nomes[campo] }} · sugestão</strong>
        <p>{{ valorSugerido(campo, sugestao.valor) }}</p>
        <blockquote>“{{ sugestao.citacao }}”</blockquote>
        <button type="button" class="botao botao--leve" :disabled="bloqueado" @click="usar(campo)">Usar {{ nomes[campo].toLowerCase() }} no rascunho</button>
      </div>
      <button v-if="noLote.length" type="button" class="botao" :disabled="bloqueado" @click="confirmarSugestoes">Confirmar sugestões exibidas</button>
      <p v-if="decisorFicaAParte" class="crm-nota-pequena">O decisor não entra no lote: confirme-o à parte, com “Usar decisão no rascunho”.</p>
      <form class="crm-form" @submit.prevent="salvar">
        <label><span>Situação</span><textarea v-model="rascunho.situacao" maxlength="200" rows="2" :disabled="bloqueado" /></label>
        <label><span>Dor: qual problema ele quer resolver?</span><textarea v-model="rascunho.dor" maxlength="200" rows="2" :disabled="bloqueado" /></label>
        <label><span>Impacto: o que esse problema causa?</span><textarea v-model="rascunho.impacto" maxlength="200" rows="2" :disabled="bloqueado" /></label>
        <label><span>Evento crítico: fato verificável</span><input v-model="rascunho.evento_critico.fato" maxlength="200" :disabled="bloqueado"></label>
        <label><span>Data do evento crítico</span><input v-model="rascunho.evento_critico.data" type="date" :disabled="bloqueado"></label>
        <label><span>Quem está falando decide a compra?</span><select v-model="rascunho.decisao.decisor_confirmado" :disabled="bloqueado"><option value="nao-sei">Não sei</option><option value="sim">Sim, confirmei</option><option value="nao">Não</option></select></label>
        <label><span>Quem decide?</span><input v-model="rascunho.decisao.quem" maxlength="200" :disabled="bloqueado"></label>
        <label><span>Como paga? Só o que ele informou</span><input v-model="rascunho.decisao.como_paga" maxlength="200" :disabled="bloqueado"></label>
        <p class="crm-nota-pequena">Impacto em dinheiro só quando dito pelo lead. Estes detalhes não substituem uma revisão comercial já registrada.</p>
        <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="bloqueado">{{ estado === 'salvando' ? 'Confirmando…' : 'Confirmar qualificação revisada' }}</button><button class="botao botao--leve" type="button" :disabled="estado === 'salvando'" @click="descartar">Descartar rascunho e reler a Ficha</button></div>
      </form>
    </details>
    <p v-if="aviso" class="recado" :class="{ 'recado--erro': estado === 'falhou' }" role="status">{{ aviso }}</p>
  </section>
</template>

<style scoped>
.crm-spiced { display: grid; gap: var(--esp-2); }
.crm-spiced__faixa { display: flex; flex-wrap: wrap; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; font-size: var(--tam-apoio); }
.crm-spiced .crm-form { margin-top: var(--esp-3); }
.crm-spiced__previa { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
.crm-spiced blockquote { margin: var(--esp-2) 0; overflow-wrap: anywhere; }
</style>
