<script lang="ts">
interface RascunhoComercial { tipo: string; opcao: string; quantidade: string; referencia: string; data: string; origem: string; motivo: string; pagamento: string; ativa: boolean | '' }
const rascunhosComerciais = new Map<string, RascunhoComercial>()
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { aarrDoLead, chaveDoPagamento, contratosMensais, diaAarr, opcoesDeterministicasDeReceita, ORIGENS_AARR, terceiroMes, textoDoRegistroAarr, textoDoRegistroReceita, type RegistroReceita, type TipoAarr } from './aarr'
import { MOTIVOS_DE_PERDA, ROTULO_DO_MOTIVO_DE_PERDA } from './motivos-de-perda'

const props = defineProps<{ lead: CrmLead; disponivel: boolean }>()
const emit = defineEmits<{ registrado: [] }>()
const identidade = computed(() => `${props.lead.produto}:${props.lead.id}`)
const novo = (): RascunhoComercial => ({ tipo: 'valor_proposta', opcao: '', quantidade: '', referencia: '', data: diaAarr(Date.now()), origem: '', motivo: '', pagamento: '', ativa: '' })
const rascunho = ref({ ...(rascunhosComerciais.get(identidade.value) ?? novo()) })
const estado = ref<'pronto' | 'salvando' | 'aguardando' | 'falhou'>('pronto')
const aviso = ref('')
const esperado = ref<{ tipo: string; texto: string } | null>(null)
const confirmado = computed(() => props.lead.aarr ?? aarrDoLead(props.lead, Date.now()))
const quantidade = computed(() => /^\d+$/.test(rascunho.value.quantidade) ? Number(rascunho.value.quantidade) : undefined)
const opcoes = computed(() => opcoesDeterministicasDeReceita(props.lead, quantidade.value))
const opcao = computed(() => opcoes.value.find(o => o.id === rascunho.value.opcao))
const oferta = computed(() => props.lead.produto === 'plus' ? props.lead.plus?.oferta : props.lead.produto)
const dinheiro = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const monetario = computed(() => ['valor_proposta', 'pagamento_confirmado'].includes(rascunho.value.tipo))
const pagamentos = computed(() => confirmado.value.pagamentos)
const contratos = computed(() => contratosMensais(props.lead, Date.now()))
const contrato = computed(() => contratos.value.find(p => p.referencia === rascunho.value.pagamento))
const pagamento = computed(() => pagamentos.value.find(p => p.chave === rascunho.value.pagamento))
const bloqueado = computed(() => !props.disponivel || estado.value === 'salvando' || estado.value === 'aguardando')
const rotulosOrigem: Record<string, string> = { cacador: 'Caçador', plus: 'Plus', indicacao: 'Indicação', CDL: 'CDL', anuncio: 'Anúncio' }
// A lista fechada de 28/10/2026, a mesma do "Perdeu" da Ficha (motivos-de-perda.ts).
const rotulosMotivo: Record<string, string> = ROTULO_DO_MOTIVO_DE_PERDA
watch(identidade, (atual, anterior) => {
  if (anterior) rascunhosComerciais.set(anterior, { ...rascunho.value })
  rascunho.value = { ...(rascunhosComerciais.get(atual) ?? novo()) }
  estado.value = 'pronto'; aviso.value = ''; esperado.value = null
})
onBeforeUnmount(() => rascunhosComerciais.set(identidade.value, { ...rascunho.value }))
watch(() => props.lead.eventos, (eventos) => {
  if (estado.value === 'aguardando' && esperado.value && eventos.some(e => e.tipo === esperado.value!.tipo && (e.registroTexto ?? e.texto) === esperado.value!.texto)) {
    estado.value = 'pronto'; aviso.value = 'Registro confirmado na Ficha.'; esperado.value = null
  }
}, { deep: true })
function descartar() {
  rascunho.value = novo(); rascunhosComerciais.delete(identidade.value)
  estado.value = 'pronto'; aviso.value = ''; esperado.value = null
}
async function gravar(tipo: TipoAarr, texto: string) {
  if (bloqueado.value) return
  const atual = identidade.value
  const { produto, chave: id } = props.lead
  estado.value = 'salvando'; aviso.value = ''
  try {
    const resposta = await fetch('/api/operations/crm/registro', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ produto, id, tipo, texto, data: '' }) })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    if (identidade.value !== atual) return
    esperado.value = { tipo, texto }; estado.value = 'aguardando'
    aviso.value = 'Gravado na planilha. Aguardando a confirmação aparecer na Ficha.'
    emit('registrado')
  } catch (erro) {
    if (identidade.value !== atual) return
    estado.value = 'falhou'
    aviso.value = `Não foi possível confirmar a gravação: ${erro instanceof Error ? erro.message : String(erro)}. Confira os registros antes de repetir.`
  }
}
async function salvar() {
  if (bloqueado.value) return
  try {
    const r = rascunho.value
    let texto: string
    if (monetario.value) {
      if (!opcao.value) throw new Error('Escolha um item do catálogo; Iris exige a quantidade de fichas ativas.')
      if (!r.data || r.data > diaAarr(Date.now())) throw new Error('Informe uma data já ocorrida.')
      texto = textoDoRegistroReceita(r.tipo as 'valor_proposta' | 'pagamento_confirmado', opcao.value, r.referencia, r.data)
    } else if (r.tipo === 'origem') texto = textoDoRegistroAarr('origem', r.origem)
    else if (r.tipo === 'motivo_perda') texto = textoDoRegistroAarr('motivo_perda', r.motivo)
    else {
      if (!r.data || r.data > diaAarr(Date.now())) throw new Error('Informe uma data já ocorrida.')
      if (r.tipo === 'retencao_3m') {
        if (!contrato.value) throw new Error('Selecione o contrato com mensalidade confirmada.')
        if (typeof r.ativa !== 'boolean') throw new Error('Confirme se a mensalidade está ativa ou inativa.')
        texto = textoDoRegistroAarr('retencao_3m', { referencia: contrato.value.referencia, inicio: contrato.value.inicio, data: r.data, ativa: r.ativa })
      } else {
        if (r.tipo === 'indicacao_pedida' && !pagamento.value) throw new Error('Selecione o pagamento ligado ao pedido de indicação.')
        texto = textoDoRegistroAarr(r.tipo as TipoAarr, { referencia: r.tipo === 'indicacao_pedida' ? pagamento.value!.chave : r.referencia, data: r.data })
      }
    }
    await gravar(r.tipo as TipoAarr, texto)
  } catch (erro) { estado.value = 'falhou'; aviso.value = erro instanceof Error ? erro.message : String(erro) }
}
async function desfazer(tipo: 'valor_proposta' | 'pagamento_confirmado', registro: RegistroReceita) {
  if (registro.eventoCiclo) { aviso.value = 'Corrija este recebimento em Proposta, contratação e recebimento, vinculando ao fato original. O histórico é preservado.'; return }
  if (bloqueado.value) return
  try { await gravar('receita_desfeita', textoDoRegistroAarr('receita_desfeita', { tipo, referencia: chaveDoPagamento(registro), data: diaAarr(Date.now()) })) }
  catch (erro) { estado.value = 'falhou'; aviso.value = erro instanceof Error ? erro.message : String(erro) }
}
</script>

