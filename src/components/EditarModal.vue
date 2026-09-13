<script setup lang="ts">
/**
 * Editar texto do roster (spec Fase 2 §3.3): papel/escopo de pessoa, nome/escopo
 * de domínio e de squad. Ids não aparecem nem mudam. Só os campos alterados
 * vão no PATCH, e o servidor recusa (400) texto acima do limite em vez de
 * cortar o que o usuário revisou.
 */
import { computed, reactive, ref } from 'vue'
import { LIMITES, type AlvoDeEdicao } from '../types'
import { mensagemDeRedacao, rosterApi } from '../rosterApi'

const props = defineProps<{ alvo: AlvoDeEdicao; enviando: boolean; erro: string }>()
const emit = defineEmits<{ salvar: [corpo: Record<string, string>]; fechar: [] }>()

/** Valores de partida: a diferença contra eles é o corpo do PATCH. */
const original = (() => {
  const a = props.alvo
  if (a.tipo === 'pessoa') return { primeiro: a.pessoa.papel, escopo: a.pessoa.escopo }
  if (a.tipo === 'dominio') return { primeiro: a.dominio.nome, escopo: a.dominio.escopo }
  return { primeiro: a.squad.nome, escopo: a.squad.escopo }
})()

const form = reactive({ primeiro: original.primeiro, escopo: original.escopo, frase: '' })
const redigindo = ref(false)
const erroRedacao = ref('')

const ehPessoa = computed(() => props.alvo.tipo === 'pessoa')
const titulo = computed(() => {
  const a = props.alvo
  if (a.tipo === 'pessoa') return `Editar ${a.pessoa.nome}`
  if (a.tipo === 'dominio') return `Editar a sala ${a.dominio.nome}`
  return `Editar a squad ${a.squad.nome}`
})
const rotuloPrimeiro = computed(() => (ehPessoa.value ? 'Papel' : 'Nome'))
const limitePrimeiro = computed(() =>
  props.alvo.tipo === 'pessoa' ? LIMITES.papel : props.alvo.tipo === 'dominio' ? LIMITES.dominioNome : LIMITES.squadNome
)
const limiteEscopo = computed(() =>
  props.alvo.tipo === 'pessoa' ? LIMITES.escopoPessoa : props.alvo.tipo === 'dominio' ? LIMITES.dominioEscopo : LIMITES.squadEscopo
)

const mudancas = computed<Record<string, string>>(() => {
  const corpo: Record<string, string> = {}
  const chave = ehPessoa.value ? 'papel' : 'nome'
  if (form.primeiro.trim() !== original.primeiro) corpo[chave] = form.primeiro.trim()
  if (form.escopo.trim() !== original.escopo) corpo.escopo = form.escopo.trim()
  return corpo
})
const podeSalvar = computed(
  () =>
    !props.enviando &&
    !redigindo.value &&
    Object.keys(mudancas.value).length > 0 &&
    form.primeiro.trim() !== '' &&
    form.escopo.trim() !== ''
)

/** Reescrever treino existente: mesma regra do modal de contratação (ajuda, nunca bloqueio). */
const reescrever = async () => {
  const a = props.alvo
  const frase = form.frase.trim()
  if (a.tipo !== 'pessoa' || !frase || redigindo.value) return
  redigindo.value = true
  erroRedacao.value = ''
  try {
    const r = await rosterApi.redigir({ alvo: 'pessoa', pessoaId: a.pessoa.id, frase })
    if (r.alvo === 'dominio') return
    if (!window.confirm('Substituir o texto atual pelo redigido?')) return
    form.primeiro = r.papel
    form.escopo = r.escopo
  } catch (error) {
    erroRedacao.value = mensagemDeRedacao(error)
  } finally {
    redigindo.value = false
  }
}

const CAMPO = 'border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58] disabled:opacity-50'
const ROTULO = 'flex flex-col gap-1 text-xs font-black uppercase'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <form
      class="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]"
      @submit.prevent="podeSalvar && emit('salvar', mudancas)"
    >
      <h2 class="font-black text-xl uppercase">✎ {{ titulo }}</h2>

      <div v-if="ehPessoa" class="flex flex-col gap-1 border-2 border-dashed border-black p-2">
        <label :class="ROTULO">
          Reescrever o treino a partir de uma frase (opcional)
          <textarea v-model="form.frase" rows="2" :maxlength="LIMITES.frase" :disabled="enviando" :class="CAMPO"></textarea>
        </label>
        <button
          type="button"
          :disabled="redigindo || enviando || !form.frase.trim()"
          class="self-start border-4 border-black bg-[#bbf7d0] px-3 py-1 font-black text-xs uppercase disabled:opacity-50"
          @click="reescrever"
        >
          {{ redigindo ? 'Redigindo...' : '✨ Reescrever com Gemini' }}
        </button>
      </div>
      <p v-if="erroRedacao" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erroRedacao }}</p>

      <label :class="ROTULO">
        {{ rotuloPrimeiro }}
        <input v-model="form.primeiro" :maxlength="limitePrimeiro" :disabled="enviando" :class="CAMPO" />
      </label>
      <label :class="ROTULO">
        Escopo{{ ehPessoa ? ' (treino)' : ' (uma linha)' }}
        <textarea v-if="ehPessoa" v-model="form.escopo" rows="8" :maxlength="limiteEscopo" :disabled="enviando" :class="CAMPO"></textarea>
        <input v-else v-model="form.escopo" :maxlength="limiteEscopo" :disabled="enviando" :class="CAMPO" />
        <span class="self-end text-[10px]">{{ form.escopo.length }}/{{ limiteEscopo }}</span>
      </label>

      <p class="text-xs font-bold opacity-70">
        Mudar o escopo muda para quem as próximas demandas vão. Eventos já criados não mudam.
      </p>
      <p v-if="erro" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erro }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" :disabled="enviando" class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50" @click="emit('fechar')">
          Cancelar
        </button>
        <button
          type="submit"
          :disabled="!podeSalvar"
          class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        >
          {{ enviando ? 'Salvando...' : 'Salvar' }}
        </button>
      </div>
    </form>
  </div>
</template>
