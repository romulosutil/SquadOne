<script setup lang="ts">
import { useSinalDoCrm } from '../casca/sinal-do-crm'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { navegar } from '../casca/rota'
import Sheet from '../components/Sheet.vue'
import CrmFicha from './CrmFicha.vue'
import CrmFunil from './CrmFunil.vue'
import FrenteComercial from './FrenteComercial.vue'
import '../estilos/operacao.css'
import CrmHoje from './CrmHoje.vue'
import CrmResultados from './CrmResultados.vue'
import ConversasParaAvancar from './ConversasParaAvancar.vue'
import { conversasParaVoce } from './conversas-para-conduzir'
import { coberturaDoHistorico } from './historico-comercial'
import { ETAPAS, PRODUTOS, ROTULO_DA_ETAPA, ROTULO_DO_PRODUTO, SIGLA_DO_PRODUTO, dataHora, hora } from './crm-formato'
import { lerFiltroDePasso, type FiltroDePasso } from './funil-lista'
import type { Resolvidas } from './proxima-venda'
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
// 16/10/2026 (blueprint, OT-01, OT-05 e OT-12): a área se chama Vendas; a revisão de prospects ganhou
// a aba Triagem, fora do caminho da venda; e cada aba tem um nome só, também na URL (?ver=numeros;
// ?ver=resultados ainda abre, para links antigos). Desde 19/10/2026 os nomes da tela são NOME_DAS_ABAS
// (vendas-abas.ts): Conversas para você (id afazer, que no lugar da Próxima venda lista as conversas e os
// passos da fila), Primeiros contatos (id triagem) e Entender (Funil, Diagnóstico e Resultados).
// 17/10/2026 (AC-19, AC-20): quatro abas. O Roteiro saiu daqui: é consulta, não tarefa de venda, e
// mora no Mais (/mais?abrir=roteiro); ?ver=roteiro e ?ver=colinha vão para lá. A vista "Por passo
// da jornada" (?ver=jornada) virou o filtro Passo do Funil, e o endereço antigo cai nele.
// 17/10/2026 (hierarquia de Vendas): três abas na ordem do trabalho, Fazer, Triar e Entender (Funil,
// Diagnóstico e Resultados num segmentado, mais o botão do Roteiro de venda). O topo é
// uma linha de saúde do retrato com o Atualizar; os avisos condicionais ficam numa dobra "Avisos (n)",
// aberta sozinha só quando o retrato falhou. A dica de cada aba foi para o title, e as ofertas para um
// "Filtros" fechado fora das Conversas para você. As regras do endereço moram em vendas-abas.ts (PURO, testado).
const props = defineProps<{ fichaInicial?: string }>()
const emit = defineEmits<{ fechar: []; registrado: [] }>()

type Vista = VistaDeVendas
type FiltroProduto = 'todos' | CrmProduto

const visao = ref<CrmVisao | null>(null)
const carregando = ref(false)
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
// Fora do expediente o link de envio fica travado até o "Liberar" daquele lead (trava-de-horario.ts).
// Desde 17/10/2026 (AC-21) um só para a Central, guardado no servidor até a meia-noite (liberados.ts):
// liberar na Próxima venda vale na Triagem e na Ficha, e recarregar não trava de novo.
const liberados = liberadosDoDia
// Trava de ritmo (trava-de-ritmo.ts, 15/10/2026): os toques de primeiro contato desta tela, até o
// retrato confirmar. Sem "Liberar": o que ela segura é a pressa de esvaziar a fila.
// Desde 17/10/2026 (AC-06) a fonte é o servidor (venda-do-dia.json, que o vendedor do Telegram e o time
// comercial também gravam); o localStorage fica de reforço até o servidor confirmar.
const primeiros = ref<PrimeirosContatos>({})
const primeirosDoServidor = ref<Record<string, { em: number }>>({})
const pausaPrimeiros = ref<{ detalhe: string } | null>({ detalhe: 'Aguardando a conferência dos primeiros contatos.' })
/** O "Enviei"/"Pular" do dia (o mesmo arquivo do Telegram): tira da lista "Conversas para você" o que já foi resolvido. */
const resolvidas = ref<Resolvidas>({})
/**
 * O dia do servidor (GET /crm/venda) só é lido onde alguém o usa: a lista de conversas (resolvidas), a
 * Primeiros contatos (ritmo e "Liberar") e a Ficha aberta (ritmo e "Liberar"). Funil, Diagnóstico e
 * Resultados não precisam dele, e a leitura a cada 30 s ia à toa (VEN-22).
 */
