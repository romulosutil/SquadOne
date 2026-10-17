<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { brl, diaMes } from './formato'
import type { PreviaDaFatura } from './types'

// Fatura do Santander em PDF: o cartão vem da Pluggy só com os totais. Primeiro
// lê e confere (nada é gravado); importar é o segundo toque, e só com a
// conferência batendo — ou com o Rômulo aceitando a diferença, por escrito.
// Desde 16/10/2026 (OT-11) o arquivo chega do "Importar" único (FinImportarArquivo),
// que monta este fluxo de novo a cada arquivo escolhido: por isso a leitura começa
// ao montar, e "Cancelar" devolve a escolha para lá.
const props = defineProps<{ arquivo: File }>()
const emit = defineEmits<{ importado: []; cancelar: [] }>()
// O seletor único fica desligado enquanto este fluxo lê ou grava, como antes.
const ocupado = defineModel<boolean>('ocupado', { default: false })

const previa = ref<PreviaDaFatura | null>(null)
const escolher = ref<{ id: string; vencimento: string; totalBanco: number }[]>([])
const faturaEscolhida = ref('')
const erro = ref('')
const feito = ref('')

async function enviar(confirmar: boolean, aceitarDiferenca = false) {
  ocupado.value = true
  erro.value = ''
  feito.value = ''
  const q = new URLSearchParams()
  if (confirmar) q.set('confirmar', '1')
  if (aceitarDiferenca) q.set('aceitarDiferenca', '1')
  if (faturaEscolhida.value) q.set('fatura', faturaEscolhida.value)
  try {
    const resposta = await fetch(`/api/financas/importar/santander?${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/pdf' },
      body: props.arquivo,
    })
    const corpo = await resposta.json().catch(() => ({}))
    if (resposta.status === 409 && corpo.escolherFatura) {
      escolher.value = corpo.faturas ?? []
      erro.value = corpo.error
      return
    }
    if (!resposta.ok && !corpo.conferencia) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    previa.value = corpo
    escolher.value = []
    if (corpo.gravado) {
      feito.value = `${corpo.novos} lançamento(s) importado(s).`
      emit('importado')
    } else if (corpo.error) {
      erro.value = corpo.error
    }
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    ocupado.value = false
  }
}

onMounted(() => void enviar(false))
</script>

<template>
  <div class="fin-importar-fluxo">
    <h3 class="fin-subtitulo">Fatura do Santander (PDF)</h3>
    <p class="fin-sub">É conferida com o total do banco antes de entrar.</p>
    <p v-if="ocupado" class="fin-sub" role="status">Lendo…</p>
    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }}</p>
    <p v-if="feito" class="fin-aviso is-ok" role="status">{{ feito }}</p>

    <div v-if="escolher.length" class="fin-escolha">
      <label>Qual fatura é esta?
        <select v-model="faturaEscolhida">
          <option value="" disabled>Escolha</option>
          <option v-for="f in escolher" :key="f.id" :value="f.id">vence {{ diaMes(f.vencimento) }}/{{ f.vencimento.slice(0, 4) }} · {{ brl(f.totalBanco) }}</option>
        </select>
      </label>
      <button type="button" class="fin-botao" :disabled="!faturaEscolhida || ocupado" @click="enviar(false)">Conferir</button>
    </div>

    <div v-if="previa && !previa.gravado" class="fin-previa">
      <p class="fin-aviso" :class="previa.conferencia.bate ? 'is-ok' : 'is-forte'">
        <template v-if="previa.conferencia.bate">
          Bate com o banco: a fatura que vence em {{ diaMes(previa.fatura.vencimento) }} soma {{ brl(previa.fatura.totalBanco) }} nos dois.
        </template>
        <template v-else-if="previa.conferencia.diferencaCentavos !== null">
          Não bate: pelo PDF dá {{ brl(previa.conferencia.esperadoCentavos ?? 0) }}, o banco diz {{ brl(previa.conferencia.totalBanco) }}
          (diferença de {{ brl(previa.conferencia.diferencaCentavos) }}). Algum lançamento pode não ter sido lido.
        </template>
        <template v-else>Não deu para conferir: o PDF não trouxe o saldo anterior.</template>
      </p>
      <p class="fin-sub">{{ previa.lidos }} lançamento(s) lido(s), {{ previa.novos }} novo(s).</p>
      <details class="fin-dobra">
        <summary>Ver o que foi lido</summary>
        <ul class="fin-linhas fin-linhas--compacta">
          <li v-for="(l, i) in previa.lancamentos" :key="i" :class="{ 'is-repetido': !l.novo }">
            <span><b>{{ l.descricao }}</b><small>{{ diaMes(l.dataCompra) }}<template v-if="l.parcela"> · {{ l.parcela }}</template><template v-if="l.cartaoFinal"> · ·{{ l.cartaoFinal }}</template><template v-if="!l.novo"> · já estava</template></small></span>
            <span class="fin-valor" :class="{ 'is-positivo': l.centavos > 0 }">{{ brl(l.centavos) }}</span>
          </li>
        </ul>
      </details>
      <div class="fin-acoes">
        <button v-if="previa.conferencia.bate" type="button" class="fin-botao fin-botao--primario" :disabled="ocupado || !previa.novos" @click="enviar(true)">
          Importar {{ previa.novos }} lançamento(s)
        </button>
        <button v-else type="button" class="fin-botao" :disabled="ocupado || !previa.novos" @click="enviar(true, true)">
          Importar mesmo com a diferença
        </button>
        <button type="button" class="fin-botao" :disabled="ocupado" @click="emit('cancelar')">Cancelar</button>
      </div>
    </div>
  </div>
</template>
