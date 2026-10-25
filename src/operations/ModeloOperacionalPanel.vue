<script setup lang="ts">
import {computed,nextTick,ref,shallowRef} from 'vue'
import {useAtualizacaoViva} from '../casca/atualizacao-viva'
import type {CrmVisao} from './types'
import {SECOES_MODELO,documentosModelo,itensModelo,regrasModelo,camposModelo,textosModelo,estadoFrenteModelo,estadoDefinicaoModelo,destaquesModelo,referenciasModelo,type SecaoModelo} from './modelo-operacional'
const documentos=documentosModelo(import.meta.glob('./modelo-operacional/*.json',{eager:true,import:'default'}))
const modulosIndicadores=import.meta.glob('./modelo-operacional/indicadores.ts',{eager:true})
type Indicador={id:string;rotulo:string;valor:number|null;unidade:string;detalhe:string}
const calcular=(Object.values(modulosIndicadores)[0] as {calcularIndicadoresOperacionais?:(v:CrmVisao|null,a?:number)=>Indicador[]}|undefined)?.calcularIndicadoresOperacionais
const visao=shallowRef<CrmVisao|null>(null),frente=shallowRef<unknown>(null),erro=ref(''),agora=ref(Date.now())
const abertas=ref(new Set<SecaoModelo>(['rotina']))
async function ler(signal:AbortSignal){
 const resultados=await Promise.allSettled(['/api/operations/crm','/api/operations/crm/frente'].map(async url=>{const r=await fetch(url,{cache:'no-store',signal});if(!r.ok)throw new Error('Fonte indisponível');return r.json()}))
 if(signal.aborted)return false
 visao.value=resultados[0].status==='fulfilled'?resultados[0].value:null
 frente.value=resultados[1].status==='fulfilled'?resultados[1].value:null
 agora.value=Date.now();erro.value=resultados.some(r=>r.status==='rejected')?'Uma fonte não respondeu. Os dados sem confirmação aparecem como não verificados.':''
 return !erro.value
}
const {atualizando,sincronizar,conferidoEm}=useAtualizacaoViva(ler)
const indicadores=computed(()=>calcular?.(visao.value,agora.value)??[])
const estadoFrente=computed(()=>estadoFrenteModelo(frente.value))
const confirmacaoCapacidade=computed(()=>textosModelo(documentos.capacidade?.confirmacaoOperador))
const dados=(id:SecaoModelo)=>itensModelo(id,documentos)
const regras=(id:SecaoModelo)=>regrasModelo(id,documentos)
const destaques=(id:SecaoModelo)=>destaquesModelo(id,documentos)
const tituloItem=(item:Record<string,unknown>)=>String(item.nome??item.titulo??item.familia??item.id??'Procedimento')
async function abrir(id:SecaoModelo){abertas.value=new Set(abertas.value).add(id);await nextTick();document.getElementById(`operacao-${id}`)?.scrollIntoView({block:'start'})}
function alternar(id:SecaoModelo,e:Event){const nova=new Set(abertas.value);if((e.target as HTMLDetailsElement).open)nova.add(id);else nova.delete(id);abertas.value=nova}
</script>

