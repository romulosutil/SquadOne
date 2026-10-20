<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import CrmJornada from './CrmJornada.vue'
import CrmAprendizado from './CrmAprendizado.vue'
import CrmSpiced from './CrmSpiced.vue'
import CrmConfirmarPasso from './CrmConfirmarPasso.vue'
import CrmHistorico from './CrmHistorico.vue'
import CrmRevisarClassificacao from './CrmRevisarClassificacao.vue'
import AcompanhamentoObservado from '../office/AcompanhamentoObservado.vue'
import { precisaConferirHistorico } from './historico-comercial'
import { contatoPausado } from './aprendizado-comercial'
import { copilotoServe, type SugestaoDoCopiloto } from './copiloto'
import { cabeProposta, gostouDepoisDoLink, propostaDeUmToque } from './mandar-proposta'
import { copilotoLigado } from './copiloto-ligado'
import CrmMomento from './CrmMomento.vue'
import CrmObjecao from './CrmObjecao.vue'
import { colinhaDoLead } from './colinha'
import { nomeDaOferta, ofertaDoLead, proximoDaJornada } from './jornada'
import { DIAS_SEM_RESPOSTA, ROTULO_DA_ETAPA, ROTULO_DA_OFERTA_DO_PLUS, ROTULO_DA_RESPOSTA, ROTULO_DO_PRODUTO, dataHora, diasNaEtapa, ehConvite, hojeEmSP, hora, onde, rotuloDoFollowup, textoDaAbordagem, textoDaSubEtapa, textoDoEvento } from './crm-formato'
import { ehPrimeiroContato, envioTravado, linksDePrimeiroContato, type EnviosLiberados } from './trava-de-horario'
import type { EstadoDoRitmo } from './trava-de-ritmo'
import { recadoDasTravas, rotuloDoLiberar } from './recado-de-travas'
import RecadoDeTravas from './RecadoDeTravas.vue'
import type { CrmLead, CrmTipoDeRegistro, CrmVisao } from './types'
import { raioXAvulso } from '../../server/site-mensagem.ts'
import { agoraDaFicha, desfechosDoLead, textoDoLink, type RegistroDeDesfecho, type SugestaoDeVenda } from './proxima-venda'
import { acaoDaFicha, primeiroContatoDaFicha } from './primeiro-da-ficha'
import { pedeMaterial, textoParaATela, type PapelDaMensagem } from './marcadores-da-conversa'
import { useAssistente } from '../casca/assistente'
import { ehSiteProprio, linhasDosSinais, type SinaisDoSite } from '../../server/sinais-do-site.ts'

