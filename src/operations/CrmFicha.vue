<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CrmJornada from './CrmJornada.vue'
import { copilotoServe, type SugestaoDoCopiloto } from './copiloto'
import { cabeProposta, gostouDepoisDoLink, propostaDeUmToque } from './mandar-proposta'
import { copilotoLigado } from './copiloto-ligado'
import CrmMomento from './CrmMomento.vue'
import CrmObjecao from './CrmObjecao.vue'
import { colinhaDoLead } from './colinha'
import { nomeDaOferta, ofertaDoLead, proximoDaJornada } from './jornada'
import { anotadoEm, textoDaAnotacao, type EnviosAnotados, type TipoDeEnvioAnotado } from './anotacao-de-envio'
import { DIAS_SEM_RESPOSTA, ROTULO_DA_ETAPA, ROTULO_DA_OFERTA_DO_PLUS, ROTULO_DA_RESPOSTA, ROTULO_DO_PRODUTO, dataHora, diasNaEtapa, ehConvite, hojeEmSP, hora, onde, rotuloDoFollowup, textoDaAbordagem, textoDaSubEtapa, textoDoEvento } from './crm-formato'
import { ROTULO_DE_LIBERAR, ehPrimeiroContato, envioTravado, linksDePrimeiroContato, type EnviosLiberados } from './trava-de-horario'
import { textoDoRitmo, type EstadoDoRitmo } from './trava-de-ritmo'
import type { CrmLead, CrmTipoDeRegistro, CrmVisao } from './types'
import { raioXAvulso } from '../../server/site-mensagem.ts'
import { agoraDaFicha, anotacoesAMao, desfechosDoLead, textoDoLink, type RegistroDeDesfecho, type SugestaoDeVenda } from './proxima-venda'
import { acaoDaFicha, primeiroContatoDaFicha } from './primeiro-da-ficha'
import { useAssistente } from '../casca/assistente'

// Ficha de um lead. As únicas escritas da Central são as deste arquivo (nota, próximo passo e o
// desfecho: ganhou, perdeu, proposta, com o desfazer de cada um; no Plus o envio e a resposta) e
// todas vão para a aba CRM da planilha pelo n8n (POST /api/operations/crm/registro); o toque na 2ª
// mensagem e no follow-up, e os botões de anotar à mão deles, anotam o envio por essa rota, pelo
// CrmPanel (14/10/2026). Desde 17/10/2026 (AC-08) o desfecho é da faixa "Desfecho": a página do lead
// do n8n (fluxo 07) virou só um lugar a mais para abrir; a Etapa do PRUMO muda na planilha.
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente, enviar a primeira mensagem, o
// convite e o reenvio do só-robô esperam o "Liberar" deste lead, como na Hoje e no Funil. Desde
// 17/10/2026 (AC-21) é o "Liberar" do dia, guardado no servidor (liberados.ts): o mesmo da Próxima venda.
// `anotados`/`falhaDaAnotacao` (anotacao-de-envio.ts): o toque na 2ª mensagem ou no follow-up anota
// o envio pelo CrmPanel, em segundo plano; a ficha mostra a marca ou o pedido de anotar à mão.
//
// O desenho (16/10/2026, segunda volta): em 5 segundos, quem é, onde está, o que fazer agora e
// um botão primário para isso. Por isso a seção "Agora" junta a frase da ação, o próximo passo
// salvo (que se edita ali mesmo), a ação e os avisos; o resto é seção separada por título e linha,
// nunca caixa dentro de caixa, e o que é consulta fica dobrado.
// A ordem de decisão (17/10/2026, AC-14): cabeça e etapa › Agora e o primário › Desfecho › Conversa ›
// Como vender (abre em "O que oferecer"; o "Perguntar sobre este lead" abre o Assistente) › Anotar ›
// consulta (jornada, sobre o lead, linha do tempo).
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
// `colinha`: o CrmPanel leva ao Roteiro, em /mais?abrir=roteiro (AC-20), sem recarregar.
const emit = defineEmits<{
  registrado: []; colinha: []; liberar: [leadId: string]; anotar: [leadId: string, tipo: TipoDeEnvioAnotado]; primeiro: [leadId: string]
}>()

