<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { esquecerAFrente, lerFrente, useFrente } from '../casca/frente'
import type { JustificativaComercial } from './justificativa-comercial'
const props = defineProps<{ configurar?: boolean }>()
const { frente, erro } = useFrente()
const salvando = ref(false)
const limite = ref(5)
async function ler(signal: AbortSignal) { await lerFrente(signal) }
const { sincronizar } = useAtualizacaoViva(ler)
const ultimaLeitura = computed(() => frente.value?.atualizadoEm && Number.isFinite(Date.parse(frente.value.atualizadoEm))
  ? new Date(frente.value.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null)
async function alterarConfiguracao() {
  if (!frente.value || salvando.value) return
  salvando.value = true
  try { const r = await fetch('/api/operations/crm/frente/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: false }) }); const corpo = await r.json(); if (!r.ok) throw new Error(corpo.error || 'Não foi possível alterar a configuração.'); esquecerAFrente(); await sincronizar() }
  catch (e) { erro.value = e instanceof Error ? e.message : 'Não foi possível alterar a configuração. O estado anterior foi mantido.'; esquecerAFrente() }
  finally { salvando.value = false }
}
</script>
<template>
  <section class="frente-comercial painel-venda" aria-labelledby="frente-titulo">
    <header class="cabecalho-bloco"><h2 id="frente-titulo">Aquisição</h2><span class="etiqueta" data-tom="atencao" role="status">Primeiros contatos automáticos bloqueados</span></header>
    <p>Após a restrição por spam de 13/11, a aquisição está em reconstrução. Reconectar o WhatsApp não libera a fila de primeiros contatos deste executor.</p>
    <div class="frente-comercial__direcao">
      <h3>Prioridade agora: oportunidades com contexto</h3>
      <p>Revisar propostas e compromissos existentes. Novas conversas começam por necessidade e permissão de contato; número público não comprova autorização.</p>
      <a class="botao botao--leve" href="/crm?ver=funil">Revisar carteira comercial</a>
    </div>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }} A indisponibilidade não libera envios.</p>
    <p v-if="ultimaLeitura" class="texto-2 texto-pequeno">Última leitura do executor: {{ ultimaLeitura }}.</p>
    <details class="dobra frente-comercial__evidencias"><summary>Histórico de pesquisa, envios e avaliações</summary>
    <div class="frente-comercial__evidencias-corpo">
    <div v-if="frente?.atualizadoEm" class="metricas-venda" aria-label="Resultado registrado na última execução">
      <div><strong>{{ frente.enviados }}<small v-if="frente.limite !== null"> / {{ frente.limite }}</small></strong><span>contatos iniciados na última execução</span></div>
      <div><strong>{{ frente.respondidos }}</strong><span>respostas observadas</span></div>
      <div><strong>{{ frente.avaliados }}</strong><span>leads avaliados pelo time</span></div>
    </div>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }}</p>
    <div v-if="frente?.rodada" class="recado" role="status"><strong>{{ frente.rodada.pendentes }} aguardando resposta humana</strong><p>{{ frente.rodada.motivo }}</p><p class="texto-2 texto-pequeno">Pendências permanecem no histórico. Revisar uma rodada não libera a aquisição.</p></div>
    <p v-if="frente?.detalhe" class="frente-comercial__detalhe">{{ frente.detalhe }}</p>
    <p v-else-if="!frente?.atualizadoEm" class="texto-2">As avaliações e os envios aparecem aqui assim que o serviço iniciar. Nenhum contato é considerado enviado antes da confirmação da integração.</p>
    <p v-if="frente?.atualizadoEm" class="texto-2 texto-pequeno">{{ frente.selecionados }} selecionados entre {{ frente.avaliados }} avaliados na última execução. Seleção histórica não autoriza contato nem comprova necessidade.</p>
    <details v-if="frente?.funil?.length" class="dobra"><summary>Funil completo por oferta</summary><div class="frente-comercial__funil" role="table" aria-label="Etapas de Vendas por oferta"><div role="row"><strong role="columnheader">Oferta</strong><strong role="columnheader">Novo</strong><strong role="columnheader">Em contato</strong><strong role="columnheader">Proposta</strong><strong role="columnheader">Ganho</strong><strong role="columnheader">Perdido</strong><strong role="columnheader">Aptos ao primeiro</strong><strong role="columnheader">Respostas WA</strong><strong role="columnheader">Taxa</strong></div><div v-for="m in frente.funil" :key="m.produto" role="row"><span role="cell">{{ m.produto === 'estampa' ? 'Estamparia' : m.produto.toUpperCase() }}</span><span role="cell">{{ m.novo }}</span><span role="cell">{{ m.contato }}</span><span role="cell">{{ m.proposta }}</span><span role="cell">{{ m.ganho }}</span><span role="cell">{{ m.perdido }}</span><span role="cell">{{ m.elegiveis }}</span><span role="cell">{{ m.respostasWhatsapp }}/{{ m.contatosObservados }}</span><span role="cell">{{ m.taxaResposta === null ? 'Amostra <10' : `${Math.round(m.taxaResposta * 100)}%` }}</span></div></div></details>
    <details v-if="frente?.setores?.length" class="dobra"><summary>Resultado por setor</summary><div class="frente-comercial__setores" role="table" aria-label="Funil por setor"><div role="row"><strong role="columnheader">Setor</strong><strong role="columnheader">Avaliados</strong><strong role="columnheader">Selecionados</strong><strong role="columnheader">Enviados</strong></div><div v-for="s in frente.setores" :key="s.setor" role="row"><span role="cell">{{ s.setor }}</span><span role="cell">{{ s.avaliados }}</span><span role="cell">{{ s.selecionados }}</span><span role="cell">{{ s.enviados }}</span></div></div></details>
    <details v-if="frente?.fila.length" class="dobra frente-comercial__fila"><summary>Ver escolhas do time <span class="etiqueta">{{ frente.selecionados }} selecionados</span></summary>
      <ol class="lista-prioridades"><li v-for="(c, i) in frente.fila.slice(0, limite)" :key="c.id">
        <div class="frente-comercial__linha"><span class="ordem-venda">{{ i + 1 }}</span><div><a :href="`/crm?lead=${encodeURIComponent(c.id)}`"><strong>{{ c.empresa }}</strong></a><p v-if="c.setor" class="texto-2">{{ c.setor }}</p><p class="texto-2">{{ c.motivo }}</p></div><span v-if="c.nota !== null" class="etiqueta" :aria-label="`Pontuação ${c.nota} de 100`">{{ c.nota }}/100</span></div>
        <details class="frente-comercial__avaliacoes"><summary>Justificativa comercial e avaliações · {{ c.estado === 'enviado' ? 'Mensagem enviada' : c.estado === 'incerto' ? 'Envio em conferência' : 'Em preparação' }}</summary>
          <dl v-if="c.justificativaComercial" class="frente-comercial__justificativa">
            <div><dt>Por que compraria</dt><dd>{{ c.justificativaComercial.porQueComprar }}</dd></div>
            <div><dt>Por que esta oferta</dt><dd>{{ c.justificativaComercial.porQueOferta }}</dd></div>
            <div><dt>Por que agora</dt><dd>{{ c.justificativaComercial.porQueAgora }}</dd></div>
            <div><dt>Viabilidade</dt><dd>{{ c.justificativaComercial.viabilidade }}</dd></div>
          </dl>
          <p v-else class="texto-2">Escolha anterior à nova regra; justificativa comercial ainda não disponível.</p>
          <ul><li v-for="a in c.avaliacoes" :key="a.agente"><strong>{{ a.agente }} · {{ a.nota }}/100</strong><p>{{ a.motivo }}</p></li></ul><blockquote v-if="c.mensagem">{{ c.mensagem }}</blockquote></details>
      </li></ol>
      <button v-if="frente.fila.length > limite" class="botao botao--leve" type="button" @click="limite += 10">Ver mais escolhas</button>
    </details>
    <details class="dobra"><summary>O que cada agente faz</summary><dl class="frente-comercial__passo"><div><dt>Diego</dt><dd>Confere se o perfil e o destino do contato são adequados.</dd></div><div><dt>Elisa</dt><dd>Confere as evidências e a pertinência da entrega.</dd></div><div><dt>Carla</dt><dd>Define a abordagem e conduz o primeiro contato aprovado.</dd></div><div><dt>Você</dt><dd>Conduz as respostas dos clientes. As pendências aparecem em Minhas decisões.</dd></div></dl><p class="texto-2 texto-pequeno">Estes são os papéis do time. O andamento acima mostra somente o que a integração informa.</p></details>
    </div>
    </details>
    <footer class="frente-comercial__rodape"><button v-if="props.configurar && frente?.ativo" class="botao" type="button" :disabled="salvando" @click="alterarConfiguracao">{{ salvando ? 'Salvando…' : 'Confirmar pausa da configuração legada' }}</button><p class="texto-2 texto-pequeno">O atendimento e os históricos existentes continuam disponíveis. A retomada exige um fluxo próprio de elegibilidade e liberação; esta versão não oferece ativação de novos disparos.</p></footer>
  </section>
