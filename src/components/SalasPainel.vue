<script setup lang="ts">
/**
 * A Lista do Escritório: as salas da squad, uma embaixo da outra, com quem
 * trabalha em cada uma e os gestos de roster. É o padrão no celular e o
 * caminho acessível para tudo que o Mapa mostra (o Mapa é pixel art; a Lista é
 * texto). Só emite: quem chama a API é o estado dos agentes.
 */
import SalaCartao from './SalaCartao.vue'
import SalaOperacao from './SalaOperacao.vue'
import type { SquadView } from '../types'
import type { EstadoDaPessoa } from '../casca/hoje'
import type { OperacaoDaSala } from '../office/operacao'

const props = defineProps<{
  squad: SquadView
  totalArquivado: number
  desabilitado: boolean
  estados: Record<string, { estado: EstadoDaPessoa; texto: string }>
  /**
   * A operação de cada sala (office/operacao.ts): leads por passo da jornada e
   * robôs com o estado do status.json. Só leitura; sala ausente não mostra nada.
   */
  operacoes: Record<string, OperacaoDaSala>
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
</script>

<template>
  <section class="salas" aria-label="Salas da squad">
    <div class="acoes">
      <!-- A coordenada da grade saiu do rótulo (AC-25): é do mapa, não diz nada a quem lê a lista. -->
      <button type="button" class="botao" :disabled="desabilitado || !squad.proximoSlot" @click="emit('abrirSala')">
        {{ squad.proximoSlot ? 'Abrir uma sala' : 'Escritório cheio: 9 salas' }}
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
      <template v-if="operacoes[d.id]" #rodape>
        <SalaOperacao :operacao="operacoes[d.id]" :nome-da-sala="d.nome" />
      </template>
    </SalaCartao>
  </section>
</template>

<style>
.salas { display: grid; gap: var(--esp-4); }
</style>
