<script setup lang="ts">
/**
 * A operação de uma sala (15/10/2026), no rodapé do SalaCartao: os leads dela
 * por passo da jornada, os parados com o Rômulo e o estado de cada robô. Vem
 * pronta de `operacaoDaSala` (office/operacao.ts, PURO); aqui é só texto e link.
 * Só lê: tocar numa contagem abre a Jornada do CRM no filtro da sala, tocar num
 * robô abre o passo dele em "Como funciona".
 */
import type { OperacaoDaSala } from '../office/operacao'

defineProps<{ operacao: OperacaoDaSala; nomeDaSala: string }>()

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
const dias = (n?: number) => (n === undefined ? '' : n === 0 ? ' · hoje' : ` · ${plural(n, 'dia', 'dias')}`)
</script>

<template>
  <div class="operacao">
    <section v-if="operacao.jornada" class="operacao__bloco" :aria-label="`Leads da sala ${nomeDaSala}`">
      <h4>{{ operacao.jornada.titulo }}</h4>
      <p v-if="operacao.jornada.estado === 'sem-sinal'" class="estado is-sem_sinal">Sem sinal: {{ operacao.jornada.motivo }}</p>
      <template v-else>
        <p v-if="operacao.jornada.velho" class="texto-2 texto-pequeno">
          Retrato do CRM {{ operacao.jornada.idadeMin === null ? 'sem data' : `de há ${operacao.jornada.idadeMin} min` }}: pode estar velho.
        </p>
        <ul class="operacao__recortes">
          <li v-for="r in operacao.jornada.recortes" :key="r.produto ?? 'todas'">
            <a class="operacao__contagem" :href="r.href">
              <span class="operacao__rotulo">
                <strong>{{ r.rotulo }}</strong>
                <span class="operacao__n">{{ r.total }}</span>
                <span class="so-leitor">{{ r.total === 1 ? 'lead' : 'leads' }}: abrir a Jornada do CRM</span>
              </span>
              <small v-if="r.passos.length" class="texto-2">
                <template v-for="(p, i) in r.passos" :key="p.passo">{{ i ? ' · ' : '' }}{{ p.nome }} {{ p.leads }}</template>
              </small>
              <small v-else class="texto-2">nenhum lead aqui agora</small>
              <small v-if="r.fechados" class="texto-2">Fechou {{ r.fechados.ganho }} · Perdido {{ r.fechados.perdido }}</small>
              <small v-if="r.comVoce || r.parados">
                <template v-if="r.comVoce">{{ r.comVoce }} com você</template><template v-if="r.comVoce && r.parados"> · </template><strong v-if="r.parados">{{ plural(r.parados, 'parado', 'parados') }}</strong>
              </small>
            </a>
            <ul v-if="r.maisParados.length" class="operacao__parados" :aria-label="`Parados com você em ${r.rotulo}`">
              <li v-for="l in r.maisParados" :key="l.id">
                <a :href="l.href"><strong>{{ l.empresa }}</strong><span class="texto-2">{{ dias(l.dias) }}</span> <span>{{ l.acao }}</span></a>
              </li>
            </ul>
          </li>
        </ul>
      </template>
    </section>

    <section v-if="operacao.robos.length" class="operacao__bloco" :aria-label="`Robôs da sala ${nomeDaSala}`">
      <h4>Robôs desta sala</h4>
      <ul class="operacao__robos">
        <li v-for="t in operacao.robos" :key="t.id">
          <a :href="t.href">
            <span><strong>{{ t.nome }}</strong> <span class="texto-2">({{ t.quando }})</span><span class="so-leitor">: ver como funciona</span></span>
            <span class="estado" :class="`is-robo-${t.tom}`">{{ t.texto }}</span>
            <small class="texto-2">{{ t.faz }} · {{ t.onde }}</small>
          </a>
        </li>
      </ul>
    </section>
  </div>
</template>

<style>
.operacao { display: grid; gap: var(--esp-3); }
.operacao__bloco { display: grid; gap: var(--esp-2); }
.operacao__bloco h4 { margin: 0; font-size: 0.78rem; font-weight: var(--peso-forte); letter-spacing: 0.04em; text-transform: uppercase; }
.operacao__bloco p { margin: 0; }
.operacao ul { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.operacao a { color: inherit; text-decoration: none; }
.operacao__contagem,
.operacao__robos a { display: grid; gap: 0.15rem; min-height: 44px; padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); background: var(--superficie-2); }
.operacao__contagem:hover,
.operacao__robos a:hover { background: var(--destaque); color: var(--destaque-texto); }
.operacao__contagem:hover .texto-2,
.operacao__robos a:hover .texto-2 { color: inherit; }
.operacao__rotulo { display: flex; align-items: baseline; justify-content: space-between; gap: var(--esp-2); }
.operacao__n { font-size: 1.25rem; font-weight: var(--peso-titulo); font-variant-numeric: tabular-nums; }
.operacao small { font-size: 0.82rem; overflow-wrap: anywhere; }
.operacao__parados { padding-left: var(--esp-3) !important; border-left: var(--linha-fina); }
.operacao__parados a { display: block; min-height: 44px; padding: var(--esp-1) 0; font-size: 0.88rem; overflow-wrap: anywhere; }
.operacao__parados a:hover strong { text-decoration: underline; }
/* O texto diz o estado; o quadrado só reforça (RULES 3). */
.estado.is-robo-ok::before { background: var(--positivo); }
.estado.is-robo-atencao::before { background: var(--destaque); }
.estado.is-robo-sozinho::before { background: var(--ok-fundo); }
.estado.is-robo-falha { color: var(--negativo); }
.estado.is-robo-falha::before { background: var(--negativo); }
.estado.is-robo-sem_sinal { color: var(--texto-2); }
.estado.is-robo-sem_sinal::before { background: transparent; border-style: dashed; }
.operacao .estado { font-size: 0.82rem; overflow-wrap: anywhere; }
</style>
