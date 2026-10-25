<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import type { CrmLead, CrmVisao } from './types'
import { analisarOperacao, auditarEscolhas, type FrenteBi, type LinhaBi, type PeriodoBi } from './bi-operacao'
import { ROTULO_DO_PRODUTO, dataHora } from './crm-formato'
import { ROTULOS_DA_CLASSIFICACAO } from './classificacao-resposta'
const props = defineProps<{ visao: CrmVisao; leads: CrmLead[]; agora: number; disponivel: boolean }>()
const emit = defineEmits<{ abrir: [id: string] }>()
const periodo = ref<PeriodoBi>('30'), dimensao = ref<'produto'|'nicho'|'mensagem'>('produto')
const detalhe = ref<{ titulo: string; leads: CrmLead[] } | null>(null), limite = ref(12), limiteAgentes = ref(8)
const frente = ref<FrenteBi | null>(null), erro = ref('')
useAtualizacaoViva(async signal => {
  try { const r = await fetch('/api/operations/crm/frente',{ signal, cache:'no-store' }); if (!r.ok) throw new Error(); frente.value = await r.json(); erro.value = ''; return true }
  catch { if (!signal.aborted) erro.value = 'Sem leitura recente das escolhas do time.'; return false }
})
const bi = computed(() => analisarOperacao({ ...props.visao, leads:props.leads },periodo.value,props.agora))
const linhas = computed(() => dimensao.value === 'produto' ? bi.value.porOferta : dimensao.value === 'nicho' ? bi.value.porPublico : bi.value.porMensagem)
const auditoria = computed(() => auditarEscolhas(frente.value, props.visao.leads, props.agora))
const agentesFiltrados = ref(false)
const escolhas = computed(() => auditoria.value.filter(a => !agentesFiltrados.value || a.alertas.length))
const semSinal = computed(() => !!erro.value || !frente.value?.atualizadoEm || props.agora-Date.parse(frente.value.atualizadoEm) > 10*60_000 || frente.value.estado === 'sem-sinal')
const titulo = (linha: LinhaBi) => dimensao.value === 'produto' ? ROTULO_DO_PRODUTO[linha.chave as keyof typeof ROTULO_DO_PRODUTO] || linha.chave : linha.chave
const taxa = (n: number,d: number) => d ? `${(100*n/d).toLocaleString('pt-BR',{maximumFractionDigits:1})}%` : '—'
const recorteElemento = ref<HTMLElement | null>(null)
const recorte = computed(() => detalhe.value ? { titulo:detalhe.value.titulo, leads:bi.value.leads.filter(l => detalhe.value!.leads.some(d => d.id === l.id)) } : null)
function abrirRecorte(titulo: string, leads: CrmLead[]) { detalhe.value = { titulo,leads }; limite.value = 12; void nextTick(() => { recorteElemento.value?.focus({ preventScroll:true }); recorteElemento.value?.scrollIntoView({ block:'start' }) }) }
watch([periodo,dimensao], () => { detalhe.value = null; limite.value = 12 })
watch(agentesFiltrados, () => { limiteAgentes.value = 8 })
const etapas = computed(() => [
  { nome:'Envio registrado',n:bi.value.enviados },{ nome:'Indicação humana',n:bi.value.humanos },
  { nome:'Qualificação confirmada',n:bi.value.qualificados },{ nome:'Proposta registrada',n:bi.value.propostas },{ nome:'Cliente com pagamento',n:bi.value.clientesPagantes },
])
</script>
<template>
  <section class="bi" aria-labelledby="bi-titulo">
    <header class="bi__cabeca"><div><span class="sobretitulo">Prumo · inteligência da operação</span><h2 id="bi-titulo">O que os dados mandam revisar</h2><p class="texto-2">Do público escolhido à mensagem, à conversa e ao resultado.</p></div><label class="rotulo">Primeiro envio<select v-model="periodo" class="campo"><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="tudo">Todo o histórico</option></select></label></header>
    <p class="texto-2 texto-pequeno">Vendas · dados gerados em {{ dataHora(visao.geradoEm) }} · {{ bi.enviados }} contatos no recorte · {{ bi.recentes }} com menos de 48 h de observação.</p>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">Fonte indisponível ou desatualizada. Esta é a última leitura; confira a atualização antes de decidir.</p>
    <div class="bi__metricas">
      <article><span class="sobretitulo">Ação comercial</span><strong>{{ bi.planos.filter(p => p.tipo === 'agir').length }}</strong><p>clientes com próximo passo</p><a href="/crm">Abrir fila de ação →</a></article>
      <article><span class="sobretitulo">Contexto a resolver</span><strong>{{ bi.planos.filter(p => p.tipo === 'conferir').length }}</strong><p>revisão antes de contato</p></article>
      <article><span class="sobretitulo">Interesse explícito atual</span><strong>{{ bi.interesse }}<small> / {{ bi.enviados }}</small></strong><p>permissão e acesso têm classes próprias</p></article>
      <article><span class="sobretitulo">Lacuna de histórico</span><strong>{{ bi.semArquivo }}<small> / {{ bi.enviados }}</small></strong><p>contatos sem conversa preservada</p></article>
    </div>
    <section class="bi__bloco" aria-label="Limite de contatos sem resposta"><div class="bi__cabeca"><h3>Rodada de primeiros contatos</h3><strong>{{ frente?.rodada ? `${frente.rodada.pendentes} / ${frente.rodada.limite} sem resposta humana` : 'Aguardando leitura da rodada' }}</strong></div><p v-if="frente?.rodada">{{ frente.rodada.motivo }} Início: {{ dataHora(frente.rodada.inicio ?? undefined) }}.</p><p class="texto-2">Até 15 novos contatos/dia, 2/h e 30 minutos de intervalo. Atingir 10 aguardando resposta interrompe novos contatos. Robô, leitura, passagem do tempo e virada do dia não liberam vagas.</p><button v-if="frente?.rodada?.clientes.length" type="button" class="botao botao--leve" @click="abrirRecorte('Aguardando resposta nesta rodada',visao.leads.filter(l => frente?.rodada?.clientes.some(c => c.leadId === l.id)))">Conferir clientes desta rodada →</button><a class="link-discreto" href="/mais?abrir=primeiros-contatos">Revisar rodada em primeiros contatos →</a></section>
    <section class="bi__bloco"><h3>Onde a operação precisa de decisão</h3><p class="texto-2">Os grupos abaixo podem conter o mesmo cliente. Cada número abre os casos e suas evidências.</p><div class="bi__quebras"><article v-for="q in bi.quebras" :key="q.id"><div class="bi__linha"><h4>{{ q.titulo }}</h4><strong>{{ q.itens.length }}</strong></div><p>{{ q.acao }}</p><p class="texto-2 texto-pequeno">Responsável · {{ q.responsavel }}</p><button class="botao botao--leve" type="button" :disabled="!q.itens.length" @click="abrirRecorte(q.titulo,q.itens.map(p => p.lead))">Ver casos e evidências →</button></article></div></section>
    <section class="bi__bloco"><h3>Sequências de mensagens a conferir</h3><p class="texto-2">{{ bi.fluxos.length }} contato(s) com apresentação logo após resposta automática no recorte preservado. É um sinal de quebra no acesso humano; não comprova a intenção do destinatário.</p><article v-for="f in bi.fluxos.slice(0,8)" :key="f.lead.id"><h4>{{ f.lead.empresa }} · {{ f.titulo }}</h4><blockquote v-for="(m,i) in f.evidencia" :key="i"><strong>{{ m.direcao === 'entrada' ? 'Resposta automática' : 'Nossa conta' }} · {{ dataHora(m.em) }}</strong><p>{{ m.trecho }}</p></blockquote><p class="texto-2">{{ f.proximo }}</p><button class="botao botao--leve" type="button" @click="emit('abrir',f.lead.id)">Conferir sequência completa disponível →</button></article><button v-if="bi.fluxos.length > 8" type="button" class="botao botao--leve" @click="abrirRecorte('Apresentação após robô',bi.fluxos.map(f => f.lead))">Ver todos os casos</button></section>
    <div class="bi__dupla">
      <section class="bi__bloco"><h3>Resposta atual de cada contato</h3><p class="texto-2">Classes exclusivas da última evidência; a soma é {{ bi.enviados }}. Não são etapas cumulativas.</p><button v-for="c in bi.classes" :key="c.classe" class="bi__barra-linha" type="button" @click="abrirRecorte(c.rotulo,bi.leads.filter(l => (l.classificacaoResposta?.classe ?? 'pendente') === c.classe))"><span>{{ c.rotulo }}</span><span class="bi__barra" aria-hidden="true"><i :style="{ width:taxa(c.quantidade,bi.enviados) }" /></span><strong>{{ c.quantidade }}</strong></button></section>
      <section class="bi__bloco"><h3>Avanços com registro</h3><p class="texto-2">Marcos independentes da mesma coorte, acumulados até a leitura. A falta de registro não reconstrói o passado.</p><div v-for="e in etapas" :key="e.nome" class="bi__marco"><span>{{ e.nome }}</span><span class="bi__barra" aria-hidden="true"><i :style="{ width:taxa(e.n,bi.enviados) }" /></span><strong>{{ e.n }}</strong></div><p class="texto-2 texto-pequeno">Indicação humana inclui recepção e recusa. Proposta e ganho verbal não comprovam pagamento.</p></section>
    </div>
    <section class="bi__bloco"><div class="bi__cabeca"><div><h3>O público ou a mensagem?</h3><p class="texto-2">Compare a evidência; abra uma linha para ver os contatos.</p></div><label class="rotulo">Agrupar por<select v-model="dimensao" class="campo"><option value="produto">Oferta</option><option value="nicho">Público / nicho</option><option value="mensagem">Oferta, regime e variante</option></select></label></div><p class="recado">A taxa usa apenas contatos enviados há pelo menos 48 h, com resposta acumulada até agora. Não é taxa de resposta em 48 h. Públicos, datas e cobertura diferentes impedem atribuir o resultado à mensagem. Menos de 10 contatos maduros: sem taxa.</p><div class="bi__tabela"><table><caption>Resultados observados por {{ dimensao === 'produto' ? 'oferta' : dimensao === 'nicho' ? 'público' : 'mensagem' }}</caption><thead><tr><th scope="col">Recorte</th><th scope="col">Envios</th><th scope="col">Maduros</th><th scope="col">Humanos / maduros</th><th scope="col">Interesse atual*</th><th scope="col">Robô*</th><th scope="col">Recusa*</th><th scope="col">Sem arquivo</th></tr></thead><tbody><tr v-for="l in linhas.slice(0,limite)" :key="l.chave"><th scope="row"><button type="button" @click="abrirRecorte(titulo(l),l.leads)">{{ titulo(l) }} →</button></th><td>{{ l.enviados }}</td><td>{{ l.maduros }}</td><td>{{ l.humanos }}/{{ l.maduros }} · {{ l.taxa === null ? 'Amostra <10' : taxa(l.humanos,l.maduros) }}</td><td>{{ l.interesse }}</td><td>{{ l.robos }}</td><td>{{ l.recusas }}</td><td>{{ l.semArquivo }}/{{ l.enviados }}</td></tr></tbody></table></div><p class="texto-2 texto-pequeno">* Entre os contatos maduros. Humano é indicação da fonte/contexto, não comprador qualificado. Variante ausente permanece desconhecida; esta tabela não declara vencedor de A/B.</p><button v-if="linhas.length > limite" class="botao botao--leve" type="button" @click="limite += 12">Ver mais recortes</button></section>
    <section v-if="recorte" ref="recorteElemento" tabindex="-1" class="bi__bloco bi__evidencias" aria-label="Contatos do recorte"><div class="bi__cabeca"><h3>{{ recorte.titulo }} · {{ recorte.leads.length }} contatos</h3><button type="button" class="botao botao--leve" @click="detalhe = null">Fechar recorte</button></div><ol><li v-for="l in recorte.leads.slice(0,limite)" :key="l.id"><button type="button" class="botao botao--leve" @click="emit('abrir',l.id)">{{ l.empresa }} →</button><p>{{ l.classificacaoResposta ? ROTULOS_DA_CLASSIFICACAO[l.classificacaoResposta.classe] : 'Contexto insuficiente' }} · {{ l.classificacaoResposta?.motivo }}</p><blockquote v-if="l.classificacaoResposta?.evidencia"><p v-if="l.classificacaoResposta.evidencia.perguntaAnterior"><strong>Pergunta anterior:</strong> {{ l.classificacaoResposta.evidencia.perguntaAnterior }}</p><p><strong>Resposta:</strong> {{ l.classificacaoResposta.evidencia.trecho }}</p></blockquote><p v-else class="texto-2">Sem trecho suficiente nesta fonte. Abra o contexto antes de escolher a ação.</p></li></ol><button v-if="recorte.leads.length > limite" class="botao botao--leve" type="button" @click="limite += 12">Ver mais contatos</button></section>
    <section class="bi__bloco"><div class="bi__cabeca"><div><h3>O que os agentes escolheram e o que aconteceu</h3><p class="texto-2">Notas, justificativas e texto selecionado, ligados a Vendas pelo cliente.</p></div><span class="etiqueta">{{ semSinal ? 'Último retrato · conferir recência' : 'Retrato recente do time' }}</span></div><p v-if="erro" class="recado recado--atencao" role="status">{{ erro }}</p><p v-if="frente" class="texto-2">{{ dataHora(frente.atualizadoEm ?? undefined) }} · {{ frente.avaliados ?? '—' }} avaliados · {{ frente.selecionados ?? '—' }} selecionados · {{ frente.enviados ?? '—' }} envios hoje · teto {{ frente.limite ?? 'não informado' }}/dia<template v-if="frente.porHora"> · {{ frente.porHora }}/h</template><template v-if="frente.intervaloMinutos"> · {{ frente.intervaloMinutos }} min de intervalo</template>.</p><p class="recado">O score é uma avaliação dos agentes, não uma probabilidade de venda. As escolhas são do retrato atual da fila, até 100 registros; não representam todas as avaliações históricas. O texto selecionado não comprova autoria nem envio: confira a conversa observada.</p><label class="bi__check"><input v-model="agentesFiltrados" type="checkbox"> Só escolhas com ponto de revisão · {{ auditoria.filter(a => a.alertas.length).length }}</label><p v-if="!escolhas.length" class="texto-2">{{ frente ? 'Nenhuma escolha neste recorte.' : 'Lendo as escolhas do time…' }}</p><details v-for="a in escolhas.slice(0,limiteAgentes)" :key="a.escolha.id" class="bi__escolha"><summary><strong>{{ a.escolha.empresa }}</strong><span>{{ a.escolha.nota }}/100 · {{ a.resultado }}</span><span v-if="a.alertas.length">{{ a.alertas.length }} ponto(s) de revisão</span></summary><p>{{ a.escolha.motivo }}</p><ul v-if="a.alertas.length"><li v-for="alerta in a.alertas" :key="alerta">{{ alerta }}</li></ul><ul><li v-for="v in a.escolha.avaliacoes" :key="v.agente"><strong>{{ v.agente }} · {{ v.nota }}/100</strong><p>{{ v.motivo }}</p></li></ul><blockquote v-if="a.escolha.mensagem"><strong>Mensagem selecionada</strong><p>{{ a.escolha.mensagem }}</p></blockquote><button v-if="a.lead" class="botao botao--leve" type="button" @click="emit('abrir',a.lead.id)">Conferir conversa e próximo passo →</button></details><button v-if="escolhas.length > limiteAgentes" class="botao botao--leve" type="button" @click="limiteAgentes += 8">Ver mais escolhas</button></section>
    <details class="dobra"><summary>Como interpretar e usar este BI</summary><p>Fonte: retrato existente de Vendas, conversas preservadas, notas de revisão e avaliações da frente comercial. Toda leitura usa o horário de São Paulo; dados faltantes ficam desconhecidos.</p><p>Hipótese para testar: validar primeiro o canal e quem decide; depois fazer uma pergunta sobre a rotina e entregar o material autorizado. Medir acesso ao responsável, dor confirmada e próximo compromisso, separadamente de resposta e de permissão. Uma variável por teste, usando os experimentos já existentes em Diagnóstico.</p><p>Este BI orienta revisão; não modifica público, mensagens, notas, classificações ou fluxos automaticamente.</p></details>
  </section>
