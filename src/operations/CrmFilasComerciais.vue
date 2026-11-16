<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CrmLead } from './types'
import { itemDaFilaComercial, type AreaComercial } from './fila-comercial'
import { indexarResponsaveisDaConversa } from './responsavel-conversa'
import PainelOperacional from '../components/PainelOperacional.vue'
import { momentoDaOrientacao } from '../office/orientacao-da-conversa'
const props = defineProps<{leads:CrmLead[];agora:number;disponivel:boolean}>()
const emit = defineEmits<{abrir:[id:string];conduzir:[id:string]}>()
const area = ref<AreaComercial>('voce'), busca=ref(''), limite=ref(12)
const areas = [{id:'voce',nome:'Precisa de você'},{id:'time',nome:'Time em execução'},{id:'cliente',nome:'Aguardando cliente'},{id:'conferencia',nome:'Conferência de contato'}] as const
const itens = computed(() => {
  const responsaveis = indexarResponsaveisDaConversa(props.leads, props.agora)
  return props.leads.filter(l => l.marcos.enviado || l.conversa || l.proximoPasso).flatMap(l => { const i=itemDaFilaComercial(l,props.leads,props.agora,responsaveis);return i?[i]:[] }).sort((a,b)=>a.prioridade-b.prioridade)
})
const lista = computed(()=>itens.value.filter(i=>i.area===area.value && i.lead.empresa.toLocaleLowerCase().includes(busca.value.toLocaleLowerCase())))
watch(busca, () => { limite.value = 12 })
</script>
<template>
  <section class="filas-comerciais" aria-label="Fila comercial por responsável">
    <header class="filas-comerciais__introducao"><h2>Conversas para avançar</h2><p>Escolha um cliente. A orientação mostra o próximo passo, quando agir e como continuar no WhatsApp.</p></header>
    <p v-if="!disponivel" class="recado" role="status">Retrato indisponível ou atrasado. Confira a fonte antes de agir.</p>
    <div class="filas-comerciais__areas" role="group" aria-label="Áreas da operação"><button v-for="a in areas" :key="a.id" type="button" :aria-pressed="area===a.id" @click="area=a.id;limite=12"><span>{{a.nome}}</span><strong>{{itens.filter(i=>i.area===a.id).length}}</strong></button></div>
    <PainelOperacional :titulo="areas.find(a => a.id === area)?.nome ?? 'Clientes'" :descricao="`${lista.length} ${lista.length === 1 ? 'cliente' : 'clientes'} · ${area === 'voce' ? 'Uma orientação por cliente, em ordem de prioridade.' : 'Responsável, condição e próxima conferência registrados.'}`">
    <details class="dobra"><summary>{{busca ? 'Busca aplicada' : 'Buscar cliente'}}</summary><label class="rotulo filas-comerciais__busca">Nome da empresa<input v-model="busca" class="campo" type="search" /></label></details>
    <p v-if="area==='time'" class="texto-2">Aparecem trabalhos com início, responsável, resultado esperado e condição registrados; uma mensagem enviada não comprova entrega ou compromisso cumprido.</p>
    <ol class="filas-comerciais__lista"><li v-for="(i, indice) in lista.slice(0,limite)" :key="i.lead.id">
      <div class="filas-comerciais__cliente"><span class="filas-comerciais__ordem">{{indice+1}}</span><div><h3>{{i.lead.empresa}}</h3><p>{{i.acao}}</p></div></div>
      <dl class="filas-comerciais__dados"><div><dt>Responsável</dt><dd>{{i.responsavel}}</dd></div><div><dt>Quando {{area === 'voce' ? 'agir' : 'conferir'}}</dt><dd>{{momentoDaOrientacao(i.prazo).titulo}}</dd></div></dl>
      <details class="dobra filas-comerciais__evidencia"><summary>Evidência e condição deste passo</summary><blockquote>{{i.evidencia}}</blockquote><p><strong>Antes de continuar:</strong> {{i.condicao}}</p><p><strong>Resultado esperado:</strong> {{i.resultado}}</p><button type="button" class="botao botao--leve" @click="emit('abrir',i.lead.id)">Abrir ficha completa</button></details>
      <button type="button" class="botao" :class="area === 'voce' && indice === 0 ? 'botao--primario' : 'botao--leve'" @click="emit('conduzir',i.lead.id)">{{area==='voce'?'Conduzir atendimento':'Ver acompanhamento'}} →</button>
    </li></ol>
    <p v-if="!lista.length" class="recado">Nenhum item nesta área pela leitura atual.</p><button v-if="lista.length>limite" class="botao botao--leve" @click="limite+=12">Mostrar mais</button>
    </PainelOperacional>
  </section>
</template>
<style scoped>
.filas-comerciais { display: grid; gap: var(--esp-5); min-width: 0; }
.filas-comerciais__introducao h2 { margin: 0; font-size: var(--tam-secao); font-weight: var(--peso-forte); }
.filas-comerciais__introducao p { margin: var(--esp-2) 0 0; color: var(--texto-2); max-width: var(--leitura-max); }
.filas-comerciais__areas { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--esp-2); }
.filas-comerciais__areas button { display: flex; align-items: center; justify-content: space-between; gap: var(--esp-2); padding: var(--esp-3); border: var(--contorno-painel); border-radius: var(--raio-controle); background: var(--superficie); color: var(--texto); font: inherit; font-size: var(--tam-apoio); min-height: var(--toque); cursor: pointer; }
.filas-comerciais__areas button[aria-pressed="true"] { background: var(--realce); box-shadow: inset 0 -3px 0 var(--destaque); }
.filas-comerciais__areas strong { font-size: var(--tam-nome); font-variant-numeric: tabular-nums; }
.filas-comerciais__lista { display: grid; gap: var(--esp-5); list-style: none; margin: 0; padding: 0; }
.filas-comerciais__lista li { display: grid; gap: var(--esp-3); padding-bottom: var(--esp-5); border-bottom: var(--contorno-painel); }
.filas-comerciais__lista li:last-child { padding-bottom: 0; border-bottom: 0; }
.filas-comerciais__lista li > .botao { justify-self: start; }
.filas-comerciais__cliente { display: flex; align-items: start; gap: var(--esp-3); }
.filas-comerciais__cliente h3 { margin: 0; font-size: var(--tam-nome); line-height: 1.3; }
.filas-comerciais__cliente p { margin: var(--esp-1) 0 0; line-height: 1.5; }
.filas-comerciais__ordem { color: var(--texto-2); font-size: var(--tam-apoio); font-variant-numeric: tabular-nums; padding-top: var(--esp-1); }
.filas-comerciais__dados { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--esp-3); margin: 0; }
.filas-comerciais__dados dt { color: var(--texto-2); font-size: var(--tam-apoio); }
.filas-comerciais__dados dd { margin: var(--esp-1) 0 0; font-weight: var(--peso-medio); font-size: var(--tam-apoio); }
.filas-comerciais__evidencia blockquote { margin: var(--esp-3) 0; padding-left: var(--esp-3); border-left: var(--faixa) solid var(--borda); color: var(--texto-2); }
.filas-comerciais__busca { padding-block: var(--esp-3); }
@media(max-width:47.99rem) { .filas-comerciais__areas { grid-template-columns: repeat(2, minmax(0,1fr)); } .filas-comerciais__areas button { font-size: var(--tam-mini); } .filas-comerciais__lista li > .botao { width: 100%; } }
</style>
