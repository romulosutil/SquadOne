<script setup lang="ts">
import { ref } from 'vue'
import { enviarJson } from './formato'
import type { Lancamento } from './types'

// O editor de um lançamento (07/10/2026), à parte desde 16/10/2026 para a lista do
// celular e a tabela do desktop usarem o mesmo: trocar a categoria, com "aplicar
// sempre a este estabelecimento" (vira regra), e marcar ou desmarcar como recorrente.
// Nasce a cada abertura (v-if), então o estado começa do lançamento de agora.
const props = defineProps<{ lancamento: Lancamento; opcoes: string[] }>()
const emit = defineEmits<{ salvo: [anuncio: string]; fechar: [] }>()

const novaCategoria = ref(props.lancamento.categoria)
const aplicarSempre = ref(false)
const salvando = ref(false)
const erro = ref('')

async function salvarCategoria() {
  salvando.value = true
  erro.value = ''
  try {
    const r = await enviarJson<{ categoria: string; regra: string | null }>('PATCH', `/lancamentos/${encodeURIComponent(props.lancamento.id)}`, {
      categoria: novaCategoria.value,
      aplicarSempre: aplicarSempre.value,
    })
    emit('salvo', r.regra ? `Categoria trocada para ${r.categoria}, e daqui para a frente também nos outros deste estabelecimento.` : `Categoria trocada para ${r.categoria}.`)
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    salvando.value = false
  }
}

async function marcarRecorrente(recorrente: boolean) {
  const l = props.lancamento
  salvando.value = true
  erro.value = ''
  try {
    // Desmarcar o que só estava por marca volta para a detecção; o detectado ganha a marca "não".
    const valor = recorrente ? true : l.marcaDeRecorrente === true ? null : false
    await enviarJson('PUT', '/recorrentes', { estabelecimento: l.estabelecimento, recorrente: valor })
    emit('salvo', recorrente ? 'Marcado como recorrente.' : 'Não é mais recorrente.')
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    salvando.value = false
  }
}
</script>

<template>
  <form :id="`editor-${lancamento.id}`" class="fin-editor" @submit.prevent="salvarCategoria">
    <label>Categoria
      <select v-model="novaCategoria" :disabled="salvando">
        <option v-for="c in opcoes" :key="c" :value="c">{{ c }}</option>
      </select>
    </label>
    <label v-if="lancamento.estabelecimento" class="fin-marca">
      <input v-model="aplicarSempre" type="checkbox" :disabled="salvando" />
      Aplicar sempre a este estabelecimento
    </label>
    <small v-if="lancamento.estabelecimento" class="fin-sub">{{ lancamento.estabelecimento }}<template v-if="lancamento.temRegra"> · já tem uma regra, que será trocada</template></small>
    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }}</p>
    <div class="fin-acoes">
      <button type="submit" class="fin-botao fin-botao--primario" :disabled="salvando || (novaCategoria === lancamento.categoria && !aplicarSempre)">Salvar</button>
      <button v-if="lancamento.natureza === 'despesa' && lancamento.estabelecimento" type="button" class="fin-botao" :disabled="salvando" @click="marcarRecorrente(!lancamento.recorrente)">
        {{ lancamento.recorrente ? 'Não é recorrente' : 'Marcar como recorrente' }}
      </button>
      <button type="button" class="fin-botao" @click="emit('fechar')">Fechar</button>
    </div>
  </form>
</template>