const precisaDoDia = computed(() => vista.value === 'afazer' || vista.value === 'triagem' || leadId.value !== null)
async function lerDoDia() {
  try {
    const r = await fetch('/api/operations/crm/venda', { cache: 'no-store' })
    if (!r.ok) throw new Error('Proteção indisponível')
    const corpo = await r.json() as { primeiros?: Record<string, { em: number }>; resolvidas?: Resolvidas; pausaPrimeiros?: { detalhe: string } | null }
    pausaPrimeiros.value = corpo.pausaPrimeiros ?? null
    if (corpo?.primeiros && typeof corpo.primeiros === 'object') primeirosDoServidor.value = corpo.primeiros
    resolvidas.value = corpo?.resolvidas && typeof corpo.resolvidas === 'object' ? corpo.resolvidas : {}
    absorverDia(corpo)
  } catch { pausaPrimeiros.value = { detalhe: 'Não foi possível conferir a proteção. Aguarde a atualização antes de iniciar contato.' } }
}
const anuncio = ref('')
/** O servidor não guardou o convite aberto: vale só neste aparelho (o ritmo do Telegram e do time não sabe). */
const avisoDoPrimeiro = ref('')
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
  const lido = lerEnderecoDeVendas(props.fichaInicial ? `?lead=${encodeURIComponent(props.fichaInicial)}` : window.location.search)
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
  if (props.fichaInicial) return
  const url = enderecoDeVendas({ vista: vista.value, produto: produto.value, passo: passo.value, lead: leadId.value })
  if (url === `${window.location.pathname}${window.location.search}`) return
  if (substituir) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}

// ?ver=jornada (e ?ver=resultados) viram o nome de hoje também ao voltar no navegador.
const aoVoltarNoNavegador = () => { if (lerEndereco()) escreverEndereco(true) }

// ------------------------------------------------------------------ leitura

async function carregar(anunciar = false) {
  if (desmontado) return
  if (carregando.value) { releituraPendente = true; return }
  releituraPendente = false
  const controle = new AbortController()
  const prazo = window.setTimeout(() => controle.abort(), 25_000)
  carregando.value = true
  erro.value = ''
  if (precisaDoDia.value) void lerDoDia()
  try {
    // no-cache: revalida com o ETag; sem mudança no retrato o servidor responde 304.
    const resposta = await fetch('/api/operations/crm', { cache: 'no-cache', signal: controle.signal })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    visao.value = corpo
    lidoEm.value = new Date()
    if (anunciar) anuncio.value = `Vendas atualizado: ${corpo.leads?.length ?? 0} leads.`
  } catch (motivo) {
    erro.value = motivo instanceof Error ? motivo.message : String(motivo)
    if (anunciar) anuncio.value = 'Não foi possível ler Vendas.'
  } finally {
    window.clearTimeout(prazo)
    carregando.value = false
    if (releituraPendente && !desmontado) void carregar()
  }
}

const aoMudarVisibilidade = () => { if (document.visibilityState === 'visible') carregar() }

// ------------------------------------------------------------------ marcas locais

