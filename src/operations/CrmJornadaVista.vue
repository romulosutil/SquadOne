<script setup lang="ts">
import { computed } from 'vue'
import { ROTULO_DO_TRILHO, painelDaJornada } from './jornada'
import { ROTULO_DO_PRODUTO } from './crm-formato'
import type { CrmLead } from './types'

// Vista Jornada do CRM (?ver=jornada, 15/10/2026): o funil inteiro na ordem da jornada, com o
// que cada lead espera e de quem. Só lê; tocar num lead abre a Ficha.
const props = defineProps<{ leads: CrmLead[] }>()
const emit = defineEmits<{ abrir: [id: string] }>()

const painel = computed(() => painelDaJornada(props.leads))
const abertos = computed(() => painel.value.passos.filter((p) => p.passo.id !== 'ganho' && p.passo.id !== 'perdido'))
const fechados = computed(() => painel.value.passos.filter((p) => p.passo.id === 'ganho' || p.passo.id === 'perdido'))
const dias = (n?: number) => (n === undefined ? '' : n === 0 ? 'hoje' : `${n} dia${n === 1 ? '' : 's'}`)
</script>

<template>
  <section class="crm-jornada-vista" aria-labelledby="crm-jornada-titulo">
    <h2 id="crm-jornada-titulo" tabindex="-1">Jornada</h2>
    <p class="crm-muted">
      Cada lead no passo em que está, com o que ele espera. Com você: {{ painel.porQuem['você'] }} ·
      com o robô: {{ painel.porQuem['robô'] }} · esperando o dono: {{ painel.porQuem['o dono'] }}<template v-if="painel.parados">
      · <strong>{{ painel.parados }} parado{{ painel.parados === 1 ? '' : 's' }} com você</strong></template>.
      A ordem e as regras estão no guia <code>docs/referencia/jornada-do-cliente.md</code>.
    </p>

    <ol class="crm-jornada-vista__passos">
      <li v-for="p in abertos" :key="p.passo.id" class="crm-jornada-vista__passo" :class="{ 'is-vazio': !p.leads.length }">
        <header>
          <span class="crm-kicker">{{ ROTULO_DO_TRILHO[p.passo.trilho] }} · {{ p.passo.quem }}</span>
          <h3>{{ p.passo.nome }} <span class="crm-jornada-vista__n">{{ p.leads.length }}</span></h3>
          <p v-if="p.parados" class="crm-jornada-vista__parados">{{ p.parados }} parado{{ p.parados === 1 ? '' : 's' }} (há {{ p.passo.paradoApos }}+ dia{{ p.passo.paradoApos === 1 ? '' : 's' }})</p>
          <small class="crm-muted">Sai daqui: {{ p.passo.sai }}</small>
        </header>
        <ul v-if="p.leads.length">
          <li v-for="item in p.leads" :key="item.lead.id" :class="{ 'is-parado': item.parado }">
            <button type="button" @click="emit('abrir', item.lead.id)">
              <strong>{{ item.lead.empresa }}</strong>
              <span class="crm-muted">{{ ROTULO_DO_PRODUTO[item.lead.produto] }} · {{ item.lead.nicho }}<template v-if="item.lead.diasNaEtapa !== undefined"> · {{ dias(item.lead.diasNaEtapa) }} no passo</template></span>
              <span><template v-if="item.parado"><strong>Parado:</strong> </template>{{ item.proximo.acao }}</span>
            </button>
          </li>
        </ul>
      </li>
    </ol>

    <p class="crm-muted">
      <template v-for="(p, i) in fechados" :key="p.passo.id">{{ i ? ' · ' : '' }}{{ p.passo.nome }}: {{ p.leads.length }}</template>
      (a lista deles fica no Funil).
    </p>
  </section>
</template>
