<script setup lang="ts">
/**
 * Ajuste de tempo esperando aprovação. Nada muda no Google sem o clique em
 * Aprovar, e mover de horário é um SEGUNDO clique, oferecido só depois de o
 * servidor dizer que no mesmo horário não cabe.
 *
 * Duas origens, mesma rota e mesmo card: um agente propõe (texto fixo), ou o
 * usuário abre o ajuste pela Mochila e escolhe o tempo aqui (`origem:
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

// `proposto_min` viaja no evento porque o card editável é dono do valor: o App
// não pode ler de `proposta`, que guarda só o ponto de partida.
const emit = defineEmits<{ aprovar: [permitirMover: boolean, propostoMin: number]; descartar: [] }>()

const editavel = computed(() => props.proposta.origem === 'usuario')
const limites = computed(() => LIMITES_DE_AJUSTE[props.proposta.alvo])
const grade = LIMITES_DE_AJUSTE.grade

const escolhido = ref(props.proposta.proposto_min)
// Card reaproveitado por outra quest (mesma posição na lista, id diferente):
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
  <div class="border-4 border-black bg-[#c1f0c1] p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-2">
    <div class="flex items-start justify-between gap-2">
      <h3 class="font-black leading-tight">⏱ {{ titulo }}</h3>
      <button type="button" class="font-black text-lg leading-none" title="Descartar" :disabled="enviando" @click="emit('descartar')">✕</button>
    </div>
    <span v-if="squadNome" class="self-start bg-black text-white px-2 py-0.5 text-xs uppercase">{{ squadNome }}</span>
    <p class="italic text-sm">{{ proposta.pessoa_nome }}: {{ proposta.motivo }}</p>

    <label v-if="editavel" class="flex items-center gap-2 text-xs font-black uppercase">
      {{ proposta.alvo === 'duracao' ? 'Nova duração' : 'Novo esforço total' }}
      <input
        v-model.number="escolhido"
        type="number"
        :min="limites.min"
        :max="limites.max"
        :step="grade"
        :disabled="enviando"
        class="w-24 border-4 border-black bg-white px-2 py-1 font-black disabled:opacity-50"
      />
      min
      <span class="font-bold normal-case">({{ formatarMinutos(normalizarPropostoMin(proposta.alvo, Number(escolhido))) }})</span>
    </label>

    <p class="text-xs">{{ explicacao }}</p>
    <p v-if="erro" class="text-sm font-bold text-red-700">{{ erro }}</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        :disabled="enviando"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        @click="aprovar(false)"
      >
        {{ enviando ? 'Aplicando...' : 'Aprovar' }}
      </button>
      <button
        v-if="naoCabe"
        type="button"
        :disabled="enviando"
        class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        @click="aprovar(true)"
      >
        Mover para o próximo horário livre
      </button>
    </div>
  </div>
</template>