<template>
  <section class="crm-receita" aria-label="Registros comerciais confirmados">
    <h3 class="crm-ficha__rotulo">Receita, origem e continuidade</h3>
    <p class="crm-nota-pequena">{{ pagamentos.length }} componentes de pagamento confirmados. Um recebimento pode ter mais de um componente. “Ganhou” não confirma pagamento. Propostas históricas sem valor continuam sem valor medido.</p>
    <details class="dobra">
      <summary>Registrar um fato comercial</summary>
      <form class="crm-form" @submit.prevent="salvar">
        <label><span>O que aconteceu?</span><select v-model="rascunho.tipo" :disabled="bloqueado"><option value="valor_proposta">Valor de proposta</option><option value="pagamento_confirmado">Pagamento confirmado</option><option value="origem">Origem do lead</option><option value="motivo_perda">Motivo da perda</option><option value="retencao_3m">Mensalidade no terceiro mês</option><option value="indicacao_pedida">Indicação pedida</option><option value="indicacao_recebida">Indicação recebida</option></select></label>
        <template v-if="monetario">
          <p v-if="oferta === 'estampa'" role="status">Estamparia ainda não tem preço aprovado. Valor e pagamento ficam indisponíveis.</p>
          <label v-if="oferta === 'iris'"><span>Quantidade confirmada de fichas ativas neste mês</span><input v-model="rascunho.quantidade" inputmode="numeric" type="number" min="1" step="1" :disabled="bloqueado"></label>
          <p v-if="oferta === 'iris'" class="crm-nota-pequena">Faixas marginais: primeiras 15 a R$ 39; 16 a 40 a R$ 32; demais a R$ 25 por ficha ativa/mês. O total exige a quantidade confirmada.</p>
          <label><span>Item e valor do catálogo</span><select v-model="rascunho.opcao" :disabled="bloqueado || !opcoes.length"><option value="">Selecione</option><option v-for="o in opcoes" :key="o.id" :value="o.id">{{ o.rotulo }} · {{ dinheiro(o.valorCentavos) }}</option></select></label>
          <p v-if="opcao"><strong>{{ dinheiro(opcao.valorCentavos) }}</strong> · {{ opcao.recorrencia === 'mensal' ? 'mensalidade deste período' : 'valor único ou parcela indicada' }}</p>
          <p class="crm-nota-pequena">Confirme apenas se o valor deste fato é igual ao item escolhido. Sem preço livre, estimativa ou atualização de propostas antigas. Para mensalidade, use uma referência diferente por competência.</p>
        </template>
        <label v-if="rascunho.tipo === 'origem'"><span>Origem confirmada</span><select v-model="rascunho.origem" required :disabled="bloqueado"><option value="">Escolha a origem</option><option v-for="o in ORIGENS_AARR" :key="o" :value="o">{{ rotulosOrigem[o] }}</option></select></label>
        <label v-if="rascunho.tipo === 'motivo_perda'"><span>Razão informada pelo lead</span><select v-model="rascunho.motivo" required :disabled="bloqueado"><option value="">Escolha o motivo</option><option v-for="m in MOTIVOS_DE_PERDA" :key="m" :value="m">{{ rotulosMotivo[m] }}</option></select></label>
        <template v-if="rascunho.tipo === 'retencao_3m' || rascunho.tipo === 'indicacao_pedida'">
          <label v-if="rascunho.tipo === 'retencao_3m'"><span>Contrato com mensalidade confirmada</span><select v-model="rascunho.pagamento" :disabled="bloqueado"><option value="">Selecione um contrato</option><option v-for="c in contratos" :key="c.referencia" :value="c.referencia">{{ c.referencia }} · início {{ c.inicio }}</option></select></label>
          <label v-else><span>Pagamento ligado à indicação</span><select v-model="rascunho.pagamento" :disabled="bloqueado"><option value="">Selecione um registro confirmado</option><option v-for="p in pagamentos" :key="p.chave" :value="p.chave">{{ p.referencia }} · {{ p.data }} · {{ dinheiro(p.valor_centavos) }}</option></select></label>
          <p v-if="rascunho.tipo === 'retencao_3m' && contrato">Início confirmado {{ contrato.inicio }} · conferir a partir de {{ terceiroMes(contrato.inicio) }}. A idade do pagamento sozinha não confirma retenção.</p>
          <label v-if="rascunho.tipo === 'retencao_3m'"><span>Situação conferida no terceiro mês</span><select v-model="rascunho.ativa" required :disabled="bloqueado"><option value="">Escolha a situação conferida</option><option :value="true">Mensalidade ativa, confirmei</option><option :value="false">Mensalidade inativa, confirmei</option></select></label>
        </template>
        <label v-if="monetario || rascunho.tipo === 'indicacao_recebida'"><span>{{ rascunho.tipo === 'indicacao_recebida' ? 'Referência da indicação que virou lead' : 'Referência do fato ou contrato e competência' }}</span><input v-model="rascunho.referencia" maxlength="200" :disabled="bloqueado" required><small>Use um identificador. Não inclua contato ou dado de pagamento.</small></label>
        <label v-if="!['origem', 'motivo_perda'].includes(rascunho.tipo)"><span>Data do fato confirmado</span><input v-model="rascunho.data" type="date" :max="diaAarr(Date.now())" required :disabled="bloqueado"></label>
        <div class="crm-form__botoes"><button type="submit" class="botao" :disabled="bloqueado || (monetario && !opcao)">{{ estado === 'salvando' ? 'Registrando…' : 'Confirmar e registrar este fato' }}</button><button type="button" class="botao botao--leve" :disabled="estado === 'salvando'" @click="descartar">Descartar rascunho e reler a Ficha</button></div>
      </form>
    </details>
    <details class="dobra">
      <summary>Conferir valores registrados e corrigir</summary>
      <p>Origem: {{ confirmado.origem ? rotulosOrigem[confirmado.origem] : 'não medida' }} · Motivo da perda: {{ confirmado.motivoPerda ? rotulosMotivo[confirmado.motivoPerda] : 'não medido' }}.</p>
      <p>{{ confirmado.retencoes.length }} conferências de retenção · {{ confirmado.indicacoes.pedidas.length }} indicações pedidas · {{ confirmado.indicacoes.recebidas.length }} recebidas.</p>
      <p class="crm-nota-pequena">Desfazer conserva o histórico. Para corrigir, desfaça o registro e confirme o fato correto.</p>
      <ul class="crm-lista"><li v-for="p in confirmado.propostas" :key="`proposta:${chaveDoPagamento(p)}`">Proposta · {{ p.oferta }} · {{ p.componente }} · {{ dinheiro(p.valor_centavos) }} · {{ p.data }} · {{ p.referencia }} <button type="button" class="botao botao--leve" :disabled="bloqueado" @click="desfazer('valor_proposta', p)">Desfazer este valor de proposta</button></li><li v-for="p in pagamentos" :key="`pagamento:${p.chave}`">Pagamento confirmado · {{ p.oferta }} · {{ p.componente }} · {{ dinheiro(p.valor_centavos) }} · {{ p.data }} · {{ p.referencia }} <button type="button" class="botao botao--leve" :disabled="bloqueado" @click="desfazer('pagamento_confirmado', p)">Desfazer este pagamento</button></li></ul>
    </details>
    <p v-if="aviso" class="recado" :class="{ 'recado--erro': estado === 'falhou' }" role="status">{{ aviso }}</p>
  </section>
</template>

<style scoped>
.crm-receita { display: grid; gap: var(--esp-2); }
.crm-receita .crm-form { margin-top: var(--esp-3); }
.crm-receita small { display: block; }
</style>
