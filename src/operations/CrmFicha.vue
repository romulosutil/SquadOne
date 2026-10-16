<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CrmCopiloto from './CrmCopiloto.vue'
import CrmJornada from './CrmJornada.vue'
import { copilotoServe, type SugestaoDoCopiloto } from './copiloto'
import { cabeProposta, gostouDepoisDoLink, propostaDeUmToque } from './mandar-proposta'
import { copilotoLigado } from './copiloto-ligado'
import CrmMomento from './CrmMomento.vue'
import CrmObjecao from './CrmObjecao.vue'
import { colinhaDoLead } from './colinha'
import { nomeDaOferta, ofertaDoLead, proximoDaJornada } from './jornada'
import { anotadoEm, textoDaAnotacao, type EnviosAnotados, type TipoDeEnvioAnotado } from './anotacao-de-envio'
import { DIAS_SEM_RESPOSTA, ROTULO_DA_ETAPA, ROTULO_DA_OFERTA_DO_PLUS, ROTULO_DA_RESPOSTA, ROTULO_DO_PRODUTO, dataHora, diasNaEtapa, ehConvite, hojeEmSP, hora, onde, rotuloDoFollowup, textoDaAbordagem } from './crm-formato'
import { ROTULO_DE_LIBERAR, ehPrimeiroContato, envioTravado, linksDePrimeiroContato, type EnviosLiberados } from './trava-de-horario'
import { textoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'
import type { CrmLead, CrmTipoDeRegistro, CrmVisao } from './types'
import { raioXAvulso } from '../../server/site-mensagem.ts'
import { textoDoLink } from './proxima-venda'

// Ficha de um lead. As únicas escritas da Central são as deste arquivo (nota, próximo passo,
// proposta, sem contato fácil, e no Plus o envio e a resposta) e todas vão para a aba CRM da
// planilha pelo n8n (POST /api/operations/crm/registro); o toque na 2ª mensagem e no follow-up
// também anota o envio por essa rota, pelo CrmPanel (14/10/2026). Recusou/Fechou/Desfazer ficam
// na página do lead do n8n (fluxo 07); a Etapa do PRUMO muda na planilha.
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente, enviar a primeira mensagem, o
// convite e o reenvio do só-robô esperam o "Liberar" deste lead, como na Hoje e no Funil.
// `anotados`/`falhaDaAnotacao` (anotacao-de-envio.ts): o toque na 2ª mensagem ou no follow-up anota
// o envio pelo CrmPanel, em segundo plano; a ficha mostra a marca ou o pedido de anotar à mão.
//
// O desenho (16/10/2026, segunda volta): em 5 segundos, quem é, onde está, o que fazer agora e
// um botão primário para isso. Por isso a seção "Agora" junta o passo, o próximo passo (um só:
// o salvo à mão vence o sugerido, e se edita ali mesmo), a ação e os avisos; o resto é seção
// separada por título e linha, nunca caixa dentro de caixa, e o que é consulta fica dobrado.
const props = defineProps<{
  lead: CrmLead
  visao: CrmVisao
  aviso?: string | null
  liberados: EnviosLiberados
  anotados: EnviosAnotados
  falhaDaAnotacao?: string
  /** Trava de ritmo (trava-de-ritmo.ts): segurando, os links de primeiro contato somem sem "Liberar". */
  ritmo: EstadoDoRitmo
}>()
// Abre numa folha cheia (CrmPanel): fechar é o "Fechar" da folha, o Esc ou o
// voltar do navegador, então a ficha não tem botão de voltar próprio.
// `colinha`: o CrmPanel troca para /crm?ver=colinha (fecha a folha, sem recarregar).
const emit = defineEmits<{
  registrado: []; colinha: []; liberar: [leadId: string]; anotar: [leadId: string, tipo: TipoDeEnvioAnotado]; primeiro: [leadId: string]
}>()

const titulo = ref<HTMLHeadingElement | null>(null)
// Copiloto (fase 1, em sombra): só pede sugestão e conta as cópias; não escreve na planilha.
const comCopiloto = ref(false)
copilotoLigado().then((ligado) => { comCopiloto.value = ligado })
const nota = ref('')
const proximoTexto = ref('')
const proximoData = ref('')
const propostaData = ref(hojeEmSP())
const salvando = ref<CrmTipoDeRegistro | null>(null)
const mensagem = ref('')
const erro = ref('')
// De onde saiu o último registro: a confirmação aparece perto do botão tocado, não no outro canto da ficha.
const origem = ref<'proximo' | 'anotar' | 'acao'>('anotar')

const hoje = hojeEmSP()
const aberto = computed(() => props.lead.etapa !== 'ganho' && props.lead.etapa !== 'perdido')
// Perdido pelo tempo (regra dos 7 dias) não teve desfecho: a proposta ainda pode ser marcada, e o traz de volta.
const saiuPeloPrazo = computed(() => props.lead.motivoPerda === 'expirou' || props.lead.motivoPerda === 'esfriou')
const eventos = computed(() => [...props.lead.eventos].reverse())
const disponivel = computed(() => props.visao.registro.disponivel)

// ------------------------------------------------------------ datas para gente

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** "2026-10-12" → "seg 12/10": o dia da semana diz mais que o número sozinho. */
function diaDaSemana(valor?: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor ?? '')
  if (!m) return valor ?? ''
  return `${DIAS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()]} ${m[3]}/${m[2]}`
}
/** Um instante (ISO) como "seg 13/10 11:00", no fuso de São Paulo. */
function quandoFoi(iso?: string): string {
  const t = iso ? Date.parse(iso) : NaN
  return Number.isFinite(t) ? `${diaDaSemana(hojeEmSP(new Date(t)))} ${hora(iso)}` : ''
}
const primeiraMaiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