function armazenamento(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// Qualquer toque num link de primeiro contato (Triagem, Ficha). Abrir o WhatsApp não é enviar (regra
// [abrir-nao-envia]), mas conta no ritmo, do lado seguro: um convite aberto e não enviado só atrasa o
// próximo. O relógio anda na hora: sem isso a trava esperaria o próximo tique de 30 s e daria para
// tocar o seguinte.
function marcarPrimeiroContato(id: string) {
  primeiros.value = marcarPrimeiro(primeiros.value, id, Date.now())
  gravarPrimeiros(armazenamento(), primeiros.value)
  agora.value = Date.now()
  avisoDoPrimeiro.value = ''
  // O servidor conta para o Telegram, o time e outro navegador; falhar não segura o WhatsApp, mas não se esconde.
  void fetch('/api/operations/crm/venda/primeiro', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ leadId: id }),
  }).then(async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const corpo = await r.json() as { primeiros?: Record<string, { em: number }> }
    if (corpo?.primeiros && typeof corpo.primeiros === 'object') primeirosDoServidor.value = corpo.primeiros
  }).catch(() => {
    avisoDoPrimeiro.value = 'O servidor não guardou este convite aberto: ele conta no ritmo só neste aparelho. O Telegram e o time podem não saber.'
  })
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
  emit('registrado')
  void carregar()
  atrasos.push(window.setTimeout(() => carregar(), 5000), window.setTimeout(() => carregar(), 15000))
}

let desmontado = false
let releituraPendente = false
useSinalDoCrm(() => carregar())
onMounted(async () => {
  primeiros.value = lerPrimeiros(armazenamento(), Date.now())
  // Foi para o Roteiro (no Mais): a casca troca a rota e este painel desmonta já.
  if (!lerEndereco()) return
  escreverEndereco(true)
  if (!props.fichaInicial) window.addEventListener('popstate', aoVoltarNoNavegador)
  document.addEventListener('visibilitychange', aoMudarVisibilidade)
  window.addEventListener('focus', aoMudarVisibilidade)
  await carregar()
  if (desmontado) return
  temporizador = window.setInterval(() => { if (document.visibilityState === 'visible') carregar() }, 15_000)
  relogio = window.setInterval(() => { agora.value = Date.now() }, 30_000)
})

