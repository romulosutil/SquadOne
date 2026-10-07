<script setup lang="ts">
// Barra inferior do celular (abaixo de 1024 px): Hoje · Funil · ＋Pedir ·
// Finanças · Mais. A partir de 1024 px quem navega é o trilho lateral.
// O ＋Pedir fica desabilitado até a mudança da agenda para o Dell
// (ARCHITECTURE "Transição", 4): os agentes ainda moram no Easypanel.
const props = defineProps<{ caminho: string }>()

const atual = (prefixo: string): 'page' | undefined =>
  (prefixo === '/' ? props.caminho === '/' : props.caminho === prefixo || props.caminho.startsWith(`${prefixo}/`)) ? 'page' : undefined
</script>

<template>
  <nav class="barra-inferior" aria-label="Navegação principal">
    <a href="/" :aria-current="atual('/')"><span class="barra-inferior__icone" aria-hidden="true">◉</span>Hoje</a>
    <a href="/crm" :aria-current="atual('/crm')"><span class="barra-inferior__icone" aria-hidden="true">▤</span>Funil</a>
    <button type="button" class="barra-inferior__pedir" disabled aria-describedby="pedir-em-breve">
      <span class="barra-inferior__icone" aria-hidden="true">＋</span>Pedir
      <small id="pedir-em-breve">em breve</small>
    </button>
    <a href="/financas" :aria-current="atual('/financas')"><span class="barra-inferior__icone" aria-hidden="true">R$</span>Finanças</a>
    <a href="/mais" :aria-current="atual('/mais')"><span class="barra-inferior__icone" aria-hidden="true">≡</span>Mais</a>
  </nav>
</template>
