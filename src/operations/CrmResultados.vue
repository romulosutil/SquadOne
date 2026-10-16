<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  DIAS_ATE_A_LEITURA, DIFERENCA_MINIMA_PP, ENVIOS_POR_BRACO, FRASE_DO_VEREDITO, REGRA_DE_PARADA, leituraDoAbVideo, textoDaDiferenca, textoDoP,
} from './ab-video'
import { ENVIOS_MINIMOS_POR_BRACO, leituraDoAbMensagem, textoDoFaltam } from './ab-mensagem'
import { dataCurta, dataHora } from './crm-formato'
import {
  AMOSTRA_MINIMA, INICIO_DAS_ANOTACOES, PERIODOS, amostraPequena, enviosAnotados, porcento, resultados, resumoDaLinha, textoDaSegunda, textoDoFollowup,
  type Criterio, type LinhaDeResultado, type Periodo,
} from './resultados'
import type { CrmLead } from './types'
import { LIMITE_DA_RESPOSTA_RAPIDA_H, duracao, velocidadeDaVenda, type Medida } from './velocidade'

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

// A/B estratificado da 1ª mensagem (14/10/2026, ab-mensagem.ts): só leads com ab_elegiveis, letra
// comparada só entre quem podia receber as duas. Também ignora o período: o teste conta inteiro.
const abMensagem = computed(() => leituraDoAbMensagem(props.leads, props.agora))
const letraVenceu = (letra: string | null) => (letra ? `mensagem ${letra} ganhou` : 'não provado')

// Depois do "sim" (16/10/2026, OT-09): onde o funil perde, com tempo e não só contagem. Sempre os
// últimos 30 dias, como o "Por que não está vendendo"; o período acima vale para os envios.
const velocidade = computed(() => velocidadeDaVenda(props.leads, props.agora))
const textoDaMedida = (m: Medida) => !m.feitos.length
  ? 'nenhum ainda'
  : `${m.feitos.length} · mediana de ${duracao(m.medianaHoras ?? 0)} · ${m.rapidos} em até ${LIMITE_DA_RESPOSTA_RAPIDA_H} h`
const textoDaEspera = (m: Medida) => m.esperando.slice(0, 3).map((e) => `${e.empresa} (${duracao(e.horas)})`).join(', ')

