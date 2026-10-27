<script setup lang="ts">
import type { MovimentoDoEscritorio } from './jornada-do-escritorio'
withDefaults(defineProps<{ movimentos: readonly MovimentoDoEscritorio[]; compacto?: boolean; pendentes?: readonly string[] }>(), { pendentes: () => [] })
const emit = defineEmits<{ cliente: [id: string] }>()
const data = (m: MovimentoDoEscritorio) => m.em ? new Date(m.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : m.id.startsWith('pendente:') ? 'Próximo passo' : 'Sem horário registrado'
</script>
<template><ol class="timeline-escritorio" :class="{ 'timeline-escritorio--compacta': compacto }" aria-label="Linha do tempo do escritório"><li v-for="movimento in movimentos" :key="movimento.id"><button type="button" @click="emit('cliente', movimento.leadId)"><span class="timeline-escritorio__marco" :aria-label="movimento.fase ? `Fase ${movimento.fase}` : 'Encaminhamento registrado'">{{ movimento.fase ?? '→' }}</span><span class="timeline-escritorio__conteudo"><span class="timeline-escritorio__meta"><time :datetime="movimento.em || undefined">{{ data(movimento) }}</time><span v-if="pendentes.includes(movimento.leadId)" class="timeline-escritorio__vez">Sua vez agora</span></span><strong>{{ movimento.empresa }}</strong><span>{{ movimento.titulo }}</span><small>{{ movimento.responsavel ? `${movimento.responsavel} · ` : '' }}{{ movimento.setor }}</small></span><span v-if="!compacto" class="timeline-escritorio__abrir" aria-hidden="true">→</span></button></li></ol></template>
<style scoped>
.timeline-escritorio { list-style: none; padding: 0; margin: 0; min-width: 0; }
.timeline-escritorio li { position: relative; padding-bottom: var(--esp-4); }
.timeline-escritorio li:not(:last-child)::before { content: ''; position: absolute; left: 17px; top: var(--esp-6); bottom: 0; border-left: var(--contorno-painel); }
.timeline-escritorio button { display: flex; align-items: start; gap: var(--esp-3); width: 100%; min-width: 0; padding: var(--esp-2) 0; border: 0; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: var(--raio-controle); }
.timeline-escritorio button:hover { background: var(--hover); }
.timeline-escritorio__marco { display: grid; place-items: center; flex: 0 0 var(--esp-8); height: var(--esp-8); border-radius: var(--raio-pilula); background: var(--superficie-2); border: var(--contorno-painel); font-size: var(--tam-apoio); position: relative; }
.timeline-escritorio__conteudo { flex: 1; min-width: 0; display: grid; gap: var(--esp-1); overflow-wrap: anywhere; }
.timeline-escritorio__conteudo > strong { font-size: var(--tam-nome); }
.timeline-escritorio__conteudo > span:not(.timeline-escritorio__meta) { font-size: var(--tam-apoio); }
.timeline-escritorio__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); font-size: var(--tam-mini); color: var(--texto-2); }
.timeline-escritorio__conteudo small { color: var(--texto-2); font-size: var(--tam-mini); }
.timeline-escritorio__vez { background: var(--destaque); color: var(--destaque-texto); padding: var(--esp-0) var(--esp-1); border-radius: var(--raio-selo); font-weight: var(--peso-forte); }
.timeline-escritorio__abrir { align-self: center; }
.timeline-escritorio--compacta li { padding-bottom: var(--esp-1); }
.timeline-escritorio--compacta .timeline-escritorio__conteudo > strong { font-size: var(--tam-apoio); }
.timeline-escritorio--compacta .timeline-escritorio__conteudo > span:not(.timeline-escritorio__meta) { font-size: var(--tam-mini); }
</style>
