<script setup lang="ts">
import { computed } from 'vue'
import { ROTULO_DO_ESTADO, ROTULO_DO_TRILHO, jornadaDoLead, nomeDaOferta, ofertaDoLead, passoAtual, passoDaJornada, proximoDaJornada, type OfertaSugerida } from './jornada'
import { dataCurta, diaEscolhido } from './crm-formato'
import type { CrmLead } from './types'

// Bloco "Jornada" da Ficha (15/10/2026): em que passo o lead está, o que fazer agora e o que
// oferecer a ele, tudo de jornada.ts (as mesmas regras do guia dos agentes). Só lê o lead.
const props = defineProps<{ lead: CrmLead }>()

const passos = computed(() => jornadaDoLead(props.lead))
const atual = computed(() => passoDaJornada(passoAtual(props.lead)))
const proximo = computed(() => proximoDaJornada(props.lead))
const oferta = computed(() => ofertaDoLead(props.lead))
// Data do próximo salvo à mão vem como AAAA-MM-DD; o sugerido traz o prazo em palavras.
const quando = computed(() => {
  const q = proximo.value.quando
  if (!q) return ''
  return proximo.value.marcadoAMao ? `para ${diaEscolhido(q)}` : q
})
const grupos = computed<Array<{ id: string; titulo: string; itens: OfertaSugerida[] }>>(() => [
  { id: 'agora', titulo: 'Oferecer agora', itens: oferta.value.agora },
  { id: 'depois', titulo: 'Depois', itens: oferta.value.depois },
  { id: 'nao', titulo: 'Não oferecer', itens: oferta.value.naoAgora },
].filter((g) => g.itens.length))
const agora = computed(() => grupos.value.filter((g) => g.id === 'agora'))
const adiante = computed(() => grupos.value.filter((g) => g.id !== 'agora'))
</script>

<template>
  <section class="crm-ficha__bloco crm-jornada" aria-labelledby="crm-ficha-jornada">
    <h3 id="crm-ficha-jornada">Jornada</h3>
    <p class="crm-jornada__onde">
      <span class="crm-kicker">{{ ROTULO_DO_TRILHO[atual.trilho] }}</span>
      <strong>{{ atual.nome }}</strong>
      <span class="crm-muted">{{ atual.entra }}</span>
    </p>

    <ol class="crm-jornada__trilha" aria-label="Passos deste lead">
      <li v-for="p in passos" :key="p.passo.id" :class="`is-${p.estado}`" :aria-current="p.estado === 'agora' ? 'step' : undefined">
        <span class="so-leitor">{{ ROTULO_DO_ESTADO[p.estado] }}:</span>
        <span aria-hidden="true">{{ p.estado === 'feito' ? '✓' : p.estado === 'agora' ? '●' : p.estado === 'sem-registro' ? '?' : '○' }}</span>
        {{ p.passo.nome }}<template v-if="p.em"> · {{ dataCurta(p.em) }}</template>
      </li>
    </ol>

    <div class="crm-proximo crm-jornada__proximo">
      <span class="crm-kicker">Próximo passo · {{ proximo.quem === 'você' ? 'com você' : proximo.quem === 'robô' ? 'com o robô' : 'com o dono' }}</span>
      <strong>{{ proximo.acao }}</strong>
      <span v-if="quando">{{ quando }}<template v-if="proximo.marcadoAMao"> (salvo na Ficha)</template></span>
      <small class="crm-muted">O que tira o lead daqui: {{ atual.sai }}</small>
    </div>

    <div v-for="g in agora" :key="g.id" class="crm-jornada__oferta" :class="`is-${g.id}`">
      <h4>{{ g.titulo }}</h4>
      <ul>
        <li v-for="o in g.itens" :key="o.id"><strong>{{ nomeDaOferta(o.id) }}</strong> — {{ o.porque }}</li>
      </ul>
    </div>
    <div v-if="oferta.aConfirmar.length" class="crm-jornada__oferta is-confirmar">
      <h4>Confirmar antes de oferecer</h4>
      <ul><li v-for="t in oferta.aConfirmar" :key="t">{{ t }}</li></ul>
    </div>
    <!-- "Depois" e "Não oferecer" não mudam a conversa de agora: ficam dobrados, com a contagem à vista. -->
    <details v-if="adiante.length" class="dobra">
      <summary>Outras ofertas <span class="crm-muted">({{ adiante.reduce((n, g) => n + g.itens.length, 0) }})</span></summary>
      <div v-for="g in adiante" :key="g.id" class="crm-jornada__oferta" :class="`is-${g.id}`">
        <h4>{{ g.titulo }}</h4>
        <ul>
          <li v-for="o in g.itens" :key="o.id"><strong>{{ nomeDaOferta(o.id) }}</strong> — {{ o.porque }}</li>
        </ul>
      </div>
    </details>
  </section>
</template>
