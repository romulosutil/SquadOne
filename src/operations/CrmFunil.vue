<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { DICA_DA_ETAPA, ETAPAS, PRODUTOS, ROTULO_DA_ETAPA, ROTULO_DA_OFERTA_DO_PLUS, ROTULO_DA_PERDA, ROTULO_DA_RESPOSTA, ROTULO_DO_PRODUTO, SIGLA_DO_PRODUTO, dataCurta, ehConvite, diaEscolhido, diasNaEtapa, hora, onde, rotuloDaSegunda, rotuloDoFollowup, textoDaLeitura, textoDeDias, textoDoPrazo } from './crm-formato'
import { ROTULO_DE_LIBERAR, ehPrimeiroContato, envioTravado, linksDePrimeiroContato, type EnviosLiberados } from './trava-de-horario'
import { textoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'
import { anotadoEm, type EnviosAnotados, type TipoDeEnvioAnotado } from './anotacao-de-envio'
import {
  SENTIDO_INICIAL, gravarVistaDoFunil, juntarAbertas, lerVistaDoFunil, ordenarLista, sinalMaisForte, textoDoProximoPasso,
  type FiltroDeEtapa, type OrdemDaLista, type Sentido, type VistaDoFunil,
} from './funil-lista'
import type { CrmEtapa, CrmLead, CrmProduto, CrmSinal, CrmVisao } from './types'

// "Funil": no desktop, quatro colunas — Novo, Em contato, Proposta e os
// encerrados (Ganho em cima de Perdido) —, sem rolagem lateral a partir de
// 1280 px (08/10/2026: seis colunas de 15 rem ficavam espremidas). No celular
// (abaixo de 1024 px), um produto por vez (segmentado Site / Organizar / Iris /
// Estampa: as quatro ofertas do PRUMO), abas com as etapas e a lista da etapa
// escolhida. Estado sempre por texto, cor só reforça (RULES 3). No desktop,
// desde 16/10/2026, Quadro | Lista: a Lista é uma tabela (funil-lista.ts).
const props = defineProps<{
  leads: CrmLead[]
  visao: CrmVisao
  etapaEmFoco: CrmEtapa | null
  /** O filtro de produto do CRM; no celular "todos" vira Site. */
  produto: 'todos' | CrmProduto
  /** Fora do expediente (trava-de-horario.ts): o envio de primeiro contato espera o "Liberar". */
  aviso?: string | null
  liberados: EnviosLiberados
  /** Envios anotados nesta tela (anotacao-de-envio.ts), até o retrato confirmar. */
  anotados: EnviosAnotados
  /** Trava de ritmo (trava-de-ritmo.ts): com ela segurando, nenhum link de primeiro contato, sem "Liberar". */
  ritmo: EstadoDoRitmo
}>()
const emit = defineEmits<{
  abrir: [leadId: string, origem: HTMLElement | null]; produto: [produto: CrmProduto]; liberar: [leadId: string]
  anotar: [leadId: string, tipo: TipoDeEnvioAnotado]; primeiro: [leadId: string]
}>()
const anotado = (l: CrmLead, tipo: TipoDeEnvioAnotado) => anotadoEm(props.anotados, l.id, tipo) !== undefined
const segurado = computed(() => props.ritmo.motivo !== null)
// Envio, convite e o reenvio do só-robô travam fora do expediente; o follow-up de sempre, não.
const travado = (l: CrmLead) => !segurado.value && envioTravado(props.aviso, props.liberados, l.id) && linksDePrimeiroContato(l).length > 0
const linkTravado = (l: CrmLead, url: string | undefined) => Boolean(url) && (segurado.value || travado(l)) && ehPrimeiroContato(l, url!)
const haSegurados = computed(() => segurado.value && props.leads.some(l => linksDePrimeiroContato(l).length > 0))
function aoTocarPrimeiro(l: CrmLead, url: string) {
  if (ehPrimeiroContato(l, url)) emit('primeiro', l.id)
}

const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 63.99rem)') : null
const celular = ref(mq?.matches ?? false)
const aoMudarLargura = (e: MediaQueryListEvent) => { celular.value = e.matches }
mq?.addEventListener('change', aoMudarLargura)
onBeforeUnmount(() => mq?.removeEventListener('change', aoMudarLargura))