// ------------------------------------------------------------ o que fazer agora

// Um "próximo passo" só (eram três: a faixa fixa, a Jornada e o "Próximo passo salvo" em Anotar).
const proximo = computed(() => proximoDaJornada(props.lead))
const QUEM = { você: 'com você', robô: 'com o robô', 'o dono': 'com o dono' } as const
const prazo = computed(() => {
  const q = proximo.value.quando
  if (!q) return { texto: '', atrasado: false }
  if (!proximo.value.marcadoAMao) return { texto: primeiraMaiuscula(q), atrasado: false }
  if (q === hoje) return { texto: 'Para hoje', atrasado: false }
  return q < hoje ? { texto: `Era para ${diaDaSemana(q)}`, atrasado: true } : { texto: `Para ${diaDaSemana(q)}`, atrasado: false }
})

// ------------------------------------------------------------ mandar a proposta (mandar-proposta.ts)

// Gostou depois do link: a proposta é o passo de hoje (primário). Só entre o link e a proposta, sem o
// "gostei" visto pelo n8n (a conversa andou por telefone?): fica ao lado, como secundária.
const gostou = computed(() => gostouDepoisDoLink(props.lead))
const cabe = computed(() => gostou.value || cabeProposta(props.lead))
// A sugestão guardada do copiloto (GET, nunca chama o modelo): dela saem os itens; os preços, do cardápio.
const sugestaoGuardada = ref<SugestaoDoCopiloto | null>(null)
async function lerSugestaoGuardada() {
  sugestaoGuardada.value = null
  if (!comCopiloto.value || !cabe.value) return
  const id = props.lead.id
  try {
    const r = await fetch(`/api/operations/crm/copiloto/sugestao?${new URLSearchParams({ produto: props.lead.produto, id })}`)
    const dados = await r.json().catch(() => ({}))
    if (r.ok && props.lead.id === id) sugestaoGuardada.value = dados.sugestao?.sugestao ?? null
  } catch {
    // Sem a sugestão, sai o texto base da colinha.
  }
}
watch([comCopiloto, () => props.lead.id, cabe], () => { void lerSugestaoGuardada() }, { immediate: true })
const proposta = computed(() => (cabe.value ? propostaDeUmToque(props.lead, sugestaoGuardada.value) : null))
function aoTerSugestao(s: SugestaoDoCopiloto | null) {
  if (cabe.value) sugestaoGuardada.value = s
}

// As ações de um toque. `principal`: é o passo de hoje (convite, primeira mensagem, 2ª mensagem ou
// demo depois do "sim", follow-up). `anota`: tocar já anota o envio, e a ficha avisa isso uma vez.
interface AcaoDaFicha { chave: string; rotulo: string; href: string; principal: boolean; anota: boolean }
const acoes = computed<AcaoDaFicha[]>(() => {
  const l = props.lead.links
  const prumo = props.lead.produto === 'prumo'
  // Iris e estamparias: o site é o da empresa e a Etapa muda na planilha, como no PRUMO.
  const convite = ehConvite(props.lead.produto)
  const interesse = props.lead.resposta?.tipo === 'interesse'
  // Site com a variação C: a segunda (segundaDe) leva o raio-x e o demo, não só o site. Com o Raio-X
  // avulso (demo sob pedido, 14/10/2026): só o raio-x antes do demo, só o demo depois do "Gerar demo".
  const recebeuC = !prumo && props.lead.abordagem?.mensagem === 'C' && Boolean(l.raioX)
  const segunda = prumo ? 'Mandar o Raio-X'
    : !recebeuC ? 'Mandar o link do site'
    : !raioXAvulso(l.raioX) ? 'Mandar o raio-x e o demo'
    : l.site ? 'Mandar o demo com o preço' : 'Mandar o raio-x'
  const todas: Array<[string, string, string | undefined, boolean, boolean]> = [
    // Primeiro da lista quando ele gostou: o link da 2ª mensagem ainda pode estar na planilha, e o passo já é outro.
    ['proposta', 'Mandar a proposta', gostou.value ? proposta.value?.url : undefined, true, true],
    ['enviar', 'Enviar a primeira mensagem', l.enviar, true, true],
    ['convite', 'Enviar o convite', l.convite, true, true],
    ['segunda', segunda, l.segunda, interesse, true],
    ['gerarDemo', 'Gerar o demo', l.gerarDemo, interesse, false],
    ['followup', rotuloDoFollowup(props.lead), l.followup, true, true],
    // A conversa é outra intenção (ler, não mandar texto pronto): fica no apoio, ou vira o primário sem outro.
    ['whatsapp', 'Ler a conversa no WhatsApp', l.whatsapp, false, false],
    ['site', convite ? 'Site da empresa' : 'Demo', l.site, false, false],
    ['raioX', 'Raio-X', l.raioX, false, false],
    ['maps', 'Google Maps', l.maps, false, false],
    ['planilha', convite ? 'Mudar a etapa na planilha' : 'Linha na planilha', l.planilha, false, false],
    ['acoes', 'Recusou, fechou ou desfazer', l.acoes, false, false],
  ]
  return todas.flatMap(([chave, rotulo, href, principal, anota]) => (href ? [{ chave, rotulo, href, principal, anota }] : []))
    // Primeiro contato fora do expediente (envio, convite, reenvio do só-robô): some até o "Liberar".
    // Com a trava de ritmo segurando, some também, e sem "Liberar" (o aviso diz até quando).
    .filter((a) => !((travado.value || segurado.value) && ehPrimeiroContato(props.lead, a.href)))
})
const temPrimeiroContato = computed(() => linksDePrimeiroContato(props.lead).length > 0)
const segurado = computed(() => props.ritmo.motivo !== null && temPrimeiroContato.value)
const travado = computed(() => !segurado.value && envioTravado(props.aviso, props.liberados, props.lead.id) && temPrimeiroContato.value)