</template>
<style scoped>
.bi { display:grid; gap:var(--esp-5); min-width:0; }
.bi h2,.bi h3,.bi h4,.bi p { margin:0; overflow-wrap:anywhere; }
.bi__cabeca,.bi__linha { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:var(--esp-3); }
.bi__metricas { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:var(--esp-3); }
.bi__metricas article,.bi__bloco { border:var(--linha-fina); border-radius:var(--raio-controle); background:var(--superficie); padding:var(--esp-4); display:grid; gap:var(--esp-3); min-width:0; }
.bi__metricas strong { font-size:var(--tam-numero); font-variant-numeric:tabular-nums; }
.bi__metricas small { font-size:var(--tam-apoio); color:var(--texto-2); }
.bi__metricas p { font-size:var(--tam-apoio); }
.bi__quebras,.bi__dupla { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--esp-4); }
.bi__quebras article { display:grid; gap:var(--esp-3); border-top:var(--divisor); padding-top:var(--esp-3); }
.bi__quebras h4 { font-size:var(--tam-texto); }
.bi__quebras p,.bi__bloco > .texto-2 { font-size:var(--tam-apoio); }
.bi__barra-linha,.bi__marco { display:grid; grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) auto; gap:var(--esp-3); align-items:center; }
.bi__barra-linha { min-height:var(--toque); padding:var(--esp-2) 0; border:0; border-bottom:var(--divisor); text-align:left; font:inherit; font-size:var(--tam-apoio); background:transparent; color:var(--texto); cursor:pointer; }
.bi__marco { min-height:var(--toque); font-size:var(--tam-apoio); }
.bi__barra { height:var(--esp-2); background:var(--superficie-2); overflow:hidden; }
.bi__barra i { display:block; height:100%; background:var(--destaque); border-right:var(--linha-fina); }
.bi__tabela { overflow-x:auto; }
.bi table { width:100%; border-collapse:collapse; font-size:var(--tam-apoio); }
.bi caption { text-align:left; padding-bottom:var(--esp-3); color:var(--texto-2); }
.bi th,.bi td { text-align:right; padding:var(--esp-3); border-bottom:var(--divisor); font-variant-numeric:tabular-nums; }
.bi th:first-child { text-align:left; min-width:var(--esp-16); }
.bi th button { min-height:var(--toque); border:0; background:transparent; font:inherit; color:var(--texto); text-align:left; cursor:pointer; text-decoration:underline; }
.bi__evidencias ol,.bi__escolha ul { display:grid; gap:var(--esp-3); padding-left:var(--esp-5); }
.bi__evidencias li { display:grid; gap:var(--esp-2); }
.bi blockquote { margin:0; padding:var(--esp-3); border-left:var(--faixa) solid var(--borda); background:var(--superficie-2); white-space:pre-wrap; overflow-wrap:anywhere; font-size:var(--tam-apoio); }
.bi__escolha { border-top:var(--divisor); padding-top:var(--esp-3); }
.bi__escolha summary { min-height:var(--toque); display:grid; gap:var(--esp-2); cursor:pointer; }
.bi__escolha summary span { color:var(--texto-2); font-size:var(--tam-apoio); }
.bi__escolha[open] { display:grid; gap:var(--esp-3); }
.bi__check { display:flex; align-items:center; min-height:var(--toque); gap:var(--esp-2); }
.bi .botao { white-space:normal; }
@media(max-width:60rem) { .bi__metricas { grid-template-columns:repeat(2,minmax(0,1fr)); } .bi__dupla { grid-template-columns:1fr; } }
@media(max-width:35rem) { .bi__quebras { grid-template-columns:1fr; } .bi__metricas { gap:var(--esp-2); } .bi__metricas article { padding:var(--esp-3); } .bi__metricas strong { font-size:var(--tam-titulo-bloco); } }
</style>