onBeforeUnmount(() => {
  desmontado = true
  window.removeEventListener('popstate', aoVoltarNoNavegador)
  document.removeEventListener('visibilitychange', aoMudarVisibilidade)
  window.removeEventListener('focus', aoMudarVisibilidade)
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
// O número da aba "Conversas para você" é o tamanho da própria lista (conversasParaVoce): a mesma conta
// do "Sua vez" da Central, sem os primeiros contatos (que são da aba Primeiros contatos, AC-02).
const totalAFazer = computed(() => conversasParaVoce(visao.value, agora.value, resolvidas.value).length)
// Triagem (OT-05, AC-10): só os prospects para revisar, em lotes de 10 (triagem.ts), longe da fila de venda.
const triagem = computed(() => hoje.value.find(g => g.id === 'revisar') ?? null)
// Com a aba aberta, o número é o que ela conta (sem os dispensados e convidados desta tela que o
// retrato ainda não confirmou); fora dela, o tamanho do grupo do servidor.
const restantesDaTriagem = ref<number | null>(null)
watch(vista, (v) => { if (v !== 'triagem') restantesDaTriagem.value = null })
// Voltou a uma aba que usa o dia do servidor: relê já, em vez de esperar o próximo ciclo de 30 s.
watch(precisaDoDia, (usa) => { if (usa) void lerDoDia() })
// O mínimo: a última conta da aba não pode passar do grupo (ela não conta de novo ao desmontar).
const totalTriagem = computed(() => {
  const doServidor = triagem.value?.itens.length ?? 0
  return restantesDaTriagem.value === null ? doServidor : Math.min(doServidor, restantesDaTriagem.value)
})
// Os números do aviso saem dos envios do Site (a fila só envia Site), não do filtro de produto da tela.
const avisoDaFila = computed(() => avisoDeHorario((visao.value?.leads ?? []).filter(l => l.produto === 'site'), agora.value))
// Todas as ofertas: o teto é do número de WhatsApp, não do filtro da tela.
const ritmo = computed<EstadoDoRitmo>(() => {
  const atual = ritmoDoEnvio(instantesDePrimeiroContato(visao.value?.leads ?? [], somarPrimeiros(primeirosDoServidor.value, primeiros.value)), agora.value)
  return pausaPrimeiros.value ? { ...atual, motivo: 'pausa', ate: null } : atual
})
const cobertura = computed(() => coberturaDoHistorico((visao.value?.leads ?? []).filter((l) => l.produto === 'site' || l.produto === 'prumo')))
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
const temFiltroDeOferta = computed(() => vista.value !== 'afazer' && vista.value !== 'triagem')
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
  if (props.fichaInicial) emit('fechar')
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
  <section v-if="!fichaInicial" class="crm" aria-labelledby="crm-titulo">
    <!-- Uma linha de saúde: o título, quando as planilhas foram lidas e o Atualizar. -->
    <header class="crm-topo">
      <div>
        <h1 id="crm-titulo">Vendas</h1>
        <p class="crm-topo__fonte" :title="detalheDoRetrato">{{ textoDoRetrato }}</p>
      </div>
<span class="sincronizacao">Atualização automática</span>
    </header>
    <p class="so-leitor" aria-live="polite">{{ anuncio }}</p>
    <!-- Discreto de propósito: o WhatsApp já abriu; só o ritmo do servidor ficou sem saber do convite aberto. -->
    <p v-if="pausaPrimeiros && precisaDoDia" class="recado recado--atencao" role="status">{{ pausaPrimeiros.detalhe }} Respostas às conversas existentes continuam disponíveis.</p>
    <p v-if="avisoDoPrimeiro" class="crm-nota-pequena crm-anotacao-falhou" role="alert">
      {{ avisoDoPrimeiro }}
      <button type="button" class="crm-mais" @click="avisoDoPrimeiro = ''">Entendi</button>
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
        <a v-for="a in ABAS_DE_VENDAS.filter((a) => a.id !== 'entender')" :key="a.id" :href="a.href" :title="a.dica" :aria-current="aba === a.id ? 'page' : undefined" @click.prevent="trocarAba(a.id)">
          {{ a.rotulo }} <span v-if="visao && a.id === 'afazer'">{{ totalAFazer }}</span>
        </a>
        <a v-for="s in SECOES_DE_ENTENDER" :key="s.id" :href="`/crm?ver=${s.id}`" :title="s.dica" :aria-current="vista === s.id ? 'page' : undefined" @click.prevent="trocarVista(s.id)">{{ s.rotulo }}</a>
      </nav>
      <!-- Entender: as três seções num segmentado (BP-SEGMENTADO) e o Roteiro de venda, que mora no Mais. -->

      <!-- As ofertas num "Filtros" fechado, com a escolhida no resumo: filtrar é ajuste, não a decisão. -->
      <details v-if="temFiltroDeOferta" class="dobra crm-filtros-da-aba">
        <summary>{{ resumoDosFiltros }}</summary>
        <div class="crm-produtos" role="group" aria-label="Ofertas do PRUMO">
          <button v-for="p in FILTROS" :key="p.id" type="button" :aria-pressed="produto === p.id" @click="trocarProduto(p.id)">{{ p.rotulo }}</button>
        </div>
      </details>
    </div>

    <template v-if="visao">
      <ConversasParaAvancar v-if="vista === 'afazer'" :visao="visao" :agora="agora" :resolvidas="resolvidas" :maximo="20" @abrir="abrirFicha" />
      <!-- O time só pega o Site em `pronto`; a Triagem (`revisar`) e o Convidar seguem do Rômulo (19/10/2026). -->
      <template v-else-if="vista === 'triagem'">
        <FrenteComercial />
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
        <CrmResultados parte="numeros" :leads="leads" :todos-leads="visao.leads" :agora="agora" />
      </template>
      <CrmResultados v-else-if="vista === 'resultados'" parte="resultados" :leads="leads" :todos-leads="visao.leads" :agora="agora" />
      <CrmFunil
        v-else-if="vista === 'funil'" :leads="leads" :visao="visao" :agora="agora" :etapa-em-foco="etapaEmFoco" :produto="produto" :passo="passo"
        @abrir="abrirFicha" @passo="trocarPasso"
      />



      <details v-if="visao.estado === 'ok'" class="dobra crm-fontes">
        <summary>Leitura e fontes · {{ cobertura.comArquivo }} de {{ cobertura.contatados }} contatos com mensagens guardadas</summary>
        <p>Site e Organizado: {{ cobertura.semArquivo }} sem conversa arquivada; {{ cobertura.conferidos }} com contexto acompanhado. Mensagens guardadas são parciais, não prova de histórico completo.</p>
        <footer class="crm-rodape">
        <span v-for="f in visao.fontes" :key="f.id">{{ f.nome }}: {{ f.linhas }} linha{{ f.linhas === 1 ? '' : 's' }}<template v-if="f.erro"> ({{ f.erro }})</template></span>
        <a v-if="visao.links.planilhaSite" :href="visao.links.planilhaSite" target="_blank" rel="noopener">Planilha do Site ↗</a>
        <a v-if="visao.links.planilhaPrumo" :href="visao.links.planilhaPrumo" target="_blank" rel="noopener">Planilha do PRUMO ↗</a>
        <a v-if="visao.links.planilhaIris" :href="visao.links.planilhaIris" target="_blank" rel="noopener">Aba Clínicas (Iris) ↗</a>
        <a v-if="visao.links.planilhaEstampa" :href="visao.links.planilhaEstampa" target="_blank" rel="noopener">Aba Estamparias ↗</a>
        <a :href="ENDERECO_DO_ROTEIRO" @click.prevent="abrirColinha">Roteiro de venda →</a>
        </footer>
      </details>
    </template>
    <p v-else-if="carregando" class="crm-muted" role="status">Lendo Vendas…</p>
  </section>
      <Sheet v-if="leadId" flutuante titulo="Ficha do lead" :subtitulo="lead ? ROTULO_DO_PRODUTO[lead.produto] : ''" @fechar="fecharFicha">
        <div class="crm-na-folha">
          <CrmFicha
            v-if="lead && visao" :key="lead.id" :lead="lead" :visao="visao" :aviso="avisoDaFila" :liberados="liberados" :ritmo="ritmo"
            @registrado="depoisDoRegistro" @colinha="abrirColinha" @liberar="liberar" @primeiro="marcarPrimeiroContato"
          />
          <p v-else-if="carregando" role="status">Lendo a ficha…</p>
          <p v-else-if="erro" class="recado recado--erro" role="alert">{{ erro }} <button type="button" class="botao" @click="carregar(true)">Tentar de novo</button></p>
          <p v-else class="crm-aviso" role="status">Este lead não está no retrato atual: pode ter saído da planilha ou mudado de id.</p>
        </div>
      </Sheet>
</template>

<style>
/* Entender (17/10/2026): o segmentado das três seções e o Roteiro de venda numa linha inteira, embaixo das abas. */
.crm-entender { display: flex; flex-wrap: wrap; flex-basis: 100%; align-items: center; gap: var(--esp-2) var(--esp-3); min-width: 0; }
.crm-entender .segmentado button { padding: 0 var(--esp-4); }
/* Os avisos do retrato, dobrados: abertos, cada um na sua linha. */
.crm-avisos[open] { display: grid; gap: var(--esp-2); min-width: 0; }
</style>
