<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Sheet from '../components/Sheet.vue'
import CrmColinha from './CrmColinha.vue'
import CrmFicha from './CrmFicha.vue'
import CrmFunil from './CrmFunil.vue'
import CrmHoje from './CrmHoje.vue'
import CrmJornadaVista from './CrmJornadaVista.vue'
import CrmResultados from './CrmResultados.vue'
import ProximaVenda from './ProximaVenda.vue'
import { ETAPAS, PRODUTOS, ROTULO_DA_ETAPA, ROTULO_DO_PRODUTO, dataHora, hora } from './crm-formato'
import {
  AVISO_DE_FALHA_DA_ANOTACAO, anotar, corpoDaAnotacao, desanotar, gravarAnotados, lerAnotados, podarAnotados,
  type EnviosAnotados, type TipoDeEnvioAnotado,
} from './anotacao-de-envio'
import { gravarEnvios, lerEnvios, podarEnvios, type EnviosAbertos } from './fila-de-envio'
import { filaDaTela, lerResolvidas, noExpedienteDeVenda, type ResumoDoDia } from './proxima-venda'
import { avisoDeHorario } from './resultados'
import { liberarEnvio, type EnviosLiberados } from './trava-de-horario'
import {
  gravarPrimeiros, instantesDePrimeiroContato, lerPrimeiros, marcarPrimeiro, ritmoDoEnvio, somarPrimeiros, type EstadoDoRitmo, type PrimeirosContatos,
} from './trava-de-ritmo'
import type { CrmEtapa, CrmGrupoHoje, CrmLead, CrmProduto, CrmVisao } from './types'
import './crm.css'

// CRM da Central (/crm): Site antes da venda + PRUMO num modelo só, com as
// vistas Hoje (padrão), Funil e Resultados (08/10/2026) e a Ficha de um lead.
// Tudo vem do retrato que o n8n grava das planilhas (server/crm.ts); a
// Central não guarda etapa. A Colinha (?ver=colinha) é a exceção: texto
// estático (colinha.ts), que aparece mesmo com o CRM fora do ar.
// Jornada (?ver=jornada, 15/10/2026): os leads por passo da jornada (jornada.ts), com quem espera quem.
// 16/10/2026 (blueprint, OT-01, OT-05 e OT-12): a área se chama Vendas; "A fazer" é só a Próxima
// venda (a fila única; a folha "Enviar um por um" e a lista de grupos repetida saíram); a revisão de
// prospects ganhou a aba Triagem, fora do caminho da venda; e cada aba tem um nome só, também na URL
// (?ver=numeros e ?ver=roteiro; ?ver=resultados e ?ver=colinha ainda abrem, para links antigos).
type Vista = 'afazer' | 'triagem' | 'funil' | 'jornada' | 'numeros' | 'roteiro'
type FiltroProduto = 'todos' | CrmProduto

const visao = ref<CrmVisao | null>(null)
const carregando = ref(true)
const erro = ref('')
const lidoEm = ref<Date | null>(null)
const agora = ref(Date.now())
const vista = ref<Vista>('afazer')
const produto = ref<FiltroProduto>('todos')
const leadId = ref<string | null>(null)
const etapaEmFoco = ref<CrmEtapa | null>(null)
const envios = ref<EnviosAbertos>({})
// Fora do expediente o link de envio fica travado até o "Liberar" daquele lead (trava-de-horario.ts):
// só em memória, de propósito. Recarregou a página ou voltou o expediente, o ciclo recomeça.
const liberados = ref<EnviosLiberados>(new Set())
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

// As quatro ofertas do PRUMO (14/10/2026) dividem o funil; o filtro escolhe uma.
const FILTROS: Array<{ id: FiltroProduto; rotulo: string }> = [
  { id: 'todos', rotulo: 'Todas' },
  ...PRODUTOS.map(id => ({ id, rotulo: ROTULO_DO_PRODUTO[id] })),
]

// ------------------------------------------------------------------ endereço (?ver=&produto=&lead=)

