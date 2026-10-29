<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DICA_DA_ETAPA, ETAPAS, ROTULO_DA_ETAPA, ROTULO_DA_OFERTA_DO_PLUS, ROTULO_DA_RESPOSTA, SIGLA_DO_PRODUTO, dataCurta, ehConvite, diaEscolhido, diasNaEtapa, hora, onde, textoDaLeitura, textoDaSubEtapa, textoDeDias, textoDoPrazo } from './crm-formato'
import {
  SENTIDO_INICIAL, chaveDoNicho, contagemDaEtapa, gravarVistaDoFunil, juntarAbertas, lerVistaDoFunil, opcoesDeNicho, opcoesDePasso, ordenarLista, sinalMaisForte,
  textoDaColunaProximo, textoDosDescartados, textoDoProximoPasso,
  type FiltroDeEtapa, type FiltroDePasso, type OrdemDaLista, type Sentido, type VistaDoFunil,
} from './funil-lista'
import { passoAtual } from './jornada'
import { acaoDoLead, type AcaoDeVenda } from './proxima-venda'
import { textoParaATela } from './marcadores-da-conversa'
import { resumoDosMotivos } from './motivos-de-perda'
import type { CrmEtapa, CrmLead, CrmProduto, CrmSinal, CrmVisao } from './types'

// "Funil": no desktop, quatro colunas — Novo, Em contato, Proposta e os
// encerrados (Ganho em cima de Perdido) —, sem rolagem lateral a partir de
// 1280 px (08/10/2026: seis colunas de 15 rem ficavam espremidas). No celular
// (abaixo de 1024 px), abas com as etapas e a lista da etapa escolhida. Estado
// sempre por texto, cor só reforça (RULES 3). No desktop, desde 16/10/2026,
// Quadro | Lista: a Lista é uma tabela (funil-lista.ts).
// 17/10/2026 (AC-19): Quadro | Lista é a ÚNICA alternância. A vista "Por passo da jornada" virou o
// filtro Passo; e o segmentado de oferta só do celular (com "Organizar" e "Estampa", nomes que o
// desktop não usava) saiu: a oferta é o mesmo filtro do CrmPanel nas duas larguras.
const props = defineProps<{
  leads: CrmLead[]
  visao: CrmVisao
  etapaEmFoco: CrmEtapa | null
  /** O filtro de oferta do CRM (os leads já vêm filtrados; aqui só decide a nota do gerador). */
  produto: 'todos' | CrmProduto
  /** O filtro Passo (jornada.ts), dono no CrmPanel por causa do endereço (?passo=). */
  passo: FiltroDePasso
  /** Relógio do CrmPanel, para a frase da ação da Lista (o "o que achou?" depende da hora). */
  agora: number
}>()
// O Funil só mostra e abre a Ficha: não envia nem anota nada (desde 16/10/2026, OT-01), então não tem as
// travas de horário e de ritmo nem marca de envio; elas moram na Ficha e nas telas de primeiro contato.
const emit = defineEmits<{
  abrir: [leadId: string, origem: HTMLElement | null]; passo: [passo: FiltroDePasso]
}>()

const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 63.99rem)') : null
const celular = ref(mq?.matches ?? false)
const aoMudarLargura = (e: MediaQueryListEvent) => { celular.value = e.matches }
mq?.addEventListener('change', aoMudarLargura)
onBeforeUnmount(() => mq?.removeEventListener('change', aoMudarLargura))

const leadsBase = computed(() => props.leads)

const etapaAtiva = ref<CrmEtapa>(props.etapaEmFoco ?? 'novo')
watch(() => props.etapaEmFoco, e => { if (e) etapaAtiva.value = e })
const etapasVisiveis = computed(() => (celular.value ? [etapaAtiva.value] : ETAPAS))

/** Setas, Home e End movem entre as abas (padrão ARIA de abas, ativação automática). */
function teclarNaAba(e: KeyboardEvent, i: number) {
  const destino = e.key === 'ArrowRight' ? (i + 1) % ETAPAS.length
    : e.key === 'ArrowLeft' ? (i - 1 + ETAPAS.length) % ETAPAS.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? ETAPAS.length - 1 : -1
  if (destino < 0) return
  e.preventDefault()
  etapaAtiva.value = ETAPAS[destino]
  document.getElementById(`crm-aba-${ETAPAS[destino]}`)?.focus()
}

