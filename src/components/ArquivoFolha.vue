<script setup lang="ts">
/**
 * Arquivo da squad ativa + squads arquivadas (spec Fase 2 §3.5). Reativar
 * nunca é automático, e erro (409 "sem sala livre", pai arquivado) fica na
 * linha, com a folha aberta: o usuário decide o que arquivar para abrir espaço.
 */
import Sheet from './Sheet.vue'
import type { SquadView } from '../types'
import type { TipoDoRoster } from '../rosterApi'

defineProps<{
  squad: SquadView
  squadsArquivadas: SquadView[]
  /** `${tipo}:${id}` em curso; vazio = nenhum. */
  reativando: string
  erros: Record<string, string>
}>()

const emit = defineEmits<{ reativar: [tipo: TipoDoRoster, id: string]; fechar: [] }>()

const data = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '')
</script>

<template>
  <!-- Com uma reativação em curso nada fecha a folha: a recusa (409) precisa de onde aparecer. -->
  <Sheet
    titulo="Arquivo"
    subtitulo="Arquivar não apaga nada. Os eventos continuam no Google; ao reativar, os de um domínio voltam para a agenda."
    :bloqueada="!!reativando"
    @fechar="emit('fechar')"
  >
    <section class="arquivo-grupo" aria-labelledby="arquivo-salas">
      <h3 id="arquivo-salas">Salas arquivadas de {{ squad.nome }}</h3>
      <p v-if="!squad.arquivo.dominios.length" class="texto-2">Nenhuma.</p>
      <ul v-else>
        <li v-for="d in squad.arquivo.dominios" :key="d.id">
          <span>{{ d.nome }} · {{ 1 + d.integrantes.length }} pessoa(s) · arquivada em {{ data(d.arquivadoEm) }}</span>
          <button type="button" class="botao botao--leve" :disabled="!!reativando" @click="emit('reativar', 'dominios', d.id)">
            {{ reativando === `dominios:${d.id}` ? 'Reativando…' : 'Reativar' }}<span class="so-leitor"> a sala {{ d.nome }}</span>
          </button>
          <p v-if="erros[`dominios:${d.id}`]" class="recado recado--erro" role="alert">{{ erros[`dominios:${d.id}`] }}</p>
        </li>
      </ul>
    </section>

    <section class="arquivo-grupo" aria-labelledby="arquivo-pessoas">
      <h3 id="arquivo-pessoas">Pessoas arquivadas</h3>
      <p v-if="!squad.arquivo.integrantes.length" class="texto-2">Nenhuma.</p>
      <ul v-else>
        <li v-for="i in squad.arquivo.integrantes" :key="i.pessoa.id">
          <span>{{ i.pessoa.nome }} · {{ i.pessoa.papel }} · sala {{ i.dominioNome }}</span>
          <button type="button" class="botao botao--leve" :disabled="!!reativando" @click="emit('reativar', 'pessoas', i.pessoa.id)">
            {{ reativando === `pessoas:${i.pessoa.id}` ? 'Reativando…' : 'Reativar' }}<span class="so-leitor">{{ ` ${i.pessoa.nome}` }}</span>
          </button>
          <p v-if="erros[`pessoas:${i.pessoa.id}`]" class="recado recado--erro" role="alert">{{ erros[`pessoas:${i.pessoa.id}`] }}</p>
        </li>
      </ul>
    </section>

    <section class="arquivo-grupo" aria-labelledby="arquivo-squads">
      <h3 id="arquivo-squads">Squads arquivadas</h3>
      <p v-if="!squadsArquivadas.length" class="texto-2">Nenhuma.</p>
      <ul v-else>
        <li v-for="s in squadsArquivadas" :key="s.id">
          <span>{{ s.nome }} · {{ s.escopo }}</span>
          <button type="button" class="botao botao--leve" :disabled="!!reativando" @click="emit('reativar', 'squads', s.id)">
            {{ reativando === `squads:${s.id}` ? 'Reativando…' : 'Reativar' }}<span class="so-leitor"> a squad {{ s.nome }}</span>
          </button>
          <p v-if="erros[`squads:${s.id}`]" class="recado recado--erro" role="alert">{{ erros[`squads:${s.id}`] }}</p>
        </li>
      </ul>
    </section>
  </Sheet>
</template>

<style>
.arquivo-grupo { display: grid; gap: var(--esp-2); }
.arquivo-grupo h3 { margin: 0; font-size: 0.85rem; font-weight: var(--peso-forte); letter-spacing: 0.04em; text-transform: uppercase; }
.arquivo-grupo ul { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.arquivo-grupo li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--esp-2); align-items: center; padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); }
.arquivo-grupo li span { overflow-wrap: anywhere; font-weight: var(--peso-medio); }
.arquivo-grupo li .recado { grid-column: 1 / -1; }
</style>
