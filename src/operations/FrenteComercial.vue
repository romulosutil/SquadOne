<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { recomendacoesDoTime, type SetorDoTime } from './recomendacoes-do-time'
const props = defineProps<{ configurar?: boolean }>()
interface Avaliacao { agente: string; nota: number; motivo: string }
interface Contato { id: string; empresa: string; produto: string; setor?: string; nota: number; estado: string; motivo: string; avaliacoes: Avaliacao[]; mensagem: string }
interface Funil { produto: string; novo: number; contato: number; proposta: number; ganho: number; perdido: number; elegiveis: number; contatosObservados: number; respostasWhatsapp: number; taxaResposta: number | null }
interface Frente { ativo: boolean; estado: string; limite: number; enviados: number; respondidos: number; avaliados: number; selecionados: number; setores: SetorDoTime[]; funil?: Funil[]; atualizadoEm: string | null; detalhe?: string; proximoEnvioEm?: string | null; fila: Contato[] }
const frente = ref<Frente | null>(null)
const erro = ref('')
const salvando = ref(false)
const limite = ref(5)
async function ler(signal: AbortSignal) {
  try { const r = await fetch('/api/operations/crm/frente', { signal, cache: 'no-store' }); if (!r.ok) throw new Error('Não foi possível consultar o time.'); frente.value = await r.json(); erro.value = '' }
  catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) erro.value = 'O time está sem leitura recente. Os números anteriores podem estar desatualizados.' }
}
const { sincronizar } = useAtualizacaoViva(ler)
const rotulo = computed(() => erro.value ? 'Sem leitura recente' : ({ iniciando: 'Preparando o time', avaliando: 'Time avaliando', pronto: 'Fila preparada', enviando: 'Iniciando conversa', 'fora-do-horario': 'Próximo expediente', pausado: 'Primeiros contatos pausados', bloqueado: 'Precisa de atenção', 'sem-sinal': 'Sem leitura recente', concluido: 'Rodada do dia concluída' }[frente.value?.estado ?? ''] ?? 'Lendo o time'))
const recomendacoes = computed(() => recomendacoesDoTime(frente.value))
const proximo = computed(() => {
  const em = frente.value?.proximoEnvioEm
  return em && Number.isFinite(Date.parse(em)) ? new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null
})
const ultimaLeitura = computed(() => frente.value?.atualizadoEm && Number.isFinite(Date.parse(frente.value.atualizadoEm))
  ? new Date(frente.value.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null)
async function alterarConfiguracao() {
  if (!frente.value || salvando.value) return
  salvando.value = true
  try { const r = await fetch('/api/operations/crm/frente/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: !frente.value.ativo }) }); if (!r.ok) throw new Error(); frente.value.ativo = !frente.value.ativo; await sincronizar() }
  catch { erro.value = 'Não foi possível alterar a configuração. O estado anterior foi mantido.' }
  finally { salvando.value = false }
}
</script>
<template>
  <section class="frente-comercial painel-venda" aria-labelledby="frente-titulo">
    <header class="cabecalho-bloco"><div><p class="sobretitulo">Prospecção pelo time</p><h2 id="frente-titulo">Primeiros contatos</h2></div><span class="etiqueta" :data-tom="erro || frente?.estado === 'bloqueado' ? 'atencao' : 'neutro'" role="status">{{ rotulo }}</span></header>
    <p class="texto-2">Diego, Elisa e Carla comparam Site, PRUMO, Iris, Estamparia e Plus. O funil completo e as respostas observadas orientam a prioridade; só leads novos com destino e mensagem validados recebem o primeiro contato.</p>
    <div v-if="frente?.atualizadoEm" class="metricas-venda" aria-label="Resultado do time hoje">
      <div><strong>{{ frente.enviados }}<small> / 100</small></strong><span>contatos iniciados pelo time hoje</span></div>
      <div><strong>{{ frente.respondidos }}</strong><span>respostas observadas</span></div>
      <div><strong>{{ frente.avaliados }}</strong><span>leads avaliados pelo time</span></div>
    </div>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }}</p>
    <p v-else-if="frente?.detalhe" class="frente-comercial__detalhe">{{ frente.detalhe }}</p>
    <p v-else-if="!frente?.atualizadoEm" class="texto-2">As avaliações e os envios aparecem aqui assim que o serviço iniciar. Nenhum contato é considerado enviado antes da confirmação da integração.</p>
    <p v-if="ultimaLeitura" class="texto-2 texto-pequeno">Última leitura do time: {{ ultimaLeitura }}.</p>
    <p v-if="frente?.atualizadoEm && proximo && frente.estado === 'pronto' && frente.fila.some(c => c.estado === 'pronto')" class="texto-2 texto-pequeno">Próxima possibilidade: {{ proximo }}. A Central confere o ritmo novamente antes de cada envio.</p>
    <p v-if="frente?.atualizadoEm" class="texto-2 texto-pequeno">{{ frente.selecionados }} selecionados entre {{ frente.avaliados }} avaliados. O teto de 100 é um máximo compartilhado, não uma previsão de envios.</p>
    <details v-if="frente?.funil?.length" class="dobra"><summary>Funil completo por oferta</summary><div class="frente-comercial__funil" role="table" aria-label="Etapas do CRM por oferta"><div role="row"><strong role="columnheader">Oferta</strong><strong role="columnheader">Novo</strong><strong role="columnheader">Em contato</strong><strong role="columnheader">Proposta</strong><strong role="columnheader">Ganho</strong><strong role="columnheader">Perdido</strong><strong role="columnheader">Aptos ao primeiro</strong><strong role="columnheader">Respostas WA</strong><strong role="columnheader">Taxa</strong></div><div v-for="m in frente.funil" :key="m.produto" role="row"><span role="cell">{{ m.produto === 'estampa' ? 'Estamparia' : m.produto.toUpperCase() }}</span><span role="cell">{{ m.novo }}</span><span role="cell">{{ m.contato }}</span><span role="cell">{{ m.proposta }}</span><span role="cell">{{ m.ganho }}</span><span role="cell">{{ m.perdido }}</span><span role="cell">{{ m.elegiveis }}</span><span role="cell">{{ m.respostasWhatsapp }}/{{ m.contatosObservados }}</span><span role="cell">{{ m.taxaResposta === null ? 'Amostra <10' : `${Math.round(m.taxaResposta * 100)}%` }}</span></div></div></details>
    <details v-if="frente?.setores?.length" class="dobra"><summary>Resultado por setor</summary><div class="frente-comercial__setores" role="table" aria-label="Funil por setor"><div role="row"><strong role="columnheader">Setor</strong><strong role="columnheader">Avaliados</strong><strong role="columnheader">Selecionados</strong><strong role="columnheader">Enviados</strong></div><div v-for="s in frente.setores" :key="s.setor" role="row"><span role="cell">{{ s.setor }}</span><span role="cell">{{ s.avaliados }}</span><span role="cell">{{ s.selecionados }}</span><span role="cell">{{ s.enviados }}</span></div></div></details>
    <section v-if="recomendacoes.length && frente?.estado !== 'sem-sinal'" aria-label="Alertas da prospecção"><h3>Alertas da prospecção</h3><div v-for="r in recomendacoes" :key="r.id" class="frente-comercial__recomendacao"><strong>{{ r.titulo }}</strong><p>{{ r.evidencia }}</p><p>{{ r.proximoPasso }}</p></div></section>
    <details v-if="frente?.fila.length" class="dobra frente-comercial__fila"><summary>Ver escolhas do time <span class="etiqueta">{{ frente.selecionados }} selecionados</span></summary>
      <ol class="lista-prioridades"><li v-for="(c, i) in frente.fila.slice(0, limite)" :key="c.id">
        <div class="frente-comercial__linha"><span class="ordem-venda">{{ i + 1 }}</span><div><a :href="`/crm?lead=${encodeURIComponent(c.id)}`"><strong>{{ c.empresa }}</strong></a><p v-if="c.setor" class="texto-2">{{ c.setor }}</p><p class="texto-2">{{ c.motivo }}</p></div><span class="etiqueta" :aria-label="`Pontuação ${c.nota} de 100`">{{ c.nota }}/100</span></div>
        <details class="frente-comercial__avaliacoes"><summary>Avaliação dos agentes · {{ c.estado === 'enviado' ? 'Mensagem enviada' : c.estado === 'incerto' ? 'Envio em conferência' : 'Em preparação' }}</summary><ul><li v-for="a in c.avaliacoes" :key="a.agente"><strong>{{ a.agente }} · {{ a.nota }}/100</strong><p>{{ a.motivo }}</p></li></ul><blockquote v-if="c.mensagem">{{ c.mensagem }}</blockquote></details>
      </li></ol>
      <button v-if="frente.fila.length > limite" class="botao botao--leve" type="button" @click="limite += 10">Ver mais escolhas</button>
    </details>
    <footer class="frente-comercial__rodape"><template v-if="props.configurar"><button class="botao" type="button" :disabled="!frente || salvando" @click="alterarConfiguracao">{{ salvando ? 'Salvando…' : frente?.ativo ? 'Pausar primeiros contatos' : 'Ativar primeiros contatos' }}</button><p class="texto-2 texto-pequeno">Conta: WhatsApp do PRUMO. Até 100 por dia útil, dentro do expediente e dos limites de ritmo. A pausa impede novos envios; as conversas continuam disponíveis.</p></template><a v-else class="link-discreto" href="/mais?abrir=primeiros-contatos">Configurar primeiros contatos →</a></footer>
  </section>
</template>
<style scoped>
.frente-comercial { display: grid; gap: var(--esp-4); }
.frente-comercial__linha { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--esp-3); align-items: start; }
.frente-comercial__linha a { color: inherit; }
.frente-comercial__linha p { font-size: var(--tam-apoio); margin-top: var(--esp-1); }
.frente-comercial__avaliacoes { margin: var(--esp-2) 0 0 var(--esp-6); font-size: var(--tam-apoio); }
.frente-comercial__avaliacoes summary { min-height: var(--toque); align-content: center; cursor: pointer; }
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
