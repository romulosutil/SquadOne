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
import PorQueNaoVende from './PorQueNaoVende.vue'
import { aprendizadosDosLeads, ROTULO_DO_TESTE } from './aprendizado-comercial'
import { MINIMO_POR_BRACO_DO_RECIBO, leituraDoTesteDoRecibo } from './ab-recibo'
import { LIMITE_DA_RESPOSTA_RAPIDA_H, duracao, velocidadeDaVenda, type Medida } from './velocidade'
import { leituraDoTestePlus, TAMANHO_DO_TESTE_PLUS } from './plus-experimento'
import { leituraDoFollowup, MINIMO_POR_BRACO_DO_FOLLOWUP } from './followup-experimento'

// "Resultados" (08/10/2026): quanto cada nicho, mensagem e versão do site
// rendeu, contado só sobre quem foi enviado no período. Só leitura: os números
// saem do mesmo retrato da planilha que o Hoje e o Funil usam (RULES 11).
// 17/10/2026 (hierarquia de Vendas): duas seções de Entender, com o mesmo componente. `numeros` é o
// "onde perde" (os degraus, depois do "sim", o vendedor do Telegram) e, numa dobra "Experimentos"
// fechada, os três testes A/B (vídeo, 1ª mensagem, recibo): são medição em andamento, não decisão de
// hoje, e ocupavam metade da tela. `resultados` é o placar do período (nicho, mensagem, site, horário).
const props = withDefaults(defineProps<{ leads: CrmLead[]; agora: number; parte?: 'numeros' | 'resultados' }>(), { parte: 'numeros' })

const periodo = ref<Periodo>('30')
const testePlus = computed(() => leituraDoTestePlus(props.leads, props.agora))
const testeFollowup = computed(() => leituraDoFollowup(props.leads))
const aprendizados = computed(() => aprendizadosDosLeads(props.leads))
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
// Follow-up e 2ª mensagem registrados (14/10/2026): o "follow-up funciona?" com número. Quem os marca é o
// observador do WhatsApp ou o "Enviei" explícito, não o toque no link (regra [abrir-nao-envia]).
const anotados = computed(() => enviosAnotados(props.leads, periodo.value, props.agora))

// A/B do vídeo (11/10/2026, ab-video.ts): só existe com a coluna `braco_video` preenchida.
// Ignora o período: o teste é contado inteiro, uma vez, depois dos 7 dias.
const ab = computed(() => leituraDoAbVideo(props.leads, props.agora))
const bracos = computed(() => (ab.value ? [ab.value.comVideo, ab.value.semVideo] : []))

// A/B estratificado da 1ª mensagem (14/10/2026, ab-mensagem.ts): só leads com ab_elegiveis, letra
// comparada só entre quem podia receber as duas. Também ignora o período: o teste conta inteiro.
const abMensagem = computed(() => leituraDoAbMensagem(props.leads, props.agora))
const abPrumo = computed(() => leituraDoAbMensagem(props.leads, props.agora, 'prumo'))
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
// OT-10: o teste do follow-up para quem não manda recibo (ab-recibo.ts). Ignora o período: conta inteiro.
const recibo = computed(() => leituraDoTesteDoRecibo(props.leads, props.agora))
/** Quantos testes já têm envio contado: o número no título da dobra "Experimentos". */
const experimentosComDados = computed(() => [Boolean(ab.value?.inicio), Boolean(abMensagem.value.inicio), Boolean(recibo.value)].filter(Boolean).length)

const resumo = resumoDaLinha
const largura = (l: LinhaDeResultado) => `${l.enviados ? Math.round((l.responderam / l.enviados) * 100) : 0}%`
</script>

