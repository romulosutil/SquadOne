<script setup lang="ts">
import { computed } from 'vue'
import { dataHora } from './crm-formato'
import type { CanaisComerciais, FonteComercial } from './canais-comerciais'

const props = defineProps<{ canais: CanaisComerciais }>()
const canaisDaTela = computed(() => [
  { id: 'whatsapp', nome: 'WhatsApp', dados: props.canais.whatsapp },
  { id: 'linkedin', nome: 'LinkedIn', dados: props.canais.linkedin },
])
const estadoDaFonte = (f: FonteComercial) => f.estado === 'indisponivel' ? 'Fonte indisponível'
  : f.estado === 'desatualizada' ? 'Fonte desatualizada' : ''
const estadoDoContato = { enviado: 'Envio confirmado', incerto: 'Resultado incerto', bloqueado: 'Envio bloqueado' }
</script>

<template>
  <section class="canais" aria-labelledby="canais-titulo">
    <header><h2 id="canais-titulo">Primeiros contatos</h2><p class="texto-2">Dia {{ canais.dia.split('-').reverse().join('/') }} · São Paulo</p></header>
    <div class="canais__grade">
      <section v-for="{ id, nome, dados } in canaisDaTela" :key="id" class="canais__canal" :aria-label="nome">
        <h3>{{ nome }}</h3>
        <dl>
          <div>
            <dt>Pedido agendado</dt>
            <dd v-if="dados.pedido"><time :datetime="dados.pedido.criadoEm">{{ dataHora(dados.pedido.criadoEm) }}</time> · n8n {{ dados.pedido.execucaoId }}</dd>
            <dd v-if="estadoDaFonte(dados.agenda)" class="canais__alerta">{{ estadoDaFonte(dados.agenda) }}</dd>
          </div>
          <div><dt>Envios confirmados hoje</dt><dd>{{ dados.envios ?? 'Registro indisponível' }}</dd></div>
          <div><dt>Resultados incertos</dt><dd>{{ dados.incertos ?? 'Registro indisponível' }}</dd></div>
        </dl>
        <p v-if="dados.executor.em || estadoDaFonte(dados.executor)" class="texto-2">
          <span v-if="dados.executor.em">Executor · {{ dataHora(dados.executor.em) }}</span>
          <strong v-if="estadoDaFonte(dados.executor)" class="canais__alerta"> {{ estadoDaFonte(dados.executor) }}</strong>
        </p>
        <p v-if="dados.situacao && dados.executor.em">{{ dados.situacao }}</p>
        <p v-if="id === 'whatsapp' && canais.whatsapp.recibosEmConflito" class="canais__alerta">{{ canais.whatsapp.recibosEmConflito }} recibo(s) em conflito. Confira o registro do canal.</p>
        <template v-if="id === 'linkedin'">
          <p v-if="canais.linkedin.ultimaBuscaSemCandidato">
            <strong>Busca sem candidato elegível · 0 envios</strong><br>
            <span class="texto-2">Rodada {{ canais.linkedin.ultimaBuscaSemCandidato.execucaoId }} · {{ canais.linkedin.ultimaBuscaSemCandidato.slot.replace('T', ' ') }} (hora do pedido em São Paulo)</span>
          </p>
          <a href="https://www.linkedin.com/messaging/?inboxType=SECONDARY" target="_blank" rel="noopener">Conferir respostas em Outros ↗</a>
          <details v-if="canais.linkedin.contatos.length">
            <summary>Contatos e evidências do LinkedIn</summary>
            <details v-for="contato in canais.linkedin.contatos" :key="contato.id" class="canais__contato">
              <summary>{{ contato.nome }} · {{ contato.empresa }} · {{ estadoDoContato[contato.estado] }}</summary>
              <p>Reserva em {{ dataHora(contato.reservadoEm) }} · {{ contato.id }}</p>
              <p v-if="contato.confirmadoEm">Envio observado em {{ dataHora(contato.confirmadoEm) }}. {{ contato.evidencia }}</p>
              <p v-if="contato.estado === 'incerto'">Conferir o resultado antes de qualquer ação. A reserva impede outro envio.</p>
              <p v-if="contato.bloqueio"><strong>Motivo do bloqueio</strong> {{ contato.bloqueio }}</p>
              <blockquote>{{ contato.mensagem }}</blockquote>
              <a v-if="contato.conversa" :href="contato.conversa" target="_blank" rel="noopener">Abrir conversa registrada ↗</a>
              <a v-else :href="contato.perfil" target="_blank" rel="noopener">Abrir perfil registrado ↗</a>
              <p>Atendimento com Rômulo pela conversa do LinkedIn.</p>
            </details>
          </details>
        </template>
      </section>
    </div>
  </section>
</template>

<style scoped>
.canais { display: grid; gap: var(--esp-3); }
.canais h2, .canais h3, .canais p { margin: 0; }
.canais__grade { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--esp-5); }
.canais__canal { display: grid; align-content: start; gap: var(--esp-2); border-top: var(--divisor); padding-top: var(--esp-3); overflow-wrap: anywhere; }
.canais dl { margin: 0; }
.canais dl div { display: flex; justify-content: space-between; flex-wrap: wrap; gap: var(--esp-1) var(--esp-3); padding-block: var(--esp-1); }
.canais dd { margin: 0; font-variant-numeric: tabular-nums; font-weight: var(--peso-forte); }
.canais__alerta { color: var(--texto); font-weight: var(--peso-forte); }
.canais summary { cursor: pointer; min-height: var(--toque); align-content: center; }
.canais__contato { padding-inline-start: var(--esp-2); }
@media (max-width: 48rem) { .canais__grade { grid-template-columns: 1fr; } }
</style>