// Ficha de um lead. As únicas escritas da Central são as deste arquivo (nota, próximo passo, o
// desfecho: ganhou, perdeu, proposta, com o desfazer de cada um, e o que o histórico e o aprendizado
// guardam) e todas vão para a aba CRM da planilha pelo n8n (POST /api/operations/crm/registro).
// Abrir o WhatsApp NÃO grava nada (regra [abrir-nao-envia], 18/10/2026): o envio quem marca é o
// observador do WhatsApp, ou o "Enviei" explícito (CrmConfirmarConvite, "Proposta enviada" no Desfecho).
// O único efeito do toque no primeiro contato é contar na trava de ritmo (emit `primeiro`), do lado
// seguro: o toque pode não virar envio, e contar a mais só atrasa o próximo. Desde 17/10/2026 (AC-08) o
// desfecho é da faixa "Desfecho": a página do lead do n8n (fluxo 07) virou só um lugar a mais para
// abrir; a Etapa do PRUMO muda na planilha.
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente, enviar a primeira mensagem, o
// convite e o reenvio do só-robô esperam o "Liberar" deste lead, como nas telas de primeiro contato. Desde
// 17/10/2026 (AC-21) é o "Liberar" do dia, guardado no servidor (liberados.ts).
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
  /** Trava de ritmo (trava-de-ritmo.ts): segurando, os links de primeiro contato somem sem "Liberar". */
  ritmo: EstadoDoRitmo
}>()
// Abre numa folha cheia (CrmPanel): fechar é o "Fechar" da folha, o Esc ou o
// voltar do navegador, então a ficha não tem botão de voltar próprio.
// `colinha`: o CrmPanel leva ao Roteiro, em /mais?abrir=roteiro (AC-20), sem recarregar.
const emit = defineEmits<{
  registrado: []; colinha: []; liberar: [leadId: string]
  /** Tocou num link de primeiro contato: só conta na trava de ritmo, nada é gravado na planilha. */
  primeiro: [leadId: string]
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
onMounted(() => { assistente.contextoDaFicha.value = { pagina: 'ficha', lead: { produto: props.lead.produto, id: props.lead.id } } })
onBeforeUnmount(() => { if (assistente.contextoDaFicha.value?.lead?.id === props.lead.id) assistente.contextoDaFicha.value = null })
const perguntarSobreOLead = () => assistente.abrir()
const nota = ref('')
const proximoTexto = ref('')
const proximoData = ref('')
const propostaData = ref(hojeEmSP())
const propostaResumo = ref('')
// Os registros de desfecho (AC-08) já estão em CrmTipoDeRegistro; o par fica explícito para quem lê.
type TipoDaFicha = CrmTipoDeRegistro | RegistroDeDesfecho
const salvando = ref<TipoDaFicha | null>(null)
const mensagem = ref('')
const erro = ref('')
// De onde saiu o último registro: a confirmação aparece perto do botão tocado, não no outro canto da ficha.
const origem = ref<'proximo' | 'anotar' | 'desfecho' | 'aprendizado' | 'historico'>('anotar')

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
const historicoPendente = computed(() => precisaConferirHistorico(props.lead) && !primeiroDaFicha.value)
const contatoEmPausa = computed(() => contatoPausado(props.lead))
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
const proposta = computed(() => (cabe.value && lida.value?.momento?.quem !== 'recepcao' && lida.value?.momento?.quem !== 'robo'
  && props.lead.conversa?.ultima.papel !== 'recepcao' && props.lead.conversa?.ultima.papel !== 'robo'
  ? propostaDeUmToque(props.lead, sugestaoGuardada.value) : null))
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
const agora = computed(() => historicoPendente.value && !contatoEmPausa.value ? { frase: 'Confira a conversa antes de decidir a retomada.', citaOProximo: false } : agoraDaFicha(props.lead, acaoDaFila.value))
const passoConfirmavel = computed(() => !contatoEmPausa.value && !historicoPendente.value && acaoDaFila.value?.rascunho && acaoDaFila.value.textoDoRegistro && ['cadencia_enviada', 'followup_enviado'].includes(acaoDaFila.value.anota ?? '') ? acaoDaFila.value : null)

// As ações de um toque. `principal`: é o passo de hoje (convite, primeira mensagem, 2ª mensagem ou
// demo depois do "sim", follow-up). `envia`: é uma mensagem ao lead; abrir não a registra (o observador
// do WhatsApp marca quando ela sai), e a ficha avisa isso uma vez.
interface AcaoDaFicha { chave: string; rotulo: string; href: string; principal: boolean; envia: boolean }
const acoes = computed<AcaoDaFicha[]>(() => {
  const l = props.lead.links
  const prumo = props.lead.produto === 'prumo'
  // Iris e estamparias: o site é o da empresa e a Etapa muda na planilha, como no PRUMO.
  const convite = ehConvite(props.lead.produto)
  // A licença (17/10/2026) também põe a 2ª mensagem no passo: é o material que ele deixou mandar.
  const interesse = pedeMaterial(props.lead.resposta)
  // Site com a variação C: a segunda (segundaDe) leva o raio-x e o demo, não só o site. Com o Raio-X
  // avulso (demo sob pedido, 14/10/2026): só o raio-x antes do demo, só o demo depois do "Gerar demo".
  const recebeuC = !prumo && ['C', 'D'].includes(props.lead.abordagem?.mensagem ?? '') && Boolean(l.raioX)
  const segunda = prumo ? 'Mandar o Raio-X'
    : !recebeuC ? 'Mandar o link do site'
    : !raioXAvulso(l.raioX) ? 'Mandar o raio-x e o demo'
    : l.site ? 'Mandar o demo com o preço' : 'Mandar o raio-x'
  const todas: Array<[string, string, string | undefined, boolean, boolean]> = [
    // Primeiro da lista quando ele gostou: o link da 2ª mensagem ainda pode estar na planilha, e o passo já é outro.
    ['proposta', 'Mandar a proposta', gostou.value ? proposta.value?.url : undefined, true, true],
    ['enviar', 'Enviar a primeira mensagem', l.enviar, true, true],
    ['convite', 'Abrir convite no WhatsApp', l.convite, true, true],
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
  return todas.flatMap(([chave, rotulo, href, principal, envia]) => (href ? [{ chave, rotulo, href, principal, envia }] : []))
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
/**
 * As duas travas num recado só, com o próximo passo (recado-de-travas.ts, 17/10/2026): ao lado do
 * primário travado, ou no lugar dos dois avisos que ficavam empilhados na lista. `aviso` presente =
 * fora do expediente (é o avisoDeHorario do CrmPanel, com a taxa medida).
 */
const recado = computed(() => recadoDasTravas({
  agora: Date.now(), noExpediente: !props.aviso, liberado: props.liberados.has(props.lead.id), ritmo: props.ritmo, contexto: 'ficha', taxa: props.aviso,
}))

// Um primário só: a primeira ação do passo; sem nenhuma, com o lead aberto, a conversa no WhatsApp.
// As outras do passo (o "Gerar o demo" ao lado da 2ª mensagem) ficam ao lado, como secundárias.
const doPasso = computed(() => acoes.value.filter((a) => a.principal))
const primaria = computed<AcaoDaFicha | undefined>(() => {
  if (doPasso.value[0]) return doPasso.value[0]
  const conversa = aberto.value ? acoes.value.find((a) => a.chave === 'whatsapp') : undefined
  return conversa && { ...conversa, rotulo: 'Abrir a conversa no WhatsApp' }
})
const propostaAoLado = computed<AcaoDaFicha | undefined>(() =>
  !gostou.value && proposta.value ? { chave: 'proposta', rotulo: 'Mandar a proposta', href: proposta.value.url, principal: false, envia: true } : undefined)
// O primário que a Ficha mostra. Em um lead Novo só o primeiro contato, com as travas (AC-22): a conversa
// solta abriria o WhatsApp sem horário nem ritmo. Em pausa ou com o histórico por conferir, nenhum.
const primariaVisivel = computed<AcaoDaFicha | undefined>(() => {
  if (contatoEmPausa.value || historicoPendente.value) return undefined
  if (props.lead.etapa !== 'novo') return primaria.value
  return primaria.value && primaria.value.chave === primeiroDaFicha.value?.chave ? primaria.value : undefined
})
/** O toque num link de primeiro contato conta no ritmo; nada mais acontece (o WhatsApp abre pelo próprio <a>). */
function aoAbrir(href: string) {
  if (ehPrimeiroContato(props.lead, href)) emit('primeiro', props.lead.id)
}
const secundarias = computed(() => [...doPasso.value.slice(1), ...(propostaAoLado.value ? [propostaAoLado.value] : [])])
const apoio = computed(() => acoes.value.filter((a) => !a.principal && a.chave !== primaria.value?.chave))
const dicaDaAcao = computed(() => [
  doPasso.value.some((a) => a.envia) ? 'Abrir o WhatsApp não registra o envio: o observador marca quando a mensagem sai.' : '',
  props.lead.reenvioDoRobo && doPasso.value.some((a) => a.chave === 'followup') ? 'Reenvio único, pedindo o responsável.' : '',
  doPasso.value.some((a) => a.chave === 'gerarDemo') ? 'O demo sai em 20 a 40 min; o aviso chega no WhatsApp.' : '',
].filter(Boolean).join(' '))

// O prazo dos 7 dias só como aviso quando o próximo passo já não o diz ("vai para Perdido em…").
const avisoDoPrazo = computed(() => {
  const d = props.lead.diasParaSair
  if (d === undefined || props.lead.etapa !== 'contato' || /Perdido/.test(proximo.value.quando ?? '')) return ''
  return `Vai para Perdido ${d <= 1 ? 'amanhã' : `em ${d} dias`} se ele não escrever. Salvar um próximo passo segura o lead.`
})
const temAvisos = computed(() => Boolean(props.lead.plus?.fixo) || Boolean(avisoDoPrazo.value)
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
  const p = primariaVisivel.value
  if (!p) return ''
  return textoDoLink(p.href) ?? (p.chave === 'enviar' ? props.lead.mensagemPronta ?? '' : '')
})

// ------------------------------------------------------------ a conversa (o observador, 16/10/2026)

const conversaTodas = ref<Array<{ em: string; direcao: 'entrada' | 'saida'; texto: string; papel?: PapelDaMensagem }>>([])
// Quem escreveu, quando não é o lead falando por si (17/10/2026): a recepção não decide, o robô nem é gente.
const QUEM_DO_PAPEL: Record<PapelDaMensagem, string> = { recepcao: 'recepção', robo: 'resposta automática' }
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

// ------------------------------------------------------------ sinais do site (17/10/2026)

// O que o site do lead mostra (server/sinais-do-site.ts): anúncio no ar, agência, agendamento, blog. Lido
// sob demanda AO ABRIR a Ficha de um lead aberto (POST /crm/sinais: no máximo 3 requisições ao site dele,
// com cache de 7 dias em disco), nunca em lote. Só informa: nada daqui vai a lead. A seção mostra só o que
// tem fonte; sinal sem fonte (`null`) não aparece, nem como "desconhecido".
const sinaisLidos = ref<SinaisDoSite | null>(null)
const lidoEmSinais = ref('')
const estadoDosSinais = ref<'' | 'lendo' | 'inacessivel' | 'bloqueado' | 'falhou'>('')
const sinaisDoLead = computed(() => sinaisLidos.value ?? props.lead.sinais ?? null)
const linhasDeSinais = computed(() => linhasDosSinais(sinaisDoLead.value ?? undefined))
// Há site próprio a ler: não é o demo do Site, nem perfil de rede social, e o lead ainda está no funil.
const podeLerSinais = computed(() => aberto.value && props.lead.produto !== 'site' && Boolean(props.lead.links.site) && ehSiteProprio(props.lead.links.site ?? ''))
const mostraSinais = computed(() => linhasDeSinais.value.length > 0 || estadoDosSinais.value !== '' || podeLerSinais.value)
async function lerSinais(forcar = false) {
  if (!podeLerSinais.value) return
  const id = props.lead.id
  estadoDosSinais.value = 'lendo'
  try {
    const r = await fetch('/api/operations/crm/sinais', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ produto: props.lead.produto, id: props.lead.chave, forcar }),
    })
    const corpo = await r.json().catch(() => ({}))
    if (props.lead.id !== id) return
    if (r.status === 422) { estadoDosSinais.value = 'bloqueado'; return }
    if (!r.ok) { estadoDosSinais.value = 'falhou'; return }
    sinaisLidos.value = corpo.sinais ?? null
    lidoEmSinais.value = corpo.lidoEm ?? ''
    estadoDosSinais.value = corpo.estado === 'inacessivel' ? 'inacessivel' : ''
  } catch {
    if (props.lead.id === id) estadoDosSinais.value = 'falhou'
  }
}
function recomecarSinais() {
  sinaisLidos.value = null
  lidoEmSinais.value = ''
  estadoDosSinais.value = ''
  // Já lido e guardado pela visão: não pede de novo ao abrir.
  if (!props.lead.sinais) void lerSinais()
}