<template>
  <div class="crm-resultados">
    <div v-if="parte === 'resultados'" class="crm-resultados__topo">
      <div class="crm-produtos" role="group" aria-label="Período (pela data de envio)">
        <button v-for="p in PERIODOS" :key="p.id" type="button" :aria-pressed="periodo === p.id" @click="periodo = p.id">{{ p.rotulo }}</button>
      </div>
      <p class="crm-nota-pequena">
        Só quem foi <strong>enviado</strong> no período. "Leram" é quem deixou o recibo ligado ou respondeu; "respondeu" é gente
        (a saudação automática não conta). Menos de {{ AMOSTRA_MINIMA }} enviados é amostra pequena.
      </p>
    </div>

    <template v-if="parte === 'numeros'">
      <section class="crm-grupo" aria-labelledby="crm-plus-teste">
        <header class="crm-grupo__cabeca"><h2 id="crm-plus-teste">Plus · teste de {{ TAMANHO_DO_TESTE_PLUS }} envios</h2></header>
        <p class="crm-grupo__explicacao">Primeiros envios confirmados desde {{ dataCurta(new Date(testePlus.inicio).toISOString()) }}. {{ testePlus.plus.enviados }} de {{ TAMANHO_DO_TESTE_PLUS }} no lote. Somente o Rômulo envia. Comparação com o Site enviado no mesmo período, até {{ dataHora(new Date(testePlus.fim).toISOString()) }}; respostas observadas até {{ dataHora(new Date(testePlus.observacaoAte).toISOString()) }}.</p>
        <table class="crm-spiced-comparacao"><caption>Contagens por canal no mesmo período de envio</caption><thead><tr><th scope="col">Canal</th><th scope="col">Enviados</th><th scope="col">Respostas de gente</th><th scope="col">Quero ver</th><th scope="col">Propostas</th></tr></thead><tbody><tr v-for="[canal, linha] in [['Plus', testePlus.plus], ['Site', testePlus.site]] as const" :key="canal"><th scope="row">{{ canal }}</th><td>{{ linha.enviados }}</td><td>{{ linha.respostas }}</td><td>{{ linha.queroVer }}</td><td>{{ linha.propostas }}</td></tr></tbody></table>
        <p class="crm-nota-pequena">Contagens, sem declarar vencedor com amostra pequena. O lote fecha no 20º envio e conserva o mesmo período para os dois canais.</p>
      </section>
      <!-- OT-08 (16/10/2026): os degraus do funil moram aqui; a Hoje mostra só o gargalo. -->
      <PorQueNaoVende :leads="leads" :agora="agora" />
      <section class="crm-grupo" aria-labelledby="crm-prumo-abertura">
        <header class="crm-grupo__cabeca"><h2 id="crm-prumo-abertura">Serviços PRUMO · abertura A × D</h2></header>
        <p class="crm-grupo__explicacao">A usa o convite habitual; D abre com um achado verificável do raio-x. Medição separada do Site, só com mensagem enviada e braço confirmado. O braço D aguarda revisão do Rômulo.</p>
        <p v-if="!abPrumo.inicio" class="crm-nota-pequena">Nenhum envio com braço confirmado nesta oferta. O histórico sem letra continua fora da comparação.</p>
        <div v-for="par in abPrumo.pares" :key="par.par">
          <p>A: {{ par.x.enviados }} envios elegíveis · D: {{ par.y.enviados }} envios elegíveis.</p>
          <p v-if="!par.numeros" class="crm-nota-pequena">{{ textoDoFaltam(par) }} Taxas só após {{ ENVIOS_MINIMOS_POR_BRACO }} em cada lado.</p>
          <p v-else>Respondeu de gente: A {{ porcento(par.x.linha?.responderam ?? 0, par.x.enviados) }} · D {{ porcento(par.y.linha?.responderam ?? 0, par.y.enviados) }} · {{ textoDoP(par.numeros.p) }}. {{ letraVenceu(par.numeros.ganhou) }}.</p>
        </div>
      </section>
      <section class="crm-grupo" aria-labelledby="crm-followup-teste">
        <header class="crm-grupo__cabeca"><h2 id="crm-followup-teste">Follow-up · texto em teste</h2></header>
        <p class="crm-grupo__explicacao">A conserva o texto anterior; B faz uma pergunta sobre a operação. O texto novo aguarda revisão do Rômulo. Só entra envio confirmado com braço e versão registrados; o histórico não recebe letra retroativa.</p>
        <p class="crm-resultado__numeros">A: {{ testeFollowup.bracos.A.enviados }} envios · B: {{ testeFollowup.bracos.B.enviados }} envios.</p>
        <p v-if="!testeFollowup.lido" class="crm-nota-pequena">Taxas e comparação só com {{ MINIMO_POR_BRACO_DO_FOLLOWUP }} envios confirmados em cada braço.</p>
        <p v-else-if="testeFollowup.numeros" class="crm-resultado__numeros">Respondeu depois do follow-up: A {{ porcento(testeFollowup.bracos.A.responderam, testeFollowup.bracos.A.enviados) }} · B {{ porcento(testeFollowup.bracos.B.responderam, testeFollowup.bracos.B.enviados) }} · {{ textoDoP(testeFollowup.numeros.p) }}. Resultado exploratório; não autoriza envios.</p>
      </section>

      <section class="crm-grupo" aria-labelledby="crm-aprendizados">
        <header class="crm-grupo__cabeca"><h2 id="crm-aprendizados">O que os leads ensinaram</h2></header>
        <p class="crm-grupo__explicacao">{{ aprendizados.length }} leads com aprendizado registrado na seleção atual. Última revisão por lead, sem filtro de período. Avançar não significa vender; só o desfecho confirma a venda. Revise os resultados antes de mudar a oferta.</p>
        <p v-if="!aprendizados.length" class="crm-nota-pequena">Abra uma ficha e registre o fato, a hipótese, o próximo teste e o resultado em “O que este lead ensinou”.</p>
        <ul v-else class="crm-lista">
          <li v-for="a in aprendizados" :key="a.leadId" class="crm-resultado">
            <div class="crm-resultado__cabeca"><a :href="`/crm?lead=${encodeURIComponent(a.leadId)}`">{{ a.empresa }}</a><span>{{ ROTULO_DO_TESTE[a.resultado] }}{{ a.pausarAteResposta ? ' · pausa solicitada' : '' }}</span></div>
            <p><strong>Fato:</strong> {{ a.fato }}</p>
            <p><strong>Hipótese:</strong> {{ a.hipotese }}</p>
            <p><strong>Teste:</strong> {{ a.teste }}</p>
          </li>
        </ul>
      </section>

      <section class="crm-grupo" aria-labelledby="crm-resultado-velocidade">
        <header class="crm-grupo__cabeca">
          <h2 id="crm-resultado-velocidade">Depois do "sim"</h2>
        </header>
        <p class="crm-grupo__explicacao">
          Intervalos entre registros nos últimos {{ velocidade.dias }} dias. Até {{ LIMITE_DA_RESPOSTA_RAPIDA_H }} h é uma meta operacional, não uma taxa de conversão comprovada. Mensagem fora do arquivo pode não ter sido medida.
        </p>
        <ul class="crm-lista">
          <li class="crm-resultado">
            <div class="crm-resultado__cabeca"><strong>Do "quero ver" ao link</strong></div>
            <p class="crm-resultado__numeros">{{ textoDaMedida(velocidade.queroVerAoLink) }}</p>
            <p v-if="velocidade.queroVerAoLink.esperando.length" class="crm-nota-pequena">
              Sem registro do material depois da autorização: {{ textoDaEspera(velocidade.queroVerAoLink) }}
            </p>
          </li>
          <li class="crm-resultado">
            <div class="crm-resultado__cabeca"><strong>Do link à proposta</strong></div>
            <p class="crm-resultado__numeros">{{ textoDaMedida(velocidade.linkAProposta) }}</p>
            <p v-if="velocidade.linkAProposta.esperando.length" class="crm-nota-pequena">
              Material registrado, sem proposta registrada depois: {{ textoDaEspera(velocidade.linkAProposta) }}
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

      <!-- Os testes A/B são medição em andamento, não decisão de hoje: dobrados, com quantos já têm envio. -->
      <details class="dobra crm-experimentos">
        <summary>Experimentos <span class="crm-muted">({{ experimentosComDados }} de 3 com envio contado)</span></summary>
        <section v-if="ab" class="crm-grupo" aria-labelledby="crm-resultado-video">
          <header class="crm-grupo__cabeca">
            <h2 id="crm-resultado-video">Por vídeo no envio (teste A/B)</h2>
          </header>
          <p class="crm-grupo__explicacao">
            {{ ab.nicho }}{{ ab.mensagem ? ` · mensagem ${ab.mensagem}` : '' }}{{ ab.inicio ? ` · desde ${dataCurta(ab.inicio)}` : ' · nenhum envio ainda' }}.
            O braço sai do sorteio pelo place_id; o vídeo vai à mão logo depois da mensagem. Conta o teste inteiro, sem período.
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

        <section class="crm-grupo" aria-labelledby="crm-resultado-recibo">
          <header class="crm-grupo__cabeca">
            <h2 id="crm-resultado-recibo">Teste de recibo · histórico de 17 a 18/10</h2>
          </header>
          <ul class="crm-lista">
            <li class="crm-resultado">
              <div class="crm-resultado__cabeca">
                <strong>O teste anterior separava os envios sem recibo em dois grupos</strong>
                <span v-if="recibo && (recibo.teste.n < MINIMO_POR_BRACO_DO_RECIBO || recibo.controle.n < MINIMO_POR_BRACO_DO_RECIBO)" class="crm-tag">amostra pequena</span>
              </div>
              <p v-if="!recibo" class="crm-resultado__numeros">Sem amostra madura registrada no recorte histórico. Desde 19/10, o recibo não define quem entra no follow-up.</p>
              <template v-else>
                <p class="crm-resultado__numeros">
                  Com follow-up: {{ recibo.teste.responderam }} de {{ recibo.teste.n }} responderam<template v-if="recibo.p !== null"> ({{ porcento(recibo.teste.responderam, recibo.teste.n) }})</template> ·
                  sem: {{ recibo.controle.responderam }} de {{ recibo.controle.n }}<template v-if="recibo.p !== null"> ({{ porcento(recibo.controle.responderam, recibo.controle.n) }})</template>
                </p>
                <p class="crm-nota-pequena">
                  Pediram para não receber mais: {{ recibo.teste.pediramParaParar }} com follow-up, {{ recibo.controle.pediramParaParar }} sem.
                  <template v-if="recibo.p !== null"> Fisher p = {{ recibo.p.toFixed(2) }}.</template>
                  <template v-else> Taxa só com {{ MINIMO_POR_BRACO_DO_RECIBO }} em cada lado.</template>
                  O histórico não recebe novos braços nem altera a cadência atual.
                </p>
              </template>
            </li>
          </ul>
        </section>

        <!-- O placar "Por mensagem" (em Resultados) mistura quem podia receber a B com quem não podia; este não. -->
        <section class="crm-grupo" aria-labelledby="crm-resultado-ab-mensagem">
          <header class="crm-grupo__cabeca">
            <h2 id="crm-resultado-ab-mensagem">Primeira mensagem · A, B, C e D</h2>
          </header>
          <p class="crm-grupo__explicacao">
            Cada letra só é comparada entre leads que podiam receber as duas (coluna ab_elegiveis), com a letra equilibrada
            dentro de cada nicho pelo Balcão. "Respondeu" é gente. Conta o teste inteiro, sem período.
            D abre com um fato verificável do raio-x e aguarda revisão do Rômulo.
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
      </details>
    </template>

    <template v-else>
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
            Os que o observador do WhatsApp registrou (ou um "Enviei" seu), desde {{ INICIO_DAS_ANOTACOES }}; antes disso
            nenhum envio deixou rastro. Abrir o WhatsApp não conta. "Respondeu depois" é gente escrevendo depois do follow-up.
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
        </template>
      </template>
    </template>
  </div>
</template>

<style>
/* Experimentos: a dobra abre numa pilha com o mesmo respiro entre os testes que entre os grupos de fora. */
.crm-experimentos[open] { display: grid; gap: var(--esp-4); min-width: 0; }
.crm-spiced-comparacao { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: var(--tam-apoio); }
.crm-spiced-comparacao th, .crm-spiced-comparacao td { padding: var(--esp-1); overflow-wrap: anywhere; text-align: left; }
</style>
