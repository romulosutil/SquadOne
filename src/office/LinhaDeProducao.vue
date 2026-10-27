<script setup lang="ts">
import { computed } from 'vue'
import type { EstacaoDaProducao } from './linha-de-producao'
import type { FaseDoEscritorio, MovimentoDoEscritorio } from './jornada-do-escritorio'
import type { ResumoAtendimentoEstamparia } from './modelo'
const props = defineProps<{ estacoes: readonly EstacaoDaProducao[]; selecionada: FaseDoEscritorio | null; disponivel: boolean; erro: string; ultimo?: MovimentoDoEscritorio; entrega?: string; leadEmPassagem?: string; agrupadas?: number; animar: boolean; atendimentoEstamparia?: ResumoAtendimentoEstamparia | null }>()
const emit = defineEmits<{ selecionar:[fase:FaseDoEscritorio]; cliente:[id:string]; etapa:[fase:FaseDoEscritorio]; historico:[]; movimento:[]; acompanhamentos:[] }>()
const atual = computed(() => props.estacoes.find(e => e.id === props.selecionada))
const ficha = computed(() => atual.value?.fichas.find(f=>f.id === props.leadEmPassagem) ?? atual.value?.fichas[0])
const curtos = ['Preparar','Contato','Conversa','Material','Proposta','Resultado']
</script>
<template>
  <section class="linha-producao" aria-labelledby="linha-producao-titulo">
    <header class="linha-producao__cabeca"><h2 id="linha-producao-titulo">Linha de produção</h2><div class="linha-producao__controles"><button type="button" :aria-pressed="animar" :aria-label="animar ? 'Pausar animação das passagens registradas' : 'Animar passagens registradas'" @click="emit('movimento')">{{ animar ? 'Pausar animação' : 'Animar' }}</button><button type="button" @click="emit('historico')">Jornada →</button></div></header>
    <p v-if="erro" class="linha-producao__aviso" role="status">{{ erro }}</p>
    <p v-if="atendimentoEstamparia" class="linha-producao__atendimento" :data-ativo="atendimentoEstamparia.modo === 'respostas' || undefined" role="status" :title="atendimentoEstamparia.desde ? `Atendimento ativo desde ${new Date(atendimentoEstamparia.desde).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'})}${atendimentoEstamparia.retomada ? `. Inclui ${atendimentoEstamparia.retomada.entradas} conversas anteriores.` : ''}` : undefined">{{ atendimentoEstamparia.modo === 'respostas' ? atendimentoEstamparia.retomada ? 'Estamparia · Carla acompanha conversas novas e anteriores' : 'Estamparia · Carla atende novas respostas' : atendimentoEstamparia.modo === 'pausado' ? 'Estamparia · atendimento com Rômulo' : atendimentoEstamparia.modo === 'aguarda-ativacao' ? 'Estamparia · aguardando ativação' : 'Estamparia · sem leitura recente do atendimento' }}<span v-if="atendimentoEstamparia.incertas"> · {{ atendimentoEstamparia.incertas }} envio(s) em conferência</span></p>
    <p v-if="!erro && entrega" class="linha-producao__registro" role="status">{{ entrega }}</p>
    <button v-if="atendimentoEstamparia?.retomada" class="linha-producao__acompanhamentos" type="button" @click="emit('acompanhamentos')">Ver atendimentos de Estamparia →</button>
    <button v-if="disponivel && agrupadas" class="linha-producao__agrupadas" type="button" @click="emit('historico')">{{ agrupadas }} outros movimentos registrados · Ver jornada →</button>
    <ol class="linha-producao__trilho" aria-label="Fases atuais dos clientes">
      <li v-for="e in estacoes" :key="e.id" :data-estacao="e.id" :data-selecionada="selecionada === e.id || undefined"><button class="linha-producao__estacao" type="button" :aria-label="`${e.id}. ${e.nome}: ${disponivel ? e.fichas.length : 'conferindo'} clientes`" :aria-pressed="selecionada === e.id" @click="emit('selecionar',e.id)"><span>{{ e.id }}</span><strong>{{ curtos[e.id-1] }}</strong><b>{{ disponivel ? e.fichas.length : '…' }}</b></button></li>
    </ol>
    <div v-if="atual" class="linha-producao__proximo">
      <template v-if="ficha && disponivel"><div class="linha-producao__tarefa"><span class="linha-producao__dono" :data-situacao="ficha.situacao">{{ ficha.rotulo }} · {{ ficha.responsavel }}</span><strong class="linha-producao__empresa">{{ ficha.empresa }}</strong><p><b>Próximo passo:</b> {{ ficha.acao }}</p><details v-if="ficha.condicao && ficha.condicao !== ficha.acao"><summary>Condição para avançar</summary><p>{{ ficha.condicao }}</p></details></div><div class="linha-producao__acoes"><button type="button" @click="emit('cliente',ficha.id)">Ver atendimento →</button><button v-if="atual.fichas.length > 1" type="button" @click="emit('etapa',atual.id)">Ver os {{ atual.fichas.length }} clientes</button></div></template>
      <p v-else>{{ disponivel ? `Nenhum cliente em ${atual.nome.toLocaleLowerCase('pt-BR')}.` : 'Aguardando uma leitura confirmada da operação.' }}</p>
    </div>
  </section>