// Um primário só: a primeira ação do passo; sem nenhuma, com o lead aberto, a conversa no WhatsApp.
// As outras do passo (o "Gerar o demo" ao lado da 2ª mensagem) ficam ao lado, como secundárias.
const doPasso = computed(() => acoes.value.filter((a) => a.principal))
const primaria = computed<AcaoDaFicha | undefined>(() => {
  if (doPasso.value[0]) return doPasso.value[0]
  const conversa = aberto.value ? acoes.value.find((a) => a.chave === 'whatsapp') : undefined
  return conversa && { ...conversa, rotulo: 'Abrir a conversa no WhatsApp' }
})
const propostaAoLado = computed<AcaoDaFicha | undefined>(() =>
  !gostou.value && proposta.value ? { chave: 'proposta', rotulo: 'Mandar a proposta', href: proposta.value.url, principal: false, anota: true } : undefined)
const secundarias = computed(() => [...doPasso.value.slice(1), ...(propostaAoLado.value ? [propostaAoLado.value] : [])])
const apoio = computed(() => acoes.value.filter((a) => !a.principal && a.chave !== primaria.value?.chave))
const comProposta = computed(() => primaria.value?.chave === 'proposta' || secundarias.value.some((a) => a.chave === 'proposta'))
const dicaDaAcao = computed(() => [
  doPasso.value.some((a) => a.anota && a.chave !== 'proposta') ? 'Tocar já anota o envio.' : '',
  comProposta.value ? 'Mandar a proposta abre o WhatsApp com ela e já a marca enviada hoje no CRM.' : '',
  props.lead.reenvioDoRobo && doPasso.value.some((a) => a.chave === 'followup') ? 'Reenvio único, pedindo o responsável.' : '',
  doPasso.value.some((a) => a.chave === 'gerarDemo') ? 'O demo sai em 20 a 40 min; o aviso chega no WhatsApp.' : '',
].filter(Boolean).join(' '))

/** Os links que anotam o envio ao serem tocados. */
const TIPO_DA_ACAO: Record<string, TipoDeEnvioAnotado> = { segunda: 'segunda_enviada', followup: 'followup_enviado' }
function aoTocar(chave: string, href: string) {
  // O toque abre o WhatsApp (o <a> segue normal) e anota a proposta com a data de hoje: o envio e a marca
  // eram dois gestos, e só o primeiro acontecia. A planilha confirma no próximo retrato (RULES 11).
  if (chave === 'proposta') { void registrar('proposta', '', hoje, 'Proposta anotada com a data de hoje.', 'acao'); return }
  // Plus (15/10/2026): o link de envio não passa pelo n8n, então o toque é que anota a primeira mensagem.
  const tipo = chave === 'enviar' && props.lead.produto === 'plus' ? 'plus_enviado' : TIPO_DA_ACAO[chave]
  if (tipo) emit('anotar', props.lead.id, tipo)
  if (ehPrimeiroContato(props.lead, href)) emit('primeiro', props.lead.id)
}
/** "2ª mensagem anotada às 14:02 · Follow-up anotado às 14:05", enquanto a planilha não confirma. */
const anotacoes = computed(() => (['segunda_enviada', 'followup_enviado', 'plus_enviado'] as const).flatMap((tipo) => {
  const t = anotadoEm(props.anotados, props.lead.id, tipo)
  return t === undefined ? [] : [textoDaAnotacao(tipo, hora(new Date(t).toISOString()))]
}).join(' · '))

// O prazo dos 7 dias só como aviso quando o próximo passo já não o diz ("vai para Perdido em…").
const avisoDoPrazo = computed(() => {
  const d = props.lead.diasParaSair
  if (d === undefined || props.lead.etapa !== 'contato' || /Perdido/.test(proximo.value.quando ?? '')) return ''
  return `Vai para Perdido ${d <= 1 ? 'amanhã' : `em ${d} dias`} se ele não escrever. Salvar um próximo passo segura o lead.`
})
const temAvisos = computed(() => travado.value || segurado.value || Boolean(props.lead.plus?.fixo) || Boolean(avisoDoPrazo.value)
  || saiuPeloPrazo.value || props.lead.divergencias.length > 0 || Boolean(props.lead.demoPedidoEm) || Boolean(props.lead.demoApagadoEm) || !disponivel.value)

// ------------------------------------------------------------ editar o próximo passo ali mesmo

// O foco vai ao campo ao abrir e volta ao "Mudar" ao fechar: quem usa teclado não se perde na ficha.
const editando = ref(false)
const campoProximo = ref<HTMLInputElement | null>(null)
const botaoMudar = ref<HTMLButtonElement | null>(null)
async function editarProximo() {
  proximoTexto.value = props.lead.proximoPasso?.texto ?? ''
  proximoData.value = props.lead.proximoPasso?.data ?? ''
  editando.value = true
  await nextTick()
  campoProximo.value?.focus()
}
async function fecharEdicao() {
  editando.value = false
  await nextTick()
  botaoMudar.value?.focus()
}

// ------------------------------------------------------------ o que oferecer e como responder

