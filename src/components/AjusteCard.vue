<script setup lang="ts">
/**
 * Proposta de ajuste de um agente (Fase 4). Nada muda no Google sem o clique
 * em Aprovar, e mover de horário é um SEGUNDO clique, oferecido só depois de o
 * servidor dizer que no mesmo horário não cabe.
 */
import { computed } from 'vue'
import type { PropType } from 'vue'
import type { PropostaDeAjuste } from '../types'
import { formatarMinutos } from '../contribuicao'

const props = defineProps({
  proposta: { type: Object as PropType<PropostaDeAjuste>, required: true },
  // Nome da squad da proposta quando ela não é a ativa: a aprovação vale lá.
  squadNome: { type: String, default: '' },
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' },
  // O servidor respondeu 409 naoCabe: mover é um SEGUNDO gesto, nunca o primeiro.
  naoCabe: { type: Boolean, default: false }
})

const emit = defineEmits<{ aprovar: [permitirMover: boolean]; descartar: [] }>()

const titulo = computed(() => {
  const p = props.proposta
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
    <p class="text-xs">{{ explicacao }}</p>
    <p v-if="erro" class="text-sm font-bold text-red-700">{{ erro }}</p>
    <div class="flex flex-wrap gap-2">
      <button
        type="button"
        :disabled="enviando"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        @click="emit('aprovar', false)"
      >
        {{ enviando ? 'Aplicando...' : 'Aprovar' }}
      </button>
      <button
        v-if="naoCabe"
        type="button"
        :disabled="enviando"
        class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50"
        @click="emit('aprovar', true)"
      >
        Mover para o próximo horário livre
      </button>
    </div>
  </div>
</template>
