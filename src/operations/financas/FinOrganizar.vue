<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { brl, centavosDeReais, enviarJson, reaisDoCampo } from './formato'
import type { Organizacao } from './types'

// Organizar (07/10/2026): categorias (criar, renomear, juntar, remover),
// orçamento mensal de cada uma e as regras "aplicar sempre a este
// estabelecimento". Tudo é gesto do Rômulo e grava por POST da mesma origem
// (RULES 10); o servidor refaz as categorias e confere os alertas de
// 70/90/100% depois de cada um. O extrato de reserva morava aqui até
// 16/10/2026 (OT-11): agora entra pelo "Importar" único da Visão, junto da fatura.
const props = defineProps<{ versao: number }>()
const emit = defineEmits<{ mudou: [] }>()

const dados = ref<Organizacao | null>(null)
const erro = ref('')
const anuncio = ref('')
const ocupado = ref(false)
const nova = ref('')
const orcamentos = ref<Record<string, string>>({})
const renomeando = ref('')
const novoNome = ref('')

async function carregar() {
  erro.value = ''
  try {
    const resposta = await fetch('/api/financas/organizacao')
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    dados.value = corpo
    orcamentos.value = Object.fromEntries(corpo.categorias.map((c: Organizacao['categorias'][number]) => [c.nome, reaisDoCampo(c.orcamentoCentavos)]))
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  }
}

async function gesto(feito: string, acao: () => Promise<unknown>) {
  ocupado.value = true
  erro.value = ''
  anuncio.value = ''
  try {
    await acao()
    anuncio.value = feito
    emit('mudou')
    await carregar()
  } catch (e) {
    erro.value = e instanceof Error ? e.message : String(e)
  } finally {
    ocupado.value = false
  }
}

function criar() {
  const nome = nova.value.trim()
  if (!nome) return
  void gesto(`Categoria "${nome}" criada.`, async () => {
    await enviarJson('POST', '/categorias', { nome })
    nova.value = ''
  })
}

function salvarOrcamento(categoria: string) {
  const texto = (orcamentos.value[categoria] ?? '').trim()
  const centavos = texto ? centavosDeReais(texto) : null
  if (texto && centavos === null) {
    erro.value = `Orçamento de ${categoria}: escreva em reais, como 500 ou 1.200,50.`
    return
  }
  void gesto(centavos === null ? `Orçamento de ${categoria} tirado.` : `Orçamento de ${categoria} salvo.`, () =>
    enviarJson('PUT', '/orcamento', { categoria, centavos }),
  )
}

function comecarRenome(nome: string) {
  renomeando.value = nome
  novoNome.value = nome
}

function renomear(de: string) {
  const para = novoNome.value.trim()
  if (!para || para === de) {
    renomeando.value = ''
    return
  }
  const juntar = dados.value?.categorias.some((c) => c.nome !== de && c.nome.toLowerCase() === para.toLowerCase())
  if (juntar && !window.confirm(`"${para}" já existe. Juntar "${de}" nela? Os lançamentos, as regras e o orçamento passam para "${para}".`)) return
  void gesto(juntar ? `"${de}" juntada em "${para}".` : `"${de}" agora é "${para}".`, async () => {
    await enviarJson('POST', '/categorias/renomear', { de, para })
    renomeando.value = ''
  })
}

function remover(nome: string, lancamentos: number) {
  const aviso = lancamentos ? `Os ${lancamentos} lançamento(s) de "${nome}" vão para "Outros".` : ''
  if (!window.confirm(`Remover a categoria "${nome}"? ${aviso}`)) return
  void gesto(`"${nome}" removida.`, () => enviarJson('POST', '/categorias/remover', { nome }))
}

function tirarRegra(estabelecimento: string) {
  void gesto('Regra tirada. Os lançamentos voltam para a categoria automática.', () => enviarJson('POST', '/regras/remover', { estabelecimento }))
}

watch(() => props.versao, () => void carregar())
onMounted(() => void carregar())
</script>

