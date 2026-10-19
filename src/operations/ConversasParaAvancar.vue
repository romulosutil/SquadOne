<script setup lang="ts">
import { computed } from 'vue'
import type { CrmVisao } from './types'
import { conversasParaConduzir } from './conversas-para-conduzir'
import { nomeCurto } from './historico-comercial'
const props = withDefaults(defineProps<{ visao: CrmVisao | null; erro?: string; agora?: number; maximo?: number }>(), { erro: '', maximo: 3 })
const emit = defineEmits<{ abrir: [id: string] }>()
const fila = computed(() => conversasParaConduzir(props.visao?.leads ?? [], props.agora ?? Date.now()))
function contexto(e: MouseEvent,id: string) { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; if (props.maximo > 3) { e.preventDefault(); emit('abrir', id) } }
</script>
<template>
  <section class="painel-venda conversas-avancar" aria-labelledby="conversas-titulo">
    <header class="cabecalho-bloco"><div><span class="sobretitulo">O que precisa de você</span><h2 id="conversas-titulo">Conversas para avançar</h2></div><span v-if="visao?.estado === 'ok'" class="etiqueta">{{ fila.length }} {{ fila.length === 1 ? 'conversa' : 'conversas' }}</span></header>
    <p class="texto-2">Respostas humanas e combinados reais primeiro. O time acompanha os envios pelas integrações.</p>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }} O app tenta novamente sozinho e mantém a última leitura.</p>
    <p v-if="!visao || visao.estado !== 'ok'" class="recado" role="status">{{ visao?.mensagem || erro || 'Lendo as conversas…' }}</p>
    <ol v-else class="lista-prioridades">
      <li v-for="(item, i) in fila.slice(0, maximo)" :key="item.lead.id">
        <span class="etiqueta" :data-tom="i === 0 ? 'atencao' : 'neutro'">{{ item.rotulo }}</span><h3>{{ nomeCurto(item.lead.empresa) }}</h3>
        <p v-if="item.lead.conversa" class="conversas-avancar__ultima"><span class="sobretitulo">{{ item.lead.conversa.ultima.direcao === 'entrada' ? 'Última mensagem recebida' : 'Última mensagem enviada' }}</span>“{{ item.lead.conversa.ultima.trecho }}”</p>
        <p v-if="item.lead.proximoPasso" class="texto-2"><strong>Combinado:</strong> {{ item.lead.proximoPasso.texto }}</p>
        <div class="conversas-avancar__acoes"><a v-if="item.lead.links.whatsapp" :class="['botao', i === 0 ? 'botao--primario' : 'botao--leve']" :href="item.lead.links.whatsapp" target="_blank" rel="noopener">{{ item.resposta ? 'Responder no WhatsApp' : 'Ver conversa no WhatsApp' }} ↗</a><a class="link-discreto" :href="`/crm?lead=${encodeURIComponent(item.lead.id)}`" @click="contexto($event, item.lead.id)">Ver contexto →</a></div>
      </li>
    </ol>
    <p v-if="visao?.estado === 'ok' && !fila.length" class="recado">Nenhuma conversa pede ação agora. O time segue acompanhando as integrações e os primeiros contatos.</p>
    <a v-if="maximo <= 3" class="link-discreto" href="/crm">Ver todas as vendas →</a>
    <p v-else class="texto-2 texto-pequeno">O cadastro completo, inclusive contatos sem histórico integrado, está no Funil.</p>
  </section>
</template>
<style scoped>
.conversas-avancar { display: grid; gap: var(--esp-4); }
.conversas-avancar .lista-prioridades > li { display: grid; gap: var(--esp-3); }
.conversas-avancar h3 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); line-height: 1.4; }
.conversas-avancar__ultima { padding: var(--esp-3); border-radius: var(--raio-controle); background: var(--superficie-2); overflow-wrap: anywhere; }
.conversas-avancar__ultima .sobretitulo { margin-bottom: var(--esp-2); }
.conversas-avancar__acoes { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2) var(--esp-4); }
</style>
