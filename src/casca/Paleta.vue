<script lang="ts">
import type { LeadDaPaleta } from './paleta'

/**
 * Fora do `setup`: a paleta monta e desmonta a cada Ctrl+K, e reler o CRM inteiro a cada
 * abertura seria um GET pesado só para achar um nome. A leitura vale VALIDADE_DOS_LEADS_MS.
 */
let leadsLidos: { em: number; leads: LeadDaPaleta[] } | null = null
</script>

<script setup lang="ts">
/**
 * Paleta de comandos (Ctrl+K / ⌘K, a partir de 1024 px): ir a qualquer
 * destino ou aba, pedir, trocar de squad e, no Dell, abrir a Ficha de um lead
 * pelo nome (AC-23). Combobox com lista (padrão ARIA 1.2): o foco fica no
 * campo, as setas movem a opção ativa e Enter executa.
 */
import { computed, onMounted, ref, watch } from 'vue'
import Sheet from '../components/Sheet.vue'
import { ROTULO_DA_ETAPA, ROTULO_DO_PRODUTO } from '../operations/crm-formato'
import type { CrmVisao } from '../operations/types'
import { filtrarComandos, type Comando, type Perfil } from './destinos'
import { VALIDADE_DOS_LEADS_MS, comandosDeLeads } from './paleta'

const props = defineProps<{ comandos: Comando[]; perfil: Perfil }>()
const emit = defineEmits<{ fechar: []; executar: [comando: Comando] }>()

const termo = ref('')
const ativo = ref(0)
const leads = ref<LeadDaPaleta[]>(leadsLidos?.leads ?? [])
const leadsIndisponiveis = ref(false)
const lista = computed(() => [
  ...filtrarComandos(props.comandos, termo.value),
  ...comandosDeLeads(leads.value, termo.value, props.perfil),
])
watch(termo, () => { ativo.value = 0 })

/**
 * Só o nome da empresa, a oferta e a etapa saem do retrato: o resto do lead (telefone, mensagens,
 * notas) nem fica guardado aqui. Retrato fora do ar (`estado` diferente de `ok`) conta como falha:
 * uma lista vazia diria "nenhum lead com esse nome", o que não é verdade.
 */
async function lerLeads() {
  if (props.perfil !== 'operations') return
  if (leadsLidos && Date.now() - leadsLidos.em < VALIDADE_DOS_LEADS_MS) return
  try {
    const resposta = await fetch('/api/operations/crm', { cache: 'no-cache' })
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
    const corpo = await resposta.json() as Partial<CrmVisao>
    if (corpo.estado !== 'ok' || !Array.isArray(corpo.leads)) throw new Error('retrato indisponível')
    const lidos = corpo.leads.map<LeadDaPaleta>((l) => ({
      id: l.id,
      empresa: l.empresa,
      oferta: ROTULO_DO_PRODUTO[l.produto] ?? '',
      etapa: ROTULO_DA_ETAPA[l.etapa] ?? '',
    }))
    leadsLidos = { em: Date.now(), leads: lidos }
    leads.value = lidos
    leadsIndisponiveis.value = false
  } catch {
    // Os destinos continuam; o que estava em memória (se havia) ainda serve para achar o nome.
    leadsIndisponiveis.value = true
  }
}
onMounted(() => { void lerLeads() })

// Pelo índice, e não pelo id do comando: o id do lead pode ter qualquer caractere, e dois ids
// que só diferem neles virariam o mesmo id no DOM.
const idDa = (i: number) => `paleta-opcao-${i}`

function aoTeclar(e: KeyboardEvent) {
  const n = lista.value.length
  if (e.key === 'ArrowDown' && n) {
    e.preventDefault()
    ativo.value = (ativo.value + 1) % n
  } else if (e.key === 'ArrowUp' && n) {
    e.preventDefault()
    ativo.value = (ativo.value - 1 + n) % n
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const c = lista.value[ativo.value]
    if (c) emit('executar', c)
  }
}
</script>

<template>
  <Sheet titulo="Ir para…" subtitulo="Setas escolhem, Enter abre, Esc fecha." @fechar="emit('fechar')">
    <label class="rotulo">
      {{ perfil === 'operations' ? 'Buscar uma tela, uma ação ou um lead' : 'Buscar um destino ou ação' }}
      <input
        v-model="termo"
        class="campo"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-controls="paleta-lista"
        :aria-expanded="lista.length > 0"
        :aria-activedescendant="lista[ativo] ? idDa(ativo) : undefined"
        autocomplete="off"
        data-autofocus
        @keydown="aoTeclar"
      />
    </label>
    <ul id="paleta-lista" class="paleta" role="listbox" aria-label="Comandos">
      <li
        v-for="(c, i) in lista"
        :id="idDa(i)"
        :key="c.id"
        role="option"
        :aria-selected="i === ativo"
        class="paleta__item"
        @mousemove="ativo = i"
        @click="emit('executar', c)"
      >
        <strong>{{ c.rotulo }}</strong>
        <small>{{ c.dica }}</small>
      </li>
    </ul>
    <p v-if="!lista.length" class="texto-2" role="status">Nada com “{{ termo }}”.</p>
    <p v-if="leadsIndisponiveis" class="texto-2" role="status">Leads indisponíveis agora.</p>
  </Sheet>
</template>

<style>
.paleta { display: grid; gap: var(--esp-1); margin: 0; padding: 0; list-style: none; }
.paleta__item { display: grid; gap: var(--esp-0); min-height: var(--toque); padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); background: var(--superficie); cursor: pointer; }
.paleta__item small { color: var(--texto-2); }
.paleta__item[aria-selected="true"] { background: var(--destaque); color: var(--destaque-texto); }
.paleta__item[aria-selected="true"] small { color: inherit; }
</style>