const oferta = computed(() => ofertaDoLead(props.lead))
const outrasOfertas = computed(() => [
  { id: 'depois', titulo: 'Depois', itens: oferta.value.depois },
  { id: 'nao', titulo: 'Não oferecer', itens: oferta.value.naoAgora },
].filter((g) => g.itens.length))
const contagemDasOutras = computed(() => outrasOfertas.value.reduce((n, g) => n + g.itens.length, 0))
// A colinha do momento deste lead (colinha.ts): sai da etapa e da última resposta,
// com os textos já preenchidos com o nome, o artigo e o link do demo dele.
const colinha = computed(() => colinhaDoLead(props.lead))

// "Como vender": abre no copiloto quando ele serve (do "respondeu" à proposta), no roteiro quando o
// passo é escrever à mão, e na oferta no resto.
type AbaDeVenda = 'oferta' | 'roteiro' | 'copiloto'
const ABAS_DE_VENDA = computed<Array<{ id: AbaDeVenda; rotulo: string }>>(() => [
  { id: 'oferta', rotulo: 'O que oferecer' },
  { id: 'roteiro', rotulo: 'O que dizer' },
  ...(comCopiloto.value && copilotoServe(props.lead) ? [{ id: 'copiloto' as const, rotulo: 'Copiloto' }] : []),
])
const abaInicial = (): AbaDeVenda =>
  comCopiloto.value && copilotoServe(props.lead) ? 'copiloto' : aberto.value && !doPasso.value.some((a) => a.anota) ? 'roteiro' : 'oferta'
const abaDeVenda = ref<AbaDeVenda>(abaInicial())
watch(comCopiloto, () => { abaDeVenda.value = abaInicial() })

// A mensagem do primário (o texto do wa.me, ou a primeira mensagem do Balcão no link do n8n).
const rascunho = computed(() => {
  const p = primaria.value
  if (!p) return ''
  return textoDoLink(p.href) ?? (p.chave === 'enviar' ? props.lead.mensagemPronta ?? '' : '')
})

// ------------------------------------------------------------ a conversa (o observador, 16/10/2026)

const conversaTodas = ref<Array<{ em: string; direcao: 'entrada' | 'saida'; texto: string }>>([])
const conversaGuardada = ref<boolean | null>(null)
const conversaErro = ref('')
const conversaInteira = ref(false)
const MAX_NA_FICHA = 12
const conversa = computed(() => (conversaInteira.value ? conversaTodas.value : conversaTodas.value.slice(-MAX_NA_FICHA)))
const conversaCortada = computed(() => conversa.value.length < conversaTodas.value.length)
async function lerConversa() {
  conversaTodas.value = []
  conversaGuardada.value = null
  conversaErro.value = ''
  conversaInteira.value = false
  try {
    const r = await fetch(`/api/operations/crm/conversa?id=${encodeURIComponent(props.lead.chave)}`, { cache: 'no-store' })
    const corpo = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(corpo.error ?? `HTTP ${r.status}`)
    conversaGuardada.value = Boolean(corpo.guardada)
    conversaTodas.value = Array.isArray(corpo.mensagens) ? corpo.mensagens : []
  } catch (e) {
    conversaErro.value = `Não consegui ler a conversa: ${e instanceof Error ? e.message : String(e)}`
  }
}

// Ctrl/Cmd/Shift/meio abrem a página numa aba nova, como os links da casca (casca/rota.ts).
function verColinha(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  emit('colinha')
}

onMounted(async () => {
  void lerConversa()
  await nextTick()
  titulo.value?.focus()
})
watch(() => props.lead.id, () => {
  void lerConversa()
  abaDeVenda.value = abaInicial()
  nota.value = ''
  proximoTexto.value = ''
  proximoData.value = ''
  mensagem.value = ''
  erro.value = ''
  editando.value = false
})

// ------------------------------------------------------------ gravar na planilha

async function registrar(tipo: CrmTipoDeRegistro, texto: string, data: string, feito: string, de: 'proximo' | 'anotar' | 'acao' = 'anotar') {
  salvando.value = tipo
  origem.value = de
  mensagem.value = ''
  erro.value = ''
  try {
    const resposta = await fetch('/api/operations/crm/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produto: props.lead.produto, id: props.lead.chave, tipo, texto, data }),
    })
    const corpo = await resposta.json().catch(() => ({}))
    if (!resposta.ok) throw new Error(corpo.error ?? `HTTP ${resposta.status}`)
    mensagem.value = `${feito} Gravado na planilha às ${dataHora(corpo.em).slice(-5)}; aparece aqui em alguns segundos.`
    emit('registrado')
    return true
  } catch (motivo) {
    erro.value = `Não foi gravado: ${motivo instanceof Error ? motivo.message : String(motivo)}`
    return false
  } finally {
    salvando.value = null
  }
}

