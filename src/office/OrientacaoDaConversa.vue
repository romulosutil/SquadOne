<script setup lang="ts">
import { computed } from 'vue'
import PainelOperacional from '../components/PainelOperacional.vue'
import type { PlanoBi } from '../operations/bi-operacao'
import type { ProcedimentoDaDecisao } from './procedimento-da-decisao'
import { momentoDaOrientacao } from './orientacao-da-conversa'

const props = defineProps<{ plano: PlanoBi; procedimento: ProcedimentoDaDecisao }>()
const momento = computed(() => momentoDaOrientacao(props.plano.prazo))
const passos = computed(() => props.plano.tipo === 'conferir' && ['humano', 'recepcao'].includes(props.procedimento.tipo)
  ? ['Confira a última pergunta do cliente e as mensagens já enviadas na ficha.', 'Complete a informação pendente antes de preparar uma resposta.', 'Volte à orientação com o contexto atualizado para escolher como continuar.']
  : props.procedimento.passos)
</script>

<template>
  <PainelOperacional titulo="Seu próximo passo" contexto="Orientação de atendimento" :tom="plano.tipo === 'agir' ? 'acao' : 'neutro'">
    <p class="orientacao-conversa__acao">{{ plano.acao }}</p>
    <dl class="orientacao-conversa__dados">
      <div><dt>{{ plano.tipo === 'agir' ? 'Quando agir' : 'Quando revisar' }}</dt><dd>{{ momento.titulo }}</dd></div>
      <div><dt>Responsável</dt><dd>{{ plano.responsavel }}</dd></div>
    </dl>
    <p class="orientacao-conversa__horario">{{ momento.detalhe }}</p>
    <div v-if="plano.condicao" class="orientacao-conversa__condicao"><strong>Antes de continuar</strong><p>{{ plano.condicao }}</p></div>
    <div class="orientacao-conversa__conducao">
      <h4>{{ plano.tipo === 'agir' ? 'Como conduzir este passo' : 'O que conferir agora' }}</h4>
      <ol><li v-for="(item, indice) in passos" :key="indice"><span aria-hidden="true">{{ indice + 1 }}</span><p>{{ item }}</p></li></ol>
    </div>
    <div class="orientacao-conversa__resultado"><strong>O que buscamos ao terminar</strong><p>{{ plano.resultado }}</p></div>
    <slot />
    <template v-if="$slots.acoes" #acoes><slot name="acoes" /></template>
  </PainelOperacional>
</template>

<style scoped>
.orientacao-conversa__acao { margin: 0; font-size: var(--tam-secao); line-height: 1.4; font-weight: var(--peso-forte); max-width: var(--leitura-max); }
.orientacao-conversa__dados { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--esp-4); margin: 0; padding-block: var(--esp-4); border-block: var(--contorno-painel); }
.orientacao-conversa__dados > div { display: grid; gap: var(--esp-1); }
.orientacao-conversa__dados dt, .orientacao-conversa__horario { color: var(--texto-2); font-size: var(--tam-apoio); }
.orientacao-conversa__dados dd { margin: 0; font-weight: var(--peso-forte); overflow-wrap: anywhere; }
.orientacao-conversa__horario { margin: 0; line-height: 1.5; }
.orientacao-conversa__conducao h4 { font-size: var(--tam-texto); margin: 0 0 var(--esp-3); font-weight: var(--peso-forte); }
.orientacao-conversa__conducao ol { display: grid; gap: var(--esp-3); margin: 0; padding: 0; list-style: none; }
.orientacao-conversa__conducao li { display: flex; align-items: start; gap: var(--esp-3); }
.orientacao-conversa__conducao li > span { display: grid; place-items: center; flex: 0 0 var(--esp-6); height: var(--esp-6); border-radius: var(--raio-selo); background: var(--superficie-2); color: var(--texto-2); font-size: var(--tam-mini); font-weight: var(--peso-forte); }
.orientacao-conversa__conducao p, .orientacao-conversa__resultado p, .orientacao-conversa__condicao p { margin: 0; line-height: 1.6; }
.orientacao-conversa__resultado, .orientacao-conversa__condicao { display: grid; gap: var(--esp-2); padding-top: var(--esp-4); border-top: var(--contorno-painel); }
.orientacao-conversa__resultado strong, .orientacao-conversa__condicao strong { font-size: var(--tam-apoio); font-weight: var(--peso-forte); }
</style>
