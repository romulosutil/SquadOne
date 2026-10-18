<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { navegar } from '../casca/rota'
import Sheet from '../components/Sheet.vue'
import CrmFicha from './CrmFicha.vue'
import CrmFunil from './CrmFunil.vue'
import CrmHoje from './CrmHoje.vue'
import CrmResultados from './CrmResultados.vue'
import ProximaVenda from './ProximaVenda.vue'
import { ETAPAS, PRODUTOS, ROTULO_DA_ETAPA, ROTULO_DO_PRODUTO, SIGLA_DO_PRODUTO, dataHora, hora } from './crm-formato'
import { lerFiltroDePasso, type FiltroDePasso } from './funil-lista'
import {
  AVISO_DE_FALHA_DA_ANOTACAO, anotar, corpoDaAnotacao, desanotar, gravarAnotados, lerAnotados, podarAnotados,
  type EnviosAnotados, type TipoDeEnvioAnotado,
} from './anotacao-de-envio'
import { gravarEnvios, lerEnvios, podarEnvios, type EnviosAbertos } from './fila-de-envio'
import { filaDaTela, lerResolvidas, noExpedienteDeVenda, type ResumoDoDia } from './proxima-venda'
import { avisoDeHorario } from './resultados'
import { absorverDia, liberadosDoDia, liberarLead } from './liberados'
import {
  gravarPrimeiros, instantesDePrimeiroContato, lerPrimeiros, marcarPrimeiro, ritmoDoEnvio, somarPrimeiros, type EstadoDoRitmo, type PrimeirosContatos,
} from './trava-de-ritmo'
import type { CrmEtapa, CrmGrupoHoje, CrmLead, CrmProduto, CrmVisao } from './types'
import {
  ABAS_DE_VENDAS, ENDERECO_DO_ROTEIRO, SECOES_DE_ENTENDER, abaDaVista, enderecoDeVendas, lerEnderecoDeVendas, vistaDaAba,
  type AbaDeVendas, type VistaDeVendas,
} from './vendas-abas'
import './crm.css'

// CRM da Central (/crm): Site antes da venda + PRUMO num modelo só, com as
// vistas Hoje (padrão), Funil e Resultados (08/10/2026) e a Ficha de um lead.
// Tudo vem do retrato que o n8n grava das planilhas (server/crm.ts); a
// Central não guarda etapa.
// 16/10/2026 (blueprint, OT-01, OT-05 e OT-12): a área se chama Vendas; "A fazer" é só a Próxima
// venda (a fila única; a folha "Enviar um por um" e a lista de grupos repetida saíram); a revisão de
// prospects ganhou a aba Triagem, fora do caminho da venda; e cada aba tem um nome só, também na URL
// (?ver=numeros; ?ver=resultados ainda abre, para links antigos).
// 17/10/2026 (AC-19, AC-20): quatro abas. O Roteiro saiu daqui: é consulta, não tarefa de venda, e
// mora no Mais (/mais?abrir=roteiro); ?ver=roteiro e ?ver=colinha vão para lá. A vista "Por passo
// da jornada" (?ver=jornada) virou o filtro Passo do Funil, e o endereço antigo cai nele.
// 17/10/2026 (hierarquia de Vendas): três abas na ordem do trabalho, Fazer (A fazer), Triar (Triagem)
// e Entender (Funil, Números e Resultados num segmentado, mais o botão do Roteiro de venda). O topo é
// uma linha de saúde do retrato com o Atualizar; os avisos condicionais ficam numa dobra "Avisos (n)",
// aberta sozinha só quando o retrato falhou. A dica de cada aba foi para o title, e as ofertas para um
// "Filtros" fechado fora da A fazer. As regras do endereço moram em vendas-abas.ts (PURO, testado).
type Vista = VistaDeVendas
type FiltroProduto = 'todos' | CrmProduto