<template>
 <section id="modelo-operacional" class="modelo-operacional" aria-labelledby="modelo-operacional-titulo" tabindex="-1">
  <header class="modelo-operacional__topo"><div><span class="sobretitulo">Prumo e SquadOne</span><h2 id="modelo-operacional-titulo">Como vender e operar</h2><p>O que vender, quem assume cada etapa, como conduzir o dia e o que precisa de evidência para avançar.</p></div><a class="botao" href="/crm">Abrir Vendas</a></header>
  <p class="recado"><strong>Objetivo inicial:</strong> primeira venda nova com recebimento confirmado; depois, R$ 10 mil de faturamento mensal. Receita existente não comprova a primeira venda nova.</p>
  <div class="modelo-operacional__estado" role="status"><strong>{{ estadoFrente }}</strong><span>Consulta operacional. Abrir este painel não envia mensagens, registra fatos ou libera automação.</span><button class="botao" type="button" :disabled="atualizando" @click="sincronizar">{{ atualizando?'Conferindo…':'Conferir fontes' }}</button><small v-if="conferidoEm">Fontes conferidas às {{ new Date(conferidoEm).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) }}</small></div>
  <p v-if="erro" class="recado recado--atencao">{{ erro }}</p>
  <nav class="modelo-operacional__nav" aria-label="Modelo operacional"><a v-for="s in SECOES_MODELO" :key="s.id" :href="`#operacao-${s.id}`" @click.prevent="abrir(s.id)">{{ s.nome }}</a></nav>
  <ol class="modelo-operacional__resumo"><li v-for="s in SECOES_MODELO.filter(s=>s.id!=='areas')" :key="s.id"><strong>{{ s.nome }}</strong><span>{{ s.resumo }}</span></li></ol>
  <section v-if="indicadores.length" class="modelo-operacional__indicadores" aria-labelledby="operacao-leitura-titulo"><h3 id="operacao-leitura-titulo">Leitura atual da operação</h3><dl><div v-for="i in indicadores" :key="i.id"><dt>{{ i.rotulo }}</dt><dd>{{ i.valor===null?'Não verificado':i.valor.toLocaleString('pt-BR') }}<small v-if="i.valor!==null"> {{ i.unidade }}</small></dd><p>{{ i.detalhe }}</p></div></dl></section>
  <details v-for="s in SECOES_MODELO" :id="`operacao-${s.id}`" :key="s.id" class="modelo-operacional__secao" :open="abertas.has(s.id)" @toggle="alternar(s.id,$event)">
   <summary><strong>{{ s.nome }}</strong><small>{{ s.resumo }}</small><span class="modelo-operacional__instrucao">{{ abertas.has(s.id)?'Recolher seção':'Expandir seção' }}</span></summary>
   <div class="modelo-operacional__conteudo">
    <div v-if="s.id==='capacidade'&&confirmacaoCapacidade.length" class="recado"><strong>Disponibilidade confirmada pelo operador</strong><p v-for="(t,n) in confirmacaoCapacidade" :key="n">{{ t }}</p></div>
    <div v-for="(d,n) in destaques(s.id)" :key="`destaque-${n}`" class="recado"><strong>{{ d.rotulo }}</strong><ul><li v-for="(t,k) in d.textos" :key="k">{{ t }}</li></ul></div>
    <details v-if="regras(s.id).length" class="modelo-operacional__item"><summary>Regras gerais</summary><ul><li v-for="(r,n) in regras(s.id)" :key="n">{{ r }}</li></ul></details>
    <details v-for="(item,n) in dados(s.id)" :key="String(item.id??n)" class="modelo-operacional__item"><summary>{{ tituloItem(item) }}<span v-if="item.estado" class="etiqueta">{{ estadoDefinicaoModelo(item.estado) }}</span></summary><dl><div v-for="(c,j) in camposModelo(item)" :key="j"><dt>{{ c.rotulo }}</dt><dd><ul v-if="c.textos.length>1"><li v-for="(t,k) in c.textos" :key="k">{{ t }}</li></ul><template v-else>{{ c.textos[0] }}</template></dd></div></dl><details v-if="referenciasModelo(item).length" class="modelo-operacional__referencias"><summary>Referências desta definição</summary><ul><li v-for="(r,k) in referenciasModelo(item)" :key="k">{{ r }}</li></ul></details></details>
    <details v-if="referenciasModelo(documentos[s.id]).length" class="modelo-operacional__item"><summary>Fontes e versões da seção</summary><ul><li v-for="(r,n) in referenciasModelo(documentos[s.id])" :key="n">{{ r }}</li></ul></details>
    <p v-if="!dados(s.id).length" class="texto-2">Definição desta frente ainda não disponível nesta versão. Não presumir liberação.</p>
   </div>
  </details>
  <p class="modelo-operacional__limite">Prumo define a promessa; a Central organiza os fatos; os agentes preparam e encaminham; Rômulo conduz negociação e confirma decisões. A fonte comercial continua sendo Vendas.</p>
 </section>
