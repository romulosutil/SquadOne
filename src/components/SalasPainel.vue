<script setup lang="ts">
/**
 * Gestos por sala, FORA do canvas (spec Fase 2 §3.1). O GameMap segue com
 * pointer-events: none e sem eventos: um overlay isométrico teria de seguir
 * câmera, escala e projeção; botões aqui fazem o mesmo sem nada disso.
 * Só emite. Quem chama a API é o App.
 */
import { ref } from 'vue'
import type { Dominio, SquadView } from '../types'
import { trabalhadoresDaSala } from '../office/trabalhadores'

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

/**
 * Salas abertas, só em memória: 9 salas × ~10 pessoas em chips numa linha só
 * estouravam a largura e empurravam o mapa. Recolher é conforto da vista, não
 * preferência que precise sobreviver a um reload — por isso nada de localStorage.
 * Troca o Set inteiro em vez de mutar: a reatividade fica óbvia para quem lê.
 */
const expandidas = ref<Set<string>>(new Set())
const expandida = (d: Dominio) => expandidas.value.has(d.id)
function alternar(d: Dominio) {
  const proximas = new Set(expandidas.value)
  if (proximas.has(d.id)) proximas.delete(d.id)
  else proximas.add(d.id)
  expandidas.value = proximas
}

/** Com um integrante só, o toggle custaria o mesmo espaço que o chip: mostra direto. */
const precisaToggle = (d: Dominio) => d.integrantes.length > 1

const contagem = (d: Dominio) => {
  const n = 1 + d.integrantes.length
  return n === 1 ? '1 pessoa' : `${n} pessoas`
}

const rotulo = (p: { nome: string; papel: string }) => `${p.nome} · ${p.papel}`

/**
 * Fluxos do n8n e timers do Dell ligados a esta sala pelo catálogo versionado
 * (office/trabalhadores.ts). Só leitura e só aqui: o catálogo não entra no
 * prompt, e o estado de cada um (rodou, falhou) fica na Central, que lê o
 * status.json — mostrar saúde aqui sem essa fonte seria inventar (RULES 2).
 */
const automaticos = (d: Dominio) => trabalhadoresDaSala(d.id)

const BOTAO =
  'border-2 border-black bg-white px-2 py-0.5 font-black text-xs uppercase shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] disabled:opacity-40'
const MINI = 'ml-1 shrink-0 font-black disabled:opacity-40'
/** max-w + truncate: um papel longo não pode esticar o chip além da linha. */
const CHIP = 'inline-flex max-w-[16rem] items-center border-2 border-black px-1'
const TEXTO_CHIP = 'min-w-0 truncate'
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

    <!-- Rolagem própria: com 9 salas abertas o painel não empurra o mapa para fora da tela. -->
    <ul class="max-h-[40vh] overflow-y-auto divide-y-2 divide-black">
      <li v-for="d in squad.dominios" :key="d.id" class="px-3 py-2">
        <div class="flex flex-wrap items-center gap-2">
          <span class="max-w-[14rem] truncate font-black text-sm uppercase" :title="d.nome">{{ d.nome }}</span>
          <button type="button" :class="MINI" :disabled="desabilitado" title="Editar domínio" @click="emit('editarDominio', d.id)">✎</button>
          <button
            type="button"
            :class="MINI"
            :disabled="desabilitado || ehRaiz(d)"
            :title="ehRaiz(d) ? 'Sala raiz: o PO dela circula pelo escritório. Arquive a squad inteira ou substitua o PO.' : 'Arquivar domínio'"
            @click="emit('arquivarDominio', d.id)"
          >🗄</button>
          <span class="text-xs font-bold text-gray-600">{{ contagem(d) }}</span>

          <span class="flex min-w-0 flex-wrap items-center gap-1 text-xs font-bold">
            <!-- PO sempre à vista: é quem responde pela sala. -->
            <span :class="CHIP + ' bg-[#ffdb58]'">
              <span :class="TEXTO_CHIP" :title="rotulo(d.po)">{{ rotulo(d.po) }}</span>
              <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', d.po.id)">✎</button>
              <button type="button" :class="MINI" :disabled="desabilitado" title="Substituir PO (PO não se arquiva)" @click="emit('substituirPo', d.id)">⇄</button>
            </span>

            <span v-if="!precisaToggle(d) && d.integrantes[0]" :class="CHIP">
              <span :class="TEXTO_CHIP" :title="rotulo(d.integrantes[0])">{{ rotulo(d.integrantes[0]) }}</span>
              <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', d.integrantes[0].id)">✎</button>
              <button type="button" :class="MINI" :disabled="desabilitado" title="Arquivar" @click="emit('arquivarPessoa', d.integrantes[0].id)">🗄</button>
            </span>

            <!-- Não desabilita com o roster ocupado: abrir a lista não escreve nada. -->
            <button
              v-if="precisaToggle(d)"
              type="button"
              class="border-2 border-black bg-white px-1 font-black"
              :aria-expanded="expandida(d)"
              :aria-controls="`integrantes-${d.id}`"
              :aria-label="`${expandida(d) ? 'Ocultar' : 'Mostrar'} ${d.integrantes.length} integrantes de ${d.nome}`"
              @click="alternar(d)"
            >
              {{ expandida(d) ? `${d.integrantes.length} ▴` : `+${d.integrantes.length} ▾` }}
            </button>
          </span>

          <button type="button" :class="BOTAO + ' ml-auto'" :disabled="desabilitado" @click="emit('contratar', d.id)">+ Contratar</button>
        </div>

        <!-- Abaixo da linha e com flex-wrap: dez chips quebram linha, nunca rolam na horizontal. -->
        <ul
          v-if="precisaToggle(d) && expandida(d)"
          :id="`integrantes-${d.id}`"
          class="mt-2 flex flex-wrap gap-1 text-xs font-bold"
        >
          <li v-for="p in d.integrantes" :key="p.id" :class="CHIP">
            <span :class="TEXTO_CHIP" :title="rotulo(p)">{{ rotulo(p) }}</span>
            <button type="button" :class="MINI" :disabled="desabilitado" title="Editar treino" @click="emit('editarPessoa', p.id)">✎</button>
            <button type="button" :class="MINI" :disabled="desabilitado" title="Arquivar" @click="emit('arquivarPessoa', p.id)">🗄</button>
          </li>
        </ul>

        <p v-if="automaticos(d).length" class="mt-1 text-xs font-bold text-gray-700">
          <span class="font-black uppercase">Automáticos:</span>
          <template v-for="(t, i) in automaticos(d)" :key="t.id">
            {{ i ? ' · ' : ' ' }}<span :title="`${t.faz} (${t.onde})`">{{ t.nome }} ({{ t.quando }})</span>
          </template>
        </p>
      </li>
    </ul>
  </section>
</template>