const visao = ref<CrmVisao | null>(null)
const carregando = ref(true)
const erro = ref('')
const lidoEm = ref<Date | null>(null)
const agora = ref(Date.now())
const vista = ref<Vista>('afazer')
/** A seção de Entender aberta por último: tocar na aba volta a ela (o Funil na primeira vez). */
const ultimaDeEntender = ref<Vista>('funil')
const aba = computed<AbaDeVendas>(() => abaDaVista(vista.value))
const produto = ref<FiltroProduto>('todos')
const leadId = ref<string | null>(null)
const etapaEmFoco = ref<CrmEtapa | null>(null)
// O filtro Passo do Funil (AC-19) mora aqui, e não no CrmFunil, para ir no endereço (?passo=):
// as salas do Escritório abrem o Funil já num passo.
const passo = ref<FiltroDePasso>('')
const envios = ref<EnviosAbertos>({})
// Fora do expediente o link de envio fica travado até o "Liberar" daquele lead (trava-de-horario.ts).
// Desde 17/10/2026 (AC-21) um só para a Central, guardado no servidor até a meia-noite (liberados.ts):
// liberar na Próxima venda vale na Triagem e na Ficha, e recarregar não trava de novo.
const liberados = liberadosDoDia
// Trava de ritmo (trava-de-ritmo.ts, 15/10/2026): os toques de primeiro contato desta tela, até o
// retrato confirmar. Sem "Liberar": o que ela segura é a pressa de esvaziar a fila.
// Desde 17/10/2026 (AC-06) a fonte é o servidor (venda-do-dia.json, que a Próxima venda e o vendedor
// do Telegram também gravam); o localStorage fica de reforço até o servidor confirmar.
const primeiros = ref<PrimeirosContatos>({})
const primeirosDoServidor = ref<Record<string, { em: number }>>({})
async function lerPrimeirosDoServidor() {
  try {
    const r = await fetch('/api/operations/crm/venda', { cache: 'no-store' })
    if (!r.ok) return
    const corpo = await r.json() as { primeiros?: Record<string, { em: number }> }
    if (corpo?.primeiros && typeof corpo.primeiros === 'object') primeirosDoServidor.value = corpo.primeiros
    absorverDia(corpo)
  } catch { /* sem servidor: o retrato e o reforço local */ }
}
// O toque em "Mandar o link"/"Mandar o follow-up" anota o envio (anotacao-de-envio.ts); a marca
// local vale até o retrato confirmar. A falha não segura o WhatsApp: vira o aviso discreto abaixo.
const anotados = ref<EnviosAnotados>({})
const falhaDaAnotacao = ref<{ leadId: string; texto: string } | null>(null)
const anuncio = ref('')
let temporizador = 0
let relogio = 0
const atrasos: number[] = []

// As quatro ofertas do PRUMO (14/10/2026) dividem o funil; o filtro escolhe uma. Rótulo curto, o
// mesmo do selo do cartão e do celular (AC-19): eram "Serviços PRUMO" aqui e "Organizar" no celular.
const FILTROS: Array<{ id: FiltroProduto; rotulo: string }> = [
  { id: 'todos', rotulo: 'Todas' },
  ...PRODUTOS.map(id => ({ id, rotulo: SIGLA_DO_PRODUTO[id] })),
]

// ------------------------------------------------------------------ endereço (?ver=&produto=&passo=&lead=)

/** Lê o endereço; `false` quando ele foi para outra rota (o Roteiro, no Mais) e não há o que montar. */
function lerEndereco(): boolean {
  const lido = lerEnderecoDeVendas(window.location.search)
  // Links antigos (Ficha aberta com Ctrl, favoritos, o Hermes): o Roteiro saiu das abas (AC-20).
  if (lido.tipo === 'roteiro') {
    navegar(lido.para, true)
    return false
  }
  vista.value = lido.vista
  if (abaDaVista(lido.vista) === 'entender') ultimaDeEntender.value = lido.vista
  produto.value = PRODUTOS.find(id => id === lido.produto) ?? 'todos'
  passo.value = lido.vista === 'funil' ? lerFiltroDePasso(lido.passo) : ''
  leadId.value = lido.lead
  return true
}

function escreverEndereco(substituir = false) {
  const url = enderecoDeVendas({ vista: vista.value, produto: produto.value, passo: passo.value, lead: leadId.value })
  if (url === `${window.location.pathname}${window.location.search}`) return
  if (substituir) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}