</template>
<style scoped>
.linha-producao { display:grid;gap:var(--esp-2);min-width:0;padding:var(--esp-2) var(--esp-4);border-top:2px solid #826747;background:#233331;color:#e9efdf; }
.linha-producao__cabeca { display:flex;justify-content:space-between;gap:var(--esp-2);align-items:center; }
.linha-producao__cabeca h2 { margin:0;font-size:var(--tam-apoio);font-weight:var(--peso-forte); }
.linha-producao__controles { display:flex;gap:var(--esp-2); }
.linha-producao button { min-height:var(--toque);font:inherit;cursor:pointer; }
.linha-producao__cabeca button { border:0;background:transparent;color:#f0d596;font-size:var(--tam-mini); }
.linha-producao__aviso,.linha-producao__registro { margin:0;font-size:var(--tam-mini);color:#ffe3a0;overflow-wrap:anywhere; }
.linha-producao__atendimento { margin:0;font-size:var(--tam-mini);color:#ffe3a0;overflow-wrap:anywhere; }
.linha-producao__atendimento[data-ativo] { color:#bce5c7; }
.linha-producao__acompanhamentos { justify-self:start;border:1px solid #799b88;border-radius:var(--raio-selo);background:#304d43;color:#fff3cf;padding:var(--esp-1) var(--esp-2);font-size:var(--tam-mini) !important; }
.linha-producao__agrupadas { border:0;background:transparent;color:#ffe3a0;text-align:left;font-size:var(--tam-mini) !important; }
.linha-producao__trilho { display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:var(--esp-1);list-style:none;margin:0;padding:0; }
.linha-producao__trilho > li { min-width:0; }
.linha-producao__estacao { width:100%;display:flex;gap:var(--esp-1);align-items:center;text-align:left;border:1px solid #56776d;border-radius:var(--raio-selo);padding:var(--esp-1) var(--esp-2);background:#1b2c2a;color:#e9efdf; }
.linha-producao__estacao > span { color:#bdcfc1;font-size:var(--tam-mini); }
.linha-producao__estacao > strong { font-size:var(--tam-mini);flex:1; }
.linha-producao__estacao > b { color:#f2db9e;font-size:var(--tam-mini); }
.linha-producao__trilho > li[data-selecionada] button { background:#f3d58b;color:#25392f;border-color:#ffedba; }
.linha-producao__trilho > li[data-selecionada] span,.linha-producao__trilho > li[data-selecionada] b { color:inherit; }
.linha-producao__proximo { display:flex;align-items:center;justify-content:space-between;gap:var(--esp-3);padding-top:var(--esp-2);border-top:1px solid #56776d;min-width:0; }
.linha-producao__tarefa { min-width:0;display:grid;gap:var(--esp-1); }
.linha-producao__dono { font-size:var(--tam-mini);color:#c6dbce; }
.linha-producao__dono[data-situacao="sua-vez"],.linha-producao__dono[data-situacao="conferencia"] { color:#ffe3a0; }
.linha-producao__empresa { font-size:var(--tam-apoio);overflow-wrap:anywhere; }
.linha-producao__proximo p { margin:0;font-size:var(--tam-apoio);overflow-wrap:anywhere; }
.linha-producao__proximo details { font-size:var(--tam-mini); }
.linha-producao__proximo summary { min-height:var(--toque);align-content:center;cursor:pointer;color:#c6dbce; }
.linha-producao__acoes { display:flex;gap:var(--esp-2);flex-shrink:0; }
.linha-producao__acoes button { border:1px solid #799b88;border-radius:var(--raio-selo);background:#304d43;color:#fff3cf;padding:var(--esp-2);font-size:var(--tam-mini); }
.linha-producao button:focus-visible { outline:3px solid #fff3c7;outline-offset:2px; }
@media(max-width:47.99rem) {
  .linha-producao { padding:var(--esp-1) var(--esp-2); }
  .linha-producao__trilho { grid-template-columns:repeat(3,minmax(0,1fr)); }
  .linha-producao__estacao { display:grid;grid-template-columns:1fr auto;gap:0 var(--esp-1);line-height:1.2; }
  .linha-producao__estacao > strong { grid-column:1 / -1;grid-row:2; }
  .linha-producao__estacao > b { grid-column:2;grid-row:1; }
  .linha-producao__proximo { align-items:stretch;display:grid;gap:var(--esp-2); }
  .linha-producao__acoes { flex-wrap:wrap; }
  .linha-producao__acoes button { flex:1; }
}
</style>