const salvarNota = async () => {
  if (!nota.value.trim()) { origem.value = 'anotar'; erro.value = 'Escreva a nota antes de salvar.'; return }
  if (await registrar('nota', nota.value, '', 'Nota salva.')) nota.value = ''
}
const salvarProximo = async () => {
  if (!proximoTexto.value.trim() || !proximoData.value) { origem.value = 'proximo'; erro.value = 'Diga o que fazer e quando.'; return }
  if (await registrar('proximo_passo', proximoTexto.value, proximoData.value, 'Próximo passo salvo.', 'proximo')) {
    proximoTexto.value = ''
    proximoData.value = ''
    fecharEdicao()
  }
}
const limparProximo = async () => {
  if (await registrar('proximo_passo', '', '', 'Próximo passo apagado.', 'proximo')) fecharEdicao()
}
const marcarProposta = () => registrar('proposta', '', propostaData.value || hoje, 'Proposta marcada.')
const desfazerProposta = () => registrar('proposta_desfeita', '', '', 'Proposta desfeita.')
const marcarSemContato = () => registrar('sem_contato', '', '', 'Lead marcado como perdido.')
const desfazerSemContato = () => registrar('sem_contato_desfeito', '', '', 'Perda desfeita.')
// Plus: a planilha não conhece o lead, então o envio feito por fora e a resposta se anotam aqui.
const ehPlus = computed(() => props.lead.produto === 'plus')
const plusEmConversa = computed(() => props.lead.sinal === 'respondeu-prumo')
// Um formulário por vez. O próximo passo saiu daqui (16/10/2026): edita-se em "Agora", onde ele aparece.
type Formulario = 'nota' | 'proposta'
const FORMULARIOS: Array<{ id: Formulario; rotulo: string }> = [
  { id: 'nota', rotulo: 'Nota' },
  { id: 'proposta', rotulo: 'Proposta' },
]
const formularioInicial = (): Formulario => (props.lead.etapa === 'proposta' ? 'proposta' : 'nota')
const formulario = ref<Formulario>(formularioInicial())
watch(() => props.lead.id, () => { formulario.value = formularioInicial() })
const marcarEnviadoPlus = () => registrar('plus_enviado', '', '', 'Envio anotado.')
const marcarRespondeuPlus = () => registrar('plus_respondeu', '', '', 'Resposta anotada.')
</script>