// ?ver=jornada (e ?ver=resultados) viram o nome de hoje também ao voltar no navegador.
const aoVoltarNoNavegador = () => { if (lerEndereco()) escreverEndereco(true) }

// ------------------------------------------------------------------ leitura

async function carregar(anunciar = false) {
  carregando.value = true
  erro.value = ''
  void lerPrimeirosDoServidor()
  try {
    // no-cache: revalida com o ETag; sem mudança no retrato o servidor responde 304.
    const resposta = await fetch('/api/operations/crm', { cache: 'no-cache' })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    visao.value = corpo
    lidoEm.value = new Date()
    // Só um retrato legível diz quem ainda está pronto; sem ele, as marcas ficam.
    if (corpo.estado === 'ok') {
      const prontos = new Set<string>((corpo.leads ?? []).filter((l: CrmLead) => l.sinal === 'pronto').map((l: CrmLead) => l.id))
      guardarEnvios(podarEnvios(envios.value, prontos, Date.now()))
      guardarAnotados(podarAnotados(anotados.value, new Map((corpo.leads ?? []).map((l: CrmLead) => [l.id, l] as [string, CrmLead])), Date.now()))
    }
    if (anunciar) anuncio.value = `Vendas atualizado: ${corpo.leads?.length ?? 0} leads.`
  } catch (motivo) {
    erro.value = motivo instanceof Error ? motivo.message : String(motivo)
    if (anunciar) anuncio.value = 'Não foi possível ler Vendas.'
  } finally {
    carregando.value = false
  }
}

const aoMudarVisibilidade = () => { if (document.visibilityState === 'visible') carregar() }

// ------------------------------------------------------------------ envios abertos nesta tela (fila-de-envio.ts)

function armazenamento(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// A Triagem (AC-10) não marca mais "aberto no WhatsApp" aqui: o grupo dela não tem o link de envio
// do Site, e o convite tem a marca própria (triagem.ts). Fica só a poda das marcas já gravadas.
function guardarEnvios(novos: EnviosAbertos) {
  envios.value = novos
  gravarEnvios(armazenamento(), novos)
}

// Qualquer toque num link de primeiro contato (Hoje, Funil, Ficha, fila). O relógio anda na hora:
// sem isso a trava esperaria o próximo tique de 30 s e daria para tocar o seguinte.
function marcarPrimeiroContato(id: string) {
  primeiros.value = marcarPrimeiro(primeiros.value, id, Date.now())
  gravarPrimeiros(armazenamento(), primeiros.value)
  agora.value = Date.now()
  // O servidor conta para o Telegram e para outro navegador; falhar não segura o WhatsApp.
  void fetch('/api/operations/crm/venda/primeiro', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: id }),
  }).then(async (r) => {
    const corpo = r.ok ? await r.json() as { primeiros?: Record<string, { em: number }> } : null
    if (corpo?.primeiros && typeof corpo.primeiros === 'object') primeirosDoServidor.value = corpo.primeiros
  }).catch(() => undefined)
}

async function liberar(id: string) {
  const empresa = porId.value.get(id)?.empresa ?? 'Lead'
  anuncio.value = `${empresa}: envio liberado fora do expediente.`
  if (!(await liberarLead(id))) anuncio.value = `${empresa}: envio liberado só nesta aba (o servidor não guardou).`
}

/**
 * O "Liberar" do recado da Triagem: o mesmo de sempre, lead a lead (liberados.ts), para os do lote que
 * só o horário segura, de uma vez. Em série, para não empilhar POSTs; um anúncio só no fim.
 */
async function liberarVarios(ids: string[]) {
  if (!ids.length) return
  anuncio.value = `${ids.length} prospect${ids.length === 1 ? '' : 's'}: convite liberado fora do expediente hoje.`
  let guardados = 0
  for (const id of ids) if (await liberarLead(id)) guardados++
  if (guardados < ids.length) anuncio.value = `${ids.length - guardados} liberado${ids.length - guardados === 1 ? '' : 's'} só nesta aba (o servidor não guardou).`
}

// O n8n refaz o retrato logo depois de gravar o registro (uns 5 s).
function depoisDoRegistro() {
  atrasos.push(window.setTimeout(() => carregar(), 5000), window.setTimeout(() => carregar(), 15000))
}

