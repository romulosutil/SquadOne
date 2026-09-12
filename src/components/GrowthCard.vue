<script setup>
/**
 * Card de crescimento do squad (spec §4.4) — mesmo vocabulário visual dos
 * cards da Mochila: borda preta de 4px, sombra dura, badges pretos.
 *
 * O card é o ÚNICO lugar onde uma proposta vira contratação: o modelo propõe
 * (capabilities.ts), o usuário aprova aqui, e só então POST /api/squad/hire
 * escreve no roster. Os dois eixos da árvore aparecem no mesmo card porque a
 * decisão do usuário é a mesma — muda só o efeito no escritório, anunciado no
 * subtítulo: sala nova ou mais uma pessoa numa sala que já existe.
 */
import { ref } from 'vue'

defineProps({
  sugestao: { type: Object, required: true },
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' }
})

const emit = defineEmits(['aprovar', 'descartar'])

// Vazio = o servidor escolhe um nome livre. O papel vem do modelo, o nome nao:
// quem entra no squad e decisao do usuario.
const nome = ref('')
</script>

<template>
  <div class="border-4 border-black bg-white p-3 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0">
    <div class="flex items-center gap-1 flex-wrap mb-2">
      <span class="bg-black text-white px-2 py-0.5 text-xs uppercase font-bold">
        {{ sugestao.kind === 'dominio' ? '🏗️ Domínio novo' : '🤝 Contratação' }}
      </span>
      <span
        v-if="sugestao.kind === 'dominio' && sugestao.slot"
        class="border-2 border-black px-2 py-0.5 text-xs uppercase font-bold"
      >
        Slot {{ sugestao.slot[0] }},{{ sugestao.slot[1] }}
      </span>
      <span v-else-if="sugestao.kind === 'integrante'" class="border-2 border-black px-2 py-0.5 text-xs uppercase font-bold">
        {{ sugestao.dominio_id }}
      </span>
    </div>

    <h3 class="font-bold text-lg leading-tight">
      <template v-if="sugestao.kind === 'dominio'">
        Abrir domínio {{ sugestao.dominio }}?
      </template>
      <template v-else>
        Contratar {{ sugestao.papel }} em {{ sugestao.dominio_nome }}?
      </template>
    </h3>

    <p class="text-xs font-bold uppercase opacity-60 mt-1">
      <template v-if="sugestao.kind === 'dominio'">
        Sala nova no escritório · {{ sugestao.papel_po }}
      </template>
      <template v-else>
        Entra na sala do domínio, junto do PO
      </template>
    </p>

    <p class="font-bold text-sm mt-2">{{ sugestao.justificativa }}</p>
    <p class="text-xs font-bold mt-1 opacity-70">Escopo: {{ sugestao.escopo }}</p>

    <p v-if="erro" class="mt-2 border-2 border-black bg-[#ff9b71] px-2 py-1 text-xs font-bold">
      {{ erro }}
    </p>

    <div class="flex items-stretch gap-2 mt-3">
      <input
        v-model="nome"
        :disabled="enviando"
        type="text"
        placeholder="Nome (opcional)"
        class="min-w-0 flex-1 border-2 border-black px-2 py-1 text-sm font-bold outline-none focus:bg-[#ffdb58] disabled:opacity-50"
        @keyup.enter="emit('aprovar', nome)"
      />
      <button
        :disabled="enviando"
        class="border-4 border-black bg-[#ffdb58] px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all disabled:opacity-50"
        @click="emit('aprovar', nome)"
      >
        {{ enviando ? 'Contratando...' : 'Aprovar' }}
      </button>
      <button
        :disabled="enviando"
        title="Descartar a proposta"
        class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:translate-x-[2px] hover:translate-y-[2px] hover:shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] transition-all disabled:opacity-50"
        @click="emit('descartar')"
      >
        ✕
      </button>
    </div>
  </div>
</template>
