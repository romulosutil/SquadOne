<script setup lang="ts">
/**
 * Cartão de crescimento do squad (spec §4.4), na Hoje entre "o que precisa de
 * você".
 *
 * O cartão é o ÚNICO lugar onde uma proposta vira contratação: o modelo propõe
 * (capabilities.ts), o usuário aprova aqui, e só então POST /api/squad/hire
 * escreve no roster. Os dois eixos da árvore aparecem no mesmo cartão porque a
 * decisão do usuário é a mesma — muda só o efeito no escritório, anunciado no
 * subtítulo: sala nova ou mais uma pessoa numa sala que já existe.
 */
import { ref, type PropType } from 'vue'
import type { PropostaDominio, PropostaIntegrante } from '../types'

defineProps({
  sugestao: { type: Object as PropType<(PropostaDominio | PropostaIntegrante) & { id: string }>, required: true },
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' },
  // Nome da squad de origem quando ela não é a que a tela mostra; vazio esconde o selo.
  squadNome: { type: String, default: '' }
})

const emit = defineEmits<{ aprovar: [nome: string]; descartar: []; ajustar: [] }>()

// Vazio = o servidor escolhe um nome livre. O papel vem do modelo, o nome nao:
// quem entra no squad e decisao do usuario.
const nome = ref('')
</script>

<template>
  <article class="cartao cartao--decisao" :aria-label="sugestao.kind === 'dominio' ? `Proposta: abrir o domínio ${sugestao.dominio}` : `Proposta: contratar ${sugestao.papel}`">
    <div class="selos">
      <span class="selo selo--forte">{{ sugestao.kind === 'dominio' ? 'Domínio novo' : 'Contratação' }}</span>
      <span v-if="sugestao.kind === 'dominio' && sugestao.slot" class="selo">Sala {{ sugestao.slot[0] }},{{ sugestao.slot[1] }}</span>
      <span v-else-if="sugestao.kind === 'integrante'" class="selo">{{ sugestao.dominio_nome }}</span>
      <span v-if="squadNome" class="selo selo--destaque">Squad {{ squadNome }}</span>
    </div>

    <h3>
      <template v-if="sugestao.kind === 'dominio'">Abrir o domínio {{ sugestao.dominio }}?</template>
      <template v-else>Contratar {{ sugestao.papel }} em {{ sugestao.dominio_nome }}?</template>
    </h3>
    <p class="texto-2 texto-pequeno">
      <template v-if="sugestao.kind === 'dominio'">Sala nova no escritório · {{ sugestao.papel_po }}</template>
      <template v-else>Entra na sala do domínio, junto do PO</template>
    </p>
    <p>{{ sugestao.justificativa }}</p>
    <p class="texto-2 texto-pequeno">Escopo: {{ sugestao.escopo }}</p>

    <p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>

    <label class="rotulo">
      Nome <small>(opcional; vazio, o SquadOne escolhe)</small>
      <input v-model="nome" class="campo" :disabled="enviando" type="text" autocomplete="off" @keyup.enter="emit('aprovar', nome)" />
    </label>
    <div class="acoes">
      <button type="button" class="botao botao--primario" :disabled="enviando" @click="emit('aprovar', nome)">
        {{ enviando ? 'Contratando…' : 'Aprovar' }}
      </button>
      <!-- Ajustar abre a folha de contratação com a proposta pré-preenchida:
           o usuário edita papel/escopo (ou redige de novo) antes de contratar. -->
      <button type="button" class="botao" :disabled="enviando" @click="emit('ajustar')">Ajustar</button>
      <button type="button" class="botao botao--leve" :disabled="enviando" @click="emit('descartar')">Descartar</button>
    </div>
  </article>
</template>
