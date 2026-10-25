<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import PainelOperacional from '../components/PainelOperacional.vue'
import type { CrmLead } from './types'
import { planoDoLead, type PlanoBi } from './bi-operacao'
import { ROTULO_DO_PRODUTO } from './crm-formato'
const props = defineProps<{ leads: CrmLead[]; agora: number; disponivel: boolean }>()
const emit = defineEmits<{ abrir: [id: string] }>()
const filtro = ref<PlanoBi['tipo']>(props.leads.some(l => planoDoLead(l,props.agora).tipo === 'agir') ? 'agir' : 'conferir'), busca = ref(''), limite = ref(8)
const planos = computed(() => props.leads.filter(l => l.marcos.enviado || l.proximoPasso || l.conversa).map(l => planoDoLead(l,props.agora)).sort((a,b) => a.prioridade-b.prioridade || a.lead.empresa.localeCompare(b.lead.empresa)))
const estados = [{ id: 'agir', nome: 'Agir agora' }, { id: 'conferir', nome: 'Resolver contexto' }, { id: 'aguardar', nome: 'Aguardar' }] as const
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const filtradas = computed(() => planos.value.filter(p => p.tipo === filtro.value && norm(p.lead.empresa).includes(norm(busca.value))))
watch([filtro,busca], () => { limite.value = 8 })
</script>
<template>
  <section class="fila-bi" aria-label="Ações orientadas por evidência">
    <header class="cabecalho-bloco"><div><span class="sobretitulo">Decisão → execução → resultado</span><h2>O que fazer agora</h2></div><a class="link-discreto" href="/crm?ver=bi">Abrir BI da operação →</a></header>
    <p class="texto-2">Cada cliente tem uma ação, um motivo e um resultado esperado. Revisões internas e esperas têm filas próprias.</p>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">Última leitura disponível. Confira a atualização da fonte antes de agir.</p>
    <div class="fila-bi__filtros" role="group" aria-label="Tipo de próximo passo"><button v-for="e in estados" :key="e.id" type="button" class="botao botao--leve" :aria-pressed="filtro === e.id" @click="filtro = e.id">{{ e.nome }} · {{ planos.filter(p => p.tipo === e.id).length }}</button></div>
    <PainelOperacional :titulo="estados.find(e => e.id === filtro)?.nome ?? 'Clientes'" :descricao="`${filtradas.length} clientes · uma orientação por cliente, em ordem de prioridade.`">
    <details class="dobra"><summary>Buscar cliente</summary><label class="rotulo">Nome da empresa<input v-model="busca" class="campo" type="search" placeholder="Nome da empresa" /></label></details>
    <ol class="fila-bi__lista">
      <li v-for="(p,i) in filtradas.slice(0,limite)" :key="p.lead.id">
        <div class="fila-bi__cabeca"><span class="sobretitulo">{{ i+1 }} · {{ ROTULO_DO_PRODUTO[p.lead.produto] }}</span><span class="etiqueta">{{ p.prazo }}</span></div>
        <h3>{{ p.lead.empresa }}</h3><p class="fila-bi__acao">{{ p.acao }}</p>
        <blockquote><strong>Evidência</strong> · {{ p.evidencia }}</blockquote>
        <p v-if="p.condicao" class="texto-2"><strong>Antes de agir:</strong> {{ p.condicao }}</p>
        <p class="texto-2"><strong>Resultado esperado:</strong> {{ p.resultado }}</p>
        <div class="fila-bi__cabeca"><span class="texto-2 texto-pequeno">Responsável · {{ p.responsavel }}</span><button class="botao" :class="filtro === 'agir' && i === 0 ? 'botao--primario' : 'botao--leve'" type="button" @click="emit('abrir',p.lead.id)">{{ filtro === 'agir' ? 'Conduzir atendimento' : filtro === 'conferir' ? 'Conferir orientação' : 'Consultar acompanhamento' }} →</button></div>
      </li>
    </ol>
    <p v-if="!filtradas.length" class="recado">{{ filtro === 'agir' ? 'Nenhuma ação comercial sustentada pela leitura atual. Veja os contextos a resolver e os acompanhamentos.' : 'Nenhum cliente neste recorte.' }}</p>
    <button v-if="filtradas.length > limite" class="botao botao--leve" type="button" @click="limite += 8">Ver mais {{ Math.min(8,filtradas.length-limite) }} clientes</button>
    </PainelOperacional>
  </section>
</template>
<style scoped>
.fila-bi { display:grid; gap:var(--esp-4); min-width:0; }
.fila-bi__filtros,.fila-bi__cabeca { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--esp-2); }
.fila-bi__filtros { justify-content:flex-start; }
.fila-bi [aria-pressed="true"] { background:var(--realce); color:var(--texto); box-shadow:inset 0 -3px 0 var(--destaque); }
.fila-bi__lista { list-style:none; padding:0; margin:0; display:grid; gap:var(--esp-3); }
.fila-bi__lista li { border:var(--contorno-painel); border-radius:var(--raio-controle); padding:var(--esp-4); display:grid; gap:var(--esp-3); min-width:0; }
.fila-bi h3,.fila-bi p { margin:0; overflow-wrap:anywhere; }
.fila-bi__acao { font-weight:var(--peso-forte); }
.fila-bi blockquote { margin:0; padding:var(--esp-3); background:var(--superficie-2); border-left:var(--faixa) solid var(--borda); font-size:var(--tam-apoio); overflow-wrap:anywhere; }
.fila-bi .botao { white-space:normal; text-align:left; }
</style>
