<script setup lang="ts">
/**
 * O cartão de gasto falado (fase 2 da RULES 28, 17/10/2026). "gastei 30 no mercado" no painel vira
 * este cartão por regra fixa, sem passar pelo Assistente nem por modelo nenhum; só o toque em
 * "Anotar em Finanças" grava, pela rota das finanças (POST /api/financas/gasto, mesma origem). O
 * valor aparece aqui porque a tela do app é o lugar dele (RULES 24); a confirmação diz só a categoria.
 */
import type { GastoNaTela } from './assistente'
import { textoDoValor, useAssistente } from './assistente'

const props = defineProps<{ gasto: GastoNaTela }>()
const as = useAssistente()

const ROTULO_DO_ESTADO = { proposto: 'Proposto', anotando: 'Anotando…', confirmado: 'Feito', descartado: 'Descartado' } as const
</script>

<template>
  <article class="assistente-cartao" :class="{ 'is-fechado': props.gasto.estado === 'confirmado' || props.gasto.estado === 'descartado' }" aria-label="Gasto para anotar">
    <header class="assistente-cartao__cabeca">
      <h3>Gasto para anotar</h3>
      <span class="selo" :class="{ 'selo--ok': props.gasto.estado === 'confirmado' }">{{ ROTULO_DO_ESTADO[props.gasto.estado] }}</span>
    </header>
    <p class="assistente-cartao__texto"><strong>{{ textoDoValor(props.gasto.gasto.centavos) }}</strong> · {{ props.gasto.gasto.onde }}</p>
    <p class="texto-2 texto-pequeno">Lido por regra fixa: não passou por nenhum modelo. Vai para a conta manual, em Finanças.</p>
    <p v-if="props.gasto.erro" class="recado recado--erro" role="alert">{{ props.gasto.erro }}</p>
    <div v-if="props.gasto.estado === 'proposto' || props.gasto.estado === 'anotando'" class="acoes">
      <button type="button" class="botao" :disabled="props.gasto.estado === 'anotando'" @click="as.anotarGasto(props.gasto.id)">
        {{ props.gasto.estado === 'anotando' ? 'Anotando…' : 'Anotar em Finanças' }}
      </button>
      <button type="button" class="botao botao--leve" :disabled="props.gasto.estado === 'anotando'" @click="as.descartarGasto(props.gasto.id)">Descartar</button>
    </div>
    <p v-if="props.gasto.resultado" class="recado recado--ok" role="status">{{ props.gasto.resultado }}</p>
  </article>
</template>
