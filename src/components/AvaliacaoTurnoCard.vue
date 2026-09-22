<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  MOTIVOS_DE_AVALIACAO,
  type MotivoDeAvaliacao,
  podeEnviarAvaliacao,
} from '../avaliacao'

type Nota = 1 | 2 | 3 | 4 | 5

const props = defineProps<{
  enviando: boolean
  erro?: string
}>()

const emit = defineEmits<{
  enviar: [avaliacao: { nota: Nota; motivos: MotivoDeAvaliacao[]; comentario?: string }]
  fechar: []
}>()

const NOTAS: Nota[] = [1, 2, 3, 4, 5]
const nota = ref<Nota | null>(null)
const motivos = ref<MotivoDeAvaliacao[]>([])
const comentario = ref('')
const podeEnviar = computed(() => podeEnviarAvaliacao(nota.value, motivos.value))

const escolherNota = (valor: Nota) => {
  nota.value = valor
  if (valor >= 4) motivos.value = []
}

const trocarMotivo = (motivo: MotivoDeAvaliacao) => {
  if (motivos.value.includes(motivo)) {
    motivos.value = motivos.value.filter((atual) => atual !== motivo)
  } else if (motivos.value.length < 3) {
    motivos.value = [...motivos.value, motivo]
  }
}

const enviarAvaliacao = () => {
  if (!podeEnviar.value || nota.value === null || props.enviando) return
  const texto = comentario.value.trim()
  emit('enviar', {
    nota: nota.value,
    motivos: motivos.value,
    ...(texto ? { comentario: texto } : {}),
  })
}
</script>

<template>
  <section
    aria-labelledby="avaliacao-turno-titulo"
    class="fixed bottom-28 left-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)] border-4 border-black bg-white p-4 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)]"
  >
    <div class="mb-3 flex items-start justify-between gap-3">
      <div>
        <h2 id="avaliacao-turno-titulo" class="font-black text-sm uppercase">Como foi esta resposta?</h2>
        <p class="mt-1 text-xs font-medium">O feedback melhora os próximos turnos.</p>
      </div>
      <button
        type="button"
        class="border-2 border-black px-2 py-1 text-xs font-black hover:bg-black hover:text-white"
        aria-label="Fechar avaliação"
        @click="emit('fechar')"
      >×</button>
    </div>

    <div class="flex gap-1" role="group" aria-label="Nota de 1 a 5">
      <button
        v-for="valor in NOTAS"
        :key="valor"
        type="button"
        :aria-label="`${valor} de 5`"
        :aria-pressed="nota === valor"
        :class="nota === valor ? 'bg-[#ffdb58]' : 'bg-white hover:bg-gray-100'"
        class="h-10 flex-1 border-2 border-black font-black"
        @click="escolherNota(valor)"
      >{{ valor }}</button>
    </div>

    <fieldset v-if="nota !== null && nota <= 3" class="mt-3">
      <legend class="text-xs font-black">O que pesou? Escolha até 3.</legend>
      <label v-for="motivo in MOTIVOS_DE_AVALIACAO" :key="motivo.valor" class="mt-2 flex items-center gap-2 text-xs font-bold">
        <input
          type="checkbox"
          :checked="motivos.includes(motivo.valor)"
          :disabled="!motivos.includes(motivo.valor) && motivos.length >= 3"
          @change="trocarMotivo(motivo.valor)"
        >
        {{ motivo.rotulo }}
      </label>
    </fieldset>

    <label class="mt-3 block text-xs font-black" for="comentario-avaliacao">Comentário opcional</label>
    <textarea
      id="comentario-avaliacao"
      v-model="comentario"
      maxlength="1000"
      rows="2"
      class="mt-1 w-full resize-y border-2 border-black p-2 text-sm"
      placeholder="O que ajudaria na próxima resposta?"
    />

    <p v-if="erro" class="mt-2 border-2 border-black bg-red-100 p-2 text-xs font-bold" role="alert">{{ erro }}</p>
    <div class="mt-3 flex items-center justify-between gap-3">
      <button type="button" class="text-xs font-bold underline" @click="emit('fechar')">Agora não</button>
      <button
        type="button"
        :disabled="!podeEnviar || enviando"
        class="border-2 border-black bg-[#bbf7d0] px-3 py-2 text-xs font-black uppercase disabled:cursor-not-allowed disabled:opacity-50 hover:bg-black hover:text-white"
        @click="enviarAvaliacao"
      >{{ enviando ? 'Enviando…' : 'Enviar avaliação' }}</button>
    </div>
  </section>
</template>
