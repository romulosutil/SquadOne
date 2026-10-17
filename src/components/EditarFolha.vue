<script setup lang="ts">
/**
 * Editar texto do roster (spec Fase 2 §3.3): papel/escopo de pessoa, nome/escopo
 * de domínio e de squad. Ids não aparecem nem mudam. Só os campos alterados
 * vão no PATCH, e o servidor recusa (400) texto acima do limite em vez de
 * cortar o que o usuário revisou.
 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import Sheet from './Sheet.vue'
import { LIMITES, type AlvoDeEdicao } from '../types'
import { mensagemDeRedacao, rosterApi } from '../rosterApi'
import { useAgentes } from '../agentes/estado'

const props = defineProps<{ alvo: AlvoDeEdicao; enviando: boolean; erro: string }>()
const emit = defineEmits<{ salvar: [corpo: Record<string, string>]; fechar: [] }>()

// Arquivar a squad (AC-25, 17/10/2026): era um botão ao lado de "Editar a squad", à vista no
// Escritório inteiro. É raro e tira a squad do seletor e do prompt, então mora aqui, no fim da
// folha, com o segundo toque no próprio botão (sem confirm(), que o celular mostra fora do app).
// O primeiro toque só arma e desarma sozinho em 6 s. O estado é o da aba (useAgentes): a folha é
// montada pela casca, e a ação é a mesma do Escritório.
const ag = useAgentes()
const ehSquad = computed(() => props.alvo.tipo === 'squad')
const podeArquivarSquad = computed(() => (ag.roster.value?.squads.length ?? 0) > 1 && !ag.isLoading.value)
const armado = ref(false)
let desarmar = 0
onBeforeUnmount(() => window.clearTimeout(desarmar))
const arquivarSquad = () => {
  const a = props.alvo
  if (a.tipo !== 'squad' || !podeArquivarSquad.value || ag.arquivando.value) return
  if (!armado.value) {
    armado.value = true
    window.clearTimeout(desarmar)
    desarmar = window.setTimeout(() => (armado.value = false), 6000)
    return
  }
  window.clearTimeout(desarmar)
  armado.value = false
  void ag.arquivarSquadConfirmada(a.squad.id)
}

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

    <section v-if="ehSquad" class="editar-arquivar" aria-labelledby="editar-arquivar-titulo">
      <h3 id="editar-arquivar-titulo">Arquivar a squad</h3>
      <p class="texto-2 texto-pequeno">
        Ela some do seletor e do prompt. Os eventos continuam no Google, e dá para reativar no Arquivo.
      </p>
      <p v-if="!podeArquivarSquad && !ag.isLoading.value" class="texto-2 texto-pequeno">A última squad ativa não se arquiva.</p>
      <p v-else-if="ag.isLoading.value" class="texto-2 texto-pequeno">Espere o pedido em andamento terminar.</p>
      <div v-else class="acoes">
        <button
          type="button"
          class="botao botao--perigo"
          :class="{ 'is-armado': armado }"
          :disabled="enviando || ag.arquivando.value"
          @click="arquivarSquad"
        >
          {{ ag.arquivando.value ? 'Arquivando…' : armado ? 'Toque de novo para arquivar' : 'Arquivar a squad' }}
        </button>
        <button v-if="armado" type="button" class="botao botao--leve" @click="armado = false">Cancelar</button>
      </div>
    </section>

    <template #rodape>
      <button type="button" class="botao" :disabled="enviando" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-editar" class="botao botao--primario" :disabled="!podeSalvar">
        {{ enviando ? 'Salvando…' : 'Salvar' }}
      </button>
    </template>
  </Sheet>
</template>

<style>
/* Fim da folha, separado por espaço e divisor (BP-R4), não por outra caixa (BP-R1). */
.editar-arquivar { display: grid; gap: var(--esp-2); margin-top: var(--respiro-pilha); padding-top: var(--respiro-interno); border-top: var(--divisor); }
.editar-arquivar h3 { margin: 0; font-size: var(--tam-texto); font-weight: var(--peso-forte); }
.editar-arquivar p { margin: 0; }
/* Armado para o segundo toque: muda a palavra e o fundo, para não passar por um toque comum. */
.editar-arquivar .botao.is-armado { background: var(--erro-fundo); }
</style>