function lerEndereco() {
  const q = new URLSearchParams(window.location.search)
  const ver = q.get('ver')
  vista.value = ver === 'funil' || ver === 'jornada' || ver === 'triagem' ? ver
    : ver === 'numeros' || ver === 'resultados' ? 'numeros'
    : ver === 'roteiro' || ver === 'colinha' ? 'roteiro'
    : 'afazer'
  const p = q.get('produto')
  produto.value = PRODUTOS.find(id => id === p) ?? 'todos'
  leadId.value = q.get('lead')
}

function escreverEndereco(substituir = false) {
  const q = new URLSearchParams()
  if (vista.value !== 'afazer') q.set('ver', vista.value)
  if (produto.value !== 'todos') q.set('produto', produto.value)
  if (leadId.value) q.set('lead', leadId.value)
  const busca = q.toString()
  const url = `/crm${busca ? `?${busca}` : ''}`
  if (url === `${window.location.pathname}${window.location.search}`) return
  if (substituir) history.replaceState(null, '', url)
  else history.pushState(null, '', url)
}

const aoVoltarNoNavegador = () => lerEndereco()

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
    if (anunciar) anuncio.value = `CRM atualizado: ${corpo.leads?.length ?? 0} leads.`
  } catch (motivo) {
    erro.value = motivo instanceof Error ? motivo.message : String(motivo)
    if (anunciar) anuncio.value = 'Não foi possível ler o CRM.'
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

function liberar(id: string) {
  liberados.value = liberarEnvio(liberados.value, id)
  anuncio.value = `${porId.value.get(id)?.empresa ?? 'Lead'}: envio liberado fora do expediente.`
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
  lerEndereco()
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
const textoDoRetrato = computed(() => {
  if (!visao.value?.geradoEm) return 'Sem retrato das planilhas ainda.'
  const idade = idadeMin.value ?? 0
  const quando = idade < 1 ? 'agora há pouco' : idade < 60 ? `há ${idade} min` : `há ${Math.floor(idade / 60)} h`
  return `Planilhas lidas às ${hora(visao.value.geradoEm)} (${quando}) · o n8n relê a cada 10 min`
})

// ------------------------------------------------------------------ navegação

// As abas dizem a tarefa, e a linha embaixo diz para que serve a aba aberta.
const VISTAS: Array<{ id: Vista; rotulo: string; href: string; dica: string }> = [
  { id: 'afazer', rotulo: 'A fazer', href: '/crm', dica: 'A próxima venda, uma por vez, na ordem de quem está mais perto de comprar. "Ver a fila inteira" mostra o resto.' },
  { id: 'triagem', rotulo: 'Triagem', href: '/crm?ver=triagem', dica: 'Prospects que os caçadores acharam, em lotes de 10: convide ou dispense cada um. Não é venda: fica fora do A fazer.' },
  { id: 'funil', rotulo: 'Funil', href: '/crm?ver=funil', dica: 'Todos os leads por etapa (ou por passo da jornada), para consulta. Toque num lead para abrir a ficha.' },
  { id: 'numeros', rotulo: 'Números', href: '/crm?ver=numeros', dica: 'Onde o funil perde, depois do "sim" e por nicho, mensagem e horário.' },
  { id: 'roteiro', rotulo: 'Roteiro', href: '/crm?ver=roteiro', dica: 'O roteiro de venda: o que dizer em cada momento, objeções e preços do cardápio.' },
]
// A Jornada é um modo do Funil: a aba Funil fica acesa nela.
const vistaDaAba = computed<Vista>(() => (vista.value === 'jornada' ? 'funil' : vista.value))

function trocarVista(nova: Vista) {
  vista.value = nova
  leadId.value = null
  escreverEndereco()
}

function trocarProduto(novo: FiltroProduto) {
  produto.value = novo
  escreverEndereco(true)
  anuncio.value = `Mostrando ${FILTROS.find(p => p.id === novo)?.rotulo}.`
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

// "Ver a colinha inteira", da ficha: a folha fecha e quem a abriu (um item da
// lista) sai da tela junto com a vista, então o foco vai para o título da colinha.
async function abrirColinha() {
  trocarVista('roteiro')
  await nextTick()
  document.getElementById('crm-colinha-titulo')?.focus()
}
</script>

<template>
  <section class="crm" aria-labelledby="crm-titulo">
    <header class="crm-topo">
      <div>
        <span class="crm-kicker">SquadOne · PRUMO</span>
        <h1 id="crm-titulo">Vendas</h1>
        <p class="crm-topo__fonte">{{ textoDoRetrato }}<template v-if="lidoEm"> · tela lida às {{ hora(lidoEm.toISOString()) }}</template></p>
      </div>
      <button class="botao" type="button" :disabled="carregando" @click="carregar(true)">{{ carregando ? 'Lendo…' : 'Ler de novo' }}</button>
    </header>
    <p class="so-leitor" aria-live="polite">{{ anuncio }}</p>
    <!-- Discreto de propósito: o WhatsApp já abriu; falta só a anotação, que dá para fazer na ficha (nota). -->
    <p v-if="falhaDaAnotacao" class="crm-nota-pequena crm-anotacao-falhou" role="alert">
      {{ falhaDaAnotacao.texto }}
      <button type="button" class="crm-mais" @click="falhaDaAnotacao = null">Entendi</button>
    </p>

    <div v-if="erro" class="crm-erro" role="alert"><strong>CRM indisponível.</strong> {{ erro }} <button class="botao" type="button" @click="carregar(true)">Tentar de novo</button></div>

    <!-- Os avisos do retrato falam dos números; a colinha não tem nenhum. -->
    <template v-if="visao && vista !== 'roteiro'">
      <div v-if="visao.estado !== 'ok'" class="crm-aviso is-forte" role="status">
        <strong>{{ visao.estado === 'sem-retrato' ? 'Ainda sem retrato das planilhas.' : 'Retrato ilegível.' }}</strong> {{ visao.mensagem }}
        <template v-if="visao.ultimaFalha"> Última tentativa do n8n ({{ dataHora(visao.ultimaFalha.em) }}): {{ visao.ultimaFalha.erro }}</template>
      </div>
      <div v-else-if="velho || visao.ultimaFalha" class="crm-aviso" role="status">
        <strong>Retrato desatualizado.</strong> Os números são de {{ dataHora(visao.geradoEm) }}.
        <template v-if="visao.ultimaFalha"> O n8n não conseguiu ler as planilhas em {{ dataHora(visao.ultimaFalha.em) }}: {{ visao.ultimaFalha.erro }}</template>
      </div>
      <p v-if="visao.colunasAusentes.length" class="crm-nota-pequena">Colunas que a planilha ainda não tem (o CRM trata como vazias): {{ visao.colunasAusentes.join(', ') }}.</p>
      <p v-if="visao.estado === 'ok' && !visao.pastasLidas" class="crm-nota-pequena">A pasta ~/auto-site não foi lida: sem conferência de pastas agora.</p>
    </template>

    <!-- Fora do v-if do retrato: com o CRM fora do ar, ainda se chega à Colinha. As contagens só com retrato. -->
    <div v-if="visao || vista === 'roteiro' || erro" class="crm-controles" :class="{ 'crm-controles--funil': vista === 'funil' }">
      <!-- Quatro vistas com nome de tarefa (16/10/2026): "Jornada", "Resultados" e "Colinha" eram
           nomes internos, perdidos ao lado de Hoje e Funil. A Jornada virou um modo do Funil. -->
      <nav class="crm-vistas" aria-label="Vistas do CRM">
        <a v-for="v in VISTAS" :key="v.id" :href="v.href" :aria-current="vistaDaAba === v.id ? 'page' : undefined" @click.prevent="trocarVista(v.id)">
          {{ v.rotulo }} <span v-if="visao && v.id === 'afazer'">{{ totalAFazer }}</span><span v-else-if="visao && v.id === 'triagem'">{{ totalTriagem }}</span><span v-else-if="visao && v.id === 'funil'">{{ leads.length }}</span>
        </a>
      </nav>
      <p class="crm-vistas__dica">{{ VISTAS.find((v) => v.id === vistaDaAba)?.dica }}</p>
      <div v-if="vistaDaAba === 'funil'" class="segmentado crm-modo-do-funil" role="group" aria-label="Como ver o funil">
        <button type="button" :aria-pressed="vista === 'funil'" @click="trocarVista('funil')">Por etapa</button>
        <button type="button" :aria-pressed="vista === 'jornada'" @click="trocarVista('jornada')">Por passo da jornada</button>
      </div>
      <div class="crm-produtos" role="group" aria-label="Ofertas do PRUMO">
        <button v-for="p in FILTROS" :key="p.id" type="button" :aria-pressed="produto === p.id" @click="trocarProduto(p.id)">{{ p.rotulo }}</button>
      </div>
    </div>

    <CrmColinha v-if="vista === 'roteiro'" :produto="produto" />

    <template v-if="visao">
      <!-- No Funil cada coluna (ou aba, no celular) já traz o número: o resumo só repetiria. -->
      <ol v-if="visao.estado === 'ok' && vista !== 'funil' && vista !== 'roteiro'" class="crm-resumo" aria-label="Resumo do funil (toque para abrir a etapa)">
        <li v-for="etapa in ETAPAS" :key="etapa" :class="`is-${etapa}`">
          <button type="button" @click="irParaEtapa(etapa)">
            <strong>{{ contagens[etapa] }}</strong>
            <span>{{ ROTULO_DA_ETAPA[etapa] }}</span>
          </button>
        </li>
      </ol>
      <p v-if="visao.estado === 'ok' && visao.divergencias && vista !== 'roteiro'" class="crm-nota-pequena">
        {{ visao.divergencias }} lead{{ visao.divergencias === 1 ? '' : 's' }} com divergência entre planilha e pasta (marcados no Funil).
        <template v-if="visao.pastasSemLinha.length"> {{ visao.pastasSemLinha.length }} pasta(s) sem linha na planilha.</template>
      </p>

      <ProximaVenda v-if="vista === 'afazer'" :visao="visao" @registrado="depoisDoRegistro" @abrir="abrirFicha" @resumo="resumoDoCartao = $event" />
      <template v-else-if="vista === 'triagem'">
        <CrmHoje
          v-if="triagem?.itens.length" :grupo="triagem" :leads="porId" :aviso="avisoDaFila" :liberados="liberados" :ritmo="ritmo"
          :registro="visao.registro" :confirmavel="visao.estado === 'ok'"
          @abrir="abrirFicha" @liberar="liberar" @primeiro="marcarPrimeiroContato" @registrado="depoisDoRegistro" @restantes="restantesDaTriagem = $event"
        />
        <p v-else class="crm-vazio"><strong>Nada para triar.</strong> Quando os caçadores acharem prospects novos, eles aparecem aqui.</p>
      </template>
      <CrmJornadaVista v-else-if="vista === 'jornada'" :leads="leads" @abrir="abrirFicha" />
      <CrmResultados v-else-if="vista === 'numeros'" :leads="leads" :agora="agora" />
      <CrmFunil v-else-if="vista === 'funil'" :leads="leads" :visao="visao" :etapa-em-foco="etapaEmFoco" :produto="produto" :aviso="avisoDaFila" :liberados="liberados" :anotados="anotados" :ritmo="ritmo" @abrir="abrirFicha" @produto="trocarProduto" @liberar="liberar" @anotar="anotarEnvio" @primeiro="marcarPrimeiroContato" />

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

      <footer v-if="visao.estado === 'ok' && vista !== 'roteiro'" class="crm-rodape">
        <span v-for="f in visao.fontes" :key="f.id">{{ f.nome }}: {{ f.linhas }} linha{{ f.linhas === 1 ? '' : 's' }}<template v-if="f.erro"> ({{ f.erro }})</template></span>
        <a v-if="visao.links.planilhaSite" :href="visao.links.planilhaSite" target="_blank" rel="noopener">Planilha do Site ↗</a>
        <a v-if="visao.links.planilhaPrumo" :href="visao.links.planilhaPrumo" target="_blank" rel="noopener">Planilha do PRUMO ↗</a>
        <a v-if="visao.links.planilhaIris" :href="visao.links.planilhaIris" target="_blank" rel="noopener">Aba Clínicas (Iris) ↗</a>
        <a v-if="visao.links.planilhaEstampa" :href="visao.links.planilhaEstampa" target="_blank" rel="noopener">Aba Estamparias ↗</a>
      </footer>
    </template>
    <p v-else-if="carregando && vista !== 'roteiro'" class="crm-muted" role="status">Lendo o CRM…</p>
  </section>
</template>