// ------------------------------------------------------------------ envios anotados (anotacao-de-envio.ts)

function guardarAnotados(novos: EnviosAnotados) {
  anotados.value = novos
  gravarAnotados(armazenamento(), novos)
}

/**
 * O link já abriu o WhatsApp (é um <a target=_blank> comum); aqui só se anota, em segundo plano.
 * Falha (rede, n8n, validação) não desfaz nada no WhatsApp: tira a marca e pede a anotação à mão.
 */
async function anotarEnvio(id: string, tipo: TipoDeEnvioAnotado) {
  const lead = porId.value.get(id)
  if (!lead) return
  guardarAnotados(anotar(anotados.value, id, tipo, Date.now()))
  if (falhaDaAnotacao.value?.leadId === id) falhaDaAnotacao.value = null
  try {
    const resposta = await fetch('/api/operations/crm/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoDaAnotacao(lead, tipo)),
    })
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`)
    anuncio.value = `${lead.empresa}: ${tipo === 'segunda_enviada' ? '2ª mensagem anotada' : tipo === 'plus_enviado' ? 'primeira mensagem anotada' : 'follow-up anotado'}.`
    depoisDoRegistro()
  } catch {
    guardarAnotados(desanotar(anotados.value, id, tipo))
    falhaDaAnotacao.value = { leadId: id, texto: `${lead.empresa}: ${AVISO_DE_FALHA_DA_ANOTACAO}` }
  }
}

onMounted(async () => {
  envios.value = lerEnvios(armazenamento(), Date.now())
  anotados.value = lerAnotados(armazenamento(), Date.now())
  primeiros.value = lerPrimeiros(armazenamento(), Date.now())
  // Foi para o Roteiro (no Mais): a casca troca a rota e este painel desmonta já.
  if (!lerEndereco()) return
  escreverEndereco(true)
  window.addEventListener('popstate', aoVoltarNoNavegador)
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  await carregar()
  temporizador = window.setInterval(() => { if (document.visibilityState === 'visible') carregar() }, 120_000)
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
})

onBeforeUnmount(() => {
  window.removeEventListener('popstate', aoVoltarNoNavegador)
  document.removeEventListener('visibilitychange', aoMudarVisibilidade)
  window.clearInterval(temporizador)
  window.clearInterval(relogio)
  atrasos.forEach(id => window.clearTimeout(id))
})

// ------------------------------------------------------------------ derivados

const leads = computed(() => (visao.value?.leads ?? []).filter(l => produto.value === 'todos' || l.produto === produto.value))
const porId = computed(() => new Map((visao.value?.leads ?? []).map(l => [l.id, l] as [string, CrmLead])))
const hoje = computed<CrmGrupoHoje[]>(() => (visao.value?.hoje ?? []).map(g => ({
  ...g,
  itens: g.itens.filter(i => produto.value === 'todos' || porId.value.get(i.leadId)?.produto === produto.value),
})))
// O número da aba "A fazer" é o tamanho da fila da Próxima venda (AC-02, 17/10/2026): somar os grupos
// contava todos os primeiros contatos prontos (183 na aba para 3 no cartão), e a fila deixa entrar um
// por vez. Com o cartão montado vale o que ele contou (sabe o nicho, o "Liberar" e o que o servidor
// resolveu); sem ele (aberto direto em outra aba), a mesma conta pura com o que esta tela sabe.
const resumoDoCartao = ref<ResumoDoDia | null>(null)
// Fora da A fazer o cartão desmonta e a última conta dele pararia no tempo (o ritmo e o relógio andam).
watch(vista, (v) => { if (v !== 'afazer') resumoDoCartao.value = null })
const totalAFazer = computed(() => {
  if (resumoDoCartao.value) return resumoDoCartao.value.total
  const tela = { ritmo: ritmo.value, noExpediente: noExpedienteDeVenda(agora.value), agora: agora.value, liberados: liberados.value }
  return filaDaTela(visao.value, tela, lerResolvidas(armazenamento(), agora.value)).length
})
// Triagem (OT-05, AC-10): só os prospects para revisar, em lotes de 10 (triagem.ts), longe da fila de venda.
const triagem = computed(() => hoje.value.find(g => g.id === 'revisar') ?? null)
// Com a aba aberta, o número é o que ela conta (sem os dispensados e convidados desta tela que o
// retrato ainda não confirmou); fora dela, o tamanho do grupo do servidor.
const restantesDaTriagem = ref<number | null>(null)
watch(vista, (v) => { if (v !== 'triagem') restantesDaTriagem.value = null })
// O mínimo: a última conta da aba não pode passar do grupo (ela não conta de novo ao desmontar).
const totalTriagem = computed(() => {
  const doServidor = triagem.value?.itens.length ?? 0
  return restantesDaTriagem.value === null ? doServidor : Math.min(doServidor, restantesDaTriagem.value)
})
// Os números do aviso saem dos envios do Site (a fila só envia Site), não do filtro de produto da tela.
const avisoDaFila = computed(() => avisoDeHorario((visao.value?.leads ?? []).filter(l => l.produto === 'site'), agora.value))
// Todas as ofertas: o teto é do número de WhatsApp, não do filtro da tela.
const ritmo = computed<EstadoDoRitmo>(() => ritmoDoEnvio(
  instantesDePrimeiroContato(visao.value?.leads ?? [], somarPrimeiros(primeirosDoServidor.value, primeiros.value)), agora.value))
const contagens = computed(() => Object.fromEntries(ETAPAS.map(e => [e, leads.value.filter(l => l.etapa === e).length])) as Record<CrmEtapa, number>)
const lead = computed(() => (leadId.value ? porId.value.get(leadId.value) ?? null : null))

const idadeMin = computed(() => visao.value?.geradoEm ? Math.max(0, Math.round((agora.value - Date.parse(visao.value.geradoEm)) / 60_000)) : null)
const velho = computed(() => idadeMin.value === null || idadeMin.value > (visao.value?.minutosAteVelho ?? 30))
// Uma linha de saúde (17/10/2026): quando as planilhas foram lidas e há quanto tempo. O ciclo do n8n e
// a hora em que esta tela leu vão no title, para quem quiser.
const textoDoRetrato = computed(() => {
  if (!visao.value?.geradoEm) return 'Sem retrato das planilhas ainda.'
  const idade = idadeMin.value ?? 0
  const quando = idade < 1 ? 'agora há pouco' : idade < 60 ? `há ${idade} min` : `há ${Math.floor(idade / 60)} h`
  return `Planilhas lidas às ${hora(visao.value.geradoEm)} (${quando})`
})
const detalheDoRetrato = computed(() => `O n8n relê as planilhas a cada 10 min.${lidoEm.value ? ` Esta tela leu às ${hora(lidoEm.value.toISOString())}.` : ''}`)

// Os avisos condicionais do retrato, contados para o "Avisos (n)": nenhum some, todos dobrados juntos.
const avisos = computed(() => {
  const v = visao.value
  if (!v) return { falhou: false, quantos: 0 }
  const falhou = v.estado !== 'ok'
  const quantos = [
    falhou,
    !falhou && (velho.value || Boolean(v.ultimaFalha)),
    v.colunasAusentes.length > 0,
    !falhou && !v.pastasLidas,
    !falhou && Boolean(v.divergencias) && vista.value === 'funil',
  ].filter(Boolean).length
  return { falhou, quantos }
})

// ------------------------------------------------------------------ navegação

// Filtros (AC-15, 17/10/2026). No celular o botão da Próxima venda ficava a ~1.683 px do topo,
// depois de 6 chips de oferta e 5 cartões de etapa que nem mudam a fila (ela é de todas as ofertas).
// Os chips só aparecem onde filtram de verdade (Triagem e Entender: a Triagem lê os grupos da Hoje já
// filtrados pela oferta) e, desde a hierarquia de Vendas (17/10/2026), sempre num "Filtros" fechado com
// o filtro ativo no resumo, também no desktop: filtrar é ajuste, não a decisão da tela. Os cartões de
// etapa ficam só nos Números, à vista (no Funil cada coluna já traz o número).
const temFiltroDeOferta = computed(() => vista.value !== 'afazer')
const temCartoesDeEtapa = computed(() => vista.value === 'numeros')
const resumoDosFiltros = computed(() => (produto.value === 'todos' ? 'Filtros: todas as ofertas' : `Filtros: ${SIGLA_DO_PRODUTO[produto.value]}`))

function trocarVista(nova: Vista) {
  vista.value = nova
  if (abaDaVista(nova) === 'entender') ultimaDeEntender.value = nova
  leadId.value = null
  if (nova !== 'funil') passo.value = ''
  escreverEndereco()
}

function trocarAba(nova: AbaDeVendas) {
  trocarVista(vistaDaAba(nova, ultimaDeEntender.value))
}

function trocarProduto(novo: FiltroProduto) {
  produto.value = novo
  escreverEndereco(true)
  anuncio.value = `Mostrando ${FILTROS.find(p => p.id === novo)?.rotulo}.`
}

function trocarPasso(novo: FiltroDePasso) {
  passo.value = novo
  escreverEndereco(true)
}

async function irParaEtapa(etapa: CrmEtapa) {
  vista.value = 'funil'
  leadId.value = null
  etapaEmFoco.value = etapa
  escreverEndereco()
  await nextTick()
  const coluna = document.getElementById(`crm-coluna-${etapa}`)
  coluna?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest', inline: 'start' })
  coluna?.focus({ preventScroll: true })
}

// A ficha abre numa folha cheia por cima da lista (07/10/2026): a lista fica
// onde estava, e fechar devolve o foco ao botão que abriu (o Sheet faz isso).
// O endereço ganha ?lead=, então o "voltar" do celular fecha a folha.
function abrirFicha(id: string) {
  leadId.value = id
  escreverEndereco()
}

function fecharFicha() {
  leadId.value = null
  escreverEndereco()
}

// "Ver o roteiro inteiro", da Ficha: o roteiro mora no Mais (AC-20). pushState (não replace): o
// "voltar" traz de volta a Vendas com a mesma Ficha aberta (?lead= fica no histórico).
function abrirColinha() {
  navegar(ENDERECO_DO_ROTEIRO)
}
</script>

<template>
  <section class="crm" aria-labelledby="crm-titulo">
    <!-- Uma linha de saúde: o título, quando as planilhas foram lidas e o Atualizar. -->
    <header class="crm-topo">
      <div>
        <h1 id="crm-titulo">Vendas</h1>
        <p class="crm-topo__fonte" :title="detalheDoRetrato">{{ textoDoRetrato }}</p>
      </div>
      <button class="botao botao--leve" type="button" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Lendo…' : 'Atualizar' }}<span class="so-leitor"> Vendas</span></button>
    </header>
    <p class="so-leitor" aria-live="polite">{{ anuncio }}</p>
    <!-- Discreto de propósito: o WhatsApp já abriu; falta só a anotação, que dá para fazer na ficha (nota). -->
    <p v-if="falhaDaAnotacao" class="crm-nota-pequena crm-anotacao-falhou" role="alert">
      {{ falhaDaAnotacao.texto }}
      <button type="button" class="crm-mais" @click="falhaDaAnotacao = null">Entendi</button>
    </p>

    <div v-if="erro" class="crm-erro" role="alert"><strong>Vendas indisponível.</strong> {{ erro }} <button class="botao" type="button" @click="carregar(true)">Tentar de novo</button></div>

    <!-- Os avisos do retrato num lugar só, dobrados com a contagem; abertos sozinhos quando o retrato
         falhou (aí nada da tela vale até ele voltar). -->
    <details v-if="visao && avisos.quantos" class="dobra crm-avisos" :open="avisos.falhou">
      <summary>Avisos ({{ avisos.quantos }})</summary>
      <div v-if="visao.estado !== 'ok'" class="crm-aviso is-forte" role="status">
        <strong>{{ visao.estado === 'sem-retrato' ? 'Ainda sem retrato das planilhas.' : 'Retrato ilegível.' }}</strong> {{ visao.mensagem }}
        <template v-if="visao.ultimaFalha"> Última tentativa do n8n ({{ dataHora(visao.ultimaFalha.em) }}): {{ visao.ultimaFalha.erro }}</template>
      </div>
      <div v-else-if="velho || visao.ultimaFalha" class="crm-aviso" role="status">
        <strong>Retrato desatualizado.</strong> Os números são de {{ dataHora(visao.geradoEm) }}.
        <template v-if="visao.ultimaFalha"> O n8n não conseguiu ler as planilhas em {{ dataHora(visao.ultimaFalha.em) }}: {{ visao.ultimaFalha.erro }}</template>
      </div>
      <p v-if="visao.colunasAusentes.length" class="crm-nota-pequena">Colunas que a planilha ainda não tem (Vendas trata como vazias): {{ visao.colunasAusentes.join(', ') }}.</p>
      <p v-if="visao.estado === 'ok' && !visao.pastasLidas" class="crm-nota-pequena">A pasta ~/auto-site não foi lida: sem conferência de pastas agora.</p>
      <!-- A divergência é marcada no Funil: só conta como aviso lá. -->
      <p v-if="visao.estado === 'ok' && visao.divergencias && vista === 'funil'" class="crm-nota-pequena">
        {{ visao.divergencias }} lead{{ visao.divergencias === 1 ? '' : 's' }} com divergência entre planilha e pasta (marcados no Funil).
        <template v-if="visao.pastasSemLinha.length"> {{ visao.pastasSemLinha.length }} pasta(s) sem linha na planilha.</template>
      </p>
    </details>

    <div v-if="visao || erro" class="crm-controles">
      <!-- Três abas na ordem do trabalho (17/10/2026): Fazer, Triar, Entender. A dica de cada uma vai no
           title. No celular, uma linha que rola de lado (AC-15). -->
      <nav class="crm-vistas" aria-label="Vendas: fazer, triar, entender">
        <a v-for="a in ABAS_DE_VENDAS" :key="a.id" :href="a.href" :title="a.dica" :aria-current="aba === a.id ? 'page' : undefined" @click.prevent="trocarAba(a.id)">
          {{ a.rotulo }} <span v-if="visao && a.id === 'afazer'">{{ totalAFazer }}</span><span v-else-if="visao && a.id === 'triagem'">{{ totalTriagem }}</span>
        </a>
      </nav>
      <!-- Entender: as três seções num segmentado (BP-SEGMENTADO) e o Roteiro de venda, que mora no Mais. -->
      <div v-if="aba === 'entender'" class="crm-entender">
        <div class="segmentado segmentado--auto" role="group" aria-label="Entender">
          <button v-for="s in SECOES_DE_ENTENDER" :key="s.id" type="button" :title="s.dica" :aria-pressed="vista === s.id" @click="trocarVista(s.id)">{{ s.rotulo }}</button>
        </div>
        <a class="botao botao--leve" :href="ENDERECO_DO_ROTEIRO" @click.prevent="abrirColinha">Roteiro de venda</a>
      </div>
      <!-- As ofertas num "Filtros" fechado, com a escolhida no resumo: filtrar é ajuste, não a decisão. -->
      <details v-if="temFiltroDeOferta" class="dobra crm-filtros-da-aba">
        <summary>{{ resumoDosFiltros }}</summary>
        <div class="crm-produtos" role="group" aria-label="Ofertas do PRUMO">
          <button v-for="p in FILTROS" :key="p.id" type="button" :aria-pressed="produto === p.id" @click="trocarProduto(p.id)">{{ p.rotulo }}</button>
        </div>
      </details>
    </div>

    <template v-if="visao">
      <ProximaVenda v-if="vista === 'afazer'" :visao="visao" @registrado="depoisDoRegistro" @abrir="abrirFicha" @resumo="resumoDoCartao = $event" />
      <template v-else-if="vista === 'triagem'">
        <CrmHoje
          v-if="triagem?.itens.length" :grupo="triagem" :leads="porId" :aviso="avisoDaFila" :liberados="liberados" :ritmo="ritmo" :agora="agora"
          :registro="visao.registro" :confirmavel="visao.estado === 'ok'"
          @abrir="abrirFicha" @liberar-lote="liberarVarios" @primeiro="marcarPrimeiroContato" @registrado="depoisDoRegistro" @restantes="restantesDaTriagem = $event"
          @sinais-lidos="carregar()"
        />
        <p v-else class="crm-vazio"><strong>Nada para triar.</strong> Quando os caçadores acharem prospects novos, eles aparecem aqui.</p>
      </template>
      <template v-else-if="vista === 'numeros'">
        <!-- No Funil cada coluna (ou aba, no celular) já traz o número: o resumo só repetiria. -->
        <ol v-if="temCartoesDeEtapa && visao.estado === 'ok'" class="crm-resumo" aria-label="Resumo do funil (toque para abrir a etapa)">
          <li v-for="etapa in ETAPAS" :key="etapa" :class="`is-${etapa}`">
            <button type="button" @click="irParaEtapa(etapa)">
              <strong>{{ contagens[etapa] }}</strong>
              <span>{{ ROTULO_DA_ETAPA[etapa] }}</span>
            </button>
          </li>
        </ol>
        <CrmResultados parte="numeros" :leads="leads" :agora="agora" />
      </template>
      <CrmResultados v-else-if="vista === 'resultados'" parte="resultados" :leads="leads" :agora="agora" />
      <CrmFunil
        v-else-if="vista === 'funil'" :leads="leads" :visao="visao" :agora="agora" :etapa-em-foco="etapaEmFoco" :produto="produto" :passo="passo"
        :aviso="avisoDaFila" :liberados="liberados" :anotados="anotados" :ritmo="ritmo"
        @abrir="abrirFicha" @passo="trocarPasso" @liberar="liberar" @anotar="anotarEnvio" @primeiro="marcarPrimeiroContato"
      />

      <Sheet v-if="leadId" cheia titulo="Ficha do lead" :subtitulo="lead ? ROTULO_DO_PRODUTO[lead.produto] : ''" @fechar="fecharFicha">
        <div class="crm-na-folha">
          <CrmFicha
            v-if="lead" :key="lead.id" :lead="lead" :visao="visao" :aviso="avisoDaFila" :liberados="liberados" :anotados="anotados" :ritmo="ritmo"
            :falha-da-anotacao="falhaDaAnotacao?.leadId === lead.id ? falhaDaAnotacao.texto : ''"
            @registrado="depoisDoRegistro" @colinha="abrirColinha" @liberar="liberar" @anotar="anotarEnvio" @primeiro="marcarPrimeiroContato"
          />
          <p v-else class="crm-aviso" role="status">Este lead não está no retrato atual: pode ter saído da planilha ou mudado de id.</p>
        </div>
      </Sheet>

      <footer v-if="visao.estado === 'ok'" class="crm-rodape">
        <span v-for="f in visao.fontes" :key="f.id">{{ f.nome }}: {{ f.linhas }} linha{{ f.linhas === 1 ? '' : 's' }}<template v-if="f.erro"> ({{ f.erro }})</template></span>
        <a v-if="visao.links.planilhaSite" :href="visao.links.planilhaSite" target="_blank" rel="noopener">Planilha do Site ↗</a>
        <a v-if="visao.links.planilhaPrumo" :href="visao.links.planilhaPrumo" target="_blank" rel="noopener">Planilha do PRUMO ↗</a>
        <a v-if="visao.links.planilhaIris" :href="visao.links.planilhaIris" target="_blank" rel="noopener">Aba Clínicas (Iris) ↗</a>
        <a v-if="visao.links.planilhaEstampa" :href="visao.links.planilhaEstampa" target="_blank" rel="noopener">Aba Estamparias ↗</a>
      </footer>
    </template>
    <p v-else-if="carregando" class="crm-muted" role="status">Lendo Vendas…</p>
  </section>
</template>

<style>
/* Entender (17/10/2026): o segmentado das três seções e o Roteiro de venda numa linha inteira, embaixo das abas. */
.crm-entender { display: flex; flex-wrap: wrap; flex-basis: 100%; align-items: center; gap: var(--esp-2) var(--esp-3); min-width: 0; }
.crm-entender .segmentado button { padding: 0 var(--esp-4); }
/* Os avisos do retrato, dobrados: abertos, cada um na sua linha. */
.crm-avisos[open] { display: grid; gap: var(--esp-2); min-width: 0; }
</style>