const titulo = ref<HTMLHeadingElement | null>(null)
// Copiloto: a Ficha só LÊ a sugestão guardada (para a proposta e o "Agora"). A aba Copiloto saiu em
// 17/10/2026 (fase 2 da RULES 28): a sugestão mora no painel do Assistente, num cartão com o preço do
// cardápio, e o automático segue alimentando a Próxima venda e o Telegram.
const comCopiloto = ref(false)
copilotoLigado().then((ligado) => { comCopiloto.value = ligado })
// O Assistente (RULES 28), quando existe nesta Central. No celular o ＋ da barra fica inerte com a
// folha da Ficha aberta: este botão abre o painel por cima dela, com o lead do endereço como contexto.
const assistente = useAssistente()
const perguntarSobreOLead = () => assistente.abrir()
const nota = ref('')
const proximoTexto = ref('')
const proximoData = ref('')
const propostaData = ref(hojeEmSP())
// Os registros de desfecho (AC-08) já estão em CrmTipoDeRegistro; o par fica explícito para quem lê.
type TipoDaFicha = CrmTipoDeRegistro | RegistroDeDesfecho
const salvando = ref<TipoDaFicha | null>(null)
const mensagem = ref('')
const erro = ref('')
// De onde saiu o último registro: a confirmação aparece perto do botão tocado, não no outro canto da ficha.
const origem = ref<'proximo' | 'anotar' | 'acao' | 'desfecho'>('anotar')

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

// ------------------------------------------------------------ o que fazer agora

// Um "próximo passo" só (eram três: a faixa fixa, a Jornada e o "Próximo passo salvo" em Anotar).
// A jornada daqui só serve ao prazo dos 7 dias; a frase do "Agora" é a da fila (agoraDaFicha).
const proximo = computed(() => proximoDaJornada(props.lead))
// O prazo é só o do próximo passo salvo à mão: o "proposta em até 24 h" da jornada era uma redação a
// mais do mesmo passo (AC-12), e a tática da fila já diz o tempo quando ele importa.
const prazo = computed(() => {
  const q = props.lead.proximoPasso?.data
  if (!q || !proximo.value.marcadoAMao) return { texto: '', atrasado: false }
  if (q === hoje) return { texto: 'para hoje', atrasado: false }
  return q < hoje ? { texto: `era para ${diaDaSemana(q)}`, atrasado: true } : { texto: `para ${diaDaSemana(q)}`, atrasado: false }
})

// ------------------------------------------------------------ mandar a proposta (mandar-proposta.ts)

// Gostou depois do link: a proposta é o passo de hoje (primário). Só entre o link e a proposta, sem o
// "gostei" visto pelo n8n (a conversa andou por telefone?): fica ao lado, como secundária.
const gostou = computed(() => gostouDepoisDoLink(props.lead))
const cabe = computed(() => gostou.value || cabeProposta(props.lead))
// A sugestão guardada do copiloto (GET, nunca chama o modelo): dela saem os itens; os preços, do cardápio.
const sugestaoGuardada = ref<SugestaoDoCopiloto | null>(null)
// A sugestão inteira, caiba a proposta ou não: a leitura de quem está do outro lado (recepção, robô)
// entra na frase do "Agora" pelo mesmo caminho da Próxima venda.
const lida = ref<SugestaoDoCopiloto | null>(null)
async function lerSugestaoGuardada() {
  sugestaoGuardada.value = null
  lida.value = null
  if (!comCopiloto.value) return
  const id = props.lead.id
  try {
    const r = await fetch(`/api/operations/crm/copiloto/sugestao?${new URLSearchParams({ produto: props.lead.produto, id })}`)
    const dados = await r.json().catch(() => ({}))
    if (!r.ok || props.lead.id !== id) return
    const s: SugestaoDoCopiloto | null = dados.sugestao?.sugestao ?? null
    lida.value = s
    if (cabe.value) sugestaoGuardada.value = s
  } catch {
    // Sem a sugestão, sai o texto base da colinha.
  }
}
watch([comCopiloto, () => props.lead.id, cabe], () => { void lerSugestaoGuardada() }, { immediate: true })
const proposta = computed(() => (cabe.value ? propostaDeUmToque(props.lead, sugestaoGuardada.value) : null))
/**
 * A sugestão como a Próxima venda a recebe (/copiloto/prontas): só no trecho em que o copiloto serve
 * e com a última mensagem dele (conversaDaVez em server/copiloto.ts). Sem esse filtro, a Ficha diria
 * "a recepção respondeu" onde o cartão diz outra coisa.
 */
