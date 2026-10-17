<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { brl, diaMes } from './formato'
import type { PreviaDoExtrato } from './types'

// Extrato OFX/CSV de RESERVA (07/10/2026): para quando uma conexão da Pluggy
// parar. Primeiro lê e mostra o que é novo (nada é gravado); importar é o
// segundo toque. O que a Pluggy já tem não entra, e quando a conexão voltar
// ela vence e a linha do extrato sai: o mesmo gasto nunca conta duas vezes.
// Desde 16/10/2026 (OT-11) o arquivo chega do "Importar" único (FinImportarArquivo),
// que monta este fluxo de novo a cada arquivo: conta e sinal recomeçam do zero
// como antes, a leitura começa ao montar e "Cancelar" devolve a escolha para lá.
const props = defineProps<{ arquivo: File }>()
const emit = defineEmits<{ importado: []; cancelar: [] }>()
// O seletor único fica desligado enquanto este fluxo lê ou grava, como antes.
const ocupado = defineModel<boolean>('ocupado', { default: false })

const contas = ref<{ id: string; nome: string; tipo: string }[]>([])
const conta = ref('')
const inverter = ref<boolean | null>(null)
const previa = ref<PreviaDoExtrato | null>(null)
const erro = ref('')
const feito = ref('')

const novos = computed(() => previa.value?.lancamentos.filter((l) => l.novo) ?? [])

async function enviar(confirmar: boolean) {
  ocupado.value = true
  erro.value = ''
  feito.value = ''
  const q = new URLSearchParams()
  if (conta.value) q.set('conta', conta.value)
  if (inverter.value !== null) q.set('inverter', inverter.value ? '1' : '0')
  if (confirmar) q.set('confirmar', '1')
  try {
    const resposta = await fetch(`/api/financas/importar/extrato?${q}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: props.arquivo,
    })
    const corpo = await resposta.json().catch(() => ({}))
    if (resposta.status === 400 && corpo.escolherConta) {
      contas.value = corpo.contas ?? []
      previa.value = null
      return
    }
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    previa.value = corpo
    inverter.value = corpo.invertido
    if (corpo.gravado) {
      feito.value = `${corpo.novos} lançamento(s) importado(s); ${corpo.jaEstavam} já estava(m).`
      previa.value = null
      emit('importado')
    }
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    ocupado.value = false
  }
}

function aoMudarConta() {
  inverter.value = null
  void enviar(false)
}

function trocarSinal() {
  inverter.value = !inverter.value
  void enviar(false)
}

onMounted(() => void enviar(false))
</script>

<template>
  <div class="fin-importar-fluxo">
    <h3 class="fin-subtitulo">Extrato de reserva (OFX ou CSV)</h3>
    <p class="fin-sub">Para quando uma conexão parar. O que a Pluggy já tem não entra de novo.</p>

    <label v-if="contas.length" class="fin-escolha">De que conta é?
      <select v-model="conta" :disabled="ocupado" @change="aoMudarConta">
        <option value="" disabled>Escolha</option>
        <option v-for="c in contas" :key="c.id" :value="c.id">{{ c.nome }}</option>
      </select>
    </label>

    <p v-if="ocupado" class="fin-sub" role="status">Lendo…</p>
    <p v-if="erro" class="fin-aviso is-forte" role="alert">{{ erro }}</p>
    <p v-if="feito" class="fin-aviso is-ok" role="status">{{ feito }}</p>

    <div v-if="previa" class="fin-previa">
      <p class="fin-aviso is-ok">
        {{ previa.conta.nome }}, de {{ diaMes(previa.periodo.de) }} a {{ diaMes(previa.periodo.ate) }}:
        {{ previa.lidos }} lido(s), {{ previa.novos }} novo(s), {{ previa.jaEstavam }} já estava(m).
        <template v-if="previa.ignoradas"> {{ previa.ignoradas }} linha(s) sem data ou valor ficaram de fora.</template>
      </p>
      <p v-if="previa.conta.tipo === 'cartao'" class="fin-sub">
        {{ previa.invertido ? 'As compras vinham positivas no arquivo e foram viradas para saída.' : 'Os sinais estão como no arquivo.' }}
        <button type="button" class="fin-botao" :disabled="ocupado" @click="trocarSinal">Trocar o sinal</button>
      </p>
      <details class="fin-dobra">
        <summary>Ver os {{ novos.length }} novo(s)</summary>
        <ul class="fin-linhas fin-linhas--compacta">
          <li v-for="(l, i) in novos" :key="i">
            <span><b>{{ l.descricao }}</b><small>{{ diaMes(l.data) }}</small></span>
            <span class="fin-valor" :class="{ 'is-positivo': l.centavos > 0 }">{{ brl(l.centavos) }}</span>
          </li>
        </ul>
      </details>
      <div class="fin-acoes">
        <button type="button" class="fin-botao fin-botao--primario" :disabled="ocupado || !previa.novos" @click="enviar(true)">
          Importar {{ previa.novos }} lançamento(s)
        </button>
        <button type="button" class="fin-botao" :disabled="ocupado" @click="emit('cancelar')">Cancelar</button>
      </div>
    </div>
  </div>
</template>