interface ResumoDoVendedor { avisos: number; enviei: number; pulou: number; expirou: number; saiu: number; medianaAteEnvieiMin: number | null; quentes: { avisos: number; enviei: number; medianaAteEnvieiMin: number | null } }
const vendedor = ref<ResumoDoVendedor | null>(null)
onMounted(async () => {
  try {
    const r = await fetch('/api/operations/crm/vendedor', { cache: 'no-store' })
    if (r.ok) vendedor.value = (await r.json() as { resumo: ResumoDoVendedor }).resumo
  } catch { /* sem a medida: o bloco diz que não há */ }
})
const minutos = (m: number | null) => (m === null ? '—' : duracao(m / 60))

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

    <section class="crm-grupo" aria-labelledby="crm-resultado-velocidade">
      <header class="crm-grupo__cabeca">
        <h2 id="crm-resultado-velocidade">Depois do "sim"</h2>
      </header>
      <p class="crm-grupo__explicacao">
        Quanto tempo a venda espera em cada passo, nos últimos {{ velocidade.dias }} dias. A chance de fechar cai rápido depois do
        interesse: a meta é o link em até {{ LIMITE_DA_RESPOSTA_RAPIDA_H }} h.
      </p>
      <ul class="crm-lista">
        <li class="crm-resultado">
          <div class="crm-resultado__cabeca"><strong>Do "quero ver" ao link</strong></div>
          <p class="crm-resultado__numeros">{{ textoDaMedida(velocidade.queroVerAoLink) }}</p>
          <p v-if="velocidade.queroVerAoLink.esperando.length" class="crm-nota-pequena">
            Esperando o link agora: {{ textoDaEspera(velocidade.queroVerAoLink) }}
          </p>
        </li>
        <li class="crm-resultado">
          <div class="crm-resultado__cabeca"><strong>Do link à proposta</strong></div>
          <p class="crm-resultado__numeros">{{ textoDaMedida(velocidade.linkAProposta) }}</p>
          <p v-if="velocidade.linkAProposta.esperando.length" class="crm-nota-pequena">
            Viram o link e esperam a proposta: {{ textoDaEspera(velocidade.linkAProposta) }}
          </p>
        </li>
        <li class="crm-resultado">
          <div class="crm-resultado__cabeca"><strong>Vendedor no Telegram</strong></div>
          <p v-if="!vendedor || !vendedor.avisos" class="crm-resultado__numeros">Nenhum aviso medido ainda (a medida começou em 16/10/2026).</p>
          <template v-else>
            <p class="crm-resultado__numeros">
              {{ vendedor.avisos }} avisos · {{ vendedor.enviei }} viraram "Enviei" ({{ porcento(vendedor.enviei, vendedor.avisos) }}) ·
              mediana de {{ minutos(vendedor.medianaAteEnvieiMin) }} até o toque
            </p>
            <p class="crm-nota-pequena">
              {{ vendedor.pulou }} pulados, {{ vendedor.expirou }} sem toque em 30 min, {{ vendedor.saiu }} resolvidos por fora.
              <template v-if="vendedor.quentes.avisos">"Quero ver": {{ vendedor.quentes.enviei }} de {{ vendedor.quentes.avisos }}, mediana de {{ minutos(vendedor.quentes.medianaAteEnvieiMin) }}.</template>
            </p>
          </template>
        </li>
      </ul>
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

      <template v-for="secao in secoes" :key="secao.id">
        <section class="crm-grupo" :aria-labelledby="`crm-resultado-${secao.id}`">
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

        <!-- Logo depois do placar por mensagem: o placar mistura quem podia receber a B com quem não podia; este não. -->
        <section v-if="secao.id === 'mensagem'" class="crm-grupo" aria-labelledby="crm-resultado-ab-mensagem">
          <header class="crm-grupo__cabeca">
            <h2 id="crm-resultado-ab-mensagem">A × B (mesmo sorteio, por nicho)</h2>
          </header>
          <p class="crm-grupo__explicacao">
            Cada letra só é comparada entre leads que podiam receber as duas (coluna ab_elegiveis), com a letra equilibrada
            dentro de cada nicho pelo Balcão. "Respondeu" é gente. Conta o teste inteiro, sem o período acima.
            <template v-if="abMensagem.inicio">Só vale para envios sorteados desde {{ dataCurta(abMensagem.inicio) }}.</template>
          </p>
          <p v-if="!abMensagem.inicio" class="crm-vazio">
            <strong>Nenhum envio sorteado ainda.</strong> Só vale para envios sorteados depois que o Balcão passou a gravar a
            coluna ab_elegiveis (14/10/2026); os anteriores ficam fora.
          </p>
          <template v-else>
            <div v-for="par in abMensagem.pares" :key="par.par" class="crm-resultados__par">
              <h3 class="crm-resultado__numeros"><strong>{{ par.x.letra }} × {{ par.y.letra }}</strong></h3>
              <ul class="crm-lista">
                <li v-for="b in [par.x, par.y]" :key="b.letra" class="crm-resultado">
                  <div class="crm-resultado__cabeca">
                    <strong>Mensagem {{ b.letra }}</strong>
                    <span>{{ b.enviados }} de {{ ENVIOS_MINIMOS_POR_BRACO }} enviado{{ b.enviados === 1 ? '' : 's' }}</span>
                  </div>
                  <p v-if="b.linha" class="crm-resultado__numeros">{{ resumo(b.linha) }}</p>
                </li>
              </ul>
              <p v-if="par.estado === 'faltam'" class="crm-aviso" role="status">
                <strong>{{ textoDoFaltam(par) }}</strong> A taxa só aparece com {{ ENVIOS_MINIMOS_POR_BRACO }} envios em cada braço:
                olhar antes e parar quando "parece bom" inventa vencedor.
              </p>
              <div v-else-if="par.numeros" class="crm-resultados__total" role="status">
                <p class="crm-resultado__numeros">
                  Respondeu de gente: {{ par.x.letra }} <strong>{{ porcento(par.x.linha?.responderam ?? 0, par.x.enviados) }}</strong>,
                  {{ par.y.letra }} <strong>{{ porcento(par.y.linha?.responderam ?? 0, par.y.enviados) }}</strong>
                  · {{ textoDaDiferenca(par.numeros.diferencaPp) }} para a {{ par.x.letra }} · {{ textoDoP(par.numeros.p) }}
                </p>
                <p class="crm-resultado__numeros"><strong>Veredito: {{ letraVenceu(par.numeros.ganhou) }}.</strong></p>
              </div>
              <p v-if="par.porNicho.length" class="crm-nota-pequena">
                Por nicho:
                <template v-for="(n, i) in par.porNicho" :key="n.nicho">{{ i ? ' · ' : '' }}{{ n.nicho }} {{ par.x.letra }}
                  {{ n.x.linha ? `${n.x.linha.responderam}/${n.x.enviados}` : n.x.enviados }}, {{ par.y.letra }}
                  {{ n.y.linha ? `${n.y.linha.responderam}/${n.y.enviados}` : n.y.enviados }}</template>
                {{ par.estado === 'lido' ? '(responderam/enviados)' : '(enviados)' }}.
              </p>
            </div>
          </template>
          <p v-if="abMensagem.semColuna || abMensagem.letraFora" class="crm-nota-pequena">
            Fora do teste: {{ abMensagem.semColuna }} envio{{ abMensagem.semColuna === 1 ? '' : 's' }} sem ab_elegiveis
            (o histórico: os envios sem letra e os sorteados só pelo hash, antes de 14/10/2026){{ abMensagem.letraFora ? `, e ${abMensagem.letraFora} com a letra trocada (escrita à mão)` : '' }}.
            O follow-up (aviso do 05 · Acompanhamento) não é sorteado: o teste é da 1ª mensagem.
          </p>
          <p class="crm-nota-pequena">
            Regra fixada antes de ler: uma letra ganha só com +{{ DIFERENCA_MINIMA_PP }} pontos e p &lt; 0,10 (Fisher exato
            bilateral), com {{ ENVIOS_MINIMOS_POR_BRACO }}+ envios em cada braço; senão, não provado. Por nicho é para ver, não para declarar ganhador.
          </p>
        </section>
      </template>
    </template>
  </div>
</template>
