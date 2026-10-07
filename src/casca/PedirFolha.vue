<script setup lang="ts">
/**
 * Folha Pedir (o ＋ central da barra; era a CommandBar fixa no rodapé). Manda
 * o MESMO corpo de antes a /api/orquestrar — `demanda`, `modo` e o `squadId`
 * da squad ativa — pelo `handleDelegation` do estado, com as mesmas guardas.
 *
 * A folha pode fechar com o pedido rodando: o turno continua (até ~6 min com
 * redirecionamento), o topo diz "Pedido em andamento" e o fim chega num aviso.
 * Reaberta, ela mostra o último pedido: o que foi marcado e cada erro ou aviso
 * por extenso (antes eram `alert()`, que no celular some sem deixar rastro).
 */
import { computed, ref } from 'vue'
import Sheet from '../components/Sheet.vue'
import { useAgentes } from '../agentes/estado'
import { useDitado } from './ditado'
import type { Modo } from '../types'

const emit = defineEmits<{ fechar: [] }>()
const ag = useAgentes()

const demanda = ref('')
// Auto por padrão: o modelo escolhe o tipo de cada compromisso. Focar Agora e
// Baixa Prioridade são o usuário dizendo QUANDO quer o bloco para a demanda
// inteira — o servidor impõe isso mesmo que o modelo divirja.
const modo = ref<Modo>('auto')

const MODOS: { valor: Modo; rotulo: string; dica: string }[] = [
  { valor: 'auto', rotulo: 'Auto', dica: 'A squad decide entre bloco e prazo; o servidor escolhe o horário.' },
  { valor: 'foco', rotulo: 'Foco', dica: 'Próximo horário livre a partir de agora, na janela de trabalho.' },
  { valor: 'baixa_prioridade', rotulo: 'Baixa', dica: 'Encaixa onde sobrar até o 7º dia útil.' }
]
const dicaDoModo = computed(() => MODOS.find((m) => m.valor === modo.value)?.dica ?? '')

const ditado = useDitado((texto) => {
  demanda.value = demanda.value.trim() ? `${demanda.value.trim()} ${texto}` : texto
})

const squads = computed(() => ag.roster.value?.squads ?? [])
const motivoBloqueio = computed(() => {
  if (ag.isLoading.value) return 'Um pedido está em andamento. Espere a resposta para mandar outro.'
  if (ag.modalAberto.value) return 'Feche a outra folha antes de pedir.'
  if (!ag.squadAtiva.value) return ag.erroRoster.value ? `Sem squads: ${ag.erroRoster.value}` : 'Carregando as squads…'
  return ''
})
const podeEnviar = computed(() => !motivoBloqueio.value && demanda.value.trim() !== '')

const enviar = () => {
  if (!podeEnviar.value) return
  ditado.parar()
  void ag.handleDelegation({ demanda: demanda.value, modo: modo.value })
  demanda.value = ''
  // Forçar tipo vale para UMA demanda: um modo esquecido ligado forçaria a
  // próxima, que o usuário pensou em modo livre.
  modo.value = 'auto'
}

/** Enter manda; Shift+Enter quebra linha (o campo é de várias linhas no celular). */
const aoTeclar = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    enviar()
  }
}

const trocarSquad = (id: string) => void ag.trocarSquad(id)
const reusar = () => {
  const p = ag.ultimoPedido.value
  if (!p) return
  demanda.value = p.demanda
  modo.value = p.modo
}

const ROTULO_DO_MODO: Record<Modo, string> = { auto: 'Auto', foco: 'Foco', baixa_prioridade: 'Baixa prioridade' }
</script>

