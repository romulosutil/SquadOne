<script setup lang="ts">
/**
 * A Lista do Escritório: as salas da squad, uma embaixo da outra, com quem
 * trabalha em cada uma e os gestos de roster. É o padrão no celular e o
 * caminho acessível para tudo que o Mapa mostra (o Mapa é pixel art; a Lista é
 * texto). Só emite: quem chama a API é o estado dos agentes.
 */
import SalaCartao from './SalaCartao.vue'
import type { Dominio, SquadView } from '../types'
import type { EstadoDaPessoa } from '../casca/hoje'
import { trabalhadoresDaSala } from '../office/trabalhadores'

const props = defineProps<{
  squad: SquadView
  totalArquivado: number
  desabilitado: boolean
  estados: Record<string, { estado: EstadoDaPessoa; texto: string }>
}>()

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
const raizId = () => props.squad.dominios[0]?.id

/**
 * Fluxos do n8n e timers do Dell ligados a esta sala pelo catálogo versionado
 * (office/trabalhadores.ts). Só leitura e só aqui: o catálogo não entra no
 * prompt, e o estado de cada um (rodou, falhou) fica na Central, que lê o
 * status.json — mostrar saúde aqui sem essa fonte seria inventar (RULES 2).
 */
const automaticos = (d: Dominio) => trabalhadoresDaSala(d.id)
</script>

<template>
  <section class="salas" aria-label="Salas da squad">
    <div class="acoes">
      <button type="button" class="botao" :disabled="desabilitado || !squad.proximoSlot" @click="emit('abrirSala')">
        {{ squad.proximoSlot ? `Abrir sala (${squad.proximoSlot[0]},${squad.proximoSlot[1]})` : 'Escritório cheio: 9 salas' }}
      </button>
      <button type="button" class="botao" :disabled="desabilitado" @click="emit('abrirArquivo')">
        Arquivo ({{ totalArquivado }})
      </button>
    </div>
    <SalaCartao
      v-for="d in squad.dominios"
      :key="d.id"
      :dominio="d"
      :eh-raiz="d.id === raizId()"
      :desabilitado="desabilitado"
      :estados="estados"
      @contratar="emit('contratar', $event)"
      @substituir-po="emit('substituirPo', $event)"
      @editar-pessoa="emit('editarPessoa', $event)"
      @arquivar-pessoa="emit('arquivarPessoa', $event)"
      @editar-dominio="emit('editarDominio', $event)"
      @arquivar-dominio="emit('arquivarDominio', $event)"
    >
      <template v-if="automaticos(d).length" #rodape>
        <div class="automaticos">
          <h4>Automáticos desta sala</h4>
          <ul>
            <li v-for="t in automaticos(d)" :key="t.id">
              <strong>{{ t.nome }}</strong> <span class="texto-2">({{ t.quando }})</span>
              <small class="texto-2">{{ t.faz }} · {{ t.onde }}</small>
            </li>
          </ul>
        </div>
      </template>
    </SalaCartao>
  </section>
</template>

<style>
.salas { display: grid; gap: var(--esp-4); }
.automaticos { display: grid; gap: var(--esp-1); }
.automaticos h4 { margin: 0; font-size: 0.78rem; font-weight: 900; letter-spacing: 0.04em; text-transform: uppercase; }
.automaticos ul { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.automaticos li { display: grid; gap: 0.1rem; font-size: 0.88rem; }
.automaticos small { overflow-wrap: anywhere; }
</style>
