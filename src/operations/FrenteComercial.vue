<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { esquecerAFrente, lerFrente, useFrente } from '../casca/frente'
import { dataHora, hora } from './crm-formato'
import { recomendacoesDoTime } from './recomendacoes-do-time'
const props = defineProps<{ configurar?: boolean }>()
// O estado e a leitura são compartilhados com a Central (casca/frente.ts): uma leitura por ciclo.
const { frente, erro } = useFrente()
const salvando = ref(false)
const limite = ref(5)
/** O vendedor do Telegram, para o "Quem envia hoje" (GET /crm/vendedor): só o que o servidor já sabe. */
interface VendedorLido { configurado: boolean; ultimoEm: number | null }
const vendedor = ref<VendedorLido | null>(null)
async function lerVendedor(signal: AbortSignal) {
  try {
    const r = await fetch('/api/operations/crm/vendedor', { signal, cache: 'no-store' })
    if (!r.ok) throw new Error()
    const corpo = await r.json() as Partial<VendedorLido>
    vendedor.value = { configurado: corpo.configurado === true, ultimoEm: typeof corpo.ultimoEm === 'number' ? corpo.ultimoEm : null }
  } catch { if (!signal.aborted) vendedor.value = null }
}
async function ler(signal: AbortSignal) {
  await Promise.all([lerFrente(signal), lerVendedor(signal)])
}
const { sincronizar } = useAtualizacaoViva(ler)
const rotulo = computed(() => erro.value ? 'Sem leitura recente' : frente.value?.cicloParado ? 'Ciclo parado' : ({ iniciando: 'Preparando o time', avaliando: 'Time avaliando', pronto: 'Fila preparada', enviando: 'Iniciando conversa', 'fora-do-horario': 'Próximo expediente', pausado: 'Primeiros contatos pausados', bloqueado: 'Precisa de atenção', 'sem-sinal': 'Sem leitura recente', concluido: 'Rodada do dia concluída' }[frente.value?.estado ?? ''] ?? 'Lendo o time'))
/** "desde 11:42" (a última rodada que o script gravou) ou "sem nenhuma rodada ainda". */
const desdeQuando = computed(() => frente.value?.ultimaRodadaEm ? `desde ${hora(frente.value.ultimaRodadaEm)}` : 'sem nenhuma rodada gravada')
/**
 * Quem envia o primeiro contato hoje, com o que a Central sabe. O time tem dois interruptores (`ativo` e o
 * timer do systemd): "ativo" sem o ciclo andando é o pior caso, porque os leads da fila dele saem do
 * "Envie para X" do Telegram e ninguém os envia.
 */
const quemEnvia = computed(() => {
  const f = frente.value
  const time = !f ? 'Lendo o time…'
    : f.pausaAutomatica ? 'Pausa automática em todos os primeiros contatos, inclusive os seus. Respostas às conversas existentes continuam disponíveis.'
    : !f.ativo ? 'Pausado: os primeiros contatos são seus, pela Ficha e pelo "Envie para X" do Telegram.'
    : f.cicloParado ? `Ativo, mas o ciclo está parado ${desdeQuando.value}. Os leads da fila dele saem do Telegram e ninguém os envia até o ciclo voltar; pause o time para eles voltarem para você.`
    : 'Ativo e rodando: os primeiros contatos das cinco ofertas que o time cobre (Site, Plus, PRUMO, Iris e Estamparia), dentro do expediente e do teto do dia, são do time.'
  const v = vendedor.value
  const telegram = !v ? 'Sem leitura do vendedor agora.'
    : !v.configurado ? 'Desligado nesta Central (SQUADONE_VENDEDOR e o bot do Telegram).'
    : v.ultimoEm ? `Ligado; último aviso em ${dataHora(new Date(v.ultimoEm).toISOString())}.` : 'Ligado; ainda sem aviso registrado.'
  return { time, telegram }
})
const recomendacoes = computed(() => {
  const f = frente.value
  return f ? recomendacoesDoTime({ avaliados: f.avaliados ?? 0, selecionados: f.selecionados ?? 0, enviados: f.enviados ?? 0, setores: f.setores ?? [] }) : []
})
const proximo = computed(() => {
  const em = frente.value?.proximoEnvioEm
  return em && Number.isFinite(Date.parse(em)) ? new Date(em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : null
})
const ultimaLeitura = computed(() => frente.value?.atualizadoEm && Number.isFinite(Date.parse(frente.value.atualizadoEm))
  ? new Date(frente.value.atualizadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }) : null)