</template>

<style scoped>
.modelo-operacional{display:grid;gap:var(--esp-4);min-width:0;overflow-wrap:anywhere}
.modelo-operacional__topo{display:flex;align-items:flex-start;justify-content:space-between;gap:var(--esp-3);flex-wrap:wrap}.modelo-operacional__topo h2{margin:var(--esp-1) 0}.modelo-operacional__topo p{color:var(--texto-2);max-width:68ch}
.modelo-operacional__estado{display:flex;gap:var(--esp-2);align-items:center;flex-wrap:wrap;padding:var(--esp-3);border:1px solid var(--borda);border-radius:var(--raio-controle);background:var(--superficie-2)}.modelo-operacional__estado span{flex:1 1 22rem}.modelo-operacional__estado small{color:var(--texto-2)}
.modelo-operacional__nav{display:flex;gap:var(--esp-2);flex-wrap:wrap}.modelo-operacional__nav a{padding:var(--esp-2);color:var(--texto);text-decoration:underline;min-height:var(--toque)}
.modelo-operacional__resumo{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:var(--esp-3);padding-left:var(--esp-6)}.modelo-operacional__resumo li{padding-right:var(--esp-2)}.modelo-operacional__resumo strong,.modelo-operacional__resumo span{display:block}.modelo-operacional__resumo span{color:var(--texto-2);margin-top:var(--esp-1)}
.modelo-operacional__indicadores h3{margin:0 0 var(--esp-3)}.modelo-operacional__indicadores>dl{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12rem),1fr));gap:var(--esp-3)}.modelo-operacional__indicadores>dl>div{padding:var(--esp-3);border:1px solid var(--borda);border-radius:var(--raio-controle);min-width:0}.modelo-operacional__indicadores dt{color:var(--texto-2)}.modelo-operacional__indicadores dd{margin:var(--esp-1) 0;font-size:var(--tam-secao);font-weight:var(--peso-forte)}.modelo-operacional__indicadores dd small{font-size:var(--tam-mini);font-weight:var(--peso-texto)}.modelo-operacional__indicadores p{font-size:var(--tam-apoio);color:var(--texto-2);margin:0}
.modelo-operacional__secao{border-top:1px solid var(--borda);padding-top:var(--esp-3);scroll-margin-top:var(--esp-3)}.modelo-operacional__secao>summary{cursor:pointer;min-height:var(--toque)}.modelo-operacional__secao>summary strong,.modelo-operacional__secao>summary small{display:block}.modelo-operacional__secao>summary small{color:var(--texto-2);margin:var(--esp-1) 0}.modelo-operacional__conteudo{display:grid;gap:var(--esp-2);padding-top:var(--esp-2)}
.modelo-operacional__item{border:1px solid var(--borda);padding:var(--esp-3);border-radius:var(--raio-controle);min-width:0}.modelo-operacional__item summary{cursor:pointer;min-height:var(--toque);font-weight:var(--peso-forte)}.modelo-operacional__item summary .etiqueta{margin-left:var(--esp-2)}.modelo-operacional__item dl>div{margin:var(--esp-3) 0}.modelo-operacional__item dt{font-weight:var(--peso-forte)}.modelo-operacional__item dd{margin:var(--esp-1) 0;color:var(--texto-2)}.modelo-operacional__item ul{padding-left:var(--esp-5);margin:var(--esp-1) 0}.modelo-operacional__item li+li{margin-top:var(--esp-1)}
.modelo-operacional__instrucao{font-size:var(--tam-mini);color:var(--texto-2)}.modelo-operacional__referencias{border-top:1px solid var(--borda);padding-top:var(--esp-2)}
.modelo-operacional__limite{font-size:var(--tam-apoio);color:var(--texto-2);border-top:1px solid var(--borda);padding-top:var(--esp-3)}
</style>
