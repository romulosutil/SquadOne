<script setup lang="ts">
// Um alerta do retrato do dell-status na Hoje: o que é, o que fazer e o link
// que resolve. O texto de "o que fazer" é escrito lá, junto de cada
// verificação (RULES 19); a tela não inventa remédio.
import { ROTULO_DO_GRUPO, grupoDoAlerta, linkExterno, soNoDell } from '../operations/alertas'
import type { DellCheck } from '../operations/types'

const props = defineProps<{ check: DellCheck }>()

const grupo = grupoDoAlerta(props.check)
const desde = props.check.desde
  ? ` · desde ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(props.check.desde))}`
  : ''
const rotuloDoLink = (url: string) => (soNoDell(url) ? 'Abrir no Dell' : url.includes('docs.google.com/spreadsheets') ? 'Planilha' : 'Abrir')
</script>

<template>
  <article class="cartao" :class="{ 'cartao--falha': grupo === 'falha' }" :aria-label="`${ROTULO_DO_GRUPO[grupo]}: ${check.nome}`">
    <div class="selos">
      <span class="selo" :class="grupo === 'falha' ? 'selo--erro' : 'selo--atencao'">{{ ROTULO_DO_GRUPO[grupo] }}</span>
    </div>
    <h3>{{ check.nome }}</h3>
    <p><strong>O que fazer:</strong> {{ check.oQueFazer ?? 'Veja o detalhe; se não souber o que fazer, peça ao Claude.' }}</p>
    <p class="texto-2 texto-pequeno">{{ check.detalhe }}{{ desde }}</p>
    <div v-if="check.acao || check.link" class="acoes">
      <a
        v-if="check.acao"
        class="botao botao--primario"
        :href="check.acao.url"
        :target="linkExterno(check.acao.url) ? '_blank' : undefined"
        :rel="linkExterno(check.acao.url) ? 'noopener' : undefined"
      >{{ check.acao.rotulo }}<span class="so-leitor">: {{ check.nome }}</span><span v-if="linkExterno(check.acao.url)" aria-hidden="true"> ↗</span></a>
      <a v-if="check.link" class="botao botao--leve" :href="check.link" target="_blank" rel="noopener">
        {{ rotuloDoLink(check.link) }}<span class="so-leitor">: {{ check.nome }}</span> <span aria-hidden="true">↗</span>
      </a>
    </div>
  </article>
</template>