async function alterarConfiguracao() {
  if (!frente.value || salvando.value) return
  salvando.value = true
  try { const r = await fetch('/api/operations/crm/frente/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: !frente.value.ativo }) }); const corpo = await r.json(); if (!r.ok) throw new Error(corpo.error || 'Não foi possível alterar a configuração.'); esquecerAFrente(); await sincronizar() }
  catch (e) { erro.value = e instanceof Error ? e.message : 'Não foi possível alterar a configuração. O estado anterior foi mantido.'; esquecerAFrente() }
  finally { salvando.value = false }
}
</script>
<template>
  <section class="frente-comercial painel-venda" aria-labelledby="frente-titulo">
    <header class="cabecalho-bloco"><div><p class="sobretitulo">Prospecção pelo time</p><h2 id="frente-titulo">Primeiros contatos</h2></div><span class="etiqueta" :data-tom="erro || frente?.estado === 'bloqueado' ? 'atencao' : 'neutro'" role="status">{{ rotulo }}</span></header>
    <p class="texto-2">Diego, Elisa e Carla comparam Site, PRUMO, Iris, Estamparia e Plus. O funil completo e as respostas observadas orientam a prioridade; só leads novos com destino e mensagem validados recebem o primeiro contato.</p>
    <div v-if="frente?.respostasHoje" class="metricas-venda frente-comercial__metricas" aria-label="Respostas aos disparos de hoje">
      <div><strong>{{ frente.respostasHoje.enviados }}<small> / {{ frente.limite }}</small></strong><span>disparos confirmados hoje</span></div>
      <div><strong>{{ frente.respostasHoje.humanas }}</strong><span>respostas humanas</span></div>
      <div><strong>{{ frente.respostasHoje.robos }}</strong><span>somente robôs</span></div>
      <div><strong>{{ frente.respostasHoje.semResposta }}</strong><span>sem resposta</span></div>
    </div>
    <p v-if="frente?.respostasHoje" class="texto-2 texto-pequeno">Somente destinatários com disparo confirmado hoje, no horário de São Paulo, pelo time ou por você. Cada contato aparece em uma categoria; uma resposta humana substitui a automática.</p>
    <p v-else class="texto-2 texto-pequeno" role="status">Contagem do dia indisponível. Aguardando uma leitura atual de Vendas.</p>
    <section v-if="frente?.pausaAutomatica" class="recado recado--atencao" aria-label="Pausa automática dos primeiros contatos" role="status">
      <strong>Pausa automática desde {{ dataHora(frente.pausaAutomatica.desde) }}</strong>
      <p>{{ frente.pausaAutomatica.detalhe }}</p>
      <p v-if="frente.pausaAutomatica.revisarApos">Revisão a partir de {{ dataHora(frente.pausaAutomatica.revisarApos) }}. O prazo não reativa os envios.</p>
      <p>Retomada somente manual, após nova conferência da conta e dos retornos. Respostas às conversas existentes continuam disponíveis.</p>
    </section>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }}</p>
    <p v-else-if="frente?.cicloParado" class="recado recado--atencao" role="status"><strong>Ativo, mas o ciclo está parado {{ desdeQuando }}.</strong> O time não está avaliando nem enviando; o timer do Dell (frente-comercial.timer) precisa voltar.</p>
    <p v-else-if="frente?.detalhe && !frente.pausaAutomatica" class="frente-comercial__detalhe">{{ frente.detalhe }}</p>
    <p v-else-if="!frente?.atualizadoEm" class="texto-2">As avaliações e os envios aparecem aqui assim que o serviço iniciar. Nenhum contato é considerado enviado antes da confirmação da integração.</p>
    <section class="frente-comercial__quem" aria-labelledby="frente-quem">
      <h3 id="frente-quem">Quem envia hoje</h3>
      <ul>
        <li><strong>Time comercial</strong> {{ quemEnvia.time }}</li>
        <li><strong>Vendedor do Telegram</strong> {{ quemEnvia.telegram }}</li>
        <li><strong>Você</strong> A Triagem (convidar), as respostas e as conversas; abrir o WhatsApp não registra envio.</li>
      </ul>
    </section>
    <p v-if="ultimaLeitura" class="texto-2 texto-pequeno">Última leitura do time: {{ ultimaLeitura }}.</p>
    <p v-if="frente?.atualizadoEm && proximo && frente.estado === 'pronto' && frente.fila.some(c => c.estado === 'pronto')" class="texto-2 texto-pequeno">Próxima possibilidade: {{ proximo }}. A Central confere o ritmo novamente antes de cada envio.</p>
    <p v-if="frente?.atualizadoEm" class="texto-2 texto-pequeno">{{ frente.selecionados }} selecionados entre {{ frente.avaliados }} avaliados. O teto de {{ frente.limite }} é um máximo compartilhado, não uma previsão de envios.</p>
    <details v-if="frente?.funil?.length" class="dobra"><summary>Funil completo por oferta</summary><div class="frente-comercial__funil" role="table" aria-label="Etapas de Vendas por oferta"><div role="row"><strong role="columnheader">Oferta</strong><strong role="columnheader">Novo</strong><strong role="columnheader">Em contato</strong><strong role="columnheader">Proposta</strong><strong role="columnheader">Ganho</strong><strong role="columnheader">Perdido</strong><strong role="columnheader">Aptos ao primeiro</strong><strong role="columnheader">Respostas WA</strong><strong role="columnheader">Taxa</strong></div><div v-for="m in frente.funil" :key="m.produto" role="row"><span role="cell">{{ m.produto === 'estampa' ? 'Estamparia' : m.produto.toUpperCase() }}</span><span role="cell">{{ m.novo }}</span><span role="cell">{{ m.contato }}</span><span role="cell">{{ m.proposta }}</span><span role="cell">{{ m.ganho }}</span><span role="cell">{{ m.perdido }}</span><span role="cell">{{ m.elegiveis }}</span><span role="cell">{{ m.respostasWhatsapp }}/{{ m.contatosObservados }}</span><span role="cell">{{ m.taxaResposta === null ? 'Amostra <10' : `${Math.round(m.taxaResposta * 100)}%` }}</span></div></div></details>
    <details v-if="frente?.setores?.length" class="dobra"><summary>Resultado por setor</summary><div class="frente-comercial__setores" role="table" aria-label="Funil por setor"><div role="row"><strong role="columnheader">Setor</strong><strong role="columnheader">Avaliados</strong><strong role="columnheader">Selecionados</strong><strong role="columnheader">Enviados</strong></div><div v-for="s in frente.setores" :key="s.setor" role="row"><span role="cell">{{ s.setor }}</span><span role="cell">{{ s.avaliados }}</span><span role="cell">{{ s.selecionados }}</span><span role="cell">{{ s.enviados }}</span></div></div></details>
    <section v-if="recomendacoes.length && frente?.estado !== 'sem-sinal'" aria-label="Alertas da prospecção"><h3>Alertas da prospecção</h3><div v-for="r in recomendacoes" :key="r.id" class="frente-comercial__recomendacao"><strong>{{ r.titulo }}</strong><p>{{ r.evidencia }}</p><p>{{ r.proximoPasso }}</p></div></section>
    <details v-if="frente?.fila.length" class="dobra frente-comercial__fila"><summary>Ver escolhas do time <span class="etiqueta">{{ frente.selecionados }} selecionados</span></summary>
      <ol class="lista-prioridades"><li v-for="(c, i) in frente.fila.slice(0, limite)" :key="c.id">
        <div class="frente-comercial__linha"><span class="ordem-venda">{{ i + 1 }}</span><div><a :href="`/crm?lead=${encodeURIComponent(c.id)}`"><strong>{{ c.empresa }}</strong></a><p v-if="c.setor" class="texto-2">{{ c.setor }}</p><p class="texto-2">{{ c.motivo }}</p></div><span class="etiqueta" :aria-label="`Pontuação ${c.nota} de 100`">{{ c.nota }}/100</span></div>
        <details class="frente-comercial__avaliacoes"><summary>Avaliação dos agentes · {{ c.estado === 'enviado' ? 'Mensagem enviada' : c.estado === 'incerto' ? 'Envio em conferência' : 'Em preparação' }}</summary><ul><li v-for="a in c.avaliacoes" :key="a.agente"><strong>{{ a.agente }} · {{ a.nota }}/100</strong><p>{{ a.motivo }}</p></li></ul><blockquote v-if="c.mensagem">{{ c.mensagem }}</blockquote></details>
      </li></ol>
      <button v-if="frente.fila.length > limite" class="botao botao--leve" type="button" @click="limite += 10">Ver mais escolhas</button>
    </details>
    <p v-if="frente" class="texto-2 texto-pequeno">Limites compartilhados: {{ frente.limite }} primeiros contatos por dia, {{ frente.porHora }} por hora e {{ frente.intervaloMinutos }} minutos entre contatos. Limites internos não garantem ausência de bloqueio. Inicie contato apenas com autorização do destinatário.</p>
    <p class="texto-2 texto-pequeno">Pausa automática: bloqueio ou recusa da integração, conta desconectada ou pelo menos 5 contatos enviados há 1 hora ou mais, nas últimas 24 horas, com 80% sem resposta humana. Robôs não são respostas humanas.</p>
    <footer class="frente-comercial__rodape"><template v-if="props.configurar"><button class="botao" type="button" :disabled="!frente || salvando" @click="alterarConfiguracao">{{ salvando ? 'Salvando…' : frente?.ativo ? 'Pausar primeiros contatos' : 'Ativar primeiros contatos' }}</button><p class="texto-2 texto-pequeno">Conta: WhatsApp do PRUMO. A pausa impede novos envios e exige ativação manual; as conversas continuam disponíveis.</p></template><a v-else class="link-discreto" href="/mais?abrir=primeiros-contatos">Configurar primeiros contatos →</a></footer>
  </section>