const sugestaoDaFila = computed<SugestaoDeVenda | undefined>(() => {
  const s = lida.value
  if (!s?.mensagem.trim() || !copilotoServe(props.lead) || props.lead.conversa?.ultima.direcao !== 'entrada') return undefined
  return { mensagem: s.mensagem, porque: s.porque, quando: '', ...(s.momento ? { momento: s.momento } : {}) }
})
/**
 * Uma frase de "o que fazer agora" (OT-04, 16/10/2026; AC-12, 17/10/2026): a ação da fila de venda para
 * este lead, a mesma do cartão da Próxima venda e do Telegram (fraseDaAcao). A fila é calculada como se
 * o horário e o ritmo deixassem: a Ficha diz o que fazer, as travas dizem quando. Sem ação, o "Agora"
 * diz que não há nada e por quê (agoraDaFicha); a jornada só mostra a posição, lá embaixo.
 */
// O primeiro contato de um lead Novo sai daqui (AC-22, primeiro-da-ficha.ts), com as travas da
// Próxima venda: o "Liberar" do dia (`liberados`, o mesmo do cartão) e o ritmo (`ritmo`, que o
// CrmPanel conta com /crm/venda/primeiro). Fora da Hoje (o Plus depois dos 10), a frase é a da fila.
const primeiroDaFicha = computed(() => primeiroContatoDaFicha(props.lead, {
  foraDoExpediente: Boolean(props.aviso), liberado: props.liberados.has(props.lead.id), ritmo: props.ritmo,
}))
const acaoDaFila = computed(() => (props.visao?.estado === 'ok'
  ? acaoDaFicha(props.visao, props.lead, Date.now(), primeiroDaFicha.value, sugestaoDaFila.value)
  : null))
const agora = computed(() => agoraDaFicha(props.lead, acaoDaFila.value))

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
    // Deixou de ser o caminho do desfecho (AC-08: a faixa "Desfecho" grava ganho e perda): fica como consulta.
    ['acoes', 'Página do lead no n8n', l.acoes, false, false],
  ]
  return todas.flatMap(([chave, rotulo, href, principal, anota]) => (href ? [{ chave, rotulo, href, principal, anota }] : []))
    // Primeiro contato fora do expediente (envio, convite, reenvio do só-robô): some até o "Liberar".
    // Com a trava de ritmo segurando, some também, e sem "Liberar" (o aviso diz até quando).
    // O de um lead Novo fica (AC-22): é o primário, desabilitado com o motivo ao lado.
    .filter((a) => a.chave === primeiroDaFicha.value?.chave || !((travado.value || segurado.value) && ehPrimeiroContato(props.lead, a.href)))
})
/** O primário é o primeiro contato do Novo e as travas seguram: botão desabilitado, motivo ao lado. */
const primarioTravado = computed(() => {
  const p = primeiroDaFicha.value
  return p && !p.pode && primaria.value?.chave === p.chave ? p : null
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
  comProposta.value ? 'Mandar a proposta abre o WhatsApp com ela e já a marca enviada hoje.' : '',
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

// "Como vender" abre sempre em "O que oferecer" (AC-14, 17/10/2026). A aba Copiloto saiu (fase 2 da
// RULES 28): a sugestão dele vem pelo Assistente, no "Perguntar sobre este lead".
type AbaDeVenda = 'oferta' | 'roteiro'
const ABAS_DE_VENDA: Array<{ id: AbaDeVenda; rotulo: string }> = [
  { id: 'oferta', rotulo: 'O que oferecer' },
  { id: 'roteiro', rotulo: 'Roteiro' },
]
const abaInicial = (): AbaDeVenda => 'oferta'
const abaDeVenda = ref<AbaDeVenda>(abaInicial())

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
  confirmandoGanho.value = false
  escolhendoPerda.value = false
  marcandoProposta.value = false
  propostaData.value = hoje
})

// ------------------------------------------------------------ gravar na planilha

