<script setup lang="ts">
import { computed, ref } from 'vue'
import { AMOSTRA_MINIMA, PERIODOS, amostraPequena, resultados, resumoDaLinha, type Criterio, type LinhaDeResultado, type Periodo } from './resultados'
import type { CrmLead } from './types'

// "Resultados" (08/10/2026): quanto cada nicho, mensagem e versão do site
// rendeu, contado só sobre quem foi enviado no período. Só leitura: os números
// saem do mesmo retrato da planilha que o Hoje e o Funil usam (RULES 11).
const props = defineProps<{ leads: CrmLead[]; agora: number }>()

const periodo = ref<Periodo>('30')
const SECOES: Array<{ id: Criterio; titulo: string; explicacao: string; soSite: boolean }> = [
  { id: 'nicho', titulo: 'Por nicho', explicacao: 'Quem responde e quem fecha em cada busca.', soSite: false },
  { id: 'mensagem', titulo: 'Por mensagem', explicacao: 'A variação da primeira mensagem que o lead recebeu (desde 07/10).', soSite: true },
  { id: 'site', titulo: 'Por versão do site', explicacao: 'Padrão ou personalizado, e qual versão do modo personalizado (desde 07/10).', soSite: true },
  { id: 'horario', titulo: 'Por horário do envio', explicacao: 'Hora de São Paulo em que a primeira mensagem saiu: quem recebe responde no expediente.', soSite: false },
]

const temSite = computed(() => props.leads.some(l => l.produto === 'site'))
const secoes = computed(() => SECOES.filter(s => !s.soSite || temSite.value).map(s => ({
  ...s,
  ...resultados(s.soSite ? props.leads.filter(l => l.produto === 'site') : props.leads, s.id, periodo.value, props.agora),
})))
const total = computed(() => resultados(props.leads, 'nicho', periodo.value, props.agora).total)

const resumo = resumoDaLinha
const largura = (l: LinhaDeResultado) => `${l.enviados ? Math.round((l.responderam / l.enviados) * 100) : 0}%`
</script>

<template>
  <div class="crm-resultados">
    <div class="crm-resultados__topo">
      <div class="crm-produtos" role="group" aria-label="Período (pela data de envio)">
        <button v-for="p in PERIODOS" :key="p.id" type="button" :aria-pressed="periodo === p.id" @click="periodo = p.id">{{ p.rotulo }}</button>
      </div>
      <p class="crm-nota-pequena">
        Só quem foi <strong>enviado</strong> no período. "Viu" depende da confirmação de leitura ligada; "respondeu" é gente
        (a saudação automática não conta). Menos de {{ AMOSTRA_MINIMA }} enviados é amostra pequena.
      </p>
    </div>

    <p v-if="!total.enviados" class="crm-vazio"><strong>Nenhum envio neste período.</strong> Os números aparecem quando sair o primeiro site.</p>

    <template v-else>
      <p class="crm-resultados__total" aria-live="polite">
        <strong>{{ total.enviados }} enviado{{ total.enviados === 1 ? '' : 's' }}</strong> · {{ resumo(total) }}
      </p>

      <section v-for="secao in secoes" :key="secao.id" class="crm-grupo" :aria-labelledby="`crm-resultado-${secao.id}`">
        <header class="crm-grupo__cabeca">
          <h2 :id="`crm-resultado-${secao.id}`">{{ secao.titulo }}</h2>
        </header>
        <p class="crm-grupo__explicacao">{{ secao.explicacao }}</p>
        <ul class="crm-lista">
          <li v-for="linha in secao.linhas" :key="linha.chave" class="crm-resultado">
            <div class="crm-resultado__cabeca">
              <strong>{{ linha.chave }}</strong>
              <span>{{ linha.enviados }} enviado{{ linha.enviados === 1 ? '' : 's' }}</span>
              <span v-if="amostraPequena(linha)" class="crm-tag">amostra pequena</span>
            </div>
            <div class="crm-resultado__barra" aria-hidden="true"><span :style="{ width: largura(linha) }" /></div>
            <p class="crm-resultado__numeros">{{ resumo(linha) }}</p>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
