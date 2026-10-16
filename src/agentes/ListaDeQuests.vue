<script setup lang="ts">
/**
 * Compromissos dos agentes (o que era a Mochila): "próximos 3" na Hoje e a
 * lista inteira na Agenda. Tudo vem de GET /api/mochila, ou seja, do Google
 * Calendar — apagar o evento no Google some com ele na próxima leitura.
 *
 * `todas` é a lista lida inteira e `itens` o recorte desenhado: "Bloco i/N" e
 * o prazo de um bloco se contam pela lista inteira, senão o 2/3 renumeraria
 * quando um bloco sai da vista.
 */
import type { QuestCalendario } from '../types'
import { diasDoEventoDiaInteiro, infoDePrazo } from '../mochila'
import { alvoDeAjuste, formatarMinutos } from '../contribuicao'

const props = defineProps<{
  itens: QuestCalendario[]
  todas: QuestCalendario[]
  nomesDeDominio: Record<string, string>
  nomesDePessoa: Record<string, string>
  /** Ajuste em curso ou turno rodando: um por vez, como no cartão. */
  ajustando: boolean
}>()

const emit = defineEmits<{ ajustar: [quest: QuestCalendario] }>()

// O botão só aparece onde o servidor aceitaria o ajuste (bloco com horário ou
// marco de prazo): oferecê-lo num foco de dia inteiro abriria um cartão que só
// serviria para virar 409 `alvoIncompativel`.
const rotuloDeAjuste = (quest: QuestCalendario) => {
  const alvo = alvoDeAjuste(quest)
  if (!alvo) return ''
  return alvo === 'duracao' ? 'Ajustar horário' : 'Ajustar esforço'
}

const dia = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
const hora = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' })

const quando = (quest: QuestCalendario) => {
  if (quest.diaInteiro) {
    // `fim` do Google é exclusivo e "AAAA-MM-DD" puro viraria UTC (dia anterior
    // em -03:00): o helper devolve datas locais. Vários dias mostram o
    // intervalo, não só o início.
    const { primeiro, ultimo } = diasDoEventoDiaInteiro(quest.inicio, quest.fim)
    return ultimo.getTime() === primeiro.getTime() ? `${dia.format(primeiro)}, dia inteiro` : `${dia.format(primeiro)} – ${dia.format(ultimo)}`
  }
  if (quest.tipo === 'deadline') return `prazo ${dia.format(new Date(quest.fim))} ${hora.format(new Date(quest.fim))}`
  return `${dia.format(new Date(quest.inicio))} ${hora.format(new Date(quest.inicio))}–${hora.format(new Date(quest.fim))}`
}

const duracao = (quest: QuestCalendario) =>
  Math.round((new Date(quest.fim).getTime() - new Date(quest.inicio).getTime()) / 60000)

// Bloco e marco se reconhecem pela lista lida, não por contador gravado:
// apagar um bloco no Google corrige o "2/3" na próxima leitura.
const tipo = (quest: QuestCalendario) => {
  const info = infoDePrazo(quest, props.todas)
  if (info.papel === 'bloco') return `Bloco ${info.posicao} de ${info.total}, ${formatarMinutos(duracao(quest))}`
  if (quest.tipo === 'deadline') return info.papel === 'marco' ? `Prazo · ${info.blocos} bloco(s) de trabalho` : 'Prazo'
  // Dia inteiro não tem duração em minutos que signifique algo: 1440 min é ruído.
  return quest.diaInteiro ? 'Foco no dia inteiro' : `Foco, ${formatarMinutos(duracao(quest))}`
}

const prazoDoBloco = (quest: QuestCalendario) => {
  const info = infoDePrazo(quest, props.todas)
  if (info.papel !== 'bloco') return ''
  return info.marco ? `Para o ${quando(info.marco)}` : 'Para um prazo fora da agenda lida'
}
</script>

<template>
  <ol class="quests">
    <li v-for="quest in itens" :key="quest.eventId" class="quest">
      <div class="quest__corpo">
        <h3 class="quest__titulo">
          <a :href="quest.htmlLink" target="_blank" rel="noopener noreferrer">{{ quest.titulo }}<span class="so-leitor"> (abre no Google Calendar)</span></a>
        </h3>
        <p class="quest__quando">{{ quando(quest) }}</p>
        <p class="quest__tipo">{{ tipo(quest) }}<template v-if="prazoDoBloco(quest)"> · {{ prazoDoBloco(quest) }}</template></p>
        <!-- As duas marcas do evento: domínio (filtro) e membro (responsável). -->
        <div class="selos">
          <span class="selo selo--forte">{{ nomesDePessoa[quest.membro] ?? (quest.membro || 'Sem responsável') }}</span>
          <span v-if="quest.dominio" class="selo">{{ nomesDeDominio[quest.dominio] ?? quest.dominio }}</span>
          <!-- A checklist vive no Google Tasks: o selo só mostra quanto dela já foi feito. -->
          <span v-if="quest.passos" class="selo" :class="quest.passos.feitos === quest.passos.total ? 'selo--ok' : 'selo--atencao'">
            Passos {{ quest.passos.feitos }} de {{ quest.passos.total }} no Google Tasks
          </span>
        </div>
      </div>
      <!-- Fora do <a>: botão dentro de link é clique ambíguo, e este gesto abre
           um cartão em vez de sair para o Google. -->
      <button v-if="rotuloDeAjuste(quest)" type="button" class="botao botao--leve" :disabled="ajustando" @click="emit('ajustar', quest)">
        {{ rotuloDeAjuste(quest) }}<span class="so-leitor">: {{ quest.titulo }}</span>
      </button>
    </li>
  </ol>
</template>

<style>
.quests { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.quest {
  display: grid;
  gap: var(--esp-2);
  padding: var(--esp-3);
  border: var(--linha-fina);
  background: var(--superficie);
}
.quest__corpo { display: grid; gap: var(--esp-1); min-width: 0; }
.quest__titulo { margin: 0; font-size: 1rem; font-weight: var(--peso-forte); line-height: 1.25; overflow-wrap: anywhere; }
.quest__titulo a { color: var(--texto); text-decoration: underline; text-underline-offset: 3px; }
.quest__quando { margin: 0; font-weight: var(--peso-medio); font-variant-numeric: tabular-nums; }
.quest__tipo { margin: 0; color: var(--texto-2); font-size: 0.85rem; }
@media (min-width: 40rem) {
  .quest { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
}
</style>