async function registrar(tipo: TipoDaFicha, texto: string, data: string, feito: string, de: 'proximo' | 'anotar' | 'acao' | 'desfecho' = 'anotar') {
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
// ------------------------------------------------------------ desfecho (AC-08, 17/10/2026)

// Ganhou, perdeu (com o motivo) e proposta enviada num lugar só, logo depois do primário, em todas as
// ofertas. Eram botões soltos no fim de "Anotar" e o "Recusou, fechou ou desfazer" do n8n: o desfecho
// é o que limpa o funil, e ficava escondido onde ninguém chega.
const desfecho = computed(() => desfechosDoLead(props.lead))
const FEITO: Record<RegistroDeDesfecho, string> = {
  ganhou: 'Ganho marcado: sai do funil como Ganho no próximo retrato.',
  ganhou_desfeito: 'Ganho desfeito.',
  recusou: 'Recusa marcada: sai do funil no próximo retrato.',
  recusou_desfeito: 'Recusa desfeita.',
  sem_contato: 'Perda marcada: sem contato fácil.',
  sem_contato_desfeito: 'Perda desfeita.',
  proposta: 'Proposta marcada.',
  proposta_desfeita: 'Proposta desfeita.',
  dispensado_desfeito: 'Dispensar desfeito: o lead volta à Triagem.',
}
const marcarDesfecho = async (tipo: RegistroDeDesfecho, data = '') => {
  const ok = await registrar(tipo, '', data, FEITO[tipo], 'desfecho')
  if (ok) { escolhendoPerda.value = false; marcandoProposta.value = false; confirmandoGanho.value = false }
}
// O ganho tira o lead do funil: o segundo toque confirma, ali mesmo, sem confirm() (que o celular
// esconde atrás da aba). Depois de alguns segundos o botão volta ao normal.
const confirmandoGanho = ref(false)
let relogioDoGanho = 0
function tocarGanhou() {
  if (confirmandoGanho.value) { window.clearTimeout(relogioDoGanho); void marcarDesfecho('ganhou'); return }
  confirmandoGanho.value = true
  window.clearTimeout(relogioDoGanho)
  relogioDoGanho = window.setTimeout(() => { confirmandoGanho.value = false }, 6000)
}
onBeforeUnmount(() => window.clearTimeout(relogioDoGanho))
const escolhendoPerda = ref(false)
const marcandoProposta = ref(false)
// Os toques somem quando a escolha abre: o foco vai para dentro dela, senão o teclado cai no começo da folha.
const primeiraDaEscolha = ref<HTMLButtonElement | HTMLInputElement | null>(null)
async function abrirEscolha(qual: 'perda' | 'proposta') {
  confirmandoGanho.value = false
  escolhendoPerda.value = qual === 'perda'
  marcandoProposta.value = qual === 'proposta'
  await nextTick()
  primeiraDaEscolha.value?.focus()
}
const marcarProposta = () => marcarDesfecho('proposta', propostaData.value || hoje)

// ------------------------------------------------------------ anotar

// Plus: a planilha não conhece o lead, então o envio feito por fora e a resposta se anotam aqui.
const ehPlus = computed(() => props.lead.produto === 'plus')
const plusEmConversa = computed(() => props.lead.sinal === 'respondeu-prumo')
const marcarEnviadoPlus = () => registrar('plus_enviado', '', '', 'Envio anotado.')
const marcarRespondeuPlus = () => registrar('plus_respondeu', '', '', 'Resposta anotada.')
// AC-09: a 2ª mensagem e o follow-up anotados à mão, no passo deles ou quando o toque não anotou. Vão
// pelo mesmo caminho do toque (o CrmPanel): a marca, o "anotado às", e a falha some ao dar certo.
const aMao = computed(() => (aberto.value && disponivel.value ? anotacoesAMao(props.lead, Boolean(props.falhaDaAnotacao)) : []))
const ROTULO_A_MAO = { segunda_enviada: '2ª mensagem enviada', followup_enviado: 'Follow-up enviado' } as const
const primeiroAMao = ref<HTMLButtonElement[]>([])
// O "anote à mão" do aviso leva o foco ao botão: quem lê o erro não precisa achar a seção.
function irParaAnotar() {
  primeiroAMao.value[0]?.focus()
  primeiroAMao.value[0]?.scrollIntoView({ block: 'center' })
}
</script>

<template>
  <article class="crm-ficha" aria-labelledby="crm-ficha-titulo">
    <!-- Quem é e onde está (a etapa e o passo da jornada), sem caixa: a folha já é o contorno. -->
    <header class="crm-ficha__cabeca">
      <span class="crm-kicker">{{ ROTULO_DO_PRODUTO[lead.produto] }} · {{ onde(lead) }}</span>
      <h2 id="crm-ficha-titulo" ref="titulo" tabindex="-1">{{ lead.empresa }}</h2>
      <p class="crm-ficha__etapa">
        <span class="crm-etapa" :class="`is-${lead.etapa}`">{{ ROTULO_DA_ETAPA[lead.etapa] }}</span>
        <span>{{ textoDaSubEtapa(lead.subEtapa) }} · {{ diasNaEtapa(lead) }}<template v-if="lead.leitura === 'viu'"> · leu</template><template v-else-if="lead.leitura === 'pela-resposta'"> · leu e respondeu</template></span>
      </p>
    </header>

    <section class="crm-ficha__agora" aria-labelledby="crm-ficha-agora">
      <h3 id="crm-ficha-agora" class="crm-ficha__rotulo">Agora</h3>
      <template v-if="!editando">
        <!-- Uma frase só (AC-12): a mesma do cartão da Próxima venda (fraseDaAcao), ou por que não há nada. -->
        <p class="crm-ficha__acao">{{ agora.frase }}</p>
        <p v-if="agora.como" class="crm-ficha__prazo">Como: {{ agora.como }}</p>
        <p class="crm-ficha__prazo">
          <template v-if="lead.proximoPasso?.texto && !agora.citaOProximo">Próximo passo salvo: “{{ lead.proximoPasso.texto }}”<template v-if="prazo.texto">, {{ prazo.texto }}</template></template>
          <span v-if="prazo.atrasado" class="selo selo--erro">atrasado</span>
          <button v-if="aberto" ref="botaoMudar" class="botao botao--leve" type="button" @click="editarProximo">{{ lead.proximoPasso ? 'Mudar' : 'Salvar um próximo passo' }}<span v-if="lead.proximoPasso" class="so-leitor"> o próximo passo</span></button>
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

    <!-- A mensagem que o botão vai abrir, à vista antes do toque (16/10/2026): revisar sem adivinhar. -->
    <figure v-if="rascunho" class="crm-ficha__rascunho">
      <figcaption class="crm-muted">Mensagem que vai sair (revise; dá para mudar no WhatsApp antes de enviar)<template v-if="primaria?.chave === 'proposta' && proposta">. {{ proposta.origem === 'copiloto' ? 'Itens do copiloto, preços do cardápio.' : 'Texto base do Roteiro.' }}</template></figcaption>
      <blockquote>{{ rascunho }}</blockquote>
      <p v-if="primaria?.chave === 'proposta' && proposta?.completar" class="crm-ficha__completar">Complete o que está entre colchetes antes de enviar.</p>
    </figure>
    <!-- Proposta ao lado (sem o "gostei" registrado): o texto também à vista antes do toque, dobrado. -->
    <details v-if="propostaAoLado && proposta" class="dobra crm-ficha__rascunho">
      <summary>Proposta que vai sair <span class="crm-muted">({{ proposta.origem === 'copiloto' ? 'itens do copiloto, preços do cardápio' : 'texto base do Roteiro' }})</span></summary>
      <blockquote>{{ proposta.texto }}</blockquote>
      <p v-if="proposta.completar" class="crm-ficha__completar">Complete o que está entre colchetes antes de enviar.</p>
    </details>

    <!-- Não fica mais preso ao topo ao rolar (AC-14, 17/10/2026): cobria a primeira linha da Conversa.
         Com o Desfecho logo abaixo e a ordem de decisão, ele já é a segunda coisa da folha. -->
    <div v-if="primaria" class="crm-ficha__fixa" role="group" aria-label="Ação de agora">
      <!-- Primeiro contato travado (AC-22): o botão fica, desabilitado, com o motivo curto ao lado; o
           "Liberar" aparece só quando o horário é o que segura (o ritmo não se libera). -->
      <template v-if="primarioTravado">
        <button class="botao botao--primario" type="button" disabled aria-describedby="crm-ficha-motivo">{{ primarioTravado.rotulo }}</button>
        <button v-if="primarioTravado.pedeLiberar" type="button" class="botao" @click="emit('liberar', lead.id)">{{ ROTULO_DE_LIBERAR }}</button>
        <p id="crm-ficha-motivo" class="crm-muted crm-ficha__motivo">{{ primarioTravado.motivo }}.</p>
      </template>
      <a v-else class="botao botao--primario" :href="primaria.href" target="_blank" rel="noopener" @click="aoTocar(primaria.chave, primaria.href)">{{ primaria.rotulo }} <span aria-hidden="true">↗</span></a>
      <a v-for="a in secundarias" :key="a.chave" class="botao" :href="a.href" target="_blank" rel="noopener" @click="aoTocar(a.chave, a.href)">{{ a.rotulo }} <span aria-hidden="true">↗</span></a>
    </div>

    <div class="crm-ficha__status">
      <p v-if="dicaDaAcao" class="crm-muted">{{ dicaDaAcao }}</p>
      <template v-if="origem === 'acao'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}. Marque à mão em Desfecho, “Proposta enviada”.</p>
      </template>

      <!-- Os avisos num lugar só, um por linha, com a palavra antes da cor. -->
      <ul v-if="temAvisos" class="crm-ficha__avisos">
        <!-- Com o primário travado, o "Liberar" já está ao lado dele: aqui fica só o porquê (a taxa medida). -->
        <li v-if="travado" class="is-atencao">
          {{ aviso }}
          <button v-if="!primarioTravado?.pedeLiberar" type="button" class="botao botao--leve" @click="emit('liberar', lead.id)">{{ ROTULO_DE_LIBERAR }}</button>
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
      <p v-if="falhaDaAnotacao" class="crm-erro" role="alert">
        {{ falhaDaAnotacao }}
        <button v-if="aMao.length" type="button" class="botao botao--leve" @click="irParaAnotar">Anotar à mão</button>
      </p>

      <details v-if="apoio.length" class="dobra">
        <summary>Abrir em outro lugar <span class="crm-muted">({{ apoio.length }})</span></summary>
        <ul class="crm-ficha__apoio">
          <li v-for="a in apoio" :key="a.chave"><a :href="a.href" target="_blank" rel="noopener" @click="aoTocar(a.chave, a.href)">{{ a.rotulo }} <span aria-hidden="true">↗</span></a></li>
        </ul>
      </details>
    </div>

    <!-- Desfecho (AC-08): ganhou, perdeu e proposta enviada em um toque, em todas as ofertas, com o
         estado marcado e o desfazer certo (desfechosDoLead). Sem caixa: seção com título e divisor. -->
    <section class="crm-ficha__secao crm-ficha__desfecho" aria-labelledby="crm-ficha-desfecho">
      <h3 id="crm-ficha-desfecho">Desfecho</h3>
      <ul v-if="desfecho.marcados.length" class="crm-ficha__marcados">
        <li v-for="m in desfecho.marcados" :key="m.id">
          <span>{{ m.texto }}</span>
          <button v-if="m.desfazer" class="botao botao--leve" type="button" :disabled="!disponivel || salvando !== null" @click="marcarDesfecho(m.desfazer.tipo)">
            {{ salvando === m.desfazer.tipo ? 'Desfazendo…' : m.desfazer.rotulo }}
          </button>
        </li>
      </ul>
      <div v-if="(desfecho.ganhar || desfecho.perder || desfecho.proposta) && !escolhendoPerda && !marcandoProposta" class="crm-form__botoes">
        <button v-if="desfecho.ganhar" class="botao" type="button" :disabled="!disponivel || salvando !== null" :aria-pressed="confirmandoGanho" @click="tocarGanhou">
          {{ salvando === 'ganhou' ? 'Marcando…' : confirmandoGanho ? `Confirmar o ganho: ${lead.empresa}` : 'Ganhou' }}
        </button>
        <button v-if="desfecho.perder" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="abrirEscolha('perda')">Perdeu</button>
        <button v-if="desfecho.proposta" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="abrirEscolha('proposta')">Proposta enviada</button>
      </div>
      <p v-if="confirmandoGanho" class="crm-muted" role="status">Toque de novo para confirmar. O lead sai do funil como Ganho.</p>
      <div v-if="escolhendoPerda" class="crm-form" role="group" aria-labelledby="crm-ficha-perdeu">
        <p id="crm-ficha-perdeu" class="crm-ficha__rotulo">Por que perdeu?</p>
        <div class="crm-form__botoes">
          <button ref="primeiraDaEscolha" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarDesfecho('recusou')">{{ salvando === 'recusou' ? 'Marcando…' : 'Disse não' }}</button>
          <button class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarDesfecho('sem_contato')">{{ salvando === 'sem_contato' ? 'Marcando…' : 'Sem contato fácil' }}</button>
          <button class="botao botao--leve" type="button" @click="escolhendoPerda = false">Cancelar</button>
        </div>
      </div>
      <form v-if="marcandoProposta" class="crm-form" @submit.prevent="marcarProposta">
        <label><span>Proposta enviada em</span><input ref="primeiraDaEscolha" v-model="propostaData" type="date" :max="hoje" :disabled="!disponivel"></label>
        <div class="crm-form__botoes">
          <button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'proposta' ? 'Marcando…' : 'Marcar a proposta enviada' }}</button>
          <button class="botao botao--leve" type="button" @click="marcandoProposta = false">Cancelar</button>
        </div>
      </form>
      <template v-if="origem === 'desfecho'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
      </template>
    </section>

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

    <!-- Como vender (16/10/2026): oferta e roteiro numa seção com abas; o copiloto, que era a terceira,
         foi para o Assistente em 17/10/2026 (o botão logo abaixo). -->
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
      <a class="crm-colinha__inteira" href="/mais?abrir=roteiro" @click="verColinha">Ver o roteiro inteiro <span aria-hidden="true">→</span></a>
    </template>

    <!-- Fase 2 da RULES 28 (17/10/2026): no lugar da aba Copiloto. Abre o Assistente com este lead como
         contexto (o `?lead=` do endereço); a sugestão guardada do copiloto chega lá num cartão. -->
    <div v-if="assistente.disponivel.value" class="crm-form__botoes crm-ficha__perguntar">
      <button class="botao" type="button" @click="perguntarSobreOLead">Perguntar sobre este lead</button>
      <span class="crm-muted">{{ comCopiloto && copilotoServe(lead) ? 'O Assistente traz a sugestão do copiloto, quando há uma para a conversa de agora, com a proposta e o preço do cardápio.' : 'O Assistente lê este lead e responde ao lado.' }}</span>
    </div>
    </section>

    <section class="crm-ficha__secao" aria-labelledby="crm-ficha-anotar">
      <h3 id="crm-ficha-anotar">Anotar</h3>
      <div v-if="ehPlus && (lead.sinal === 'pronto' || lead.etapa === 'contato')" class="crm-form__botoes">
        <button v-if="lead.sinal === 'pronto'" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarEnviadoPlus">{{ salvando === 'plus_enviado' ? 'Anotando…' : 'Já enviei por fora' }}</button>
        <button v-if="lead.etapa === 'contato'" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarRespondeuPlus">{{ salvando === 'plus_respondeu' ? 'Anotando…' : plusEmConversa ? 'Respondeu de novo' : 'Respondeu no WhatsApp' }}</button>
      </div>
      <!-- AC-09: onde o "anote à mão" aponta. Só no passo de cada envio, ou com a anotação do toque em falha. -->
      <div v-if="aMao.length" class="crm-form__botoes" role="group" aria-label="Anotar um envio feito à mão">
        <button v-for="t in aMao" :key="t" ref="primeiroAMao" class="botao" type="button" @click="emit('anotar', lead.id, t)">{{ ROTULO_A_MAO[t] }}</button>
      </div>

      <!-- Só a nota (AC-08): proposta, recusa e sem contato foram para o Desfecho. -->
      <form class="crm-form" @submit.prevent="salvarNota">
        <label><span>Nova nota<small v-if="lead.notas"> · {{ lead.notas }} salva{{ lead.notas === 1 ? '' : 's' }} até agora</small></span><textarea v-model="nota" rows="3" maxlength="1000" :disabled="!disponivel" placeholder="O que ele disse, o que ficou combinado…" /></label>
        <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'nota' ? 'Salvando…' : 'Salvar a nota' }}</button></div>
      </form>

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
              <strong>{{ textoDoEvento(evento.rotulo) }}</strong>
              <p v-if="evento.texto">{{ textoDoEvento(evento.texto) }}</p>
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

<style>
/* O motivo do primeiro contato travado (AC-22): linha inteira, embaixo dos botões. */
.crm-ficha__motivo { flex: 1 1 100%; margin: 0; }
/* O "Perguntar sobre este lead" (fase 2 da RULES 28): embaixo das abas de Como vender, com a dica ao lado. */
.crm-ficha__perguntar { align-items: center; margin-top: var(--esp-3); }
</style>