const segmento = computed<CrmProduto>(() => (props.produto === 'todos' ? 'site' : props.produto))
const leadsBase = computed(() => (celular.value ? props.leads.filter(l => l.produto === segmento.value) : props.leads))

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
const nichos = computed(() => [...new Set(leadsBase.value.map(l => l.nicho).filter(Boolean))].sort(ordenar))
const cidades = computed(() => [...new Set(leadsBase.value.filter(l => !nicho.value || l.nicho === nicho.value).map(l => l.cidade).filter(Boolean))].sort(ordenar))
watch(nicho, () => { if (cidade.value && !cidades.value.includes(cidade.value)) cidade.value = '' })

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const filtrados = computed(() => {
  const termo = normalizar(busca.value.trim())
  return leadsBase.value.filter(l => (!nicho.value || l.nicho === nicho.value) && (!cidade.value || l.cidade === cidade.value)
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
/** "Recusou 90 · Sem resposta 12 · Descartado 750": só os motivos que têm alguém. */
const perdasDaColuna = computed(() => (Object.keys(ROTULO_DA_PERDA) as Array<keyof typeof ROTULO_DA_PERDA>)
  .map(m => [ROTULO_DA_PERDA[m], porEtapa.value.perdido.filter(l => l.motivoPerda === m).length] as const)
  .filter(([, n]) => n).map(([rotulo, n]) => `${rotulo} ${n}`).join(' · '))
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
watch([filtroDeEtapa, ordem, sentido, busca, nicho, cidade], () => { limiteDaLista.value = LIMITE_DA_LISTA })
const linhas = computed(() => {
  const todas = ordenarLista(daEtapa(filtroDeEtapa.value), ordem.value, sentido.value)
  return { lista: todas.slice(0, limiteDaLista.value), total: todas.length }
})
const sinalDe = (l: CrmLead) => sinalMaisForte(l, tipo => anotado(l, tipo))
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
    <p v-if="haSegurados" class="crm-aviso" role="status"><strong>Devagar com os primeiros contatos.</strong> {{ textoDoRitmo(ritmo) }}</p>
    <form class="crm-filtros" role="search" @submit.prevent>
      <label><span>Buscar</span><input v-model="busca" type="search" placeholder="Empresa, nicho ou cidade" autocomplete="off"></label>
      <label><span>Nicho</span><select v-model="nicho"><option value="">Todos</option><option v-for="n in nichos" :key="n" :value="n">{{ n }}</option></select></label>
      <label><span>Cidade</span><select v-model="cidade"><option value="">Todas</option><option v-for="c in cidades" :key="c" :value="c">{{ c }}</option></select></label>
    </form>
    <p v-if="busca || nicho || cidade" class="crm-filtro-resumo" role="status">{{ filtrados.length }} de {{ leadsBase.length }} leads com este filtro.</p>

    <template v-if="celular">
      <div class="segmentado" role="group" aria-label="Produto">
        <button v-for="p in PRODUTOS" :key="p" type="button" :aria-pressed="segmento === p" :aria-label="ROTULO_DO_PRODUTO[p]" @click="emit('produto', p)">
          {{ SIGLA_DO_PRODUTO[p] }}
        </button>
      </div>
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
          {{ ROTULO_DA_ETAPA[etapa] }} <strong>{{ porEtapa[etapa].length }}</strong>
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
          {{ rotuloDoFiltro(f) }} <span>{{ daEtapa(f).length }}</span>
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
                <small>{{ lead.subEtapa }}</small>
              </td>
              <td class="crm-tabela__data">
                <template v-if="lead.ultimoEvento">{{ dataCurta(lead.ultimoEvento) }}<small>{{ lead.diasDesdeUltimoEvento === 0 ? 'hoje' : lead.diasDesdeUltimoEvento !== undefined ? `há ${textoDeDias(lead.diasDesdeUltimoEvento)}` : '' }}</small></template>
                <template v-else><span aria-hidden="true">—</span><span class="so-leitor">sem toque</span></template>
              </td>
              <td class="crm-tabela__passo" :title="textoDoProximoPasso(lead) || undefined">
                <template v-if="lead.proximoPasso">{{ textoDoProximoPasso(lead) }}</template>
                <template v-else><span aria-hidden="true">—</span><span class="so-leitor">sem próximo passo</span></template>
              </td>
              <td><span v-if="sinalDe(lead)" class="crm-sinal" :class="sinalDe(lead)!.classe">{{ sinalDe(lead)!.texto }}</span></td>
              <!-- Uma ação por linha, na ordem do cartão; o resto fica na Ficha. As travas valem igual. -->
              <td class="crm-tabela__acao" @click.stop>
                <p class="crm-cartao__links">
                  <a v-if="lead.links.segunda && lead.resposta?.tipo === 'interesse'" :href="lead.links.segunda" target="_blank" rel="noopener" @click="emit('anotar', lead.id, 'segunda_enviada')">{{ rotuloDaSegunda(lead) }} <span class="so-leitor">para {{ lead.empresa }}</span>↗</a>
                  <a v-else-if="lead.links.gerarDemo && lead.resposta?.tipo === 'interesse'" :href="lead.links.gerarDemo" target="_blank" rel="noopener">Gerar demo <span class="so-leitor">de {{ lead.empresa }}</span>↗</a>
                  <a v-else-if="lead.links.followup && !linkTravado(lead, lead.links.followup)" :href="lead.links.followup" target="_blank" rel="noopener" @click="emit('anotar', lead.id, 'followup_enviado'); aoTocarPrimeiro(lead, lead.links.followup)">{{ rotuloDoFollowup(lead) }} <span class="so-leitor">para {{ lead.empresa }}</span>↗</a>
                  <button v-else-if="travado(lead)" type="button" class="botao botao--leve" @click="emit('liberar', lead.id)">{{ ROTULO_DE_LIBERAR }} <span class="so-leitor">para {{ lead.empresa }}</span></button>
                  <a v-else-if="lead.links.enviar && !linkTravado(lead, lead.links.enviar)" :href="lead.links.enviar" target="_blank" rel="noopener" @click="lead.produto === 'plus' && emit('anotar', lead.id, 'plus_enviado'); emit('primeiro', lead.id)">Enviar pelo WhatsApp <span class="so-leitor">para {{ lead.empresa }} (marca como enviado)</span>↗</a>
                  <a v-else-if="lead.links.convite && !linkTravado(lead, lead.links.convite)" :href="lead.links.convite" target="_blank" rel="noopener" @click="emit('primeiro', lead.id)">Enviar convite <span class="so-leitor">para {{ lead.empresa }} (marca como enviado)</span>↗</a>
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="crm-coluna__vazia">Nenhum lead {{ filtroDeEtapa === 'abertas' ? 'aberto' : 'nesta etapa' }}{{ busca || nicho || cidade ? ' com este filtro' : '' }}.</p>
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
          <strong>{{ porEtapa[etapa].length }}</strong>
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
              <p class="crm-cartao__estado"><span class="crm-tag" :class="`is-${lead.produto}`">{{ SIGLA_DO_PRODUTO[lead.produto] }}</span> {{ lead.subEtapa }} · {{ diasNaEtapa(lead) }}</p>
              <ol v-if="temMarcos(lead)" class="crm-marcos" aria-label="Enviado, leitura e resposta">
                <li :class="{ 'is-feito': lead.marcos.enviado }">{{ lead.marcos.enviado ? `${ehConvite(lead.produto) ? 'Convite' : 'Enviado'} ${dataCurta(lead.marcos.enviado)}` : 'Não enviado' }}</li>
                <li :class="{ 'is-feito': lead.leitura === 'viu' || lead.leitura === 'pela-resposta', 'is-desconhecido': lead.leitura === 'desconhecida' }">{{ textoDaLeitura(lead) || 'Leitura —' }}</li>
                <li :class="{ 'is-feito': lead.marcos.respondeu }">{{ lead.marcos.respondeu ? `Respondeu ${dataCurta(lead.marcos.respondeu)}` : 'Sem resposta' }}</li>
              </ol>
              <p v-if="artefatos(lead)" class="crm-cartao__artefatos">{{ artefatos(lead) }}<template v-if="lead.pasta?.falha"> · falhou: {{ lead.pasta.falha }}</template></p>
              <p v-if="lead.resposta?.trecho && lead.etapa !== 'novo'" class="crm-cartao__resposta">“{{ lead.resposta.trecho }}”</p>
              <p v-if="lead.resposta || lead.followupHoje || lead.respostaNova || lead.proximoPasso || lead.divergencias.length || lead.acervo || textoDoPrazo(lead) || (lead.etapa === 'novo' && lead.triagem)" class="crm-sinais">
                <span v-if="lead.resposta" class="crm-sinal" :class="`is-${lead.resposta.tipo}`">{{ ROTULO_DA_RESPOSTA[lead.resposta.tipo] }}</span>
                <span v-if="lead.respostaNova" class="crm-sinal is-resposta">Resposta nova</span>
                <span v-if="lead.followupHoje && !anotado(lead, 'followup_enviado')" class="crm-sinal is-followup">{{ lead.reenvioDoRobo ? 'Reenvio hoje (só robô)' : 'Follow-up hoje' }}</span>
                <span v-if="anotado(lead, 'followup_enviado')" class="crm-sinal">Follow-up anotado</span>
                <span v-if="anotado(lead, 'segunda_enviada')" class="crm-sinal">2ª mensagem anotada</span>
                <span v-if="lead.proximoPasso" class="crm-sinal">Próximo passo {{ diaEscolhido(lead.proximoPasso.data) }}</span>
                <span v-if="lead.etapa === 'novo' && lead.triagem?.prioridade !== undefined" class="crm-sinal">Prioridade {{ lead.triagem.prioridade }}</span>
                <span v-if="lead.etapa === 'novo' && lead.triagem?.origemWhatsapp?.startsWith('não confirmado')" class="crm-sinal is-prazo">WhatsApp não confirmado</span>
                <span v-if="textoDoPrazo(lead)" class="crm-sinal is-prazo" :class="{ 'is-amanha': lead.diasParaSair === 1 }">{{ textoDoPrazo(lead) }}</span>
                <span v-if="lead.divergencias.length" class="crm-sinal is-divergencia">Divergência</span>
                <span v-if="lead.acervo && lead.etapa === 'contato'" class="crm-sinal is-acervo">Acervo, sem follow-up automático</span>
              </p>
              <p v-if="lead.links.enviar || lead.links.convite || lead.links.segunda || lead.links.followup || lead.links.site" class="crm-cartao__links">
                <!-- O toque abre o WhatsApp e anota o envio em segundo plano (CrmPanel, anotarEnvio). -->
                <a v-if="lead.links.segunda && lead.resposta?.tipo === 'interesse'" :href="lead.links.segunda" target="_blank" rel="noopener" @click="emit('anotar', lead.id, 'segunda_enviada')">{{ rotuloDaSegunda(lead) }} <span class="so-leitor">para {{ lead.empresa }}</span>↗</a>
                <a v-if="lead.links.gerarDemo && lead.resposta?.tipo === 'interesse'" :href="lead.links.gerarDemo" target="_blank" rel="noopener">Gerar demo <span class="so-leitor">de {{ lead.empresa }}</span>↗</a>
                <a v-if="lead.links.followup && !linkTravado(lead, lead.links.followup)" :href="lead.links.followup" target="_blank" rel="noopener" @click="emit('anotar', lead.id, 'followup_enviado'); aoTocarPrimeiro(lead, lead.links.followup)">{{ rotuloDoFollowup(lead) }} <span class="so-leitor">para {{ lead.empresa }}</span>↗</a>
                <button v-if="travado(lead)" type="button" class="botao botao--leve" @click="emit('liberar', lead.id)">{{ ROTULO_DE_LIBERAR }} <span class="so-leitor">para {{ lead.empresa }}</span></button>
                <a v-if="lead.links.enviar && !linkTravado(lead, lead.links.enviar)" :href="lead.links.enviar" target="_blank" rel="noopener" @click="lead.produto === 'plus' && emit('anotar', lead.id, 'plus_enviado'); emit('primeiro', lead.id)">Enviar pelo WhatsApp <span class="so-leitor">para {{ lead.empresa }} (marca como enviado)</span>↗</a>
                <a v-if="lead.links.convite && !linkTravado(lead, lead.links.convite)" :href="lead.links.convite" target="_blank" rel="noopener" @click="emit('primeiro', lead.id)">Enviar convite <span class="so-leitor">para {{ lead.empresa }} (marca como enviado)</span>↗</a>
                <a v-if="lead.links.site" :href="lead.links.site" target="_blank" rel="noopener">{{ lead.produto === 'site' ? 'Demo' : 'Site' }} <span class="so-leitor">de {{ lead.empresa }}</span>↗</a>
              </p>
            </article>
          </li>
        </ul>
        <p v-if="!cartoes(etapa).lista.length" class="crm-coluna__vazia">Nenhum lead nesta etapa{{ busca || nicho || cidade ? ' com este filtro' : '' }}.</p>
        <button v-if="cartoes(etapa).resto" type="button" class="crm-mais" @click="mais(etapa)">Mostrar mais {{ Math.min(cartoes(etapa).resto, LIMITE) }} de {{ cartoes(etapa).resto }}</button>
      </section>
    </div>
  </div>
</template>
