<script setup lang="ts">
/**
 * Arquivo da squad ativa + squads arquivadas (spec Fase 2 §3.5). Reativar
 * nunca é automático, e erro (409 "sem sala livre", pai arquivado) fica na
 * linha, com o modal aberto: o usuário decide o que arquivar para abrir espaço.
 */
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
const BOTAO = 'border-2 border-black bg-[#bbf7d0] px-2 py-0.5 font-black text-xs uppercase disabled:opacity-50'
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" @click.self="emit('fechar')">
    <div class="flex max-h-full w-full max-w-xl flex-col gap-3 overflow-y-auto border-4 border-black bg-white p-4 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)]">
      <h2 class="font-black text-xl uppercase">🗄 Arquivo</h2>
      <p class="text-xs font-bold opacity-70">
        Arquivar não apaga nada. Os eventos continuam no Google; ao reativar, os de um domínio voltam para a Mochila.
      </p>

      <h3 class="font-black text-sm uppercase">Salas arquivadas de {{ squad.nome }}</h3>
      <p v-if="!squad.arquivo.dominios.length" class="text-xs font-bold opacity-60">Nenhuma.</p>
      <div v-for="d in squad.arquivo.dominios" :key="d.id" class="flex flex-col gap-1 border-2 border-black p-2">
        <div class="flex items-center justify-between gap-2 text-sm font-bold">
          <span>{{ d.nome }} · {{ 1 + d.integrantes.length }} pessoa(s) · {{ data(d.arquivadoEm) }}</span>
          <button type="button" :class="BOTAO" :disabled="!!reativando" @click="emit('reativar', 'dominios', d.id)">
            {{ reativando === `dominios:${d.id}` ? '...' : 'Reativar' }}
          </button>
        </div>
        <p v-if="erros[`dominios:${d.id}`]" class="bg-[#ff9b71] px-1 text-xs font-bold">{{ erros[`dominios:${d.id}`] }}</p>
      </div>

      <h3 class="font-black text-sm uppercase">Pessoas arquivadas</h3>
      <p v-if="!squad.arquivo.integrantes.length" class="text-xs font-bold opacity-60">Nenhuma.</p>
      <div v-for="i in squad.arquivo.integrantes" :key="i.pessoa.id" class="flex flex-col gap-1 border-2 border-black p-2">
        <div class="flex items-center justify-between gap-2 text-sm font-bold">
          <span>{{ i.pessoa.nome }} · {{ i.pessoa.papel }} · sala {{ i.dominioNome }}</span>
          <button type="button" :class="BOTAO" :disabled="!!reativando" @click="emit('reativar', 'pessoas', i.pessoa.id)">
            {{ reativando === `pessoas:${i.pessoa.id}` ? '...' : 'Reativar' }}
          </button>
        </div>
        <p v-if="erros[`pessoas:${i.pessoa.id}`]" class="bg-[#ff9b71] px-1 text-xs font-bold">{{ erros[`pessoas:${i.pessoa.id}`] }}</p>
      </div>

      <h3 class="font-black text-sm uppercase">Squads arquivadas</h3>
      <p v-if="!squadsArquivadas.length" class="text-xs font-bold opacity-60">Nenhuma.</p>
      <div v-for="s in squadsArquivadas" :key="s.id" class="flex flex-col gap-1 border-2 border-black p-2">
        <div class="flex items-center justify-between gap-2 text-sm font-bold">
          <span>{{ s.nome }} · {{ s.escopo }}</span>
          <button type="button" :class="BOTAO" :disabled="!!reativando" @click="emit('reativar', 'squads', s.id)">
            {{ reativando === `squads:${s.id}` ? '...' : 'Reativar' }}
          </button>
        </div>
        <p v-if="erros[`squads:${s.id}`]" class="bg-[#ff9b71] px-1 text-xs font-bold">{{ erros[`squads:${s.id}`] }}</p>
      </div>

      <div class="flex justify-end">
        <button type="button" class="border-4 border-black bg-white px-3 py-1 font-black text-xs uppercase" @click="emit('fechar')">Fechar</button>
      </div>
    </div>
  </div>
</template>