const busca = ref('')
const nicho = ref('')
const cidade = ref('')
const mostrarDescartados = ref(false)
const LIMITE = 30
const limites = ref<Record<CrmEtapa, number>>(Object.fromEntries(ETAPAS.map(e => [e, LIMITE])) as Record<CrmEtapa, number>)

const ordenar = (a: string, b: string) => a.localeCompare(b, 'pt-BR')
// `nicho` guarda a chave (chaveDoNicho): "Previdenciária" e "previdenciaria" são uma opção só (AC-19).
const nichos = computed(() => opcoesDeNicho(leadsBase.value.map(l => l.nicho)))
const doNicho = (l: CrmLead) => !nicho.value || chaveDoNicho(l.nicho) === nicho.value
const cidades = computed(() => [...new Set(leadsBase.value.filter(doNicho).map(l => l.cidade).filter(Boolean))].sort(ordenar))
watch(nicho, () => { if (cidade.value && !cidades.value.includes(cidade.value)) cidade.value = '' })
// O passo de cada lead uma vez por retrato: o filtro o pediria de novo a cada tecla na busca.
const passoDe = computed(() => new Map(leadsBase.value.map(l => [l.id, passoAtual(l)] as const)))
const passos = computed(() => opcoesDePasso(leadsBase.value, props.passo))
const passoEscolhido = computed({ get: () => props.passo, set: (v: FiltroDePasso) => emit('passo', v) })
const comFiltro = computed(() => Boolean(busca.value || nicho.value || cidade.value || props.passo))

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtrados = computed(() => {
  const termo = normalizar(busca.value.trim())
  return leadsBase.value.filter(l => doNicho(l) && (!cidade.value || l.cidade === cidade.value)
    && (!props.passo || passoDe.value.get(l.id) === props.passo)
    && (!termo || normalizar(`${l.empresa} ${l.nicho} ${l.cidade}`).includes(termo)))
})

// Em contato junta quem só recebeu e quem já respondeu: quem respondeu vem antes.
const CONVERSA: ReadonlySet<CrmSinal> = new Set(['respondeu', 'em-conversa', 'respondeu-prumo', 'diagnostico'])
const emConversa = (l: CrmLead) => l.etapa === 'contato' && CONVERSA.has(l.sinal)

// Dentro da coluna: o que pede ação primeiro; etapas abertas do mais antigo
// (o mais perto de sair) para o mais novo, encerradas do mais recente para o mais antigo.
const peso = (l: CrmLead) => (l.respostaNova ? 0 : l.followupHoje ? 1 : l.proximoPasso ? 2 : emConversa(l) ? 3
  : l.links.enviar || l.links.convite ? 4 : l.divergencias.length ? 5 : 6)
const porEtapa = computed(() => {
  const grupos = Object.fromEntries(ETAPAS.map(e => [e, [] as CrmLead[]])) as Record<CrmEtapa, CrmLead[]>
  for (const lead of filtrados.value) grupos[lead.etapa].push(lead)
  for (const etapa of ETAPAS) {
    const encerrada = etapa === 'ganho' || etapa === 'perdido'
    grupos[etapa].sort((a, b) => peso(a) - peso(b)
      // Prospects do Iris e das estamparias: a maior Prioridade do caçador primeiro (14/10/2026).
      || (b.triagem?.prioridade ?? -1) - (a.triagem?.prioridade ?? -1)
      || (encerrada ? -1 : 1) * ((Date.parse(a.desde ?? '') || 0) - (Date.parse(b.desde ?? '') || 0))
      || ordenar(a.empresa, b.empresa))
  }
  return grupos
})
const descartados = computed(() => porEtapa.value.perdido.filter(l => l.motivoPerda === 'descartado').length)
/** O número da etapa no Quadro, nas abas e na Lista: um só, pela mesma escolha de descartados (AC-03). */
const contagem = (etapa: CrmEtapa) => contagemDaEtapa(porEtapa.value[etapa], etapa, mostrarDescartados.value)
/** "Recusou 90 · Sem resposta 12 · Descartado 750": só os motivos que têm alguém. */
// Desde 28/10/2026 pelo motivo da lista fechada (motivos-de-perda.ts), o mesmo da Ficha e de Resultados.
const perdasDaColuna = computed(() => resumoDosMotivos(porEtapa.value.perdido))
const conversas = computed(() => porEtapa.value.contato.filter(emConversa).length)
const cartoes = (etapa: CrmEtapa) => {
  const lista = etapa === 'perdido' && !mostrarDescartados.value ? porEtapa.value.perdido.filter(l => l.motivoPerda !== 'descartado') : porEtapa.value[etapa]
  return { lista: lista.slice(0, limites.value[etapa]), resto: Math.max(0, lista.length - limites.value[etapa]) }
}
const mais = (etapa: CrmEtapa) => { limites.value = { ...limites.value, [etapa]: limites.value[etapa] + LIMITE } }