</template>
<style scoped>
.frente-comercial { display: grid; gap: var(--esp-4); }
.frente-comercial__direcao { display: grid; gap: var(--esp-3); padding-block: var(--esp-4); border-block: var(--divisor); justify-items: start; }
.frente-comercial__direcao h3 { margin: 0; font-size: var(--tam-nome); }
.frente-comercial__acao { margin: 0; font-size: var(--tam-nome); overflow-wrap: anywhere; }
.frente-comercial__passo { display: grid; gap: var(--esp-3); margin: 0; }
.frente-comercial__passo > div { display: grid; grid-template-columns: minmax(4rem, auto) minmax(0, 1fr); gap: var(--esp-3); padding-top: var(--esp-3); border-top: var(--divisor); }
.frente-comercial__passo dt { color: var(--texto-2); font-size: var(--tam-apoio); }
.frente-comercial__passo dd { margin: 0; overflow-wrap: anywhere; }
.frente-comercial__evidencias-corpo { display: grid; gap: var(--esp-4); padding-top: var(--esp-4); min-width: 0; }
@media (max-width: 29rem) { .frente-comercial__passo > div { grid-template-columns: minmax(0, 1fr); gap: var(--esp-1); } }
.frente-comercial__linha { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--esp-3); align-items: start; }
.frente-comercial__linha a { color: inherit; }
.frente-comercial__linha p { font-size: var(--tam-apoio); margin-top: var(--esp-1); }
.frente-comercial__avaliacoes { margin: var(--esp-2) 0 0 var(--esp-6); font-size: var(--tam-apoio); }
.frente-comercial__avaliacoes summary { min-height: var(--toque); align-content: center; cursor: pointer; }
.frente-comercial__justificativa { display: grid; gap: var(--esp-3); padding: var(--esp-3) 0; }
.frente-comercial__justificativa dt { font-weight: var(--peso-medio); }
.frente-comercial__justificativa dd { margin: 0; overflow-wrap: anywhere; }
.frente-comercial__avaliacoes ul { display: grid; gap: var(--esp-3); padding: var(--esp-3); background: var(--superficie-2); list-style: none; border-radius: var(--raio-controle); }
.frente-comercial__avaliacoes blockquote { margin: var(--esp-3) 0; padding-left: var(--esp-3); border-left: var(--linha-fina); white-space: pre-wrap; }
.frente-comercial__rodape { display: grid; gap: var(--esp-2); padding-top: var(--esp-2); }
.frente-comercial__detalhe { color: var(--texto-2); font-size: var(--tam-apoio); }
.frente-comercial__setores { display: grid; gap: var(--esp-2); overflow-x: auto; font-size: var(--tam-apoio); }
.frente-comercial__setores > div { display: grid; grid-template-columns: minmax(9rem,1fr) repeat(3,minmax(5rem,auto)); gap: var(--esp-3); }
.frente-comercial__funil { display: grid; gap: var(--esp-2); overflow-x: auto; font-size: var(--tam-apoio); }
.frente-comercial__funil > div { display: grid; grid-template-columns: minmax(7rem,1fr) repeat(8,minmax(5rem,auto)); gap: var(--esp-3); min-width: 57rem; }
.frente-comercial__recomendacao { margin-top: var(--esp-2); padding: var(--esp-3); border: var(--linha-fina); border-radius: var(--raio-controle); }
.frente-comercial__recomendacao p { margin-top: var(--esp-2); }
</style>
