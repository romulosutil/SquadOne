<script setup lang="ts">
import { computed } from 'vue'
import type { CrmLead } from '../operations/types'
import { fasesDoCliente } from './jornada-do-escritorio'
const props = defineProps<{ lead: CrmLead; agora?: number; compacto?: boolean }>()
const fases = computed(() => fasesDoCliente(props.lead, props.agora))
const nomes = { atual: 'Agora', confirmado: 'Confirmado', depois: 'Depois', 'sem-registro': 'Sem registro' }
const curtos = ['Preparar','Contato','Conversa','Material','Proposta','Resultado']
</script>
<template><ol class="jornada-cliente" :class="{'jornada-cliente--compacta':compacto}" aria-label="Fases da jornada do cliente"><li v-for="fase in fases" :key="fase.id" :data-estado="fase.estado" :aria-label="`${fase.id}. ${fase.nome}: ${nomes[fase.estado]}`" :aria-current="fase.estado === 'atual' ? 'step' : undefined"><span class="jornada-cliente__numero">{{ fase.estado === 'confirmado' ? '✓' : fase.id }}</span><div><strong>{{ compacto ? curtos[fase.id-1] : fase.nome }}</strong><small v-if="!compacto || fase.estado === 'atual'">{{ nomes[fase.estado] }}</small></div></li></ol></template>
<style scoped>
.jornada-cliente { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); list-style: none; margin: 0; padding: 0; gap: var(--esp-2); }
.jornada-cliente li { display: flex; align-items: center; gap: var(--esp-2); padding: var(--esp-2); min-width: 0; background: var(--superficie-2); border-radius: var(--raio-controle); border: var(--contorno-painel); }
.jornada-cliente li[data-estado='atual'] { background: var(--realce); box-shadow: inset 0 -3px 0 var(--destaque); }
.jornada-cliente__numero { flex: 0 0 var(--esp-6); height: var(--esp-6); display: grid; place-items: center; border-radius: var(--raio-pilula); border: var(--contorno-painel); font-size: var(--tam-apoio); }
.jornada-cliente li[data-estado='confirmado'] .jornada-cliente__numero { color: var(--positivo); }
.jornada-cliente li > div { min-width: 0; display: grid; gap: var(--esp-0); }
.jornada-cliente strong { font-size: var(--tam-apoio); overflow-wrap: anywhere; }
.jornada-cliente small { color: var(--texto-2); font-size: var(--tam-mini); }
@media (max-width: 29rem) { .jornada-cliente { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.jornada-cliente--compacta { grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--esp-1); }
.jornada-cliente--compacta li { min-height:var(--toque);gap:var(--esp-1);padding:var(--esp-1); }
.jornada-cliente--compacta .jornada-cliente__numero { flex-basis:var(--esp-4);height:var(--esp-4);font-size:var(--tam-mini);border:0; }
.jornada-cliente--compacta strong { font-size:var(--tam-mini); }
</style>
