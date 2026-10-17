<script setup lang="ts">
import { ref } from 'vue'
import FinImportar from './FinImportar.vue'
import FinImportarExtrato from './FinImportarExtrato.vue'
import { ACEITA_NA_IMPORTACAO, tipoDoArquivo, type TipoDeImportacao } from './importar'

// "Importar" único (16/10/2026, OT-11 do blueprint de serviço, "menos entradas
// repetidas no menu"): a fatura em PDF morava na Visão e o extrato OFX/CSV em
// Organizar, cada um com o seu seletor. Agora é um seletor só, na Visão (é onde se
// chega, e onde o "Devo" já manda importar a fatura "abaixo"); o arquivo decide o
// fluxo (importar.ts) e cada fluxo segue o mesmo de antes: lê e mostra a prévia sem
// gravar, importa no segundo toque, com as perguntas que só ele faz (qual fatura,
// de que conta, trocar o sinal). Os dois juntos num formulário só misturariam
// perguntas que não se aplicam ao outro arquivo, por isso o fluxo é montado
// inteiro, de novo a cada escolha (a `chave`): nada de uma escolha vaza para a próxima.
const emit = defineEmits<{ importado: [] }>()

const arquivo = ref<File | null>(null)
const tipo = ref<TipoDeImportacao | null>(null)
const chave = ref(0)
const ocupado = ref(false)
const erro = ref('')
const seletor = ref<HTMLInputElement | null>(null)

function aoEscolher(evento: Event) {
  const escolhido = (evento.target as HTMLInputElement).files?.[0] ?? null
  erro.value = ''
  arquivo.value = escolhido
  tipo.value = escolhido ? tipoDoArquivo(escolhido.name, escolhido.type) : null
  chave.value += 1
  if (escolhido && !tipo.value) erro.value = `"${escolhido.name}" não é PDF, OFX nem CSV. Envie a fatura do Santander em PDF ou o extrato do banco em OFX ou CSV.`
}

function cancelar() {
  arquivo.value = null
  tipo.value = null
  erro.value = ''
  // Sem limpar o seletor, escolher o mesmo arquivo de novo não dispararia o change.
  if (seletor.value) seletor.value.value = ''
}
</script>

<template>
  <section class="fin-bloco" aria-labelledby="fin-importar">
    <header class="fin-bloco__topo">
      <h2 id="fin-importar">Importar</h2>
      <p class="fin-sub">
        A fatura do Santander em PDF (o banco manda os totais do cartão, mas não os lançamentos: baixe no app do Santander)
        ou, quando uma conexão parar, o extrato do banco em OFX ou CSV. Nada entra antes de você ver o que foi lido.
      </p>
    </header>
    <label class="fin-arquivo">
      <span>{{ arquivo ? arquivo.name : 'Escolher PDF, OFX ou CSV' }}</span>
      <input ref="seletor" type="file" :accept="ACEITA_NA_IMPORTACAO" :disabled="ocupado" @change="aoEscolher" />
    </label>
    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }}</p>

    <FinImportar
      v-if="arquivo && tipo === 'fatura'"
      :key="`fatura-${chave}`"
      v-model:ocupado="ocupado"
      :arquivo="arquivo"
      @importado="emit('importado')"
      @cancelar="cancelar"
    />
    <FinImportarExtrato
      v-else-if="arquivo && tipo === 'extrato'"
      :key="`extrato-${chave}`"
      v-model:ocupado="ocupado"
      :arquivo="arquivo"
      @importado="emit('importado')"
      @cancelar="cancelar"
    />
  </section>
</template>
