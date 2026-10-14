<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  DIAS_ATE_A_LEITURA, DIFERENCA_MINIMA_PP, ENVIOS_POR_BRACO, FRASE_DO_VEREDITO, REGRA_DE_PARADA, leituraDoAbVideo, textoDaDiferenca, textoDoP,
} from './ab-video'
import { dataCurta, dataHora } from './crm-formato'
import {
  AMOSTRA_MINIMA, INICIO_DAS_ANOTACOES, PERIODOS, amostraPequena, enviosAnotados, porcento, resultados, resumoDaLinha, textoDaSegunda, textoDoFollowup,
  type Criterio, type LinhaDeResultado, type Periodo,
} from './resultados'
import type { CrmLead } from './types'

// "Resultados" (08/10/2026): quanto cada nicho, mensagem e versão do site
// rendeu, contado só sobre quem foi enviado no período. Só leitura: os números
// saem do mesmo retrato da planilha que o Hoje e o Funil usam (RULES 11).
const props = defineProps<{ leads: CrmLead[]; agora: number }>()

const periodo = ref<Periodo>('30')
const SECOES: Array<{ id: Criterio; titulo: string; explicacao: string; soSite: boolean }> = [
  { id: 'nicho', titulo: 'Por nicho', explicacao: 'Quem responde e quem fecha em cada busca.', soSite: false },
  { id: 'mensagem', titulo: 'Por mensagem', explicacao: 'A variação da primeira mensagem que o lead recebeu (letra desde 07/10). Sem a letra, o regime pela data: com o link na 1ª mensagem até 04/10, pedido de licença sem link desde 05/10.', soSite: true },
  { id: 'site', titulo: 'Por versão do site', explicacao: 'Padrão ou personalizado, e qual versão do modo personalizado (desde 07/10).', soSite: true },
  { id: 'horario', titulo: 'Por horário do envio', explicacao: 'Hora de São Paulo em que a primeira mensagem saiu: quem recebe responde no expediente.', soSite: false },
]

const temSite = computed(() => props.leads.some(l => l.produto === 'site'))
const secoes = computed(() => SECOES.filter(s => !s.soSite || temSite.value).map(s => ({
  ...s,
  ...resultados(s.soSite ? props.leads.filter(l => l.produto === 'site') : props.leads, s.id, periodo.value, props.agora),
})))
const total = computed(() => resultados(props.leads, 'nicho', periodo.value, props.agora).total)
// Follow-up e 2ª mensagem anotados ao tocar no link (14/10/2026): o "follow-up funciona?" com número.
const anotados = computed(() => enviosAnotados(props.leads, periodo.value, props.agora))

