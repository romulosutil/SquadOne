<script setup lang="ts">
/**
 * "Por que não está vendendo" (16/10/2026): o funil dos últimos 30 dias em degraus, com o que mais
 * perde marcado e o que fazer nele (por-que-nao-vende.ts). Substitui a linha de contagens da Hoje:
 * "3 novos · 7 em contato" não dizia onde o dinheiro escapa.
 *
 * `resumido` (16/10/2026, OT-08): na Hoje fica só o gargalo e o que fazer, com o link para Números;
 * os degraus moram em Números, junto do "Depois do sim". Um lugar para os números, a Hoje só com a ação.
 */
import { computed } from 'vue'
import { diagnosticoDeVenda } from './por-que-nao-vende'
import type { CrmLead } from './types'

const props = defineProps<{ leads: readonly CrmLead[]; agora: number; resumido?: boolean }>()
const d = computed(() => diagnosticoDeVenda(props.leads, props.agora))
const pct = (t?: number) => (t === undefined ? '' : `${Math.round(t * 100)}%`)
const maior = computed(() => Math.max(1, d.value.degraus[0]?.n ?? 1))
</script>

<template>
  <section class="nao-vende" aria-labelledby="nao-vende-titulo">
    <div class="nao-vende__cabeca">
      <h2 id="nao-vende-titulo">Por que não está vendendo</h2>
      <a v-if="resumido" class="nao-vende__mais" href="/crm?ver=numeros">Ver os números</a>
    </div>
    <div v-if="d.gargalo" class="nao-vende__gargalo" role="note">
      <strong>{{ d.gargalo.titulo }}</strong>
      <p v-if="!resumido">{{ d.gargalo.texto }}</p>
      <p><span class="texto-2">O que fazer:</span> {{ d.gargalo.acao }}</p>
    </div>
    <p v-else-if="!d.degraus[0].n" class="texto-2">Nenhuma primeira mensagem nos últimos {{ d.dias }} dias.</p>
    <p v-else class="texto-2">Nenhum degrau muito abaixo do esperado nos últimos {{ d.dias }} dias.</p>

    <template v-if="!resumido">
    <ol class="nao-vende__degraus" :aria-label="`Funil dos últimos ${d.dias} dias`">
      <li v-for="g in d.degraus" :key="g.id" :class="{ 'is-gargalo': d.gargalo?.degrau === g.id }">
        <span class="nao-vende__rotulo">{{ g.rotulo }}</span>
        <span class="nao-vende__barra" aria-hidden="true"><span :style="{ width: `${Math.max(2, (g.n / maior) * 100)}%` }" /></span>
        <strong class="nao-vende__n">{{ g.n }}</strong>
        <small class="texto-2 nao-vende__taxa">{{ pct(g.taxa) }}<template v-if="g.referencia !== undefined && g.taxa !== undefined"> (esperado ~{{ pct(g.referencia) }})</template></small>
      </li>
    </ol>
    <p class="texto-2 texto-pequeno">Últimos {{ d.dias }} dias, pelo retrato das planilhas. "Leram" é quem deixou o recibo ou respondeu (sem recibo é "não sei"), com as mesmas regras do placar abaixo; o "esperado" é referência de prospecção por mensagem, não meta.</p>
    </template>
  </section>
</template>

<style>
.nao-vende { display: grid; gap: var(--respiro-interno); min-width: 0; padding: var(--respiro-bloco); border: var(--linha); border-radius: var(--raio-bloco); background: var(--superficie); color: var(--texto); }
.nao-vende__cabeca { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--esp-2); }
.nao-vende h2 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
.nao-vende p { margin: 0; }
.nao-vende__mais { display: inline-flex; min-height: var(--toque); align-items: center; color: var(--texto); font-weight: var(--peso-forte); }
/* Gargalo calmo (17/10/2026): fundo neutro, a faixa e o título no --negativo. Com o bloco inteiro em
   --erro-fundo o cartão gritava (no escuro era um vinho), e é um diagnóstico para ler, não uma falha. */
.nao-vende__gargalo { display: grid; gap: var(--esp-1); padding: var(--esp-3) var(--esp-4) var(--esp-3) calc(var(--esp-4) + var(--faixa)); border-radius: var(--raio-controle); background: var(--superficie-2); box-shadow: inset var(--faixa) 0 0 var(--negativo); }
.nao-vende__gargalo > strong { color: var(--negativo); }
.nao-vende__degraus { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
/* Coluna da direita com largura fixa: com `auto`, cada linha tinha uma barra de tamanho diferente. */
.nao-vende__degraus li { display: grid; grid-template-columns: minmax(0, 1fr) 10.5rem; gap: var(--esp-0) var(--esp-2); align-items: center; padding: var(--esp-1) var(--esp-2); border-radius: var(--raio-controle); }
.nao-vende__degraus li.is-gargalo { background: var(--erro-fundo); }
.nao-vende__rotulo { grid-column: 1; }
.nao-vende__n { grid-column: 2; grid-row: 1; font-variant-numeric: tabular-nums; }
.nao-vende__barra { grid-column: 1; display: block; height: var(--esp-2); border-radius: var(--raio-pilula); background: var(--superficie-2); overflow: hidden; }
.nao-vende__barra span { display: block; height: 100%; background: var(--destaque); }
.nao-vende__degraus li.is-gargalo .nao-vende__barra span { background: var(--negativo); }
.nao-vende__taxa { grid-column: 2; font-variant-numeric: tabular-nums; text-align: right; }
</style>
