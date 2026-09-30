<script setup lang="ts">
import { computed } from 'vue'
import { ROTULO_DO_GRUPO, grupoDoAlerta, linkExterno, remedioEmComum, separarAlertas, soNoDell } from './alertas'
import type { DellCheck, DellStatus } from './types'

// Topo da home: o que precisa do Rômulo agora e o que fazer com cada alerta.
// Tudo vem do retrato do dell-status (RULES 19); o texto de "o que fazer" é
// escrito lá, junto de cada verificação. O que resolve sozinho fica fechado.
const props = defineProps<{ status: DellStatus | null; loading: boolean; error: string }>()

const alertas = computed(() => separarAlertas(props.status?.verificacoes ?? []))
const precisam = computed(() => [...alertas.value.falhas, ...alertas.value.fila, ...alertas.value.olhar])
const emComum = computed(() => remedioEmComum(alertas.value.falhas))

const titulo = computed(() => {
  if (props.error) return 'Não consegui ler o estado do Dell'
  if (!props.status) return props.loading ? 'Conferindo o Dell…' : 'Sem leitura do Dell'
  const n = precisam.value.length
  if (n) return `${n} ${n === 1 ? 'coisa precisa' : 'coisas precisam'} de você`
  // Sem retrato do monitor não há como afirmar que está tudo bem (RULES 2).
  if (!props.status.geradoEm) return 'Ainda sem leitura do Dell'
  return 'Nada precisa de você agora'
})
const resumo = computed(() => {
  if (props.error) return props.error
  if (!props.status) return ''
  const { falhas, fila, olhar, sozinhos } = alertas.value
  const partes = [
    falhas.length ? `${falhas.length} ${falhas.length === 1 ? 'falhou' : 'falharam'}` : '',
    fila.length ? `${fila.length} na sua fila` : '',
    olhar.length ? `${olhar.length} para olhar` : '',
  ].filter(Boolean)
  const aviso = falhas.length ? ' O Hermes já avisou no WhatsApp.' : ''
  const sozinho = sozinhos.length ? ` ${sozinhos.length} ${sozinhos.length === 1 ? 'resolve' : 'resolvem'} sozinho${sozinhos.length === 1 ? '' : 's'}.` : ''
  return partes.length ? `${partes.join(' · ')}.${aviso}${sozinho}` : `Serviços, fluxos e rotinas respondendo.${sozinho}`
})
const tom = computed(() => props.error || alertas.value.falhas.length ? 'falha'
  : !props.status || precisam.value.length ? 'atencao' : 'ok')
const quando = computed(() => props.status?.geradoEm
  ? `conferido às ${new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(props.status.geradoEm))}`
  : '')
const desde = (c: DellCheck) => c.desde
  ? ` · desde ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(c.desde))}`
  : ''
const rotuloDoLink = (c: DellCheck) => !c.link ? '' : soNoDell(c.link) ? 'Abrir no Dell'
  : c.link.includes('docs.google.com/spreadsheets') ? 'Planilha' : 'Abrir'
</script>

<template>
  <section class="ops-panel dell-status precisa" :class="`is-${tom}`" aria-labelledby="precisa-title">
    <div class="dell-status__hero" role="status" aria-live="polite">
      <span class="dell-status__sinal" aria-hidden="true">{{ tom === 'ok' ? '✓' : tom === 'falha' ? '!' : '…' }}</span>
      <div>
        <h1 id="precisa-title">{{ titulo }}</h1>
        <p v-if="resumo">{{ resumo }}</p>
      </div>
      <small v-if="quando">{{ quando }}</small>
    </div>

    <p v-if="emComum" class="precisa__comum"><strong>{{ emComum.quantas }} falhas, um gesto só:</strong> {{ emComum.texto }}</p>

    <ol v-if="precisam.length" class="precisa__lista">
      <li v-for="c in precisam" :key="c.id" class="precisa__item" :class="`is-${grupoDoAlerta(c)}`">
        <p class="precisa__selo"><span class="dell-dot" :class="`is-${c.estado}`" aria-hidden="true" />{{ ROTULO_DO_GRUPO[grupoDoAlerta(c)] }}</p>
        <h2>{{ c.nome }}</h2>
        <p class="precisa__fazer"><strong>O que fazer:</strong> {{ c.oQueFazer ?? 'Veja o detalhe; se não souber o que fazer, peça ao Claude.' }}</p>
        <p class="precisa__detalhe">{{ c.detalhe }}{{ desde(c) }}</p>
        <div v-if="c.acao || c.link" class="precisa__acoes">
          <a v-if="c.acao" class="precisa__acao" :href="c.acao.url" :target="linkExterno(c.acao.url) ? '_blank' : undefined" :rel="linkExterno(c.acao.url) ? 'noopener' : undefined">{{ c.acao.rotulo }}<span class="ops-visually-hidden">: {{ c.nome }}</span><span v-if="linkExterno(c.acao.url)" aria-hidden="true"> ↗</span></a>
          <a v-if="c.link" :href="c.link" target="_blank" rel="noopener">{{ rotuloDoLink(c) }}<span class="ops-visually-hidden">: {{ c.nome }}</span> <span aria-hidden="true">↗</span></a>
        </div>
      </li>
    </ol>

    <details v-if="alertas.sozinhos.length" class="precisa__sozinhos">
      <summary>{{ alertas.sozinhos.length }} {{ alertas.sozinhos.length === 1 ? 'item resolve' : 'itens resolvem' }} sozinho{{ alertas.sozinhos.length === 1 ? '' : 's' }}: ver</summary>
      <ul>
        <li v-for="c in alertas.sozinhos" :key="c.id">
          <strong>{{ c.nome }}</strong>
          <p>{{ c.oQueFazer }}</p>
          <small>{{ c.detalhe }}</small>
          <a v-if="c.acao" :href="c.acao.url" :target="linkExterno(c.acao.url) ? '_blank' : undefined" :rel="linkExterno(c.acao.url) ? 'noopener' : undefined">{{ c.acao.rotulo }}<span class="ops-visually-hidden">: {{ c.nome }}</span></a>
        </li>
      </ul>
    </details>
  </section>
</template>
