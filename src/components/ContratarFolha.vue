<script setup lang="ts">
/**
 * Contratar integrante, abrir sala (domínio + PO) ou substituir PO (spec
 * Fase 2 §3.2). A frase + "Redigir com Gemini" é AJUDA: toda falha vira
 * mensagem acima dos campos, que seguem editáveis, e contratar à mão sempre
 * funciona. A frase não é salva; o que vai para o roster é papel + escopo.
 * Sem campo de horário: janela de agenda é global (Fase 3).
 */
import { computed, reactive, ref } from 'vue'
import Sheet from './Sheet.vue'
import { LIMITES, type AlvoDeContratacao, type DadosDeContratacao, type PreenchimentoDeContratacao } from '../types'
import { mensagemDeRedacao, rosterApi } from '../rosterApi'

const props = defineProps<{
  alvo: AlvoDeContratacao
  inicial?: PreenchimentoDeContratacao
  enviando: boolean
  erro: string
}>()

const emit = defineEmits<{ contratar: [dados: DadosDeContratacao]; fechar: [] }>()

/** O formato que o Gemini também segue (spec §5.3), mostrado como exemplo. */
const PLACEHOLDER_ESCOPO =
  'Missão: ...\nCuida de: ...; ...\nNão cuida de: ...\nAo opinar sobre um compromisso: ...\nSinais de alerta: ...'

const form = reactive({
  frase: '',
  nome: '',
  papel: props.inicial?.papel ?? '',
  escopo: props.inicial?.escopo ?? '',
  nomeDominio: props.inicial?.nomeDominio ?? '',
  escopoDominio: props.inicial?.escopoDominio ?? '',
  /** Substituir PO: id do integrante a promover; vazio = pessoa nova. */
  integranteId: ''
})
const redigindo = ref(false)
const erroRedacao = ref('')
const avisoTruncado = ref(false)

const titulo = computed(() => {
  const a = props.alvo
  if (a.alvo === 'integrante') return `Contratar em ${a.dominio.nome}`
  if (a.alvo === 'po') return `Substituir o PO de ${a.dominio.nome}`
  // Sem a coordenada da grade (AC-25): o mesmo nome do botão que abriu a folha.
  return 'Abrir uma sala'
})
const integrantes = computed(() => (props.alvo.alvo === 'po' ? props.alvo.dominio.integrantes : []))
const promovendo = computed(() => props.alvo.alvo === 'po' && form.integranteId !== '')

const podeContratar = computed(() => {
  if (props.enviando || redigindo.value) return false
  if (promovendo.value) return true
  const pessoaOk = form.papel.trim() !== '' && form.escopo.trim() !== ''
  if (props.alvo.alvo === 'dominio') {
    return pessoaOk && form.nomeDominio.trim() !== '' && form.escopoDominio.trim() !== ''
  }
  return pessoaOk
})

const temTexto = () => [form.papel, form.escopo, form.nomeDominio, form.escopoDominio].some((v) => v.trim() !== '')

const redigir = async () => {
  const frase = form.frase.trim()
  if (!frase || redigindo.value) return
  redigindo.value = true
  erroRedacao.value = ''
  avisoTruncado.value = false
  try {
    const a = props.alvo
    const r = await rosterApi.redigir(
      a.alvo === 'dominio'
        ? { alvo: 'dominio', squadId: a.squadId, frase }
        : { alvo: a.alvo, squadId: a.squadId, dominioId: a.dominio.id, frase }
    )
    // O usuário pode ter escrito enquanto esperava: sobrescrever calado perderia o texto dele.
    if (temTexto() && !window.confirm('Substituir o texto atual pelo redigido?')) return
    if (r.alvo === 'dominio') {
      form.nomeDominio = r.nome
      form.escopoDominio = r.escopo_dominio
      form.papel = r.papel_po
      form.escopo = r.escopo_po
    } else {
      form.papel = r.papel
      form.escopo = r.escopo
    }
    avisoTruncado.value = r.truncado
  } catch (error) {
    erroRedacao.value = mensagemDeRedacao(error)
  } finally {
    redigindo.value = false
  }
}

