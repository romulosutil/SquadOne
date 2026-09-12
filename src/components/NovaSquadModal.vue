<script setup lang="ts">
/**
 * Gesto "Nova squad" (Fase 1): nome, escopo e papel do PO. A squad nasce com um
 * domínio e o PO dele. Redigir papel/escopo com o Gemini é Fase 2 — aqui o
 * usuário escreve. Limites iguais aos do servidor, para o erro aparecer antes.
 */
import { reactive } from 'vue'
import type { DadosNovaSquad } from '../types'

defineProps({
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' }
})

const emit = defineEmits<{ criar: [dados: DadosNovaSquad]; fechar: [] }>()

const form = reactive<DadosNovaSquad>({ nome: '', escopo: '', papel_po: '', nome_po: '' })

const enviar = () => {
  const dados = {
    nome: form.nome.trim(),
    escopo: form.escopo.trim(),
    papel_po: form.papel_po.trim(),
    nome_po: form.nome_po.trim()
  }
  if (!dados.nome || !dados.escopo || !dados.papel_po) return
  emit('criar', dados)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <form
      class="w-full max-w-md border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] flex flex-col gap-3"
      @submit.prevent="enviar"
    >
      <h2 class="font-black text-xl uppercase">🏢 Nova squad</h2>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Nome
        <input v-model="form.nome" required maxlength="40" :disabled="enviando" placeholder="Pay4Fun"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]" />
      </label>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Escopo
        <textarea v-model="form.escopo" required maxlength="200" rows="3" :disabled="enviando"
          placeholder="Que tipo de demanda pertence a esta squad"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]"></textarea>
      </label>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Papel do PO
        <input v-model="form.papel_po" required maxlength="60" :disabled="enviando" placeholder="PO Pay4Fun"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]" />
      </label>

      <label class="flex flex-col gap-1 text-xs font-black uppercase">
        Nome do PO (opcional)
        <input v-model="form.nome_po" maxlength="40" :disabled="enviando"
          class="border-2 border-black px-2 py-1 text-sm font-bold normal-case outline-none focus:bg-[#ffdb58]" />
      </label>

      <p v-if="erro" class="border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">{{ erro }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" :disabled="enviando" @click="emit('fechar')"
          class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase disabled:opacity-50">
          Cancelar
        </button>
        <button type="submit" :disabled="enviando"
          class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] disabled:opacity-50">
          {{ enviando ? 'Criando...' : 'Criar' }}
        </button>
      </div>
    </form>
  </div>
</template>