// Ctrl/Cmd/Shift/meio abrem a página numa aba nova, como os links da casca (casca/rota.ts).
function verColinha(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  emit('colinha')
}

onMounted(async () => {
  void lerConversa()
  recomecarSinais()
  await nextTick()
  titulo.value?.focus()
})
watch(() => props.lead.id, () => {
  void lerConversa()
  recomecarSinais()
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
  propostaResumo.value = ''
})

// ------------------------------------------------------------ gravar na planilha

async function registrar(tipo: TipoDaFicha, texto: string, data: string, feito: string, de: 'proximo' | 'anotar' | 'desfecho' | 'aprendizado' | 'historico' = 'anotar') {
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
const marcarProposta = async () => {
  if (!propostaResumo.value.trim()) {
    origem.value = 'desfecho'
    erro.value = 'Registre o que foi enviado: escopo, valor e prazo, ou a referência da proposta.'
    return
  }
  if (await registrar('proposta', propostaResumo.value.trim(), propostaData.value || hoje, 'Envio da proposta confirmado.', 'desfecho')) marcandoProposta.value = false
}
const salvarAprendizado = (texto: string) => registrar('nota', texto, '', 'Aprendizado salvo.', 'aprendizado')

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

    <CrmSpiced :lead="lead" :disponivel="disponivel" :sugestao="lida?.spiced" @registrado="emit('registrado')" />

    <CrmRevisarClassificacao v-if="lead.revisaoComercial || lead.etapa === 'perdido' || lead.etapa === 'ganho'" :key="lead.id" :lead="lead" :disponivel="disponivel" @registrado="emit('registrado')" />

    <p v-if="lead.revisaoComercial" class="recado recado--atencao"><strong>Classificação ou prazo a revisar.</strong> {{ lead.revisaoComercial }}</p>
    <p v-if="lead.demoProtegida && !lead.demoApagadoEm" class="texto-2 texto-pequeno"><strong>Demo protegida da limpeza automática.</strong> {{ lead.demoProtegida }}</p>

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

    <CrmHistorico v-if="historicoPendente || lead.conversa || lead.marcos.enviado" :lead="lead" :disponivel="disponivel" :salvando="salvando !== null"
      @importado="lerConversa(); emit('registrado')" />
    <template v-if="origem === 'historico'">
      <p class="crm-status" role="status">{{ mensagem }}</p><p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
    </template>



    <!-- A mensagem que o botão vai abrir, à vista antes do toque (16/10/2026): revisar sem adivinhar. -->
    <CrmConfirmarPasso v-if="passoConfirmavel" :lead="lead" :acao="passoConfirmavel" :disponivel="disponivel" @registrado="emit('registrado')" />
    <figure v-if="!passoConfirmavel && rascunho && !contatoEmPausa && !historicoPendente" class="crm-ficha__rascunho">
      <figcaption class="crm-muted">Mensagem que vai sair (revise; dá para mudar no WhatsApp antes de enviar)<template v-if="primariaVisivel?.chave === 'proposta' && proposta">. {{ proposta.origem === 'copiloto' ? 'Itens do copiloto, preços do cardápio.' : 'Texto base do Roteiro.' }}</template></figcaption>
      <blockquote>{{ rascunho }}</blockquote>
      <p v-if="primariaVisivel?.chave === 'proposta' && proposta?.completar" class="crm-ficha__completar">Complete o que está entre colchetes antes de enviar.</p>
    </figure>
    <!-- Proposta ao lado (sem o "gostei" registrado): o texto também à vista antes do toque, dobrado. -->
    <details v-if="propostaAoLado && proposta && !contatoEmPausa" class="dobra crm-ficha__rascunho">
      <summary>Proposta que vai sair <span class="crm-muted">({{ proposta.origem === 'copiloto' ? 'itens do copiloto, preços do cardápio' : 'texto base do Roteiro' }})</span></summary>
      <blockquote>{{ proposta.texto }}</blockquote>
      <p v-if="proposta.completar" class="crm-ficha__completar">Complete o que está entre colchetes antes de enviar.</p>
    </details>

    <!-- Não fica mais preso ao topo ao rolar (AC-14, 17/10/2026): cobria a primeira linha da Conversa.
         Com o Desfecho logo abaixo e a ordem de decisão, ele já é a segunda coisa da folha. -->
    <a v-if="lead.etapa === 'novo'" class="botao" href="/crm?ver=triagem">Ver avaliação do time →</a>
    <div v-if="primariaVisivel && !passoConfirmavel" class="crm-ficha__fixa" role="group" aria-label="Ação de agora">
      <!-- Primeiro contato travado (AC-22): o botão fica, desabilitado, e embaixo o recado único das
           travas diz quando volta; o "Liberar" é um link nele, só quando o horário é o que segura. -->
      <template v-if="primarioTravado">
        <button class="botao botao--primario" type="button" disabled aria-describedby="crm-ficha-motivo">{{ primarioTravado.rotulo }}</button>
        <RecadoDeTravas
          id="crm-ficha-motivo" class="crm-ficha__motivo" :recado="recado" sem-detalhe
          :rotulo-do-liberar="primarioTravado.pedeLiberar ? rotuloDoLiberar('ficha') : undefined" @liberar="emit('liberar', lead.id)"
        />
      </template>
      <a v-else class="botao botao--primario" :href="primariaVisivel.href" target="_blank" rel="noopener" @click="aoAbrir(primariaVisivel.href)">{{ primariaVisivel.rotulo }} <span aria-hidden="true">↗</span></a>
      <a v-for="a in secundarias" :key="a.chave" class="botao" :href="a.href" target="_blank" rel="noopener" @click="aoAbrir(a.href)">{{ a.rotulo }} <span aria-hidden="true">↗</span></a>
    </div>

    <div class="crm-ficha__status">
      <AcompanhamentoObservado :lead="lead" />
      <p v-if="primariaVisivel && dicaDaAcao" class="crm-muted">{{ dicaDaAcao }}</p>

      <!-- As travas do primeiro contato num recado só (horário e ritmo), com o quando; com o primário
           travado ele já está ao lado do botão e não se repete aqui. -->
      <RecadoDeTravas
        v-if="(travado || segurado) && !primarioTravado" :recado="recado"
        :rotulo-do-liberar="rotuloDoLiberar('ficha')" @liberar="emit('liberar', lead.id)"
      />
      <!-- Os avisos num lugar só, um por linha, com a palavra antes da cor. -->
      <ul v-if="temAvisos" class="crm-ficha__avisos">
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

      <details v-if="apoio.length" class="dobra">
        <summary>Abrir em outro lugar <span class="crm-muted">({{ apoio.length }})</span></summary>
        <ul class="crm-ficha__apoio">
          <li v-for="a in apoio.filter((a) => !historicoPendente || !a.envia)" :key="a.chave"><a :href="a.href" target="_blank" rel="noopener">{{ a.rotulo }} <span aria-hidden="true">↗</span></a></li>
        </ul>
      </details>
    </div>

    <!-- A conversa de verdade (16/10/2026), como o observador guardou; sem ela, a última resposta classificada. -->
    <details v-if="lead.resposta || conversa.length" class="crm-ficha__secao dobra" :open="historicoPendente && !contatoEmPausa">
      <summary>Mensagens disponíveis · {{ conversaTodas.length || 'apenas trecho classificado' }}</summary>
      <p class="crm-muted">Até 60 mensagens recentes do arquivo. Isto não comprova histórico completo, nem leitura de áudios e anexos.</p>
      <p v-if="lead.resposta" class="crm-resposta" :class="`is-${lead.resposta.tipo}`">
        <strong>{{ ROTULO_DA_RESPOSTA[lead.resposta.tipo] }}</strong>{{ lead.resposta.em ? ` ${quandoFoi(lead.resposta.em)}` : '' }}
      </p>
      <ol v-if="conversa.length" class="crm-conversa" aria-label="Mensagens, da mais antiga para a mais nova">
        <li v-if="conversaCortada" class="crm-muted"><button type="button" class="crm-mais" @click="conversaInteira = true">Ver as {{ conversaTodas.length - conversa.length }} mensagens anteriores</button></li>
        <li v-for="(m, i) in conversa" :key="`${m.em}-${i}`" :class="`is-${m.direcao}`">
          <span class="so-leitor">{{ m.direcao === 'entrada' ? `${lead.empresa} escreveu` : 'Você escreveu' }}</span>
          <p>{{ m.texto ? textoParaATela(m.texto) : (m.direcao === 'saida' ? '(mensagem enviada, sem o texto)' : '(sem texto: áudio, foto ou figurinha)') }}</p>
          <time :datetime="m.em" class="crm-muted">{{ quandoFoi(m.em) }}{{ m.papel ? ` · ${QUEM_DO_PAPEL[m.papel]}` : '' }}</time>
        </li>
      </ol>
      <template v-else>
        <blockquote v-if="lead.resposta?.trecho" class="crm-resposta__trecho">{{ textoParaATela(lead.resposta.trecho) }}</blockquote>
        <p v-else-if="lead.resposta" class="crm-muted">Só resposta automática. Ninguém escreveu ainda.</p>
        <p class="crm-muted">{{ conversaGuardada === false ? 'Sem mensagens arquivadas deste contato. O histórico anterior não foi recuperado; confira no WhatsApp ou importe a exportação.' : conversaErro || '' }}</p>
      </template>
    </details>

    <!-- Sinais do site (17/10/2026): seção por título e linha (BP-FICHA), uma linha por sinal COM fonte;
         o que não se pôde ler não aparece. Só informa; a leitura é deste lead, ao abrir a Ficha. -->
    <details v-if="mostraSinais" class="crm-ficha__secao dobra">
      <summary id="crm-ficha-sinais">Sinais do site</summary>
      <p v-if="estadoDosSinais === 'lendo'" class="crm-muted" role="status">Lendo a página inicial do site…</p>
      <ul v-if="linhasDeSinais.length" class="crm-ficha__ofertas" aria-label="O que o site mostra">
        <li v-for="l in linhasDeSinais" :key="l.rotulo"><strong>{{ l.rotulo }}</strong><span>{{ l.motivo }}</span></li>
      </ul>
      <p v-else-if="estadoDosSinais === '' && sinaisDoLead" class="crm-muted">A página inicial não deu nada a afirmar (ela é montada no navegador).</p>
      <p v-if="estadoDosSinais === 'inacessivel'" class="crm-muted" role="status">Não consegui ler o site: fora do ar ou bloqueou a leitura.</p>
      <p v-else-if="estadoDosSinais === 'bloqueado'" class="crm-muted" role="status">A Central não lê esse endereço (rede que não é pública).</p>
      <p v-else-if="estadoDosSinais === 'falhou'" class="crm-muted" role="status">Não deu para ler o site agora.</p>
      <p v-if="podeLerSinais && estadoDosSinais !== 'lendo'" class="crm-muted">
        {{ lidoEmSinais ? `Lido ${quandoFoi(lidoEmSinais)}. ` : '' }}Só a página inicial e o mapa do site; nada é enviado a ninguém.
        <button type="button" class="crm-mais" aria-label="Atualizar os sinais do site" @click="lerSinais(true)">Atualizar</button>
      </p>
    </details>

    <!-- Desfecho (AC-08): ganhou, perdeu e proposta enviada em um toque, em todas as ofertas, com o
         estado marcado e o desfazer certo (desfechosDoLead). Sem caixa: seção com título e divisor. -->
    <details class="crm-ficha__secao crm-ficha__desfecho dobra" :open="escolhendoPerda || marcandoProposta || confirmandoGanho">
      <summary>Registrar resultado: proposta, ganho ou perda</summary>
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
        <p class="crm-nota-pequena">Confirme somente depois de enviar. Abrir o WhatsApp não conta como proposta enviada.</p>
        <label><span>Proposta enviada em</span><input ref="primeiraDaEscolha" v-model="propostaData" type="date" :max="hoje" :disabled="!disponivel"></label>
        <label><span>O que foi enviado (escopo, valor, prazo ou referência)</span><textarea v-model="propostaResumo" required maxlength="1000" rows="4" :disabled="!disponivel" /></label>
        <div class="crm-form__botoes">
          <button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'proposta' ? 'Marcando…' : 'Marcar a proposta enviada' }}</button>
          <button class="botao botao--leve" type="button" @click="marcandoProposta = false">Cancelar</button>
        </div>
      </form>
      <template v-if="origem === 'desfecho'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
      </template>
    </details>

    <CrmAprendizado :key="lead.id" :lead="lead" :disponivel="disponivel" :salvando="salvando !== null" @salvar="salvarAprendizado" />
    <template v-if="origem === 'aprendizado'">
      <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
      <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
    </template>

    <!-- Como vender (16/10/2026): oferta e roteiro numa seção com abas; o copiloto, que era a terceira,
         foi para o Assistente em 17/10/2026 (o botão logo abaixo). -->
    <details class="crm-ficha__secao dobra">
      <summary>Oferta e roteiro de venda</summary>
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
    </details>

    <details class="crm-ficha__secao dobra">
      <summary>Anotações e registros manuais</summary>
      <!-- Só a nota (AC-08): proposta, recusa e sem contato foram para o Desfecho. -->
      <form class="crm-form" @submit.prevent="salvarNota">
        <label><span>Nova nota<small v-if="lead.notas"> · {{ lead.notas }} salva{{ lead.notas === 1 ? '' : 's' }} até agora</small></span><textarea v-model="nota" rows="3" maxlength="1000" :disabled="!disponivel" placeholder="O que ele disse, o que ficou combinado…" /></label>
        <div class="crm-form__botoes"><button class="botao" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'nota' ? 'Salvando…' : 'Salvar a nota' }}</button></div>
      </form>

      <template v-if="origem === 'anotar'">
        <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
        <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>
      </template>
    </details>

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