const contratar = () => {
  if (!podeContratar.value) return
  const a = props.alvo
  if (a.alvo === 'po' && form.integranteId) {
    emit('contratar', { alvo: 'po', integranteId: form.integranteId })
  } else if (a.alvo === 'dominio') {
    emit('contratar', {
      alvo: 'dominio',
      nome: form.nome.trim(),
      nomeDominio: form.nomeDominio.trim(),
      escopoDominio: form.escopoDominio.trim(),
      papelPo: form.papel.trim(),
      escopoPo: form.escopo.trim()
    })
  } else if (a.alvo === 'po') {
    emit('contratar', { alvo: 'po', nome: form.nome.trim(), papel: form.papel.trim(), escopo: form.escopo.trim() })
  } else {
    emit('contratar', { alvo: 'integrante', nome: form.nome.trim(), papel: form.papel.trim(), escopo: form.escopo.trim() })
  }
}
</script>

<template>
  <!-- Com envio em curso nada fecha a folha: o hire já pode estar gravado. -->
  <Sheet :titulo="titulo" :bloqueada="enviando" @fechar="emit('fechar')">
    <form id="form-contratar" class="folha-form" @submit.prevent="contratar">
      <label v-if="alvo.alvo === 'po'" class="rotulo">
        Quem assume
        <select v-model="form.integranteId" class="campo" :disabled="enviando" data-autofocus>
          <option value="">Pessoa nova</option>
          <option v-for="p in integrantes" :key="p.id" :value="p.id">Promover {{ p.nome }} · {{ p.papel }}</option>
        </select>
      </label>

      <template v-if="!promovendo">
        <div class="quadro">
          <label class="rotulo">
            Em uma frase, o que você precisa
            <textarea
              v-model="form.frase"
              class="campo"
              rows="2"
              :maxlength="LIMITES.frase"
              :disabled="enviando"
              placeholder="alguém para cuidar do meu imposto de renda e das notas da PJ"
              :data-autofocus="alvo.alvo === 'po' ? undefined : ''"
            ></textarea>
          </label>
          <button type="button" class="botao" :disabled="redigindo || enviando || !form.frase.trim()" @click="redigir">
            {{ redigindo ? 'Redigindo…' : 'Redigir com Gemini' }}
          </button>
          <p class="texto-2 texto-pequeno">Opcional: você pode preencher tudo à mão.</p>
        </div>

        <p v-if="erroRedacao" class="recado recado--erro" role="alert">{{ erroRedacao }}</p>
        <p v-if="avisoTruncado" class="recado recado--atencao" role="status">
          O texto veio maior que o limite e foi cortado. Revise o fim.
        </p>

        <template v-if="alvo.alvo === 'dominio'">
          <label class="rotulo">
            Nome do domínio
            <input v-model="form.nomeDominio" class="campo" :maxlength="LIMITES.dominioNome" :disabled="enviando" placeholder="Financeiro" />
          </label>
          <label class="rotulo">
            Escopo do domínio <small>(uma linha)</small>
            <input v-model="form.escopoDominio" class="campo" :maxlength="LIMITES.dominioEscopo" :disabled="enviando" placeholder="contas, impostos e investimentos" />
          </label>
        </template>

        <label class="rotulo">
          {{ alvo.alvo === 'integrante' ? 'Nome' : 'Nome do PO' }} <small>(opcional)</small>
          <input v-model="form.nome" class="campo" :maxlength="LIMITES.pessoaNome" :disabled="enviando" />
        </label>
        <label class="rotulo">
          {{ alvo.alvo === 'integrante' ? 'Papel' : 'Papel do PO' }}
          <input v-model="form.papel" class="campo" :maxlength="LIMITES.papel" :disabled="enviando" placeholder="Contador PF" />
        </label>
        <label class="rotulo">
          {{ alvo.alvo === 'integrante' ? 'Escopo (treino)' : 'Escopo do PO (treino)' }}
          <textarea
            v-model="form.escopo"
            class="campo"
            rows="8"
            :maxlength="LIMITES.escopoPessoa"
            :disabled="enviando"
            :placeholder="PLACEHOLDER_ESCOPO"
          ></textarea>
          <span class="contador">{{ form.escopo.length }}/{{ LIMITES.escopoPessoa }}</span>
        </label>
      </template>

      <p v-if="alvo.alvo === 'po'" class="texto-2 texto-pequeno">
        O PO atual vira integrante arquivado deste domínio. Os eventos dele continuam no Google.
      </p>
      <p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>
    </form>

    <template #rodape>
      <button type="button" class="botao" :disabled="enviando" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-contratar" class="botao botao--primario" :disabled="!podeContratar">
        {{ enviando ? 'Contratando…' : alvo.alvo === 'po' ? 'Substituir' : 'Contratar' }}
      </button>
    </template>
  </Sheet>
</template>
