/**
 * Estado e ações do app dos agentes — o que era o `<script>` do App.vue até a
 * casca mobile (07/10/2026). A casca e as rotas (Hoje, Agenda, Escritório, a
 * folha Pedir) leem e chamam daqui; nenhum contrato de API mudou.
 *
 * Um só por aba (`useAgentes`): a Hoje mostra os cartões que o Pedir criou, e
 * o Escritório anima quem o turno chamou. Duas cópias deste estado teriam duas
 * guardas de `isLoading` e mandariam dois turnos em paralelo — o que a guarda
 * existe para impedir (os dois leriam a agenda antes de o outro reservar).
 */
import { computed, ref } from 'vue'
import {
  linhasDasTarefasCriadas,
  linhasDosEventosCriados,
  propostaDoUsuario,
  resumoDoAjuste,
  resumoDosEventosCriados
} from '../contribuicao'
import { ErroDaApi, rosterApi, type TipoDoRoster } from '../rosterApi'
import type {
  AlvoDeContratacao,
  AlvoDeEdicao,
  DadosDeContratacao,
  DadosNovaSquad,
  Modo,
  PreenchimentoDeContratacao,
  PropostaDeAjuste,
  QuestCalendario,
  Redirecionamento,
  RespostaDeAjuste,
  RosterView,
  SquadView,
  Sugestao,
  TarefaCriada
} from '../types'
import { ampliarAcesso, conectado, desconectar, irParaConsentimento, lerRetornoDoConsentimento, sincronizarStatus, tasksLiberado } from '../auth/google'
import { gravarSquadAtiva, lerSquadAtiva } from '../squadAtiva'

/** Gesto opcional no toast: "Autorizar Google Tasks", "Ver detalhes". */
export interface AcaoDoToast {
  rotulo: string
  fazer: () => void
}

/**
 * O último pedido desta aba, para a folha Pedir dizer o que aconteceu. Antes
 * erros e avisos iam num `alert()`, que no celular cobre a tela e some sem
 * deixar rastro; aqui ficam até o próximo pedido.
 */
export interface UltimoPedido {
  estado: 'rodando' | 'feito' | 'erro'
  demanda: string
  modo: Modo
  /** Squad em que o pedido entrou (a de destino, se o servidor redirecionou). */
  squadNome: string
  /** O que foi marcado, uma linha por compromisso ou tarefa. */
  linhas: string[]
  /** Erros e avisos do turno, ou o motivo da falha inteira. */
  problemas: string[]
  /** Quantas propostas (contratação, troca) o turno deixou na Hoje. */
  propostas: number
}

