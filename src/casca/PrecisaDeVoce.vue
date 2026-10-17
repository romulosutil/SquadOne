<script setup lang="ts">
/**
 * Os cartões do "precisa de você" (RULES 13): no máximo 3 à vista, o do Dell contando como um, e o
 * resto atrás de "Ver todos". Saiu da HojeRota em 17/10/2026 para a Hoje (perfil app) e a Central de
 * comando (perfil operations) mostrarem os mesmos cartões pela mesma regra; o título e o tom do
 * bloco ficam com cada tela, que é quem sabe o que dizer em cima deles.
 */
import { computed, ref } from 'vue'
import AjusteCard from '../components/AjusteCard.vue'
import GrowthCard from '../components/GrowthCard.vue'
import TrocaSquadCard from '../components/TrocaSquadCard.vue'
import DellAlerta from './DellAlerta.vue'
import FinancasAlerta from './FinancasAlerta.vue'
import { useAgentes } from '../agentes/estado'
import { MAX_NA_HOJE, type Pendencia } from './hoje'
import type { ResumoDoDell } from '../operations/alertas'
import type { PropostaDominio, PropostaIntegrante, PropostaTrocaSquad } from '../types'

const props = defineProps<{
  /** O resumo do Dell, só no perfil operations; o cartão aparece quando algo precisa do Rômulo. */
  dell: ResumoDoDell | null
  pendencias: Pendencia[]
}>()

const ag = useAgentes()
const { squadAtiva, isLoading, sugestoesDeTroca, sugestoesDeCrescimento, ajustes, aprovando, erroSugestao, aprovandoAjuste, erroAjuste, ajusteNaoCabe } = ag

const cartaoDoDell = computed(() => !!props.dell && !props.dell.semNoticia && props.dell.precisam.length > 0)
const verTodos = ref(false)
// RULES 13: o cartão do Dell conta como um dos 3.
const vagas = computed(() => MAX_NA_HOJE - (cartaoDoDell.value ? 1 : 0))
const mostradas = computed(() => (verTodos.value ? props.pendencias : props.pendencias.slice(0, vagas.value)))

const troca = (id: string) => sugestoesDeTroca.value.find((s) => s.id === id) as (PropostaTrocaSquad & { id: string }) | undefined
const ajuste = (id: string) => ajustes.value.find((a) => a.id === id)
const crescimento = (id: string) =>
  sugestoesDeCrescimento.value.find((s) => s.id === id) as ((PropostaDominio | PropostaIntegrante) & { id: string }) | undefined
const nomeSeOutraSquad = (squadId: string) => (squadId !== squadAtiva.value?.id ? ag.nomeDaSquad(squadId) : '')
</script>

<template>
  <ol v-if="cartaoDoDell || mostradas.length" class="hoje__cartoes">
    <li v-if="cartaoDoDell && dell"><DellAlerta :resumo="dell" /></li>
    <li v-for="p in mostradas" :key="p.chave">
      <FinancasAlerta v-if="p.tipo === 'financas'" :pendencia="p" />
      <TrocaSquadCard
        v-else-if="p.tipo === 'troca' && troca(p.id)"
        :sugestao="troca(p.id)!"
        :desabilitado="isLoading"
        @trocar="ag.aceitarTroca(p.id, false)"
        @reenviar="ag.aceitarTroca(p.id, true)"
        @descartar="ag.descartarSugestao(p.id)"
      />
      <!-- Ajuste: nada muda no Google sem este clique, e mover é um segundo clique. -->
      <AjusteCard
        v-else-if="p.tipo === 'ajuste' && ajuste(p.id)"
        :proposta="ajuste(p.id)!"
        :squad-nome="nomeSeOutraSquad(ajuste(p.id)!.squad_id)"
        :enviando="aprovandoAjuste === p.id"
        :erro="erroAjuste[p.id] || ''"
        :nao-cabe="!!ajusteNaoCabe[p.id]"
        @aprovar="(mover, min) => ag.aprovarAjuste(p.id, mover, min)"
        @descartar="ag.tirarAjuste(p.id)"
      />
      <!-- :key pelo id do servidor (no v-for acima): cada cartão tem seu próprio
           nome digitado; por índice, o seguinte herdava o nome depois de um descarte. -->
      <GrowthCard
        v-else-if="p.tipo === 'crescimento' && crescimento(p.id)"
        :sugestao="crescimento(p.id)!"
        :squad-nome="nomeSeOutraSquad(crescimento(p.id)!.squad_id)"
        :enviando="aprovando === p.id"
        :erro="erroSugestao[p.id] || ''"
        @aprovar="(nome) => ag.aprovarSugestao(p.id, nome)"
        @descartar="ag.descartarSugestao(p.id)"
        @ajustar="ag.ajustarSugestao(p.id)"
      />
    </li>
  </ol>
  <button
    v-if="pendencias.length > vagas"
    type="button"
    class="botao botao--leve botao--largo"
    :aria-expanded="verTodos"
    @click="verTodos = !verTodos"
  >
    {{ verTodos ? 'Mostrar menos' : `Ver todos os ${pendencias.length} cartões` }}
  </button>
</template>

<style>
.hoje__cartoes { display: grid; gap: var(--esp-3); margin: 0; padding: 0; list-style: none; }
</style>
