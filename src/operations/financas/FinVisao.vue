<script setup lang="ts">
import { computed } from 'vue'
import FinImportar from './FinImportar.vue'
import { brl, diaMes, mesCurto, mesLongo, ROTULO_DO_TIPO, somarMeses, variacao } from './formato'
import type { VisaoFinanceira } from './types'

// Visão: os três blocos (tenho, devo, gastei) e o que se repete. Os números
// vêm prontos do servidor (server/financas/resumo.ts); aqui é só a tela.
const props = defineProps<{ dados: VisaoFinanceira }>()
const emit = defineEmits<{ mudar: [mes: string, visao: 'competencia' | 'caixa']; importado: [] }>()

const maiorMes = computed(() => Math.max(1, ...props.dados.devo.porMes.map((m) => m.centavos)))
const maiorCategoria = computed(() => Math.max(1, ...props.dados.gastei.categorias.map((c) => Math.max(c.centavos, c.anteriorCentavos))))
const pct = (v: number, max: number) => `${Math.max(2, Math.round((Math.max(0, v) / max) * 100))}%`
const proximoMesPermitido = computed(() => props.dados.mes < props.dados.hoje.slice(0, 7))
const linkDaCategoria = (categoria: string) => `/financas/lancamentos?categoria=${encodeURIComponent(categoria)}&mes=${props.dados.mes}`
const nomeDoCartao = (c: { nome: string; final: string | null }) => (c.final ? `${c.nome} ·${c.final}` : c.nome)
</script>

