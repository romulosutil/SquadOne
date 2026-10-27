<script setup lang="ts">
import { computed, useId } from 'vue'
import { PONTOS_DA_ESTEIRA, trajetoDaEsteira, type EstacaoDaProducao } from './linha-de-producao'
import type { FaseDoEscritorio } from './jornada-do-escritorio'
const props = defineProps<{ estacoes: readonly EstacaoDaProducao[]; selecionada?: FaseDoEscritorio | null; disponivel: boolean; pontos?: Record<FaseDoEscritorio, [number, number]> }>()
const emit = defineEmits<{ selecionar: [fase: FaseDoEscritorio]; cliente:[id:string]; etapa:[fase:FaseDoEscritorio] }>()
const seta = `seta-esteira-${useId()}`
const pontos = computed(() => props.pontos ?? PONTOS_DA_ESTEIRA)
const caminho = computed(() => trajetoDaEsteira(1,6,pontos.value).map((p,i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' '))
const trechos = computed(() => props.estacoes.slice(1).map((e,i) => ({id:e.id, d:trajetoDaEsteira(props.estacoes[i].id,e.id,pontos.value).map((p,j) => `${j ? 'L' : 'M'}${p.join(' ')}`).join(' ')})))
</script>
<template>
  <div class="esteira-cena" aria-label="Percurso conectado da produção">
    <svg class="esteira-cena__trilho" viewBox="-450 0 900 500" aria-hidden="true">
      <defs><marker :id="seta" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L9 5L1 9" fill="none" stroke="#fff4c6" stroke-width="2" /></marker></defs>
      <path :d="caminho" class="esteira-cena__borda" /><path :d="caminho" class="esteira-cena__base" />
      <path v-for="t in trechos" :key="t.id" :d="t.d" class="esteira-cena__rota" :marker-end="`url(#${seta})`" />
    </svg>
    <div v-for="e in estacoes" :key="e.id" class="esteira-cena__estacao" :data-fase="e.id" :data-selecionada="selecionada === e.id || undefined" :style="{left:`${pontos[e.id][0]}px`,top:`${pontos[e.id][1]}px`}">
      <button class="esteira-cena__placa" type="button" :aria-label="`Estação ${e.id}, ${e.nome}: ${disponivel ? e.fichas.length + ' clientes' : 'aguardando leitura'}. Ver próximo passo.`" :aria-pressed="selecionada === e.id" @click="emit('selecionar',e.id)"><strong>{{ e.id }}</strong><b>{{ disponivel ? e.fichas.length : '…' }}</b></button>
      <span class="esteira-cena__nome" aria-hidden="true">{{ e.nome }}</span>
    </div>
  </div>
</template>
<style scoped>
.esteira-cena { position:absolute;left:0;top:0;z-index:12;pointer-events:none; }
.esteira-cena__trilho { position:absolute;left:-450px;top:0;width:900px;height:500px;overflow:visible; }
.esteira-cena__borda,.esteira-cena__base,.esteira-cena__rota { fill:none;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke; }
.esteira-cena__borda { stroke:#182c2c;stroke-width:14; }
.esteira-cena__base { stroke:#398b83;stroke-width:9; }
.esteira-cena__rota { stroke:#ffe3a0;stroke-width:2;stroke-dasharray:4 9; }
.esteira-cena__estacao { position:absolute;display:grid;justify-items:center;transform:translate(-50%,calc(-22px / var(--escala,1)));width:calc(116px / var(--escala,1));pointer-events:none;color:#fff2cc;font-family:var(--fonte); }
.esteira-cena__placa { position:relative;display:grid;place-items:center;pointer-events:auto;min-width:calc(44px / var(--escala,1));height:calc(44px / var(--escala,1));padding:0;border:calc(2px / var(--escala,1)) solid #b6dbcc;border-radius:50%;background:#203f3c;color:#fff0cd;box-shadow:var(--sombra-pequena);cursor:pointer;font:700 calc(16px / var(--escala,1))/1 var(--fonte); }
.esteira-cena__placa b { position:absolute;right:calc(-14px / var(--escala,1));top:calc(-5px / var(--escala,1));min-width:calc(25px / var(--escala,1));padding:calc(var(--esp-1) / var(--escala,1));border-radius:calc(var(--raio-controle) / 2 / var(--escala,1));background:#f7e3ae;color:#273a32;font-size:calc(var(--tam-mini) / var(--escala,1)); }
.esteira-cena__nome { margin-top:calc(var(--esp-1) / var(--escala,1));padding:calc(var(--esp-1) * .75 / var(--escala,1)) calc(var(--esp-1) * 1.5 / var(--escala,1));border-radius:calc(var(--raio-controle) * .4 / var(--escala,1));background:#172d2fed;font-size:calc(var(--tam-mini) / var(--escala,1));line-height:1.2;text-align:center; }
.esteira-cena__estacao[data-selecionada] .esteira-cena__placa { background:#f0ce79;color:#273a32;border-color:#fff2c6;box-shadow:var(--sombra); }
.esteira-cena__placa:focus-visible { outline:calc(3px / var(--escala,1)) solid #fff3c7;outline-offset:calc(4px / var(--escala,1)); }
</style>
