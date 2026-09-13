<script setup lang="ts">
/**
 * Contratar integrante, abrir sala (domínio + PO) ou substituir PO (spec
 * Fase 2 §3.2). A frase + "Redigir com Gemini" é AJUDA: toda falha vira
 * mensagem acima dos campos, que seguem editáveis, e contratar à mão sempre
 * funciona. A frase não é salva; o que vai para o roster é papel + escopo.
 * Sem campo de horário: janela de agenda é global (Fase 3).
 */
import { computed, reactive, ref } from 'vue'
import { LIMITES, type AlvoDeContratacao, type DadosDeContratacao, type PreenchimentoDeContratacao } from '../types'
import { mensagemDeRedacao, rosterApi } from '../rosterApi'
import { useFecharComEsc } from '../modal'

const props = defineProps<{
  alvo: AlvoDeContratacao
  inicial?: PreenchimentoDeContratacao
  enviando: boolean
  erro: string
}>()

const emit = defineEmits<{ contratar: [dados: DadosDeContratacao]; fechar: [] }>()

// Com envio em curso, nem overlay nem Esc fecham: o hire já pode estar gravado.
const fechar = () => {
  if (!props.enviando) emit('fechar')
}
useFecharComEsc(() => !props.enviando, fechar)

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
  return `Abrir sala (${a.slot[0]},${a.slot[1]})`
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

const CAMPO =
  'border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58] disabled:opacity-50'
const ROTULO = 'flex flex-col gap-1 text-xs font-black uppercase'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="fechar">
    <form
      class="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
      @submit.prevent="contratar"
    >
      <h2 class="font-black text-xl uppercase">🤝 {{ titulo }}</h2>

      <label v-if="alvo.alvo === 'po'" :class="ROTULO">
        Quem assume
        <select v-model="form.integranteId" :disabled="enviando" :class="CAMPO">
          <option value="">Pessoa nova</option>
          <option v-for="p in integrantes" :key="p.id" :value="p.id">Promover {{ p.nome }} · {{ p.papel }}</option>
        </select>
      </label>

      <template v-if="!promovendo">
        <div class="flex flex-col gap-1 border-2 border-dashed border-black p-2">
          <label :class="ROTULO">
            Em uma frase, o que você precisa
            <textarea
              v-model="form.frase"
              rows="2"
              :maxlength="LIMITES.frase"
              :disabled="enviando"
              placeholder="alguém para cuidar do meu imposto de renda e das notas da PJ"
              :class="CAMPO"
            ></textarea>
          </label>
          <button
            type="button"
            :disabled="redigindo || enviando || !form.frase.trim()"
            class="self-start border-4 border-black bg-[#bbf7d0] px-3 py-1 font-black text-xs uppercase disabled:opacity-50"
            @click="redigir"
          >
            {{ redigindo ? 'Redigindo...' : '✨ Redigir com Gemini' }}
          </button>
          <p class="text-xs font-bold opacity-70">Opcional: você pode preencher tudo à mão.</p>
        </div>

        <p v-if="erroRedacao" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erroRedacao }}</p>
        <p v-if="avisoTruncado" class="border-2 border-black bg-[#ffdb58] px-2 py-1 text-xs font-bold">
          O texto veio maior que o limite e foi cortado. Revise o fim.
        </p>

        <template v-if="alvo.alvo === 'dominio'">
          <label :class="ROTULO">
            Nome do domínio
            <input v-model="form.nomeDominio" :maxlength="LIMITES.dominioNome" :disabled="enviando" placeholder="Financeiro" :class="CAMPO" />
          </label>
          <label :class="ROTULO">
            Escopo do domínio (uma linha)
            <input v-model="form.escopoDominio" :maxlength="LIMITES.dominioEscopo" :disabled="enviando" placeholder="contas, impostos e investimentos" :class="CAMPO" />
          </label>
        </template>

        <label :class="ROTULO">
          {{ alvo.alvo === 'integrante' ? 'Nome (opcional)' : 'Nome do PO (opcional)' }}
          <input v-model="form.nome" :maxlength="LIMITES.pessoaNome" :disabled="enviando" :class="CAMPO" />
        </label>
        <label :class="ROTULO">
          {{ alvo.alvo === 'integrante' ? 'Papel' : 'Papel do PO' }}
          <input v-model="form.papel" :maxlength="LIMITES.papel" :disabled="enviando" placeholder="Contador PF" :class="CAMPO" />
        </label>
        <label :class="ROTULO">
          {{ alvo.alvo === 'integrante' ? 'Escopo (treino)' : 'Escopo do PO (treino)' }}
          <textarea
            v-model="form.escopo"
            rows="8"
            :maxlength="LIMITES.escopoPessoa"
            :disabled="enviando"
            :placeholder="PLACEHOLDER_ESCOPO"
            :class="CAMPO"
          ></textarea>
          <span class="self-end text-[10px]">{{ form.escopo.length }}/{{ LIMITES.escopoPessoa }}</span>
        </label>
      </template>

      <p v-if="alvo.alvo === 'po'" class="text-xs font-bold opacity-70">
        O PO atual vira integrante arquivado deste domínio. Os eventos dele continuam no Google.
      </p>
      <p v-if="erro" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erro }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" :disabled="enviando" class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50" @click="emit('fechar')">
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="!podeContratar"
          class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        >
          {{ enviando ? 'Contratando...' : alvo.alvo === 'po' ? 'Substituir' : 'Contratar' }}
        </button>
      </div>
    </form>
  </div>
</template>
