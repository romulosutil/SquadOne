<script setup lang="ts">
/**
 * Editar texto do roster (spec Fase 2 §3.3): papel/escopo de pessoa, nome/escopo
 * de domínio e de squad. Ids não aparecem nem mudam. Só os campos alterados
 * vão no PATCH, e o servidor recusa (400) texto acima do limite em vez de
 * cortar o que o usuário revisou.
 */
import { computed, reactive, ref } from 'vue'
import Sheet from './Sheet.vue'
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

/** Reescrever treino existente: mesma regra da folha de contratação (ajuda, nunca bloqueio). */
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
</script>

<template>
  <!-- Com o PATCH em curso nada fecha a folha: a edição já pode estar gravada. -->
  <Sheet :titulo="titulo" :bloqueada="enviando" @fechar="emit('fechar')">
    <form id="form-editar" class="folha-form" @submit.prevent="podeSalvar && emit('salvar', mudancas)">
      <div v-if="ehPessoa" class="quadro">
        <label class="rotulo">
          Reescrever o treino a partir de uma frase <small>(opcional)</small>
          <textarea v-model="form.frase" class="campo" rows="2" :maxlength="LIMITES.frase" :disabled="enviando"></textarea>
        </label>
        <button type="button" class="botao" :disabled="redigindo || enviando || !form.frase.trim()" @click="reescrever">
          {{ redigindo ? 'Redigindo…' : 'Reescrever com Gemini' }}
        </button>
      </div>
      <p v-if="erroRedacao" class="recado recado--erro" role="alert">{{ erroRedacao }}</p>

      <label class="rotulo">
        {{ rotuloPrimeiro }}
        <input v-model="form.primeiro" class="campo" :maxlength="limitePrimeiro" :disabled="enviando" data-autofocus />
      </label>
      <label class="rotulo">
        Escopo <small>{{ ehPessoa ? '(treino)' : '(uma linha)' }}</small>
        <textarea v-if="ehPessoa" v-model="form.escopo" class="campo" rows="8" :maxlength="limiteEscopo" :disabled="enviando"></textarea>
        <input v-else v-model="form.escopo" class="campo" :maxlength="limiteEscopo" :disabled="enviando" />
        <span class="contador">{{ form.escopo.length }}/{{ limiteEscopo }}</span>
      </label>

      <p class="texto-2 texto-pequeno">
        Mudar o escopo muda para quem as próximas demandas vão. Eventos já criados não mudam.
      </p>
      <p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>
    </form>

    <template #rodape>
      <button type="button" class="botao" :disabled="enviando" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-editar" class="botao botao--primario" :disabled="!podeSalvar">
        {{ enviando ? 'Salvando…' : 'Salvar' }}
      </button>
    </template>
  </Sheet>
</template>