<template>
  <div class="fin-blocos">
    <!-- TENHO -->
    <section class="fin-bloco" aria-labelledby="fin-tenho">
      <header class="fin-bloco__topo">
        <h2 id="fin-tenho">Tenho</h2>
        <strong class="fin-total">{{ brl(dados.tenho.totalCentavos) }}</strong>
        <p class="fin-sub">Contas e investimentos, pelo saldo que o banco informa.</p>
      </header>
      <p v-if="!dados.tenho.contas.length" class="fin-vazio">Nenhuma conta lida ainda. Toque em "Atualizar agora".</p>
      <ul v-else class="fin-linhas">
        <li v-for="c in dados.tenho.contas" :key="c.id">
          <span><b>{{ c.nome }}</b><small>{{ ROTULO_DO_TIPO[c.tipo] ?? c.tipo }} · {{ c.instituicao }}</small></span>
          <span class="fin-valor" :class="{ 'is-negativo': c.saldoCentavos < 0 }">{{ brl(c.saldoCentavos) }}</span>
        </li>
      </ul>
    </section>

    <!-- DEVO -->
    <section class="fin-bloco" aria-labelledby="fin-devo">
      <header class="fin-bloco__topo">
        <h2 id="fin-devo">Devo</h2>
        <strong class="fin-total">{{ brl(dados.devo.totalCentavos) }}</strong>
        <p class="fin-sub">
          Faturas a pagar, a fatura aberta e as parcelas que ainda vêm.
          <template v-if="dados.devo.parcelasAcabamEm">As parcelas acabam em {{ mesCurto(dados.devo.parcelasAcabamEm) }}.</template>
        </p>
      </header>
      <p v-if="!dados.devo.cartoes.length" class="fin-vazio">Nenhum cartão lido ainda.</p>
      <article v-for="c in dados.devo.cartoes" :key="c.id" class="fin-cartao">
        <h3>{{ nomeDoCartao(c) }} <span class="fin-total-pequeno">{{ brl(c.totalCentavos) }}</span></h3>
        <dl class="fin-pares">
          <template v-if="c.fechada">
            <dt>Fatura fechada · vence {{ diaMes(c.fechada.vencimento) }}</dt>
            <dd>{{ brl(c.fechada.centavos) }}<small v-if="c.fechada.pagoCentavos"> (já pago {{ brl(c.fechada.pagoCentavos) }})</small></dd>
          </template>
          <dt>Fatura aberta · vence {{ diaMes(c.aberta.vencimento) }}</dt>
          <dd v-if="c.aberta.semLancamentos">—</dd>
          <dd v-else>{{ brl(c.aberta.centavos) }}</dd>
          <template v-if="c.futurasCentavos">
            <dt>Parcelas depois disso</dt>
            <dd>{{ brl(c.futurasCentavos) }}</dd>
          </template>
          <template v-if="c.semDetalheCentavos">
            <dt>Sem detalhe</dt>
            <dd>{{ brl(c.semDetalheCentavos) }}</dd>
          </template>
        </dl>
        <p v-if="c.aberta.semLancamentos" class="fin-sub">O banco não envia os lançamentos deste cartão: importe a fatura em PDF abaixo para ver em quê gastou.</p>
        <p v-if="c.semDetalheCentavos" class="fin-sub">"Sem detalhe" é a diferença entre o limite usado que o banco informa e o que dá para detalhar aqui.</p>
        <p v-if="c.usoPct !== null && c.limiteCentavos" class="fin-uso" :class="{ 'is-alto': c.usoPct >= 70, 'is-estouro': c.usoPct >= 100 }">
          <span class="fin-barra" aria-hidden="true"><i :style="{ width: `${Math.min(100, c.usoPct)}%` }" /></span>
          Limite usado: {{ c.usoPct }}% de {{ brl(c.limiteCentavos) }}
        </p>
      </article>

      <template v-if="dados.devo.porMes.length">
        <h3 class="fin-subtitulo">Mês a mês</h3>
        <ul class="fin-barras">
          <li v-for="m in dados.devo.porMes" :key="m.mes">
            <span>{{ mesCurto(m.mes) }}</span>
            <span class="fin-barra" aria-hidden="true"><i :style="{ width: pct(m.centavos, maiorMes) }" /></span>
            <span class="fin-valor">{{ brl(m.centavos) }}</span>
          </li>
        </ul>
      </template>

      <details v-if="dados.devo.parcelamentos.length" class="fin-dobra">
        <summary>{{ dados.devo.parcelamentos.length }} parcelamento(s) em andamento</summary>
        <ul class="fin-linhas">
          <li v-for="p in dados.devo.parcelamentos" :key="p.grupo">
            <span>
              <b>{{ p.descricao }}</b>
              <small>{{ p.cartao }} · {{ p.ultimaVista }} de {{ p.total }} · faltam {{ p.restantes }} · acaba em {{ mesCurto(p.acabaEm) }}</small>
            </span>
            <span class="fin-valor">{{ brl(p.valorParcela) }}<small>/mês</small></span>
          </li>
        </ul>
      </details>
    </section>

    <!-- GASTEI -->
    <section class="fin-bloco fin-bloco--largo" aria-labelledby="fin-gastei">
      <header class="fin-bloco__topo">
        <h2 id="fin-gastei">Gastei</h2>
        <div class="fin-mes" role="group" aria-label="Mês">
          <button type="button" class="fin-botao-icone" aria-label="Mês anterior" @click="emit('mudar', somarMeses(dados.mes, -1), dados.visao)">‹</button>
          <span>{{ mesLongo(dados.mes) }}</span>
          <button type="button" class="fin-botao-icone" aria-label="Próximo mês" :disabled="!proximoMesPermitido" @click="emit('mudar', somarMeses(dados.mes, 1), dados.visao)">›</button>
        </div>
        <div class="fin-alternar" role="group" aria-label="Como contar">
          <button type="button" :aria-pressed="dados.visao === 'competencia'" @click="emit('mudar', dados.mes, 'competencia')">Competência</button>
          <button type="button" :aria-pressed="dados.visao === 'caixa'" @click="emit('mudar', dados.mes, 'caixa')">Caixa</button>
        </div>
        <p class="fin-sub">
          {{ dados.visao === 'competencia'
            ? 'Compras no cartão contam no mês da fatura; o pagamento da fatura não conta de novo.'
            : 'O que saiu das contas no mês, com a fatura paga numa linha só.' }}
        </p>
        <strong class="fin-total">{{ brl(dados.gastei.totalCentavos) }}</strong>
        <p class="fin-sub">
          {{ variacao(dados.gastei.totalCentavos, dados.gastei.anteriorCentavos) }} contra {{ mesCurto(somarMeses(dados.mes, -1)) }} ({{ brl(dados.gastei.anteriorCentavos) }}).
          Entrou {{ brl(dados.recebi.totalCentavos) }}.
        </p>
      </header>
      <p v-if="!dados.gastei.categorias.length" class="fin-vazio">Nenhum gasto lido neste mês.</p>
      <ul v-else class="fin-categorias">
        <li v-for="c in dados.gastei.categorias" :key="c.categoria">
          <a :href="linkDaCategoria(c.categoria)">
            <span class="fin-categorias__nome">{{ c.categoria }}</span>
            <span class="fin-valor">{{ brl(c.centavos) }}</span>
            <span class="fin-barra fin-barra--dupla" aria-hidden="true">
              <i :style="{ width: pct(c.centavos, maiorCategoria) }" />
              <i class="is-anterior" :style="{ width: pct(c.anteriorCentavos, maiorCategoria) }" />
            </span>
            <small>{{ variacao(c.centavos, c.anteriorCentavos) }} · antes {{ brl(c.anteriorCentavos) }}</small>
          </a>
        </li>
      </ul>
    </section>

    <!-- RECORRENTES -->
    <section v-if="dados.recorrentes.length" class="fin-bloco" aria-labelledby="fin-recorrentes">
      <header class="fin-bloco__topo">
        <h2 id="fin-recorrentes">Todo mês</h2>
        <strong class="fin-total">{{ brl(dados.recorrentes.reduce((s, r) => s + r.mediaCentavos, 0)) }}</strong>
        <p class="fin-sub">Gastos que aparecem em 3 dos últimos 4 meses, com valor parecido.</p>
      </header>
      <ul class="fin-linhas">
        <li v-for="r in dados.recorrentes" :key="r.descricao">
          <span><b>{{ r.descricao }}</b><small>{{ r.categoria }} · {{ r.meses }} meses · último em {{ mesCurto(r.ultimoMes) }}</small></span>
          <span class="fin-valor">{{ brl(r.mediaCentavos) }}</span>
        </li>
      </ul>
    </section>

    <FinImportar @importado="emit('importado')" />
  </div>
</template>