// A/B do vídeo (11/10/2026, ab-video.ts): só existe com a coluna `braco_video` preenchida.
// Ignora o período: o teste é contado inteiro, uma vez, depois dos 7 dias.
const ab = computed(() => leituraDoAbVideo(props.leads, props.agora))
const bracos = computed(() => (ab.value ? [ab.value.comVideo, ab.value.semVideo] : []))

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

    <section v-if="ab" class="crm-grupo" aria-labelledby="crm-resultado-video">
      <header class="crm-grupo__cabeca">
        <h2 id="crm-resultado-video">Por vídeo no envio (teste A/B)</h2>
      </header>
      <p class="crm-grupo__explicacao">
        {{ ab.nicho }}{{ ab.mensagem ? ` · mensagem ${ab.mensagem}` : '' }}{{ ab.inicio ? ` · desde ${dataCurta(ab.inicio)}` : ' · nenhum envio ainda' }}.
        O braço sai do sorteio pelo place_id; o vídeo vai à mão logo depois da mensagem. Conta o teste inteiro, sem o período acima.
      </p>
      <ul class="crm-lista">
        <li v-for="linha in bracos" :key="linha.chave" class="crm-resultado">
          <div class="crm-resultado__cabeca">
            <strong>{{ linha.chave }}</strong>
            <span>{{ linha.enviados }} de {{ ENVIOS_POR_BRACO }} enviado{{ linha.enviados === 1 ? '' : 's' }}</span>
          </div>
          <p v-if="ab.numeros" class="crm-resultado__numeros">{{ resumo(linha) }}</p>
        </li>
      </ul>

      <p v-if="ab.estado === 'amostra-insuficiente'" class="crm-aviso" role="status">
        <strong>Amostra insuficiente.</strong> Faltam envios para {{ ENVIOS_POR_BRACO }} em cada braço. As taxas só aparecem
        na leitura, {{ DIAS_ATE_A_LEITURA }} dias depois do último envio: olhar antes e parar quando "parece bom" inventa vencedor.
      </p>
      <p v-else-if="ab.estado === 'aguardando-leitura'" class="crm-aviso" role="status">
        <strong>Amostra completa. Leitura em {{ dataHora(ab.leituraEm ?? '') }}</strong> ({{ DIAS_ATE_A_LEITURA }} dias depois do último envio).
        Até lá, sem taxas.
      </p>
      <div v-else-if="ab.numeros" class="crm-resultados__total" role="status">
        <p class="crm-resultado__numeros">
          Respondeu de gente: com vídeo <strong>{{ porcento(ab.comVideo.responderam, ab.comVideo.enviados) }}</strong>
          ({{ ab.comVideo.responderam }} de {{ ab.comVideo.enviados }}), sem vídeo
          <strong>{{ porcento(ab.semVideo.responderam, ab.semVideo.enviados) }}</strong>
          ({{ ab.semVideo.responderam }} de {{ ab.semVideo.enviados }}) · {{ textoDaDiferenca(ab.numeros.diferencaPp) }} · {{ textoDoP(ab.numeros.p) }}
        </p>
        <p class="crm-resultado__numeros"><strong>Veredito: {{ FRASE_DO_VEREDITO[ab.numeros.veredito] }}.</strong></p>
      </div>

      <p v-if="ab.foraDoSorteio" class="crm-aviso is-forte" role="note">
        <strong>{{ ab.foraDoSorteio }} lead{{ ab.foraDoSorteio === 1 ? '' : 's' }} com a coluna braco_video diferente do sorteio.</strong>
        Confira na planilha antes de ler: braço trocado à mão desfaz o sorteio.
      </p>
      <p v-if="ab.foraDoDesenho" class="crm-nota-pequena">
        {{ ab.foraDoDesenho }} marcado{{ ab.foraDoDesenho === 1 ? '' : 's' }} fora do nicho ou da mensagem do teste: não entra{{ ab.foraDoDesenho === 1 ? '' : 'm' }} na conta.
      </p>
      <p class="crm-nota-pequena">
        Regra fixada antes do teste: vídeo ganha só com +{{ DIFERENCA_MINIMA_PP }} pontos e p &lt; 0,10 (Fisher exato bilateral);
        senão, não provado. {{ REGRA_DE_PARADA }}
      </p>
    </section>

    <p v-if="!total.enviados" class="crm-vazio"><strong>Nenhum envio neste período.</strong> Os números aparecem quando sair o primeiro site.</p>

    <template v-else>
      <p class="crm-resultados__total" aria-live="polite">
        <strong>{{ total.enviados }} enviado{{ total.enviados === 1 ? '' : 's' }}</strong> · {{ resumo(total) }}
      </p>

      <section class="crm-grupo" aria-labelledby="crm-resultado-anotados">
        <header class="crm-grupo__cabeca">
          <h2 id="crm-resultado-anotados">Follow-up e 2ª mensagem</h2>
        </header>
        <p class="crm-grupo__explicacao">
          Anotados ao tocar em "Mandar o follow-up" e "Mandar o link" na Central, desde {{ INICIO_DAS_ANOTACOES }}; antes disso
          nenhum envio deixou rastro. "Respondeu depois" é gente escrevendo depois do follow-up.
        </p>
        <ul class="crm-lista">
          <li class="crm-resultado">
            <div class="crm-resultado__cabeca">
              <strong>Follow-up</strong>
              <span v-if="anotados.followups && anotados.followups < AMOSTRA_MINIMA" class="crm-tag">amostra pequena</span>
            </div>
            <p class="crm-resultado__numeros">{{ textoDoFollowup(anotados) }}</p>
          </li>
          <li class="crm-resultado">
            <div class="crm-resultado__cabeca"><strong>2ª mensagem</strong></div>
            <p class="crm-resultado__numeros">{{ textoDaSegunda(anotados) }}</p>
          </li>
        </ul>
      </section>

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