</template>
<style scoped>
.frente-comercial { display: grid; gap: var(--esp-4); }
.frente-comercial__metricas { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 39.99rem) { .frente-comercial__metricas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.frente-comercial__linha { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--esp-3); align-items: start; }
.frente-comercial__linha a { color: inherit; }
.frente-comercial__linha p { font-size: var(--tam-apoio); margin-top: var(--esp-1); }
.frente-comercial__avaliacoes { margin: var(--esp-2) 0 0 var(--esp-6); font-size: var(--tam-apoio); }
.frente-comercial__avaliacoes summary { min-height: var(--toque); align-content: center; cursor: pointer; }
.frente-comercial__avaliacoes ul { display: grid; gap: var(--esp-3); padding: var(--esp-3); background: var(--superficie-2); list-style: none; border-radius: var(--raio-controle); }
.frente-comercial__avaliacoes blockquote { margin: var(--esp-3) 0; padding-left: var(--esp-3); border-left: var(--linha-fina); white-space: pre-wrap; }
.frente-comercial__rodape { display: grid; gap: var(--esp-2); padding-top: var(--esp-2); }
.frente-comercial__detalhe { color: var(--texto-2); font-size: var(--tam-apoio); }
.frente-comercial__quem h3 { margin: 0 0 var(--esp-2); font-size: var(--tam-apoio); font-weight: var(--peso-forte); }
.frente-comercial__quem ul { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; font-size: var(--tam-apoio); color: var(--texto-2); }
.frente-comercial__quem strong { display: block; color: var(--texto); font-weight: var(--peso-forte); }
.frente-comercial__setores { display: grid; gap: var(--esp-2); overflow-x: auto; font-size: var(--tam-apoio); }
.frente-comercial__setores > div { display: grid; grid-template-columns: minmax(9rem,1fr) repeat(3,minmax(5rem,auto)); gap: var(--esp-3); }
.frente-comercial__funil { display: grid; gap: var(--esp-2); overflow-x: auto; font-size: var(--tam-apoio); }
.frente-comercial__funil > div { display: grid; grid-template-columns: minmax(7rem,1fr) repeat(8,minmax(5rem,auto)); gap: var(--esp-3); min-width: 57rem; }
.frente-comercial__recomendacao { margin-top: var(--esp-2); padding: var(--esp-3); border: var(--linha-fina); border-radius: var(--raio-controle); }
.frente-comercial__recomendacao p { margin-top: var(--esp-2); }
</style>