<template>
  <div class="fin-blocos">
    <p class="fin-anuncio fin-bloco--largo" role="status" aria-live="polite">{{ anuncio }}</p>
    <p v-if="erro" class="fin-aviso is-forte fin-bloco--largo" role="alert">{{ erro }}</p>

    <section class="fin-bloco fin-bloco--largo" aria-labelledby="fin-categorias">
      <header class="fin-bloco__topo">
        <h2 id="fin-categorias">Categorias e orçamento</h2>
        <p class="fin-sub">O orçamento é por mês e conta as compras no mês da fatura. Passou de 70, 90 e 100%, chega um aviso no WhatsApp só com a %.</p>
      </header>
      <form class="fin-linha-form" @submit.prevent="criar">
        <label>Nova categoria <input v-model="nova" maxlength="40" :disabled="ocupado" /></label>
        <button type="submit" class="fin-botao" :disabled="ocupado || !nova.trim()">Criar</button>
      </form>
      <p v-if="!dados" class="fin-sub" role="status">Carregando…</p>
      <ul v-else class="fin-org">
        <li v-for="c in dados.categorias" :key="c.nome">
          <div class="fin-org__nome">
            <template v-if="renomeando === c.nome">
              <form class="fin-linha-form" @submit.prevent="renomear(c.nome)">
                <label class="fin-oculto-visual" :for="`renome-${c.nome}`">Novo nome de {{ c.nome }}</label>
                <input :id="`renome-${c.nome}`" v-model="novoNome" maxlength="40" :disabled="ocupado" />
                <button type="submit" class="fin-botao" :disabled="ocupado">Salvar</button>
                <button type="button" class="fin-botao" @click="renomeando = ''">Cancelar</button>
              </form>
            </template>
            <template v-else>
              <b>{{ c.nome }}</b>
              <small>{{ c.lancamentos }} lançamento(s)<template v-if="c.fixa && c.nome !== 'Outros'"> · vem da natureza do lançamento</template></small>
            </template>
          </div>
          <form v-if="!c.fixa || c.nome === 'Outros'" class="fin-linha-form fin-org__orcamento" @submit.prevent="salvarOrcamento(c.nome)">
            <label>Orçamento/mês (R$)
              <input v-model="orcamentos[c.nome]" inputmode="decimal" placeholder="sem" :disabled="ocupado" />
            </label>
            <button type="submit" class="fin-botao" :disabled="ocupado">Salvar</button>
            <small v-if="c.orcamentoCentavos">agora: {{ brl(c.orcamentoCentavos) }}</small>
          </form>
          <div v-if="!c.fixa && renomeando !== c.nome" class="fin-acoes">
            <button type="button" class="fin-botao" :disabled="ocupado" @click="comecarRenome(c.nome)">Renomear</button>
            <button type="button" class="fin-botao" :disabled="ocupado" @click="remover(c.nome, c.lancamentos)">Remover</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="fin-bloco" aria-labelledby="fin-regras">
      <header class="fin-bloco__topo">
        <h2 id="fin-regras">Regras por estabelecimento</h2>
        <p class="fin-sub">Nascem quando você corrige um lançamento e marca "aplicar sempre a este estabelecimento". Valem para os lançamentos novos e os antigos, menos os que você mudou à mão.</p>
      </header>
      <p v-if="dados && !dados.regras.length" class="fin-vazio">Nenhuma regra ainda. Corrija a categoria de um lançamento em Lançamentos.</p>
      <ul v-else-if="dados" class="fin-linhas">
        <li v-for="r in dados.regras" :key="r.estabelecimento">
          <span><b>{{ r.estabelecimento }}</b><small>→ {{ r.categoria }} · {{ r.lancamentos }} lançamento(s)</small></span>
          <button type="button" class="fin-botao" :disabled="ocupado" @click="tirarRegra(r.estabelecimento)">Tirar</button>
        </li>
      </ul>
    </section>

  </div>
</template>