<template>
  <Sheet titulo="Pedir" subtitulo="Diga o que precisa; a squad marca na agenda." @fechar="emit('fechar')">
    <form id="form-pedir" class="pedir" @submit.prevent="enviar">
      <!-- Chip da squad: o pedido vai para ela (squadId), e trocar daqui troca a squad ativa da aba. -->
      <label class="pedir__squad">
        <span>Squad</span>
        <select
          class="pedir__chip"
          :value="ag.squadAtiva.value?.id ?? ''"
          :disabled="ag.isLoading.value || !squads.length"
          @change="trocarSquad(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="s in squads" :key="s.id" :value="s.id">{{ s.nome }}</option>
        </select>
      </label>

      <label class="rotulo">
        O que você precisa?
        <textarea
          v-model="demanda"
          class="campo"
          rows="3"
          maxlength="2000"
          placeholder="Ex.: revisar o contrato da Ana até sexta"
          data-autofocus
          @keydown="aoTeclar"
        ></textarea>
      </label>

      <div class="pedir__linha">
        <div class="segmentado pedir__modos" role="group" aria-label="Quando marcar">
          <button
            v-for="m in MODOS"
            :key="m.valor"
            type="button"
            :aria-pressed="modo === m.valor"
            @click="modo = m.valor"
          >
            {{ m.rotulo }}
          </button>
        </div>
        <button
          type="button"
          class="botao pedir__mic"
          :aria-pressed="ditado.ouvindo.value"
          :disabled="!ditado.suportado"
          @click="ditado.alternar"
        >
          {{ ditado.ouvindo.value ? 'Parar' : 'Ditar' }}<span aria-hidden="true"> 🎙</span>
        </button>
      </div>
      <p class="texto-2 texto-pequeno">{{ ROTULO_DO_MODO[modo] }}: {{ dicaDoModo }}</p>

      <p v-if="!ditado.suportado" class="texto-2 texto-pequeno">Ditado indisponível neste navegador; digite o pedido.</p>
      <p v-else-if="ditado.ouvindo.value" class="recado recado--atencao" role="status">
        Ouvindo… {{ ditado.parcial.value }} <small>(o navegador transcreve pelo serviço de voz dele)</small>
      </p>
      <p v-if="ditado.erro.value" class="recado recado--erro" role="alert">{{ ditado.erro.value }}</p>

      <p v-if="motivoBloqueio" class="texto-2 texto-pequeno" role="status">{{ motivoBloqueio }}</p>
    </form>

    <!-- O último pedido: por extenso, até o próximo. -->
    <section v-if="ag.ultimoPedido.value" class="pedir__resultado" aria-labelledby="pedir-ultimo" aria-live="polite">
      <h3 id="pedir-ultimo">
        {{ ag.ultimoPedido.value.estado === 'rodando' ? 'Processando o pedido…' : ag.ultimoPedido.value.estado === 'erro' ? 'O pedido não foi processado' : 'Pedido feito' }}
      </h3>
      <p class="texto-2 texto-pequeno">
        “{{ ag.ultimoPedido.value.demanda }}” · squad {{ ag.ultimoPedido.value.squadNome }} · {{ ROTULO_DO_MODO[ag.ultimoPedido.value.modo] }}
      </p>
      <p v-if="ag.ultimoPedido.value.estado === 'rodando'" class="texto-pequeno">
        Pode levar alguns minutos. Pode fechar esta folha: o resultado aparece aqui e num aviso.
      </p>
      <template v-else>
        <ul v-if="ag.ultimoPedido.value.linhas.length" class="pedir__linhas">
          <li v-for="(l, i) in ag.ultimoPedido.value.linhas" :key="i">{{ l }}</li>
        </ul>
        <p v-else-if="ag.ultimoPedido.value.estado === 'feito'" class="texto-pequeno">Nada foi marcado na agenda.</p>
        <p v-if="ag.ultimoPedido.value.propostas" class="texto-pequeno">
          {{ ag.ultimoPedido.value.propostas }} proposta(s) esperando você em Hoje.
        </p>
        <ul v-if="ag.ultimoPedido.value.problemas.length" class="pedir__problemas">
          <li v-for="(p, i) in ag.ultimoPedido.value.problemas" :key="i" class="recado" :class="ag.ultimoPedido.value.estado === 'erro' ? 'recado--erro' : 'recado--atencao'">{{ p }}</li>
        </ul>
        <button v-if="ag.ultimoPedido.value.estado === 'erro'" type="button" class="botao botao--leve" @click="reusar">Usar o texto de novo</button>
      </template>
    </section>

    <template #rodape>
      <button type="submit" form="form-pedir" class="botao botao--primario" :disabled="!podeEnviar">
        {{ ag.isLoading.value ? 'Pedido em andamento…' : 'Enviar' }}
      </button>
    </template>
  </Sheet>
</template>

<style>
.pedir { display: grid; gap: var(--esp-3); }
.pedir__squad { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); font-size: 0.8rem; font-weight: 900; }
.pedir__chip {
  min-height: 44px;
  max-width: 100%;
  padding: 0 var(--esp-3);
  border: var(--linha-fina);
  border-radius: 999px;
  background: var(--destaque);
  color: var(--destaque-texto);
  font: inherit;
  font-size: 1rem;
  font-weight: 900;
}
.pedir__linha { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.pedir__modos { flex: 1 1 14rem; }
.pedir__mic { flex: 0 0 auto; }
.pedir__mic[aria-pressed="true"] { background: var(--erro-fundo); }
.pedir__resultado { display: grid; gap: var(--esp-2); padding: var(--esp-3); border: var(--linha-fina); background: var(--superficie-2); }
.pedir__resultado h3 { margin: 0; font-size: 1rem; font-weight: 900; }
.pedir__linhas, .pedir__problemas { display: grid; gap: var(--esp-1); margin: 0; padding: 0 0 0 var(--esp-4); }
.pedir__problemas { padding: 0; list-style: none; }
</style>
