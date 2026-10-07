<script setup lang="ts">
/**
 * Gesto "Nova squad" (Fase 1): nome, escopo e papel do PO. A squad nasce com um
 * domínio e o PO dele. Limites iguais aos do servidor, para o erro aparecer antes.
 */
import { reactive } from 'vue'
import Sheet from './Sheet.vue'
import type { DadosNovaSquad } from '../types'

const props = defineProps({
  enviando: { type: Boolean, default: false },
  erro: { type: String, default: '' }
})

const emit = defineEmits<{ criar: [dados: DadosNovaSquad]; fechar: [] }>()

const form = reactive<DadosNovaSquad>({ nome: '', escopo: '', papel_po: '', nome_po: '' })

const enviar = () => {
  if (props.enviando) return
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
  <!-- Com a criação em curso nada fecha a folha: a squad já pode existir. -->
  <Sheet titulo="Nova squad" subtitulo="Nasce com uma sala e o PO dela." :bloqueada="enviando" @fechar="emit('fechar')">
    <form id="form-nova-squad" class="folha-form" @submit.prevent="enviar">
      <label class="rotulo">
        Nome
        <input v-model="form.nome" class="campo" required maxlength="40" :disabled="enviando" placeholder="Pay4Fun" data-autofocus />
      </label>
      <label class="rotulo">
        Escopo
        <textarea v-model="form.escopo" class="campo" required maxlength="200" rows="3" :disabled="enviando"
          placeholder="Que tipo de demanda pertence a esta squad"></textarea>
      </label>
      <label class="rotulo">
        Papel do PO
        <input v-model="form.papel_po" class="campo" required maxlength="60" :disabled="enviando" placeholder="PO Pay4Fun" />
      </label>
      <label class="rotulo">
        Nome do PO <small>(opcional)</small>
        <input v-model="form.nome_po" class="campo" maxlength="40" :disabled="enviando" />
      </label>
      <p v-if="erro" class="recado recado--erro" role="alert">{{ erro }}</p>
    </form>

    <template #rodape>
      <button type="button" class="botao" :disabled="enviando" @click="emit('fechar')">Cancelar</button>
      <button type="submit" form="form-nova-squad" class="botao botao--primario" :disabled="enviando">
        {{ enviando ? 'Criando…' : 'Criar' }}
      </button>
    </template>
  </Sheet>
</template>