// Lista do desktop (16/10/2026, item 8 da auditoria de 15/10, funil-lista.ts): uma tabela ao lado
// do quadro, para as etapas cheias. Os mesmos filtros e as mesmas travas; um sinal por linha.
const storage = (() => { try { return window.localStorage } catch { return null } })()
const vista = ref<VistaDoFunil>(lerVistaDoFunil(storage))
function escolherVista(v: VistaDoFunil) {
  vista.value = v
  gravarVistaDoFunil(storage, v)
}
const naLista = computed(() => !celular.value && vista.value === 'lista')
const filtroDeEtapa = ref<FiltroDeEtapa>(props.etapaEmFoco ?? 'abertas')
watch(() => props.etapaEmFoco, e => { if (e) filtroDeEtapa.value = e })
const FILTROS_DE_ETAPA: FiltroDeEtapa[] = ['abertas', ...ETAPAS]
const rotuloDoFiltro = (f: FiltroDeEtapa) => (f === 'abertas' ? 'Abertas' : ROTULO_DA_ETAPA[f])
// Uma vez por mudança do funil: daEtapa('abertas') também conta o botão, e reordenar ~2000 leads a cada render pesa.
const abertas = computed(() => juntarAbertas(porEtapa.value, peso))
const daEtapa = (f: FiltroDeEtapa) => (f === 'abertas' ? abertas.value
  : f === 'perdido' && !mostrarDescartados.value ? porEtapa.value.perdido.filter(l => l.motivoPerda !== 'descartado') : porEtapa.value[f])
const ordem = ref<OrdemDaLista>('acao')
const sentido = ref<Sentido>('asc')
function ordenarPor(o: Exclude<OrdemDaLista, 'acao'>) {
  if (ordem.value !== o) {
    ordem.value = o
    sentido.value = SENTIDO_INICIAL[o]
  } else if (sentido.value === SENTIDO_INICIAL[o]) sentido.value = sentido.value === 'asc' ? 'desc' : 'asc'
  else ordem.value = 'acao'
}
const ariaSort = (o: Exclude<OrdemDaLista, 'acao'>) => (ordem.value !== o ? 'none' : sentido.value === 'asc' ? 'ascending' : 'descending')
const LIMITE_DA_LISTA = 50
const limiteDaLista = ref(LIMITE_DA_LISTA)
watch([filtroDeEtapa, ordem, sentido, busca, nicho, cidade, () => props.passo], () => { limiteDaLista.value = LIMITE_DA_LISTA })
const linhas = computed(() => {
  const todas = ordenarLista(daEtapa(filtroDeEtapa.value), ordem.value, sentido.value)
  return { lista: todas.slice(0, limiteDaLista.value), total: todas.length }
})
// A ação da fila de venda de cada linha à vista (AC-19): a frase do cartão da Próxima venda e do
// "Agora" da Ficha, nunca uma quarta redação. Só das linhas mostradas: acaoDoLead percorre os grupos
// da Hoje inteiros, e fazer isso para os ~2000 leads a cada tique do relógio pesaria.
const acoes = computed(() => new Map<string, AcaoDeVenda | null>(naLista.value ? linhas.value.lista.map(l => [l.id, acaoDoLead(props.visao, l.id, props.agora)]) : []))
const proximoDe = (l: CrmLead) => textoDaColunaProximo(acoes.value.get(l.id), l)
const sinalDe = (l: CrmLead) => sinalMaisForte(l)
const seta = (o: Exclude<OrdemDaLista, 'acao'>) => (ordem.value !== o ? '' : sentido.value === 'asc' ? '↑' : '↓')
/**
 * Clicar em qualquer ponto da linha abre a Ficha. O nome ganha o foco antes: a folha devolve o foco
 * a quem o tinha ao abrir, e numa célula sem foco ele voltaria para o body, longe da linha.
 */