<template>
  <article class="crm-ficha" aria-labelledby="crm-ficha-titulo">
    <!-- Quem é e onde está (a etapa e o passo da jornada), sem caixa: a folha já é o contorno. -->
    <header class="crm-ficha__cabeca">
      <span class="crm-kicker">{{ ROTULO_DO_PRODUTO[lead.produto] }} · {{ onde(lead) }}</span>
      <h2 id="crm-ficha-titulo" ref="titulo" tabindex="-1">{{ lead.empresa }}</h2>
      <p class="crm-ficha__etapa">
        <span class="crm-etapa" :class="`is-${lead.etapa}`">{{ ROTULO_DA_ETAPA[lead.etapa] }}</span>
        <span>{{ lead.subEtapa }} · {{ diasNaEtapa(lead) }}<template v-if="lead.leitura === 'viu'"> · leu</template><template v-else-if="lead.leitura === 'pela-resposta'"> · leu e respondeu</template></span>
      </p>
    </header>

    <section class="crm-ficha__agora" aria-labelledby="crm-ficha-agora">
      <h3 id="crm-ficha-agora" class="crm-ficha__rotulo">Agora, {{ QUEM[proximo.quem] }}</h3>
      <template v-if="!editando">
        <p class="crm-ficha__acao">{{ proximo.acao }}</p>
        <p class="crm-ficha__prazo">
          <template v-if="prazo.texto">{{ prazo.texto }}</template>
          <span v-if="prazo.atrasado" class="selo selo--erro">atrasado</span>
          <button v-if="aberto" ref="botaoMudar" class="botao botao--leve" type="button" @click="editarProximo">Mudar<span class="so-leitor"> o próximo passo</span></button>
        </p>
      </template>
      <form v-else class="crm-form" @submit.prevent="salvarProximo">
        <label><span>O que fazer</span><input ref="campoProximo" v-model="proximoTexto" type="text" maxlength="200" :disabled="!disponivel" placeholder="Ex.: ligar para combinar a conversa"></label>
        <label><span>Quando</span><input v-model="proximoData" type="date" :min="hoje" :disabled="!disponivel"></label>
        <div class="crm-form__botoes">
          <button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'proximo_passo' ? 'Salvando…' : 'Salvar' }}</button>
          <button v-if="lead.proximoPasso" class="botao botao--leve" type="button" :disabled="!disponivel || salvando !== null" @click="limparProximo">Apagar o salvo</button>
          <button class="botao botao--leve" type="button" @click="fecharEdicao">Cancelar</button>
        </div>
      </form>
      <template v-if="origem === 'proximo'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
      </template>
    </section>

    <!-- Preso ao topo da folha enquanto se rola: é a ação de hoje. Filho direto da ficha, porque o
         sticky só anda dentro do pai: dentro da seção "Agora", soltaria assim que ela saísse da tela. -->
    <!-- A mensagem que o botão vai abrir, à vista antes do toque (16/10/2026): revisar sem adivinhar. -->
    <figure v-if="rascunho" class="crm-ficha__rascunho">
      <figcaption class="crm-muted">Mensagem que vai sair (revise; dá para mudar no WhatsApp antes de enviar)<template v-if="primaria?.chave === 'proposta' && proposta">. {{ proposta.origem === 'copiloto' ? 'Itens do copiloto, preços do cardápio.' : 'Texto base da colinha.' }}</template></figcaption>
      <blockquote>{{ rascunho }}</blockquote>
      <p v-if="primaria?.chave === 'proposta' && proposta?.completar" class="crm-ficha__completar">Complete o que está entre colchetes antes de enviar.</p>
    </figure>
    <!-- Proposta ao lado (sem o "gostei" registrado): o texto também à vista antes do toque, dobrado. -->
    <details v-if="propostaAoLado && proposta" class="dobra crm-ficha__rascunho">
      <summary>Proposta que vai sair <span class="crm-muted">({{ proposta.origem === 'copiloto' ? 'itens do copiloto, preços do cardápio' : 'texto base da colinha' }})</span></summary>
      <blockquote>{{ proposta.texto }}</blockquote>
      <p v-if="proposta.completar" class="crm-ficha__completar">Complete o que está entre colchetes antes de enviar.</p>
    </details>

    <div v-if="primaria" class="crm-ficha__fixa" role="group" aria-label="Ação de agora">
      <a class="botao botao--primario" :href="primaria.href" target="_blank" rel="noopener" @click="aoTocar(primaria.chave, primaria.href)">{{ primaria.rotulo }} <span aria-hidden="true">↗</span></a>
      <a v-for="a in secundarias" :key="a.chave" class="botao" :href="a.href" target="_blank" rel="noopener" @click="aoTocar(a.chave, a.href)">{{ a.rotulo }} <span aria-hidden="true">↗</span></a>
    </div>

    <div class="crm-ficha__status">
      <p v-if="dicaDaAcao" class="crm-muted">{{ dicaDaAcao }}</p>
      <template v-if="origem === 'acao'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}. Marque à mão em Anotar, Proposta.</p>
      </template>

      <!-- Os avisos num lugar só, um por linha, com a palavra antes da cor. -->
      <ul v-if="temAvisos" class="crm-ficha__avisos">
        <li v-if="travado" class="is-atencao">
          {{ aviso }}
          <button type="button" class="botao botao--leve" @click="emit('liberar', lead.id)">{{ ROTULO_DE_LIBERAR }}</button>
        </li>
        <li v-if="segurado" class="is-atencao" role="status">{{ textoDoRitmo(ritmo) }}</li>
        <li v-if="lead.plus?.fixo" class="is-atencao">Telefone fixo: confira se tem WhatsApp antes de enviar.</li>
        <li v-if="avisoDoPrazo">{{ avisoDoPrazo }}</li>
        <li v-else-if="saiuPeloPrazo">
          Saiu depois de {{ DIAS_SEM_RESPOSTA }} dias sem mensagem dele. Volta sozinho se ele escrever; para trazer agora, salve um próximo passo ou marque a proposta.
        </li>
        <li v-if="lead.divergencias.length" class="is-erro" role="note">
          Planilha e pasta não batem: {{ lead.divergencias.map((d) => d.replace(/\.$/, '')).join('; ') }}. Vale a planilha; confira as duas.
        </li>
        <li v-if="lead.demoPedidoEm" role="note">
          Demo pedido {{ quandoFoi(lead.demoPedidoEm) }}. Quando ficar pronto, o aviso chega no WhatsApp e "Mandar o demo" aparece aqui.
        </li>
        <li v-if="lead.demoApagadoEm" class="is-atencao" role="note">
          Demo apagado da Vercel {{ quandoFoi(lead.demoApagadoEm) }}, porque o lead foi para Perdido: o link antigo não abre. Para mandar de novo,
          publique a pasta{{ lead.pasta ? ` ${lead.pasta.slug}` : '' }} outra vez com <code>vercel link</code> e <code>vercel deploy</code>.
        </li>
        <li v-if="!disponivel" class="is-atencao">Nada grava na planilha agora: {{ visao.registro.motivo }}</li>
      </ul>
      <p class="crm-muted crm-ficha__anuncio" role="status" aria-live="polite">{{ anotacoes ? `${anotacoes}. A planilha confirma em alguns minutos.` : '' }}</p>
      <p v-if="falhaDaAnotacao" class="crm-erro" role="alert">{{ falhaDaAnotacao }}</p>

      <details v-if="apoio.length" class="dobra">
        <summary>Abrir em outro lugar <span class="crm-muted">({{ apoio.length }})</span></summary>
        <ul class="crm-ficha__apoio">
          <li v-for="a in apoio" :key="a.chave"><a :href="a.href" target="_blank" rel="noopener" @click="aoTocar(a.chave, a.href)">{{ a.rotulo }} <span aria-hidden="true">↗</span></a></li>
        </ul>
      </details>
    </div>

    <!-- A conversa de verdade (16/10/2026), como o observador guardou; sem ela, a última resposta classificada. -->
    <section v-if="lead.resposta || conversa.length" class="crm-ficha__secao" aria-labelledby="crm-ficha-conversa">
      <h3 id="crm-ficha-conversa">Conversa</h3>
      <p v-if="lead.resposta" class="crm-resposta" :class="`is-${lead.resposta.tipo}`">
        <strong>{{ ROTULO_DA_RESPOSTA[lead.resposta.tipo] }}</strong>{{ lead.resposta.em ? ` ${quandoFoi(lead.resposta.em)}` : '' }}
      </p>
      <ol v-if="conversa.length" class="crm-conversa" aria-label="Mensagens, da mais antiga para a mais nova">
        <li v-if="conversaCortada" class="crm-muted"><button type="button" class="crm-mais" @click="conversaInteira = true">Ver as {{ conversaTodas.length - conversa.length }} mensagens anteriores</button></li>
        <li v-for="(m, i) in conversa" :key="`${m.em}-${i}`" :class="`is-${m.direcao}`">
          <span class="so-leitor">{{ m.direcao === 'entrada' ? `${lead.empresa} escreveu` : 'Você escreveu' }}</span>
          <p>{{ m.texto || (m.direcao === 'saida' ? '(mensagem enviada, sem o texto)' : '(sem texto: áudio, foto ou figurinha)') }}</p>
          <time :datetime="m.em" class="crm-muted">{{ quandoFoi(m.em) }}</time>
        </li>
      </ol>
      <template v-else>
        <blockquote v-if="lead.resposta?.trecho" class="crm-resposta__trecho">{{ lead.resposta.trecho }}</blockquote>
        <p v-else-if="lead.resposta" class="crm-muted">Só resposta automática. Ninguém escreveu ainda.</p>
        <p class="crm-muted">{{ conversaGuardada === false ? 'A conversa inteira aparece aqui a partir das próximas mensagens: o observador passou a guardar em 16/10/2026.' : conversaErro || '' }}</p>
      </template>
    </section>

    <!-- Como vender (16/10/2026): oferta, roteiro e copiloto eram três blocos seguidos; viraram
         uma seção com três abas, abrindo na que o momento pede. -->
    <section class="crm-ficha__secao" aria-labelledby="crm-ficha-vender">
      <h3 id="crm-ficha-vender">Como vender</h3>
      <div class="segmentado" role="group" aria-label="Como vender este lead">
        <button v-for="a in ABAS_DE_VENDA" :key="a.id" type="button" :aria-pressed="abaDeVenda === a.id" @click="abaDeVenda = a.id">{{ a.rotulo }}</button>
      </div>

    <template v-if="abaDeVenda === 'oferta'">
      <p v-if="!oferta.agora.length && !oferta.aConfirmar.length && !outrasOfertas.length" class="crm-muted">Sem oferta calculada para este lead.</p>
      <ul v-if="oferta.agora.length" class="crm-ficha__ofertas">
        <li v-for="o in oferta.agora" :key="o.id"><strong>{{ nomeDaOferta(o.id) }}</strong><span>{{ o.porque }}</span></li>
      </ul>
      <template v-if="oferta.aConfirmar.length">
        <p class="crm-ficha__rotulo">Antes, confirme</p>
        <ul class="crm-ficha__conferir"><li v-for="t in oferta.aConfirmar" :key="t">{{ t }}</li></ul>
      </template>
      <details v-if="outrasOfertas.length" class="dobra">
        <summary>Depois e não oferecer <span class="crm-muted">({{ contagemDasOutras }})</span></summary>
        <template v-for="g in outrasOfertas" :key="g.id">
          <h4 class="crm-ficha__rotulo">{{ g.titulo }}</h4>
          <ul class="crm-ficha__ofertas is-depois">
            <li v-for="o in g.itens" :key="o.id"><strong>{{ nomeDaOferta(o.id) }}</strong><span>{{ o.porque }}</span></li>
          </ul>
        </template>
      </details>
    </template>

    <template v-else-if="abaDeVenda === 'roteiro'">
      <p v-if="colinha.momentos[0]" class="crm-ficha__rotulo">{{ colinha.momentos[0].titulo }}</p>
      <p v-if="colinha.motivo" class="crm-colinha__motivo">{{ colinha.motivo }}</p>
      <CrmObjecao v-for="o in colinha.objecoes" :key="o.id" :objecao="o" :lead="lead" :nivel="4" />
      <CrmMomento v-for="m in colinha.momentos" :key="m.momento" :passo="m" :lead="lead" :nivel="4" />
      <a class="crm-colinha__inteira" href="/crm?ver=colinha" @click="verColinha">Ver o roteiro inteiro <span aria-hidden="true">→</span></a>
    </template>

    <!-- Do "respondeu" à proposta, com o copiloto ligado. -->
    <CrmCopiloto v-else-if="abaDeVenda === 'copiloto'" :lead="lead" @sugestao="aoTerSugestao" />
    </section>

    <section class="crm-ficha__secao" aria-labelledby="crm-ficha-anotar">
      <h3 id="crm-ficha-anotar">Anotar</h3>
      <div v-if="ehPlus && (lead.sinal === 'pronto' || lead.etapa === 'contato')" class="crm-form__botoes">
        <button v-if="lead.sinal === 'pronto'" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarEnviadoPlus">{{ salvando === 'plus_enviado' ? 'Anotando…' : 'Já enviei por fora' }}</button>
        <button v-if="lead.etapa === 'contato'" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarRespondeuPlus">{{ salvando === 'plus_respondeu' ? 'Anotando…' : plusEmConversa ? 'Respondeu de novo' : 'Respondeu no WhatsApp' }}</button>
      </div>
      <div class="segmentado" role="group" aria-label="O que anotar">
        <button v-for="f in FORMULARIOS" :key="f.id" type="button" :aria-pressed="formulario === f.id" @click="formulario = f.id">{{ f.rotulo }}</button>
      </div>

      <form v-if="formulario === 'nota'" class="crm-form" @submit.prevent="salvarNota">
        <label><span>Nova nota<small v-if="lead.notas"> · {{ lead.notas }} salva{{ lead.notas === 1 ? '' : 's' }} até agora</small></span><textarea v-model="nota" rows="3" maxlength="1000" :disabled="!disponivel" placeholder="O que ele disse, o que ficou combinado…" /></label>
        <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'nota' ? 'Salvando…' : 'Salvar a nota' }}</button></div>
      </form>

      <template v-else>
        <div v-if="lead.etapa === 'proposta'" class="crm-form">
          <p>Proposta enviada {{ diaDaSemana(lead.proposta?.data) || quandoFoi(lead.proposta?.em) }}.</p>
          <div class="crm-form__botoes"><button class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="desfazerProposta">{{ salvando === 'proposta_desfeita' ? 'Desfazendo…' : 'Desfazer a proposta' }}</button></div>
        </div>
        <form v-else-if="aberto || saiuPeloPrazo" class="crm-form" @submit.prevent="marcarProposta">
          <label><span>Enviada em</span><input v-model="propostaData" type="date" :max="hoje" :disabled="!disponivel"></label>
          <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'proposta' ? 'Marcando…' : 'Marcar a proposta enviada' }}</button></div>
        </form>
        <p v-else class="crm-muted">Lead encerrado como {{ ROTULO_DA_ETAPA[lead.etapa] }}. Para reabrir, use Desfazer na página do lead.</p>
      </template>

      <button v-if="aberto" class="botao botao--leve crm-ficha__perder" type="button" :disabled="!disponivel || salvando !== null" @click="marcarSemContato">{{ salvando === 'sem_contato' ? 'Marcando…' : 'Sem contato fácil: marcar como perdido' }}</button>
      <button v-else-if="lead.motivoPerda === 'sem-contato'" class="botao botao--leve crm-ficha__perder" type="button" :disabled="!disponivel || salvando !== null" @click="desfazerSemContato">{{ salvando === 'sem_contato_desfeito' ? 'Desfazendo…' : 'Desfazer a perda por falta de contato' }}</button>

      <template v-if="origem === 'anotar'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
      </template>
    </section>

    <!-- Consulta: de onde veio e o que já aconteceu. Fechado, com a contagem à vista. -->
    <div class="crm-ficha__secao crm-ficha__consulta">
      <!-- A jornada saiu do topo (16/10/2026): o "Agora" já diz o passo; aqui fica o mapa inteiro. -->
      <CrmJornada :lead="lead" />
      <details class="dobra">
        <summary>Sobre o lead</summary>
        <!-- Triagem do caçador (Iris, estamparias): por que entrou e de onde veio o WhatsApp. -->
        <p v-if="lead.triagem">
          <template v-if="lead.triagem.prioridade !== undefined">Prioridade {{ lead.triagem.prioridade }}. </template>
          <template v-if="lead.triagem.nota">Nota no Google {{ lead.triagem.nota }}. </template>
          <template v-if="lead.triagem.sinais">Sinais: {{ lead.triagem.sinais }}. </template>
          <template v-if="lead.triagem.origemWhatsapp">WhatsApp: {{ lead.triagem.origemWhatsapp }}.</template>
        </p>
        <p v-if="!lead.plus">
          Na planilha: <strong>{{ lead.estadoNaPlanilha }}</strong>
          <template v-if="lead.pasta"> · pasta {{ lead.pasta.lugar }}</template>
          <template v-if="lead.diasDesdeUltimoEvento !== undefined"> · último evento {{ lead.diasDesdeUltimoEvento === 0 ? 'hoje' : `há ${lead.diasDesdeUltimoEvento} dia${lead.diasDesdeUltimoEvento === 1 ? '' : 's'}` }}</template>
        </p>
        <p v-if="textoDaAbordagem(lead)">Recebeu: {{ textoDaAbordagem(lead) }}</p>
        <!-- Plus: veio do Catálogo de Negócios Maçônicos e abre com a saudação da Ordem. -->
        <p v-if="lead.plus">
          Plus, com a oferta <strong>{{ ROTULO_DA_OFERTA_DO_PLUS[lead.plus.oferta] }}</strong>. {{ lead.plus.descricao }}
          <template v-if="lead.plus.instagram"> Instagram: <a :href="`https://instagram.com/${lead.plus.instagram}`" target="_blank" rel="noopener">@{{ lead.plus.instagram }}</a>.</template>
          <template v-if="lead.plus.tambem?.length"> Mesmo WhatsApp: {{ lead.plus.tambem.join(', ') }}.</template>
        </p>
        <p v-if="lead.mensagemPronta">Primeira mensagem: “{{ lead.mensagemPronta }}”</p>
        <p v-if="lead.leitura === 'desconhecida'">Leitura sem confirmação: pode ter lido, porque o WhatsApp dele pode não mandar recibo.</p>
      </details>

      <details class="dobra">
        <summary>Linha do tempo <span class="crm-muted">({{ eventos.length }})</span></summary>
        <ol v-if="eventos.length" class="crm-tempo">
          <li v-for="(evento, i) in eventos" :key="`${evento.tipo}-${evento.em}-${i}`" :class="`is-${evento.origem === 'manual' ? 'manual' : 'auto'}`">
            <time :datetime="evento.em">{{ dataHora(evento.em) }}</time>
            <div>
              <strong>{{ evento.rotulo }}</strong>
              <p v-if="evento.texto">{{ evento.texto }}</p>
              <small>{{ evento.origem === 'manual' ? 'Manual' : 'Automático' }} · {{ evento.fonte }}<template v-if="evento.estimado"> · data estimada</template></small>
            </div>
          </li>
        </ol>
        <p v-else class="crm-muted">Nenhum evento com data na planilha.</p>
      </details>

      <details v-if="lead.pasta?.artefatos" class="dobra" :open="Boolean(lead.pasta.falha)">
        <summary>Na fila do gerador<template v-if="lead.pasta.falha"> <span class="selo selo--erro">falhou</span></template></summary>
        <ul class="crm-artefatos">
          <li>{{ lead.pasta.artefatos.conteudo ? '✓ content.md' : '× sem content.md' }}</li>
          <li>{{ lead.pasta.artefatos.fotos ? `✓ ${lead.pasta.artefatos.fotos} foto${lead.pasta.artefatos.fotos === 1 ? '' : 's'}` : '× sem fotos' }}</li>
          <li>{{ lead.pasta.artefatos.capa ? '✓ capa' : '× sem capa' }}</li>
          <li>{{ lead.pasta.artefatos.gerado ? '✓ index.html' : '× site ainda não gerado' }}</li>
          <li v-if="lead.pasta.falha">! falha.log: {{ lead.pasta.falha }}</li>
        </ul>
        <small class="crm-muted">Pasta ~/auto-site/{{ lead.pasta.lugar === 'raiz' ? '' : lead.pasta.lugar }}{{ lead.pasta.slug }}/. A Central só lê: não confirma publicação.</small>
      </details>
    </div>
  </article>
</template>