function criarEstadoDosAgentes() {
  const currentAgent = ref('Idle')
  // A Mochila NAO guarda quest local: a verdade e o Google Calendar. Esta ref e
  // so o cache da ultima leitura de GET /api/mochila.
  const quests = ref<QuestCalendario[]>([])
  const carregandoMochila = ref(false)
  /** Squad cuja Mochila foi lida com sucesso: é a fonte do estado do time na Hoje. */
  const mochilaDe = ref<string | null>(null)
  const sugestoes = ref<Sugestao[]>([])
  // O roster inteiro (todas as squads). Mapa e Mochila mostram só a ativa.
  const roster = ref<RosterView | null>(null)
  const erroRoster = ref('')
  const squadAtivaId = ref<string | null>(lerSquadAtiva())
  /** Id guardado que não existe (outro volume, squad de outra instalação): primeira squad. */
  const squadAtiva = computed<SquadView | null>(() => {
    const squads = roster.value?.squads ?? []
    return squads.find((s) => s.id === squadAtivaId.value) ?? squads[0] ?? null
  })
  const nomesDeDominio = computed<Record<string, string>>(() =>
    Object.fromEntries((squadAtiva.value?.dominios ?? []).map((d) => [d.id, d.nome]))
  )
  const nomeDaSquad = (id: string) => roster.value?.squads.find((s) => s.id === id)?.nome ?? id
  const sugestoesDeCrescimento = computed(() => sugestoes.value.filter((s) => s.kind !== 'troca_squad'))
  const sugestoesDeTroca = computed(() =>
    sugestoes.value.filter((s): s is Extract<Sugestao, { kind: 'troca_squad' }> => s.kind === 'troca_squad')
  )
  const criandoSquad = ref(false)
  const enviandoSquad = ref(false)
  const erroNovaSquad = ref('')
  const isLoading = ref(false)
  /** Squad em que o turno em curso começou; null sem turno. */
  const turnoSquadId = ref<string | null>(null)
  // Contratacao em curso: id da sugestao sendo aprovada (so uma por vez, o
  // servidor serializa as escritas no roster de qualquer forma). Id, nao indice:
  // um turno novo ou um descarte durante o POST desloca os indices.
  const aprovando = ref('')
  const erroSugestao = ref<Record<string, string>>({})
  const toast = ref('')
  const acaoDoToast = ref<AcaoDoToast | null>(null)
  let toastTimer = 0
  // Propostas de ajuste dos agentes. Não somem com turno novo nem troca de squad:
  // pertencem a eventos que continuam existindo no Google.
  const ajustes = ref<PropostaDeAjuste[]>([])
  // Um ajuste por vez: cada um relê a agenda e grava no Google.
  const aprovandoAjuste = ref('')
  const erroAjuste = ref<Record<string, string>>({})
  const ajusteNaoCabe = ref<Record<string, boolean>>({})
  const ultimoPedido = ref<UltimoPedido | null>(null)
  /** A folha Pedir aberta: o toast de um pedido com problema a reabre. */
  const pedirAberto = ref(false)

  const avisar = (texto: string, acao?: AcaoDoToast) => {
    toast.value = texto
    acaoDoToast.value = acao ?? null
    clearTimeout(toastTimer)
    // Com botão, mais tempo: 4 s mal dão para ler, que dirá decidir clicar.
    toastTimer = window.setTimeout(() => {
      toast.value = ''
      acaoDoToast.value = null
    }, acao ? 10000 : 4000)
  }
  const fecharToast = () => {
    clearTimeout(toastTimer)
    toast.value = ''
    acaoDoToast.value = null
  }

  let iniciado = false
  // O roster manda: papeis, slots desbloqueados e roteamento saem daqui.
  const iniciar = async () => {
    if (iniciado) return
    iniciado = true
    try {
      await carregarRoster()
    } catch (error) {
      console.error('Falha ao carregar o roster:', error)
      erroRoster.value = error instanceof Error ? error.message : String(error)
    }

    // Volta do consentimento: o callback redireciona para /?auth=ok ou
    // /?auth=<motivo>. Avisar aqui e o unico feedback que o usuario tem de que
    // a autorizacao deu certo, porque o resto do fluxo acontece no servidor.
    const retorno = lerRetornoDoConsentimento()

    // Sincroniza antes de decidir o texto: "nada mudou" só é verdade quando já
    // havia credencial. Sem isso, a primeira conexão (recusando o Calendar)
    // ouviria falar de uma "conexão anterior" que nunca existiu.
    const jaEstavaConectado = await sincronizarStatus()

    if (retorno === 'escopo_calendar_negado') {
      avisar(
        jaEstavaConectado
          ? 'Google: o Calendar foi desmarcado na autorização, então nada mudou e a conexão anterior continua valendo. Para autorizar o Google Tasks, repita marcando as duas caixas.'
          : 'Google: o Calendar foi desmarcado na autorização, então nada foi salvo. Para conectar, repita marcando a caixa do Calendar.',
        { rotulo: 'Tentar de novo', fazer: ampliarAcesso }
      )
    } else if (retorno && retorno !== 'ok') avisar(`Google: ${retorno}`)
    else if (retorno === 'ok') {
      avisar(tasksLiberado.value ? 'Calendário e Google Tasks autorizados' : 'Calendário conectado')
    }

    // A credencial mora no servidor: basta perguntar. Sem popup, sem gesto — se
    // ja houve consentimento antes, continua valendo depois de reload e deploy.
    if (jaEstavaConectado) await carregarMochila()
  }

  const carregarRoster = async () => {
    const response = await fetch('/api/squad')
    const corpo = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(corpo.error ?? 'Falha ao carregar o roster')
    roster.value = corpo
    erroRoster.value = ''
    // Corrige o guardado quando ele apontava para uma squad que não existe.
    const ativa = squadAtiva.value
    if (ativa && ativa.id !== squadAtivaId.value) {
      squadAtivaId.value = ativa.id
      gravarSquadAtiva(ativa.id)
    }
  }

  /**
   * Devolve se a squad ativa é `id` ao final. Com turno em curso não troca — o
   * mesmo guarda do seletor: a resposta do turno e o recarregar da Mochila são
   * da squad em que ele começou, e trocar no meio misturaria as duas.
   */
  const trocarSquad = async (id: string): Promise<boolean> => {
    if (id === squadAtiva.value?.id) return true
    if (isLoading.value) return false
    // Squad criada em outra aba: o roster local ainda não a conhece.
    if (!roster.value?.squads.some((s) => s.id === id)) await carregarRoster()
    squadAtivaId.value = id
    gravarSquadAtiva(id)
    quests.value = []
    mochilaDe.value = null
    currentAgent.value = 'Idle'
    await carregarMochila()
    return true
  }

  /**
   * Cada abertura de folha ganha um número. Resposta atrasada só fecha ou escreve
   * erro na folha se ela ainda for a MESMA abertura que fez a requisição: fechar e
   * abrir outra no meio não pode ter a folha nova zerada pela resposta da antiga.
   */
  let seqAbertura = 0
  const novaAbertura = () => ++seqAbertura
  let aberturaNovaSquad = 0

  const abrirNovaSquad = () => {
    erroNovaSquad.value = ''
    aberturaNovaSquad = novaAbertura()
    criandoSquad.value = true
  }

  const criarSquad = async (dados: DadosNovaSquad) => {
    const abertura = aberturaNovaSquad
    const aindaAberto = () => criandoSquad.value && aberturaNovaSquad === abertura
    enviandoSquad.value = true
    erroNovaSquad.value = ''
    try {
      const response = await fetch('/api/squad/nova', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados)
      })
      const corpo = await response.json().catch(() => ({}))
      // Erro fica DENTRO da folha: o usuário corrige o nome sem redigitar o resto.
      if (!response.ok) throw new Error(corpo.error ?? `HTTP ${response.status}`)
      roster.value = corpo.roster
      if (aindaAberto()) criandoSquad.value = false
      // A squad já existe no servidor; só a troca espera o turno acabar.
      const trocou = await trocarSquad(corpo.squad.id)
      avisar(
        trocou
          ? `Squad ${corpo.squad.nome} criada`
          : `Squad ${corpo.squad.nome} criada — troque no seletor quando o turno acabar`
      )
    } catch (error) {
      if (aindaAberto()) erroNovaSquad.value = error instanceof Error ? error.message : String(error)
    } finally {
      enviandoSquad.value = false
    }
  }

  /**
   * O servidor rodou o turno em outra squad e já criou os eventos lá. Não passa
   * por `trocarSquad`: aquele recusa trocar com turno em curso (`isLoading`), e
   * aqui a troca não é pedido, é fato consumado. Devolve o id adotado.
   */
  const adotarSquadDoTurno = async (r: Redirecionamento): Promise<string> => {
    // Squad criada em outra aba: sem ela no roster local, `squadAtiva` cairia na
    // primeira squad em vez do destino, e a Mochila viria da squad errada.
    if (!roster.value?.squads.some((s) => s.id === r.para_id)) await carregarRoster()
    squadAtivaId.value = r.para_id
    gravarSquadAtiva(r.para_id)
    quests.value = []
    mochilaDe.value = null
    avisar(`Demanda atendida pela squad ${r.para_nome}`)
    return r.para_id
  }

  /**
   * Aceite do card de troca. Fallback: o servidor já redireciona sozinho, e este
   * card só sobra quando a squad de destino também mandou a demanda embora (o
   * teto de um salto). Reenviar usa `auto`: o modo forçado era da squad anterior.
   */
  const aceitarTroca = async (id: string, reenviar: boolean) => {
    const proposta = sugestoesDeTroca.value.find((s) => s.id === id)
    if (!proposta) return
    // Sem troca não há reenvio: reenviar na squad de origem agendaria justamente
    // onde o modelo disse que a demanda não pertence. O card fica para depois.
    if (!(await trocarSquad(proposta.destino_id))) return
    sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
    if (reenviar) await handleDelegation({ demanda: proposta.demanda, modo: 'auto' })
  }

  /** 409 squadInexistente: a squad desta aba sumiu do servidor. */
  const recuperarSquadInexistente = async () => {
    squadAtivaId.value = null
    await carregarRoster()
    avisar('A squad selecionada não existe mais: voltei para a primeira.')
  }

  const carregarMochila = async (recuperando = false) => {
    if (!conectado.value || !squadAtiva.value) return
    const squadId = squadAtiva.value.id
    carregandoMochila.value = true
    try {
      const response = await fetch(`/api/mochila?squadId=${encodeURIComponent(squadId)}`)
      const corpo = await response.json().catch(() => ({}))
      // Trocou de squad enquanto esperava: esta resposta é da squad anterior, e
      // gravá-la mostraria as quests de uma squad no mapa de outra.
      if (squadAtiva.value?.id !== squadId) return
      if (!response.ok) {
        if (response.status === 409 && corpo.squadInexistente && !recuperando) {
          await recuperarSquadInexistente()
          return await carregarMochila(true)
        }
        // 401 = o servidor nao tem credencial valida (nunca conectou, ou o
        // Google recusou o refresh). Derruba o estado pra UI voltar a oferecer
        // o botao de conectar.
        if (response.status === 401) conectado.value = false
        throw new Error(corpo.error ?? `HTTP ${response.status}`)
      }
      quests.value = corpo.quests ?? []
      mochilaDe.value = squadId
      if (corpo.erros?.length) console.warn('Dominios com erro na Mochila:', corpo.erros)
      // Domínio com eventos demais volta sem quests: sem avisar na tela, a
      // Mochila pareceria completa.
      const incompletos = (corpo.erros ?? []).filter((e) => e.incompleto).map((e) => e.dominio)
      if (incompletos.length) avisar(`Mochila incompleta: eventos demais em ${incompletos.join(', ')}`)
    } catch (error) {
      // So no console, a Mochila vazia fica indistinguivel de "nao ha quests":
      // o motivo tem que chegar na tela de quem pode agir sobre ele.
      console.error('Falha ao ler a Mochila:', error)
      avisar(`Agenda: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      carregandoMochila.value = false
    }
  }

  const tirarAjuste = (id: string) => {
    ajustes.value = ajustes.value.filter((a) => a.id !== id)
    const { [id]: _e, ...erros } = erroAjuste.value
    erroAjuste.value = erros
    const { [id]: _n, ...naoCabe } = ajusteNaoCabe.value
    ajusteNaoCabe.value = naoCabe
  }

  const nomesDePessoa = computed<Record<string, string>>(() => {
    const squad = squadAtiva.value
    if (!squad) return {}
    const mapa: Record<string, string> = {}
    for (const i of squad.arquivo.integrantes) mapa[i.pessoa.id] = `${i.pessoa.nome} (arquivado)`
    for (const d of squad.dominios) for (const p of [d.po, ...d.integrantes]) mapa[p.id] = p.nome
    return mapa
  })

  /**
   * Ajuste iniciado pelo PRÓPRIO usuário, pelo botão da agenda. Mesma rota e
   * mesmo card das propostas de agente: muda só quem abriu e quem escolhe o
   * tempo (o card nasce editável). O id vem do evento, então clicar de novo
   * reabre o mesmo card em vez de empilhar outro.
   */
  const abrirAjusteDaQuest = (quest: QuestCalendario) => {
    const squad = squadAtiva.value
    if (!squad || aprovandoAjuste.value) return
    const proposta = propostaDoUsuario(quest, quests.value, squad.id, nomesDePessoa.value[quest.membro])
    if (!proposta) return
    tirarAjuste(proposta.id)
    ajustes.value = [...ajustes.value, proposta]
  }

  const aprovarAjuste = async (id: string, permitirMover: boolean, propostoMin: number) => {
    if (aprovandoAjuste.value) return
    const proposta = ajustes.value.find((a) => a.id === id)
    if (!proposta) return
    aprovandoAjuste.value = id
    erroAjuste.value = { ...erroAjuste.value, [id]: '' }
    try {
      const response = await fetch(`/api/quests/${encodeURIComponent(proposta.eventId)}/ajustar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          squadId: proposta.squad_id,
          alvo: proposta.alvo,
          // Do card, não da proposta: no ajuste do usuário o tempo é escolha dele.
          proposto_min: propostoMin,
          permitirMover
        })
      })
      const corpo = await response.json().catch(() => ({}))
      if (!response.ok) {
        if (response.status === 401) conectado.value = false
        // Evento apagado no Google: a proposta não tem mais onde valer.
        if (response.status === 404 && corpo.questSumiu) {
          tirarAjuste(id)
          avisar(corpo.error ?? 'O evento não existe mais no Google.')
          return
        }
        ajusteNaoCabe.value = { ...ajusteNaoCabe.value, [id]: response.status === 409 && !!corpo.naoCabe }
        throw new Error(corpo.error ?? `HTTP ${response.status}`)
      }
      tirarAjuste(id)
      avisar(resumoDoAjuste(corpo as RespostaDeAjuste))
      // O horário mudou no Google: a Mochila relê em vez de confiar na resposta.
      await carregarMochila()
    } catch (error) {
      if (ajustes.value.some((a) => a.id === id)) {
        erroAjuste.value = { ...erroAjuste.value, [id]: error instanceof Error ? error.message : String(error) }
      }
    } finally {
      aprovandoAjuste.value = ''
    }
  }

  /**
   * [APROVAR] do card (§4.4). E aqui que a proposta do modelo vira roster: o
   * POST devolve o squad ja atualizado, e trocar `roster.value` e o unico gatilho
   * de que o escritorio precisa — o GameMap ve um dominio (ou uma pessoa) a mais
   * e roda a sequencia de crescimento sozinho.
   */
  const aprovarSugestao = async (id: string, nome: string) => {
    if (aprovando.value) return
    const sugestao = sugestoes.value.find((s) => s.id === id)
    if (!sugestao) return
    aprovando.value = id
    erroSugestao.value = { ...erroSugestao.value, [id]: '' }
    // Um turno novo pode substituir a lista enquanto o POST corre. Aí o card
    // deste id nao existe mais, e mexer no estado dos cards (remover, gravar
    // erro, liberar `aprovando`) atropelaria os cards do turno novo.
    const aindaNaLista = () => sugestoes.value.some((s) => s.id === id)
    try {
      const response = await fetch('/api/squad/hire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sugestao, nome })
      })
      const dados = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(dados.error ?? `HTTP ${response.status}`)

      // O roster mudou de qualquer jeito: roster e aviso valem mesmo sem o card.
      roster.value = dados.roster
      if (aindaNaLista()) {
        sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
        const { [id]: _, ...outrosErros } = erroSugestao.value
        erroSugestao.value = outrosErros
      }
      // A contratação cai na squad da proposta, que pode não ser a da tela.
      const onde = dados.squadId !== squadAtiva.value?.id ? ` na squad ${nomeDaSquad(dados.squadId)}` : ''
      avisar(
        dados.kind === 'dominio'
          ? `${dados.pessoa.nome} abriu o dominio ${dados.dominio.nome}${onde}`
          : `${dados.pessoa.nome} entrou no squad (${dados.dominio.nome})${onde}`
      )
    } catch (error) {
      console.error('Falha ao contratar:', error)
      if (aindaNaLista()) erroSugestao.value = { ...erroSugestao.value, [id]: error instanceof Error ? error.message : String(error) }
    } finally {
      // So libera se ainda for a aprovacao deste id: depois de um turno novo,
      // `aprovando` pode ja pertencer a um card do turno novo.
      if (aprovando.value === id) aprovando.value = ''
    }
  }

  const descartarSugestao = (id: string) => {
    sugestoes.value = sugestoes.value.filter((s) => s.id !== id)
  }

  // Folha de contratação aberta pela sala, pelo slot livre ou pelo "Ajustar" de
  // um card. `sugestaoId` existe só no último caso: contratar remove o card.
  const contratacao = ref<{
    alvo: AlvoDeContratacao
    inicial?: PreenchimentoDeContratacao
    sugestaoId?: string
    /** Número desta abertura (novaAbertura): identifica a quem a resposta pertence. */
    abertura: number
  } | null>(null)
  const enviandoContratacao = ref(false)
  const erroContratacao = ref('')

  const totalArquivado = computed(
    () =>
      (squadAtiva.value?.arquivo.dominios.length ?? 0) +
      (squadAtiva.value?.arquivo.integrantes.length ?? 0) +
      (roster.value?.squadsArquivadas.length ?? 0)
  )

  const acharDominioAtivo = (id: string) => squadAtiva.value?.dominios.find((d) => d.id === id)

  const abrirContratacao = (alvo: AlvoDeContratacao, inicial?: PreenchimentoDeContratacao, sugestaoId?: string) => {
    erroContratacao.value = ''
    contratacao.value = { alvo, inicial, sugestaoId, abertura: novaAbertura() }
  }

  const contratarNaSala = (dominioId: string) => {
    const dominio = acharDominioAtivo(dominioId)
    if (dominio && squadAtiva.value) abrirContratacao({ alvo: 'integrante', squadId: squadAtiva.value.id, dominio })
  }

  const abrirSala = () => {
    const squad = squadAtiva.value
    if (squad?.proximoSlot) abrirContratacao({ alvo: 'dominio', squadId: squad.id, slot: squad.proximoSlot })
  }

  const substituirPoDaSala = (dominioId: string) => {
    const dominio = acharDominioAtivo(dominioId)
    if (dominio && squadAtiva.value) abrirContratacao({ alvo: 'po', squadId: squadAtiva.value.id, dominio })
  }

  /** "Ajustar" do card: a mesma folha, com a proposta do modelo como ponto de partida. */
  const ajustarSugestao = (id: string) => {
    const s = sugestoes.value.find((x) => x.id === id)
    if (!s || s.kind === 'troca_squad') return
    const falhar = (msg: string) => {
      erroSugestao.value = { ...erroSugestao.value, [id]: msg }
    }
    const squad = roster.value?.squads.find((q) => q.id === s.squad_id)
    if (!squad) return falhar('A squad desta proposta não está ativa.')
    if (s.kind === 'integrante') {
      const dominio = squad.dominios.find((d) => d.id === s.dominio_id)
      if (!dominio) return falhar('O domínio desta proposta não está mais ativo.')
      abrirContratacao({ alvo: 'integrante', squadId: squad.id, dominio }, { papel: s.papel, escopo: s.escopo }, id)
    } else {
      if (!squad.proximoSlot) return falhar('Escritório cheio: não há sala livre.')
      abrirContratacao(
        { alvo: 'dominio', squadId: squad.id, slot: squad.proximoSlot },
        { nomeDominio: s.dominio, escopoDominio: s.escopo, papel: s.papel_po, escopo: s.escopo },
        id
      )
    }
  }

  /**
   * Contratar pela UI usa as mesmas rotas do card (hire) e da substituição de PO.
   * Trocar `roster` é o único gatilho de que o escritório precisa: o GameMap vê a
   * sala ou a pessoa nova e anima sozinho.
   */
  const confirmarContratacao = async (dados: DadosDeContratacao) => {
    const atual = contratacao.value
    if (!atual || enviandoContratacao.value) return
    const { alvo, abertura } = atual
    const aindaAberto = () => contratacao.value?.abertura === abertura
    enviandoContratacao.value = true
    erroContratacao.value = ''
    try {
      if (dados.alvo === 'po' && alvo.alvo === 'po') {
        const corpo =
          'integranteId' in dados
            ? { integranteId: dados.integranteId }
            : { nome: dados.nome || undefined, papel: dados.papel, escopo: dados.escopo }
        const r = await rosterApi.substituirPo(alvo.dominio.id, corpo)
        roster.value = r.roster
        avisar(`${r.po.nome} é o novo PO de ${alvo.dominio.nome}`)
      } else if (dados.alvo === 'integrante' && alvo.alvo === 'integrante') {
        const r = await rosterApi.contratar(
          { kind: 'integrante', squad_id: alvo.squadId, dominio_id: alvo.dominio.id, papel: dados.papel, escopo: dados.escopo },
          dados.nome || undefined
        )
        roster.value = r.roster
        avisar(`${r.pessoa.nome} entrou em ${r.dominio.nome}`)
      } else if (dados.alvo === 'dominio' && alvo.alvo === 'dominio') {
        const r = await rosterApi.contratar(
          {
            kind: 'dominio',
            squad_id: alvo.squadId,
            dominio: dados.nomeDominio,
            escopo: dados.escopoDominio,
            papel_po: dados.papelPo,
            escopo_po: dados.escopoPo
          },
          dados.nome || undefined
        )
        roster.value = r.roster
        avisar(`${r.pessoa.nome} abriu o domínio ${r.dominio.nome}`)
      }
      if (atual.sugestaoId) descartarSugestao(atual.sugestaoId)
      if (aindaAberto()) contratacao.value = null
    } catch (error) {
      // Squad sumiu ou foi arquivada em outra aba: mesmo gesto da Fase 1.
      if (error instanceof ErroDaApi && error.corpo.squadInexistente) {
        if (aindaAberto()) contratacao.value = null
        await recuperarSquadInexistente()
        return
      }
      if (aindaAberto()) erroContratacao.value = error instanceof Error ? error.message : String(error)
    } finally {
      enviandoContratacao.value = false
    }
  }

  const edicao = ref<AlvoDeEdicao | null>(null)
  let aberturaEdicao = 0
  let aberturaArquivo = 0
  const enviandoEdicao = ref(false)
  const erroEdicao = ref('')
  const arquivoAberto = ref(false)
  const reativando = ref('')
  const errosArquivo = ref<Record<string, string>>({})
  // Arquivar em curso: um por vez, e o painel fica desabilitado enquanto isso.
  const arquivando = ref(false)
  const ocupadoComRoster = computed(() => isLoading.value || enviandoContratacao.value || arquivando.value)
  // Qualquer folha do roster aberta bloqueia o Pedir, como a de nova squad já
  // fazia: um Enter lá mandaria um turno às cegas com o roster mudando aqui.
  const modalAberto = computed(
    () => criandoSquad.value || !!contratacao.value || !!edicao.value || arquivoAberto.value
  )

  const acharPessoaAtiva = (id: string) =>
    squadAtiva.value?.dominios.flatMap((d) => [d.po, ...d.integrantes]).find((p) => p.id === id)

  const abrirEdicao = (alvo: AlvoDeEdicao) => {
    erroEdicao.value = ''
    aberturaEdicao = novaAbertura()
    edicao.value = alvo
  }
  const editarPessoa = (id: string) => {
    const pessoa = acharPessoaAtiva(id)
    if (pessoa) abrirEdicao({ tipo: 'pessoa', pessoa })
  }
  const editarDominio = (id: string) => {
    const dominio = acharDominioAtivo(id)
    if (dominio) abrirEdicao({ tipo: 'dominio', dominio })
  }
  const editarSquadAtiva = () => {
    if (squadAtiva.value) abrirEdicao({ tipo: 'squad', squad: squadAtiva.value })
  }

  const salvarEdicao = async (corpo: Record<string, string>) => {
    const alvo = edicao.value
    if (!alvo || enviandoEdicao.value) return
    const [tipo, id]: [TipoDoRoster, string] =
      alvo.tipo === 'pessoa'
        ? ['pessoas', alvo.pessoa.id]
        : alvo.tipo === 'dominio'
          ? ['dominios', alvo.dominio.id]
          : ['squads', alvo.squad.id]
    const abertura = aberturaEdicao
    const aindaAberto = () => !!edicao.value && aberturaEdicao === abertura
    enviandoEdicao.value = true
    erroEdicao.value = ''
    try {
      const r = await rosterApi.editar(tipo, id, corpo)
      roster.value = r.roster
      if (aindaAberto()) edicao.value = null
      avisar('Salvo')
    } catch (error) {
      if (aindaAberto()) erroEdicao.value = error instanceof Error ? error.message : String(error)
    } finally {
      enviandoEdicao.value = false
    }
  }

  /**
   * Arquivar pede confirmação com o efeito explícito (spec §3.4). O perigo não é
   * perder dado, é o usuário achar que perdeu.
   */
  // `pergunta` null: a tela já confirmou com o segundo toque (a squad, na folha de editar: AC-25).
  const arquivar = async (tipo: TipoDoRoster, id: string, pergunta: string | null) => {
    if (arquivando.value || (pergunta !== null && !window.confirm(pergunta))) return
    arquivando.value = true
    try {
      const eraSquadAtiva = tipo === 'squads' && id === squadAtiva.value?.id
      const r = await rosterApi.arquivar(tipo, id)
      roster.value = r.roster
      if (eraSquadAtiva && r.roster.squads[0]) {
        // trocarSquad sairia cedo: o computed já caiu na primeira squad ativa
        // quando o roster mudou. Grava a escolha e relê a Mochila à mão.
        const nova = r.roster.squads[0]
        squadAtivaId.value = nova.id
        gravarSquadAtiva(nova.id)
        quests.value = []
        mochilaDe.value = null
        currentAgent.value = 'Idle'
        await carregarMochila()
      } else if (tipo === 'dominios') {
        await carregarMochila()
      }
      avisar('Arquivado')
    } catch (error) {
      avisar(error instanceof Error ? error.message : String(error))
    } finally {
      arquivando.value = false
    }
  }

  const arquivarPessoa = (id: string) => {
    const p = acharPessoaAtiva(id)
    if (!p) return
    arquivar('pessoas', id, `Arquivar ${p.nome}? Sai do escritório e do prompt. Os eventos dele continuam no Google e na agenda do domínio. Dá para reativar no Arquivo.`)
  }
  const arquivarDominio = (id: string) => {
    const d = acharDominioAtivo(id)
    if (!d) return
    arquivar('dominios', id, `Arquivar a sala ${d.nome} com ${1 + d.integrantes.length} pessoa(s)? A sala fecha e libera o slot. Os eventos continuam no Google, mas saem da agenda até você reativar.`)
  }
  /**
   * Arquivar a squad saiu do lado de "Editar" (AC-25, 17/10/2026): ação rara e de efeito grande
   * não fica à vista. Mora na folha de editar a squad, que confirma com o segundo toque ali mesmo;
   * a folha fecha porque a squad que ela editava não está mais à vista.
   */
  const arquivarSquadConfirmada = async (id: string) => {
    await arquivar('squads', id, null)
    if (edicao.value?.tipo === 'squad' && edicao.value.squad.id === id && !roster.value?.squads.some((s) => s.id === id)) {
      edicao.value = null
    }
  }

  const abrirArquivo = () => {
    errosArquivo.value = {}
    aberturaArquivo = novaAbertura()
    arquivoAberto.value = true
  }

  const reativar = async (tipo: TipoDoRoster, id: string) => {
    if (reativando.value) return
    const chave = `${tipo}:${id}`
    const abertura = aberturaArquivo
    const aindaAberto = () => arquivoAberto.value && aberturaArquivo === abertura
    reativando.value = chave
    errosArquivo.value = { ...errosArquivo.value, [chave]: '' }
    try {
      const r = await rosterApi.reativar(tipo, id)
      roster.value = r.roster
      avisar('Reativado')
      if (tipo === 'dominios') await carregarMochila()
    } catch (error) {
      if (aindaAberto()) {
        errosArquivo.value = { ...errosArquivo.value, [chave]: error instanceof Error ? error.message : String(error) }
      } else {
        avisar(error instanceof Error ? error.message : String(error))
      }
    } finally {
      reativando.value = ''
    }
  }

  // Navega para fora da SPA; o retorno cai em `iniciar`.
  const conectarGoogle = () => irParaConsentimento()

  const desconectarGoogle = async () => {
    await desconectar()
    quests.value = []
    mochilaDe.value = null
    avisar('Calendário desconectado')
  }

  const abrirPedir = () => {
    pedirAberto.value = true
  }

  const handleDelegation = async (payload: { demanda: string; modo: Modo }) => {
    if (isLoading.value || modalAberto.value) return

    isLoading.value = true
    currentAgent.value = 'Idle'
    // A squad do turno, não a da tela quando ele voltar: é nela que os eventos nasceram.
    const squadIdDoTurno = squadAtiva.value?.id ?? null
    turnoSquadId.value = squadIdDoTurno
    const pedido: UltimoPedido = {
      estado: 'rodando',
      demanda: payload.demanda,
      modo: payload.modo,
      squadNome: squadAtiva.value?.nome ?? '',
      linhas: [],
      problemas: [],
      propostas: 0
    }
    ultimoPedido.value = pedido
    /** O toast do fim: com a folha fechada, o problema precisa de um caminho de volta. */
    const verDetalhes: AcaoDoToast = { rotulo: 'Ver detalhes', fazer: abrirPedir }

    try {
      // O token e problema do servidor: ele pega do store e renova sozinho. Um
      // turno que nao toca o calendario roda mesmo sem credencial.
      const response = await fetch('/api/orquestrar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demanda: payload.demanda, modo: payload.modo, squadId: squadIdDoTurno ?? undefined })
      })

      if (!response.ok) {
        // O corpo carrega a classificacao: `modeloOcupado` e transitorio e passa
        // sozinho, por isso o texto manda tentar de novo em vez de sugerir que
        // algo quebrou.
        const corpo = await response.json().catch(() => ({}))
        // A squad desta aba sumiu: o servidor recusou ANTES do Gemini, entao nada
        // foi agendado. Reenviar sozinho mandaria a demanda para outra squad sem
        // o usuario ver.
        if (response.status === 409 && corpo.squadInexistente) {
          await recuperarSquadInexistente()
          throw new Error('A squad selecionada não existe mais. Confira a squad e reenvie o pedido.')
        }
        throw new Error(corpo.error || 'Erro na requisição')
      }

      const turno = await response.json()

      // O turno pode ter rodado em OUTRA squad (redirecionamento automático do
      // servidor): os eventos nasceram lá, então a aba adota o destino ANTES de
      // reler a Mochila — senão ela viria da squad de origem, sem as quests novas.
      if (turno.redirecionado) {
        await adotarSquadDoTurno(turno.redirecionado)
        pedido.squadNome = turno.redirecionado.para_nome
      }

      const erros = turno.erros ?? []
      const avisos = turno.avisos ?? []
      // Passos sem o escopo do Tasks: o compromisso saiu inteiro, então não é
      // problema da lista — é o toast do turno com o gesto certo. Nunca logout:
      // ampliar é o mesmo consentimento.
      const ampliar = (x: { motivo?: string }) => x.motivo === 'ampliarAcesso'
      // Tarefa avulsa sem o escopo chega como ERRO (não sobrou nada dela), mas o
      // gesto é o mesmo dos passos: toast com "Autorizar", não lista de problema.
      const pedeTasks = avisos.some(ampliar) || erros.some(ampliar)
      if (pedeTasks) tasksLiberado.value = false
      const acaoTasks = pedeTasks ? { rotulo: 'Autorizar Google Tasks', fazer: ampliarAcesso } : undefined
      const semTasks = 'Falta autorizar o Google Tasks: passos e tarefas ficaram de fora.'
      const tarefas: TarefaCriada[] = turno.tarefas_criadas ?? []

      // Cada turno SUBSTITUI as propostas, inclusive por nenhuma: sugestao de
      // uma demanda antiga nao tem mais contexto, e deixar a lista so crescer
      // (ou nunca esvaziar) mostrava cards que ninguem pediu agora.
      sugestoes.value = turno.sugestoes ?? []
      erroSugestao.value = {}
      // Aprovacao em curso era de um card que acabou de sair: sem zerar, os
      // cards novos ficariam bloqueados ate o POST antigo voltar.
      aprovando.value = ''
      pedido.propostas = sugestoes.value.length

      // Agendar sem credencial falha por compromisso, nao o turno inteiro: o
      // motivo classificado e o que diz para a agenda voltar a oferecer o
      // botao de conectar. Bloco de prazo recusado no meio da serie chega como
      // aviso (o compromisso saiu em parte), com o mesmo motivo.
      const precisaConectar = (x: { motivo?: string }) => x.motivo === 'precisaConectar'
      if (erros.some(precisaConectar) || avisos.some(precisaConectar)) conectado.value = false
      // try por tarefa: o lote sobrevive, os erros vem nomeados. Avisos sao
      // coisas feitas de um jeito diferente do pedido (conflito, esforco que
      // nao coube antes do prazo) e o usuario precisa saber delas agora.
      pedido.problemas = [
        ...erros.filter((e) => !ampliar(e)).map((e) => `${e.capacidade}: ${e.erro}`),
        ...avisos.filter((a) => !ampliar(a)).map((a) => `Aviso — ${a.titulo}: ${a.aviso}`)
      ]
      if (pedido.problemas.length) console.warn('Tarefas com erro:', erros, 'Avisos:', avisos)
      if (pedeTasks) pedido.problemas.push(semTasks)

      if (turno.eventos_criados?.length || tarefas.length) {
        // responsavel_id e uma PESSOA (PO ou integrante); o GameMap resolve em
        // qual DOMINIO ela esta para mandar o PO raiz ate a sala certa.
        currentAgent.value = (turno.eventos_criados?.[0] ?? tarefas[0]).responsavel_id
        // O que foi marcado, no toast: o servidor escolhe o horário e a duração,
        // e sem isto o usuário só descobria abrindo a agenda ou o Google. O
        // toast do redirecionamento automático vem antes e seria sobrescrito por
        // este, então a squad de destino entra aqui em vez de se perder. Tarefa
        // avulsa não aparece na agenda (vive só no Tasks): o toast e a folha são
        // os únicos lugares do app que contam que ela nasceu.
        const resumo = resumoDosEventosCriados(turno.eventos_criados ?? [], {}, tarefas)
        pedido.linhas = [...linhasDosEventosCriados(turno.eventos_criados ?? []), ...linhasDasTarefasCriadas(tarefas)]
        const texto = turno.redirecionado ? `Squad ${turno.redirecionado.para_nome} — ${resumo}` : resumo
        const problemas = pedido.problemas.filter((p) => p !== semTasks).length
        avisar(
          [texto, pedeTasks ? semTasks : '', problemas ? `${problemas} aviso(s) no pedido` : ''].filter(Boolean).join(' · '),
          acaoTasks ?? (problemas ? verDetalhes : undefined)
        )
      } else if (pedeTasks) {
        avisar(semTasks, acaoTasks)
      } else if (pedido.problemas.length) {
        avisar(`Pedido com ${pedido.problemas.length} problema(s)`, verDetalhes)
      } else if (pedido.propostas) {
        avisar(`Nada marcado: ${pedido.propostas} proposta(s) esperando você em Hoje`)
      }
      pedido.estado = 'feito'

      // Rele o calendario em vez de confiar no retorno: o que o Google gravou e
      // o que vale, inclusive edicoes feitas fora do app.
      await carregarMochila()
    } catch (error) {
      console.error('Falha ao orquestrar:', error)
      pedido.estado = 'erro'
      pedido.problemas = [error instanceof Error && error.message ? error.message : 'Houve um erro ao processar a demanda. Tente novamente.']
      avisar('O pedido não foi processado', verDetalhes)
    } finally {
      // Objeto novo: `pedido` foi mexido cru, fora da reatividade; outro pedido
      // não começa no meio (a guarda de `isLoading`), então este é o último.
      ultimoPedido.value = { ...pedido }
      isLoading.value = false
      turnoSquadId.value = null
    }
  }

  return {
    // leitura
    currentAgent,
    quests,
    carregandoMochila,
    mochilaDe,
    roster,
    erroRoster,
    squadAtiva,
    nomesDeDominio,
    nomesDePessoa,
    nomeDaSquad,
    sugestoesDeCrescimento,
    sugestoesDeTroca,
    isLoading,
    turnoSquadId,
    ultimoPedido,
    pedirAberto,
    toast,
    acaoDoToast,
    ocupadoComRoster,
    modalAberto,
    totalArquivado,
    // cartões
    aprovando,
    erroSugestao,
    ajustes,
    aprovandoAjuste,
    erroAjuste,
    ajusteNaoCabe,
    // folhas do roster
    criandoSquad,
    enviandoSquad,
    erroNovaSquad,
    contratacao,
    enviandoContratacao,
    erroContratacao,
    edicao,
    enviandoEdicao,
    erroEdicao,
    arquivoAberto,
    reativando,
    errosArquivo,
    // ações
    iniciar,
    avisar,
    fecharToast,
    abrirPedir,
    carregarMochila,
    trocarSquad,
    abrirNovaSquad,
    criarSquad,
    aceitarTroca,
    abrirAjusteDaQuest,
    aprovarAjuste,
    tirarAjuste,
    aprovarSugestao,
    descartarSugestao,
    ajustarSugestao,
    contratarNaSala,
    abrirSala,
    substituirPoDaSala,
    confirmarContratacao,
    editarPessoa,
    editarDominio,
    editarSquadAtiva,
    salvarEdicao,
    arquivarPessoa,
    arquivarDominio,
    arquivarSquadConfirmada,
    arquivando,
    abrirArquivo,
    reativar,
    conectarGoogle,
    desconectarGoogle,
    handleDelegation
  }
}

export type EstadoDosAgentes = ReturnType<typeof criarEstadoDosAgentes>

let unico: EstadoDosAgentes | null = null

/** O estado da aba. Criado na primeira chamada; `iniciar()` faz as leituras. */
export function useAgentes(): EstadoDosAgentes {
  return (unico ??= criarEstadoDosAgentes())
}
