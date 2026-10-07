<script setup lang="ts">
/**
 * Ajuste de tempo esperando aprovação. Nada muda no Google sem o clique em
 * Aprovar, e mover de horário é um SEGUNDO clique, oferecido só depois de o
 * servidor dizer que no mesmo horário não cabe.
 *
 * Duas origens, mesma rota e mesmo cartão: um agente propõe (texto fixo), ou o
 * usuário abre o ajuste pela agenda e escolhe o tempo aqui (`origem:
 * 'usuario'`, campo editável). A diferença acaba no `proposto_min` emitido.
 */
import { computed, ref, watch } from 'vue'
import type { PropType } from 'vue'
import { LIMITES_DE_AJUSTE, type PropostaDeAjuste } from '../types'
import { formatarMinutos, normalizarPropostoMin } from '../contribuicao'

const props = defineProps({
  proposta: { type: Object as PropType<PropostaDeAjuste>, required: true },
  // Nome da squad da proposta quando ela não é a ativa: a aprovação vale lá.
  squadNome: { type: String, default: '' },
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' },
  // O servidor respondeu 409 naoCabe: mover é um SEGUNDO gesto, nunca o primeiro.
  naoCabe: { type: Boolean, default: false }
})

// `proposto_min` viaja no evento porque o cartão editável é dono do valor: o
// estado não pode ler de `proposta`, que guarda só o ponto de partida.
const emit = defineEmits<{ aprovar: [permitirMover: boolean, propostoMin: number]; descartar: [] }>()

const editavel = computed(() => props.proposta.origem === 'usuario')
const limites = computed(() => LIMITES_DE_AJUSTE[props.proposta.alvo])
const grade = LIMITES_DE_AJUSTE.grade

const escolhido = ref(props.proposta.proposto_min)
// Cartão reaproveitado por outra quest (mesma posição na lista, id diferente):
// sem isto o campo ficaria com o tempo do compromisso anterior.
watch(() => props.proposta.id, () => { escolhido.value = props.proposta.proposto_min })

const aprovar = (permitirMover: boolean) => {
  const min = editavel.value ? normalizarPropostoMin(props.proposta.alvo, Number(escolhido.value)) : props.proposta.proposto_min
  // Devolve o valor já normalizado para o campo, senão o usuário aprovaria 47
  // e veria 45 acontecer sem explicação.
  if (editavel.value) escolhido.value = min
  emit('aprovar', permitirMover, min)
}

const titulo = computed(() => {
  const p = props.proposta
  const oQue = p.alvo === 'duracao' ? 'a duração' : 'o esforço'
  if (editavel.value) return `Ajustar ${oQue} de "${p.titulo}" (hoje ${formatarMinutos(p.atual_min)})`
  return p.alvo === 'duracao'
    ? `${p.papel} propõe ${p.atual_min} → ${p.proposto_min} min em "${p.titulo}"`
    : `${p.papel} propõe esforço de ${formatarMinutos(p.atual_min)} → ${formatarMinutos(p.proposto_min)} para "${p.titulo}"`
})

const explicacao = computed(() =>
  props.proposta.alvo === 'duracao'
    ? 'Aprovar muda só o fim do bloco. Se não couber, você decide se move.'
    : 'Aprovar cria blocos antes do prazo (para mais) ou encurta blocos futuros (para menos). Nada é apagado.'
)
</script>

<template>
  <article class="cartao cartao--ajuste" :aria-label="`Ajuste de tempo: ${proposta.titulo}`">
    <div class="selos">
      <span class="selo selo--ok">Ajuste de tempo</span>
      <span v-if="squadNome" class="selo selo--destaque">Squad {{ squadNome }}</span>
    </div>
    <h3>{{ titulo }}</h3>
    <p class="texto-pequeno"><em>{{ proposta.pessoa_nome }}: {{ proposta.motivo }}</em></p>

    <label v-if="editavel" class="rotulo">
      {{ proposta.alvo === 'duracao' ? 'Nova duração, em minutos' : 'Novo esforço total, em minutos' }}
      <input
        v-model.number="escolhido"
        class="campo"
        type="number"
        inputmode="numeric"
        :min="limites.min"
        :max="limites.max"
        :step="grade"
        :disabled="enviando"
      />
      <small>Fica {{ formatarMinutos(normalizarPropostoMin(proposta.alvo, Number(escolhido))) }}, de {{ grade }} em {{ grade }} min.</small>
    </label>

    <p class="texto-2 texto-pequeno">{{ explicacao }}</p>
    <p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>
    <div class="acoes">
      <button type="button" class="botao botao--primario" :disabled="enviando" @click="aprovar(false)">
        {{ enviando ? 'Aplicando…' : 'Aprovar' }}
      </button>
      <button v-if="naoCabe" type="button" class="botao" :disabled="enviando" @click="aprovar(true)">
        Mover para o próximo horário livre
      </button>
      <button type="button" class="botao botao--leve" :disabled="enviando" @click="emit('descartar')">Descartar</button>
    </div>
  </article>
</template>
