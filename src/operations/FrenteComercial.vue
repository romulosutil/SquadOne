<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { esquecerAFrente, lerFrente, useFrente } from '../casca/frente'
const props = defineProps<{ configurar?: boolean }>()
const { frente, erro } = useFrente()
const salvando = ref(false)
const { sincronizar } = useAtualizacaoViva(async signal => { await lerFrente(signal) })
const status = computed(() => !frente.value ? 'Carregando' : frente.value.aquisicao?.primeirosContatosAutomaticos !== true ? 'Pausado pela política'
  : frente.value.cicloParado ? 'Executor parado' : frente.value.ativo ? 'Ligado' : 'Pausado')
async function alterarConfiguracao() {
  if (!frente.value || salvando.value) return
  salvando.value = true
  try {
    const r = await fetch('/api/operations/crm/frente/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: !frente.value.ativo }) })
    const corpo = await r.json()
    if (!r.ok) throw new Error(corpo.error || 'Não foi possível alterar os primeiros contatos.')
    esquecerAFrente(); await sincronizar()
  } catch (e) { erro.value = e instanceof Error ? e.message : 'Configuração não confirmada.' }
  finally { salvando.value = false }
}
</script>
<template>
  <section class="frente-comercial painel-venda" aria-labelledby="frente-titulo">
    <header class="cabecalho-bloco"><h2 id="frente-titulo">{{ configurar ? 'Controle da fila do WhatsApp' : 'Primeiros contatos' }}</h2><span class="etiqueta" role="status">{{ status }}</span></header>
    <p>O agente envia a primeira mensagem atual. Quando o cliente responder, você assume a conversa.</p>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }}</p>
    <p v-if="frente?.pausaAutomatica" class="recado recado--atencao" role="status">{{ frente.pausaAutomatica.detalhe }}</p>
    <p v-else-if="frente?.cicloParado" class="recado recado--atencao" role="status">A fila está ligada, mas o executor não está rodando. Nenhum próximo envio foi confirmado.</p>
    <p v-else-if="frente?.detalhe" class="texto-2">{{ frente.detalhe }}</p>
    <div v-if="!configurar && frente?.respostasHoje" class="metricas-venda">
      <div><strong>{{ frente.respostasHoje.enviados }}</strong><span>primeiros contatos hoje</span></div>
      <div><strong>{{ frente.respostasHoje.humanas }}</strong><span>respostas humanas hoje</span></div>
    </div>
    <div class="frente-comercial__acoes">
      <a v-if="!configurar" class="botao botao--primario" href="/crm">Ver respostas para atender</a>
      <button v-if="props.configurar" class="botao botao--leve" type="button" :disabled="salvando || !frente || (frente.aquisicao?.primeirosContatosAutomaticos !== true && !frente.ativo)" @click="alterarConfiguracao">{{ salvando ? 'Salvando…' : frente?.ativo ? 'Pausar primeiros contatos' : 'Ativar fila de primeiros contatos' }}</button>
    </div>
    <details v-if="frente?.fila.length" class="dobra">
      <summary>Fila de primeiros contatos</summary>
      <ol class="frente-comercial__fila"><li v-for="contato in frente.fila.slice(0,20)" :key="contato.id"><a :href="`/crm?lead=${encodeURIComponent(contato.id)}&detalhe=ficha`">{{ contato.empresa }}</a><span>{{ contato.estado === 'enviado' ? 'Enviado; aguarda resposta' : contato.estado === 'incerto' ? 'Conferir envio; não repetir' : 'Na fila' }}</span></li></ol>
    </details>
  </section>
</template>
<style scoped>
.frente-comercial { display: grid; gap: var(--esp-4); }
.frente-comercial__acoes { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.frente-comercial__fila { display: grid; gap: var(--esp-3); padding: var(--esp-3); }
.frente-comercial__fila li { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--esp-2); }
</style>
