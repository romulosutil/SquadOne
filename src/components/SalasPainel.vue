<script setup lang="ts">
/**
 * Gestos por sala, FORA do canvas (spec Fase 2 §3.1). O GameMap segue com
 * pointer-events: none e sem eventos: um overlay isométrico teria de seguir
 * câmera, escala e projeção; botões aqui fazem o mesmo sem nada disso.
 * Só emite. Quem chama a API é o App.
 */
import type { Dominio, SquadView } from '../types'

const props = defineProps<{ squad: SquadView; totalArquivado: number; desabilitado: boolean }>()

const emit = defineEmits<{
  contratar: [dominioId: string]
  abrirSala: []
  substituirPo: [dominioId: string]
  editarPessoa: [pessoaId: string]
  arquivarPessoa: [pessoaId: string]
  editarDominio: [dominioId: string]
  arquivarDominio: [dominioId: string]
  abrirArquivo: []
}>()

/** dominios[0] nunca é arquivado: o PO dele é quem circula pelo escritório. */
const ehRaiz = (d: Dominio) => d.id === props.squad.dominios[0]?.id

const BOTAO =
  'border-2 border-black bg-white px-2 py-0.5 font-black text-xs uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-40'
const MINI = 'ml-1 font-black disabled:opacity-40'
</script>

<template>
  <section class="border-4 border-black bg-white shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] shrink-0">
    <div class="flex flex-wrap items-center justify-between gap-2 border-b-4 border-black bg-[#f4f0e6] px-3 py-2">
      <span class="font-black uppercase text-sm">🏢 Salas de {{ squad.nome }}</span>
      <div class="flex items-center gap-2">
        <button
          type="button"
          :class="BOTAO"
          :disabled="desabilitado || !squad.proximoSlot"
          :title="squad.proximoSlot ? 'Abrir um domínio novo no próximo slot livre' : 'As 9 salas estão ocupadas'"
          @click="emit('abrirSala')"
        >
          {{ squad.proximoSlot ? `+ Abrir sala (${squad.proximoSlot[0]},${squad.proximoSlot[1]})` : 'Escritório cheio' }}
        </button>
        <button type="button" :class="BOTAO" :disabled="desabilitado" @click="emit('abrirArquivo')">
          🗄 Arquivo ({{ totalArquivado }})
        </button>
      </div>
    </div>

    <ul class="divide-y-2 divide-black">
      <li v-for="d in squad.dominios" :key="d.id" class="flex flex-wrap items-center gap-2 px-3 py-2">
        <span class="font-black text-sm uppercase">{{ d.nome }}</span>
        <button type="button" :class="MINI" :disabled="desabilitado" title="Editar domínio" @click="emit('editarDominio', d.id)">✎</button>
        <button
          type="button"
          :class="MINI"
          :disabled="desabilitado || ehRaiz(d)"
          :title="ehRaiz(d) ? 'Sala raiz: o PO dela circula pelo escritório. Arquive a squad inteira ou substitua o PO.' : 'Arquivar domínio'"
          @click="emit('arquivarDominio', d.id)"
        >🗄</button>

        <span class="flex flex-wrap items-center gap-1 text-xs font-bold">
          <span class="border-2 border-black bg-[#ffdb58] px-1">
            {{ d.po.nome }} · {{ d.po.papel }}
            <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', d.po.id)">✎</button>
            <button type="button" :class="MINI" :disabled="desabilitado" title="Substituir PO (PO não se arquiva)" @click="emit('substituirPo', d.id)">⇄</button>
          </span>
          <span v-for="p in d.integrantes" :key="p.id" class="border-2 border-black px-1">
            {{ p.nome }} · {{ p.papel }}
            <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', p.id)">✎</button>
            <button type="button" :class="MINI" :disabled="desabilitado" title="Arquivar" @click="emit('arquivarPessoa', p.id)">🗄</button>
          </span>
        </span>

        <button type="button" :class="BOTAO + ' ml-auto'" :disabled="desabilitado" @click="emit('contratar', d.id)">+ Contratar</button>
      </li>
    </ul>
  </section>
</template>