function abrirDaLinha(l: CrmLead) {
  const nome = document.getElementById(`crm-linha-${l.id}`)
  nome?.focus({ preventScroll: true })
  emit('abrir', l.id, nome)
}

const temMarcos = (l: CrmLead) => l.etapa === 'contato' || l.etapa === 'proposta' || Boolean(l.marcos.enviado)
const artefatos = (l: CrmLead) => {
  const a = l.pasta?.artefatos
  if (!a || l.sinal !== 'na-fila') return ''
  return [a.conteudo ? 'conteúdo ✓' : 'sem conteúdo', `${a.fotos} foto${a.fotos === 1 ? '' : 's'}`, a.capa ? 'capa ✓' : 'sem capa', a.gerado ? 'site gerado' : 'site ainda não gerado'].join(' · ')
}
</script>

<template>
  <div class="crm-funil">
    <form class="crm-filtros" role="search" @submit.prevent>
      <label><span>Buscar</span><input v-model="busca" type="search" placeholder="Empresa, nicho ou cidade" autocomplete="off"></label>
      <label><span>Nicho</span><select v-model="nicho"><option value="">Todos</option><option v-for="n in nichos" :key="n.chave" :value="n.chave">{{ n.rotulo }}</option></select></label>
      <label><span>Cidade</span><select v-model="cidade"><option value="">Todas</option><option v-for="c in cidades" :key="c" :value="c">{{ c }}</option></select></label>
      <!-- Era a vista "Por passo da jornada" (?ver=jornada); virou filtro para o Funil ter uma alternância só. -->
      <label><span>Passo</span><select v-model="passoEscolhido"><option value="">Todos</option><option v-for="p in passos" :key="p.id" :value="p.id">{{ p.nome }} ({{ p.total }})</option></select></label>
    </form>
    <p v-if="comFiltro" class="crm-filtro-resumo" role="status">{{ filtrados.length }} de {{ leadsBase.length }} leads com este filtro.</p>

    <template v-if="celular">
      <div class="crm-abas" role="tablist" aria-label="Etapas do funil">
        <button
          v-for="(etapa, i) in ETAPAS"
          :id="`crm-aba-${etapa}`"
          :key="etapa"
          type="button"
          role="tab"
          :class="`is-${etapa}`"
          :aria-selected="etapaAtiva === etapa"
          :aria-controls="`crm-coluna-${etapa}`"
          :tabindex="etapaAtiva === etapa ? 0 : -1"
          @click="etapaAtiva = etapa"
          @keydown="teclarNaAba($event, i)"
        >
          {{ ROTULO_DA_ETAPA[etapa] }} <strong>{{ contagem(etapa).mostrados }}</strong>
          <span v-if="contagem(etapa).foraDescartados" class="so-leitor">, {{ textoDosDescartados(contagem(etapa)) }}</span>
        </button>
      </div>
    </template>

    <div v-else class="segmentado segmentado--auto crm-funil__vista" role="group" aria-label="Vista do funil">
      <button type="button" :aria-pressed="vista === 'quadro'" @click="escolherVista('quadro')">Quadro</button>
      <button type="button" :aria-pressed="vista === 'lista'" @click="escolherVista('lista')">Lista</button>
    </div>

    <section v-if="naLista" class="crm-lista-funil" aria-labelledby="crm-lista-titulo">
      <h2 id="crm-lista-titulo" class="so-leitor">Lista do funil</h2>
      <div class="escolhas" role="group" aria-label="Etapa">
        <button v-for="f in FILTROS_DE_ETAPA" :key="f" type="button" :aria-pressed="filtroDeEtapa === f" @click="filtroDeEtapa = f">
          {{ rotuloDoFiltro(f) }} <span>{{ f === 'abertas' ? abertas.length : contagem(f).mostrados }}</span>
          <small v-if="f !== 'abertas' && contagem(f).foraDescartados"> · {{ textoDosDescartados(contagem(f)) }}</small>
        </button>
      </div>
      <p v-if="filtroDeEtapa === 'contato' && porEtapa.contato.length" class="crm-coluna__nota">
        {{ conversas }} respondeu{{ conversas === 1 ? '' : 'ram' }} · {{ porEtapa.contato.length - conversas }} sem resposta. Um próximo passo segura o lead aqui.
      </p>
      <template v-if="filtroDeEtapa === 'perdido'">
        <p v-if="perdasDaColuna" class="crm-coluna__nota">{{ perdasDaColuna }}</p>
        <label v-if="descartados" class="crm-check"><input v-model="mostrarDescartados" type="checkbox"> Mostrar os {{ descartados }} descartados antes do contato</label>
      </template>

      <div v-if="linhas.total" class="crm-tabela-rolagem">
        <table class="crm-tabela">
          <caption class="so-leitor">Leads da etapa {{ rotuloDoFiltro(filtroDeEtapa) }}. Escolha o nome para abrir a ficha.</caption>
          <colgroup><col class="crm-tabela__c-lead"><col class="crm-tabela__c-oferta"><col class="crm-tabela__c-etapa"><col class="crm-tabela__c-data"><col class="crm-tabela__c-passo"><col class="crm-tabela__c-sinal"><col class="crm-tabela__c-acao"></colgroup>
          <thead>
            <tr>
              <th scope="col">Lead</th>
              <th scope="col">Oferta</th>
              <th scope="col">Etapa</th>
              <th scope="col" :aria-sort="ariaSort('ultimo')">
                <button type="button" class="crm-tabela__ordenar" @click="ordenarPor('ultimo')">Último toque <span aria-hidden="true">{{ seta('ultimo') }}</span></button>
              </th>
              <th scope="col" :aria-sort="ariaSort('proximo')">
                <button type="button" class="crm-tabela__ordenar" @click="ordenarPor('proximo')">Próximo passo <span aria-hidden="true">{{ seta('proximo') }}</span></button>
              </th>
              <th scope="col">Sinal mais forte</th>
              <th scope="col">Ação</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lead in linhas.lista" :key="lead.id" :class="{ 'tem-divergencia': lead.divergencias.length }" @click="abrirDaLinha(lead)">
              <td class="crm-tabela__lead">
                <button :id="`crm-linha-${lead.id}`" type="button" class="crm-tabela__abrir" :data-lead="lead.id" @click.stop="emit('abrir', lead.id, $event.currentTarget as HTMLElement)">
                  <strong>{{ lead.empresa }}</strong>
                  <small>{{ onde(lead) }}</small>
                </button>
              </td>
              <td>
                <span class="crm-tag" :class="`is-${lead.produto}`">{{ SIGLA_DO_PRODUTO[lead.produto] }}</span>
                <small v-if="lead.plus">{{ ROTULO_DA_OFERTA_DO_PLUS[lead.plus.oferta] }}</small>
              </td>
              <td :class="`is-${lead.etapa}`">
                <span class="crm-etapa">{{ ROTULO_DA_ETAPA[lead.etapa] }}</span>
                <small>{{ textoDaSubEtapa(lead.subEtapa) }}</small>
              </td>
              <td class="crm-tabela__data">
                <template v-if="lead.ultimoEvento">{{ dataCurta(lead.ultimoEvento) }}<small>{{ lead.diasDesdeUltimoEvento === 0 ? 'hoje' : lead.diasDesdeUltimoEvento !== undefined ? `há ${textoDeDias(lead.diasDesdeUltimoEvento)}` : '' }}</small></template>
                <template v-else><span aria-hidden="true">—</span><span class="so-leitor">sem toque</span></template>
              </td>
              <!-- A frase da ação (a da Próxima venda); sem ação, a data do passo salvo; o title traz o salvo inteiro. -->
              <td class="crm-tabela__passo" :title="[proximoDe(lead), textoDoProximoPasso(lead)].filter(Boolean).join(' · ') || undefined">
                <template v-if="proximoDe(lead)">{{ proximoDe(lead) }}</template>
                <template v-else><span aria-hidden="true">—</span><span class="so-leitor">nada a fazer agora</span></template>
              </td>
              <td><span v-if="sinalDe(lead)" class="crm-sinal" :class="sinalDe(lead)!.classe">{{ sinalDe(lead)!.texto }}</span></td>
              <!-- OT-01 (16/10/2026): o Funil é consulta. Mandar mensagem é na Próxima venda ou na Ficha do lead
                   aberto (as travas moram lá); aqui a ação da linha é abrir a ficha. -->
              <td class="crm-tabela__acao" @click.stop>
                <button type="button" class="botao botao--leve" @click="emit('abrir', lead.id, $event.currentTarget as HTMLElement)">Ficha <span class="so-leitor">de {{ lead.empresa }}</span></button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="crm-coluna__vazia">Nenhum lead {{ filtroDeEtapa === 'abertas' ? 'aberto' : 'nesta etapa' }}{{ comFiltro ? ' com este filtro' : '' }}.</p>
      <button v-if="linhas.total > linhas.lista.length" type="button" class="crm-mais" @click="limiteDaLista += LIMITE_DA_LISTA">
        Mostrar mais {{ Math.min(linhas.total - linhas.lista.length, LIMITE_DA_LISTA) }} de {{ linhas.total - linhas.lista.length }}
      </button>
    </section>

    <div v-else class="crm-colunas" :class="{ 'crm-colunas--uma': celular }">
      <section
        v-for="etapa in etapasVisiveis"
        :id="`crm-coluna-${etapa}`"
        :key="etapa"
        class="crm-coluna"
        :class="[`is-${etapa}`, { 'is-foco': !celular && etapaEmFoco === etapa }]"
        :role="celular ? 'tabpanel' : undefined"
        :aria-labelledby="celular ? `crm-aba-${etapa}` : `crm-coluna-titulo-${etapa}`"
        :tabindex="celular ? 0 : -1"
      >
        <header class="crm-coluna__cabeca">
          <h2 :id="`crm-coluna-titulo-${etapa}`">{{ ROTULO_DA_ETAPA[etapa] }}</h2>
          <strong>{{ contagem(etapa).mostrados }}</strong>
          <small v-if="contagem(etapa).foraDescartados">{{ textoDosDescartados(contagem(etapa)) }}</small>
          <small>{{ DICA_DA_ETAPA[etapa] }}</small>
        </header>

        <!-- O gerador é do Site: no filtro de outra oferta a nota só confundiria. -->
        <p v-if="etapa === 'novo' && visao.gerador && (produto === 'todos' || produto === 'site')" class="crm-coluna__nota">
          Gerador de sites: {{ visao.gerador.estado === 'processando' ? 'gerando agora' : visao.gerador.estado === 'ocioso' ? 'ocioso' : visao.gerador.estado === 'atencao' ? 'precisa de atenção' : 'sem status' }}.
          {{ visao.gerador.detalhe }}{{ visao.gerador.pendentes !== undefined ? ` ${visao.gerador.pendentes} na fila.` : '' }}{{ visao.gerador.atualizadoEm ? ` (às ${hora(visao.gerador.atualizadoEm)})` : '' }}
        </p>
        <p v-if="etapa === 'contato' && porEtapa.contato.length" class="crm-coluna__nota">
          {{ conversas }} respondeu{{ conversas === 1 ? '' : 'ram' }} · {{ porEtapa.contato.length - conversas }} sem resposta.
          Um próximo passo segura o lead aqui.
        </p>
        <template v-if="etapa === 'perdido'">
          <p v-if="perdasDaColuna" class="crm-coluna__nota">{{ perdasDaColuna }}</p>
          <label v-if="descartados" class="crm-check"><input v-model="mostrarDescartados" type="checkbox"> Mostrar os {{ descartados }} descartados antes do contato</label>
        </template>

        <ul class="crm-cartoes">
          <li v-for="lead in cartoes(etapa).lista" :key="lead.id">
            <article class="crm-cartao" :class="{ 'tem-divergencia': lead.divergencias.length }" :aria-labelledby="`crm-cartao-${lead.id}`">
              <button :id="`crm-cartao-${lead.id}`" type="button" class="crm-cartao__abrir" :data-lead="lead.id" @click="emit('abrir', lead.id, $event.currentTarget as HTMLElement)">
                <strong>{{ lead.empresa }}</strong>
                <small>{{ onde(lead) }}</small>
              </button>
              <p class="crm-cartao__estado"><span class="crm-tag" :class="`is-${lead.produto}`">{{ SIGLA_DO_PRODUTO[lead.produto] }}</span> {{ textoDaSubEtapa(lead.subEtapa) }} · {{ diasNaEtapa(lead) }}</p>
              <ol v-if="temMarcos(lead)" class="crm-marcos" aria-label="Enviado, leitura e resposta">
                <li :class="{ 'is-feito': lead.marcos.enviado }">{{ lead.marcos.enviado ? `${ehConvite(lead.produto) ? 'Convite' : 'Enviado'} ${dataCurta(lead.marcos.enviado)}` : 'Não enviado' }}</li>
                <li :class="{ 'is-feito': lead.leitura === 'viu' || lead.leitura === 'pela-resposta', 'is-desconhecido': lead.leitura === 'desconhecida' }">{{ textoDaLeitura(lead) || 'Leitura —' }}</li>
                <li :class="{ 'is-feito': lead.marcos.respondeu }">{{ lead.marcos.respondeu ? `Respondeu ${dataCurta(lead.marcos.respondeu)}` : 'Sem resposta' }}</li>
              </ol>
              <p v-if="artefatos(lead)" class="crm-cartao__artefatos">{{ artefatos(lead) }}<template v-if="lead.pasta?.falha"> · falhou: {{ lead.pasta.falha }}</template></p>
              <p v-if="lead.resposta?.trecho && lead.etapa !== 'novo'" class="crm-cartao__resposta">“{{ textoParaATela(lead.resposta.trecho) }}”</p>
              <p v-if="lead.resposta || lead.followupHoje || lead.respostaNova || lead.proximoPasso || lead.divergencias.length || lead.acervo || textoDoPrazo(lead) || (lead.etapa === 'novo' && lead.triagem)" class="crm-sinais">
                <span v-if="lead.resposta" class="crm-sinal" :class="`is-${lead.resposta.tipo}`">{{ ROTULO_DA_RESPOSTA[lead.resposta.tipo] }}</span>
                <span v-if="lead.respostaNova" class="crm-sinal is-resposta">Resposta nova</span>
                <span v-if="lead.followupHoje" class="crm-sinal is-followup">{{ lead.reenvioDoRobo ? 'Reenvio hoje (só robô)' : 'Follow-up hoje' }}</span>
                <span v-if="lead.proximoPasso" class="crm-sinal">Próximo passo {{ diaEscolhido(lead.proximoPasso.data) }}</span>
                <span v-if="lead.etapa === 'novo' && lead.triagem?.prioridade !== undefined" class="crm-sinal">Prioridade {{ lead.triagem.prioridade }}</span>
                <span v-if="lead.etapa === 'novo' && lead.triagem?.origemWhatsapp?.startsWith('não confirmado')" class="crm-sinal is-prazo">WhatsApp não confirmado</span>
                <span v-if="textoDoPrazo(lead)" class="crm-sinal is-prazo" :class="{ 'is-amanha': lead.diasParaSair === 1 }">{{ textoDoPrazo(lead) }}</span>
                <span v-if="lead.divergencias.length" class="crm-sinal is-divergencia">Divergência</span>
                <span v-if="lead.acervo && lead.etapa === 'contato'" class="crm-sinal is-acervo">Acervo, sem follow-up automático</span>
              </p>
              <!-- OT-01 (16/10/2026): só consulta. Mandar mensagem é na Próxima venda ou na Ficha (toque no nome). -->
              <p v-if="lead.links.site" class="crm-cartao__links">
                <a :href="lead.links.site" target="_blank" rel="noopener">{{ lead.produto === 'site' ? 'Demo' : 'Site' }} <span class="so-leitor">de {{ lead.empresa }}</span>↗</a>
              </p>
            </article>
          </li>
        </ul>
        <p v-if="!cartoes(etapa).lista.length" class="crm-coluna__vazia">Nenhum lead nesta etapa{{ comFiltro ? ' com este filtro' : '' }}.</p>
        <button v-if="cartoes(etapa).resto" type="button" class="crm-mais" @click="mais(etapa)">Mostrar mais {{ Math.min(cartoes(etapa).resto, LIMITE) }} de {{ cartoes(etapa).resto }}</button>
      </section>
    </div>
  </div>
</template>
