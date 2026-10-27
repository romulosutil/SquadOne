<script setup lang="ts">
import cenarioDoEscritorio from '../office/assets/escritorio-cozy-v1.webp?url'
/**
 * Escritório isométrico — spec §4.1 (tiles), §4.2 (movimento), §4.3 (pathfinding).
 *
 * O personagem NÃO vive no CSS Grid. Ele é position:absolute dentro de .world
 * e é movido por translate3d escrito direto no style pelo loop de useOffice.
 * A versão anterior usava `transition: grid-column-start`, que não anima —
 * teleporta (medido no navegador: getAnimations() == [] e 1 valor único em 700ms).
 *
 * Duas camadas: `.ground` leva a matriz isométrica e desenha os losangos de
 * chão; `.objects` fica sem skew e recebe paredes, props e atores já projetados,
 * ordenados por z-index = diagonal do mundo (algoritmo do pintor).
 *
 * O mapa vem do roster em ÁRVORE (§3.1): UMA SALA POR DOMÍNIO, com o PO e os
 * integrantes dele dentro. Nada aqui deriva sala de pessoa.
 *
 * Uma instância por SQUAD (um andar por vez): o Escritório monta com
 * `:key="squadAtiva.id"` (a Central, pelo andar dela), e só quando o Mapa está
 * aberto (import assíncrono; na Central, logo na primeira pintura).
 * Trocar de squad recria o componente, e com ele o `knownRooms` de useOffice —
 * sem isso as salas da outra squad seriam lidas como crescimento e animariam.
 *
 * Toque: cada personagem tem um botão de 44×44 px de TELA (dividido pela
 * escala) que abre a sala dele. O estado de cada um vai no nome acessível, em
 * texto (`estados`, só com fonte; `Sem sinal` quando não há).
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import { ESCALA_MAXIMA, escalaInteira } from '../office/vista'
import type { EstadoDaPessoa } from '../casca/hoje'
import {
  useOffice,
  type CharSheet,
  type OfficePessoa,
  type RoomPhase,
  type RoomView,
} from '../office/useOffice'
import {
  ISO_MATRIX,
  TILE,
  WALL_H,
  WALL_MATRIX_X,
  WALL_MATRIX_Y,
} from '../office/rooms'
import { PE_DO_PROP, PROP_SPRITE, VIES_Z } from '../office/pixelProps'
import type { BalaoDaSala } from '../office/baloes'
import type { SquadView } from '../types'
import { useMovimentoDoEscritorio } from '../office/movimento'
import { dominiosDoEscritorio, trabalhosPorPessoa } from '../office/projecao'
import { CENA_ILUSTRADA } from '../office/configuracao'
import type { CriarRenderizadorDoEscritorio } from '../office/renderizador'
import { criarCoreografia, type TransporteVisual } from '../office/coreografia'
import EsteiraNoEscritorio from '../office/EsteiraNoEscritorio.vue'
import type { EstacaoDaProducao, PassagemDaProducao } from '../office/linha-de-producao'
import type { FaseDoEscritorio } from '../office/jornada-do-escritorio'
import { pontosDasEstacoes, pontoDaEsteiraNoMundo } from '../office/caminhos-da-cena'

const props = defineProps<{
  agent?: string
  squad?: SquadView | null
  /** Estado de cada pessoa, em texto. Quem não está aqui é `Sem sinal`. */
  estados?: Record<string, { estado: EstadoDaPessoa; texto: string }>
  /** Uma frase sobre o andar agora ("Pedido em andamento", "Último pedido: Ana"). */
  status?: string
  /**
   * Pessoa → balão sempre visível, já com a fonte resolvida por quem monta (office/baloes.ts:
   * a sala no PO dela, a agenda de cada um, o PO raiz em visita). Desde 17/10/2026 é genérico: a Sala
   * Finanças, os robôs e os leads do PRUMO e a agenda falam pelo mesmo balão. Dado da tela, não do roster.
   */
  baloes?: Record<string, BalaoDaSala>
  /**
   * A sala (id do domínio) que o PO raiz visita por um problema real (destinoDoSupervisor). Vence o
   * `agent`; null volta para a mesa. É o único movimento que diz algo: o passeio é decoração.
   */
  visita?: string | null
  /** Na Central: altura fixa e a barra do mapa enxuta, o mapa é uma parte da tela, não a tela. */
  compacto?: boolean
  salaSelecionada?: string | null
  imersivo?: boolean
  painelAgentes?: { resumo: string; detalhe: string }
  painelDecisoes?: { resumo: string; detalhe: string }
  estacoesProducao?: readonly EstacaoDaProducao[]
  estacaoSelecionada?: FaseDoEscritorio | null
  producaoDisponivel?: boolean
  passagem?: PassagemDaProducao | null
  /** Porta usada pelo laboratório; a aplicação usa DOM por padrão. */
  criarRenderizador?: CriarRenderizadorDoEscritorio
}>()

const emit = defineEmits<{ abrirSala: [dominioId: string]; abrirAgente: [salaId: string, pessoaId: string]; painel: [tipo: 'agentes' | 'decisoes']; estacao:[fase:FaseDoEscritorio]; etapa:[fase:FaseDoEscritorio]; cliente:[id:string]; passagemFinalizada:[id:string]; transporte:[texto:string] }>()

const estadoDoAtor = computed<Record<string, BalaoDaSala>>(() => props.baloes ?? {})
const imagemDaCenaDisponivel = ref(true)
const cenarioIlustrado = computed(() => imagemDaCenaDisponivel.value && dominios.value.length <= CENA_ILUSTRADA.maximoDeSalas)

const manifest = shallowRef<Record<string, CharSheet> | null>(null)
const dominios = computed(() => dominiosDoEscritorio(props.squad, !!props.imersivo, manifest.value))

const { preferencia: preferenciaDeMovimento, animar } = useMovimentoDoEscritorio()
const { setViewportEl, setWorldEl, scale, sheets, erroSprites, carregarSprites, pessoas, rooms, bounds, setActorEl, moveTo, percorrer, postoDaPessoa, cancelarPercurso, olharParaPonto, seguirPercurso, focus, pausado } =
  useOffice(dominios, preferenciaDeMovimento, computed(() => props.imersivo ? 180 : 0), computed(() => !props.estacoesProducao), props.criarRenderizador)

const caixa = ref({ w: 0, h: 0 })
const mapaEl = ref<HTMLElement | null>(null)
const pontosDaProducao = computed(() => pontosDasEstacoes(cenarioIlustrado.value, dominios.value, postoDaPessoa))
const transporte = ref<TransporteVisual | null>(null)
const coreografia = criarCoreografia({
  squad: () => props.squad, pessoas: () => pessoas.value, pontos: () => pontosDaProducao.value,
  postoDaPessoa, percorrer, cancelarPercurso, seguirPercurso,
  acompanhar: () => !!mapaEl.value && (mapaEl.value.clientWidth < 768 || scale.value * (bounds.value.maxY - bounds.value.minY) > caixa.value.h),
  estado: valor => { transporte.value = valor }, texto: valor => emit('transporte', valor),
  terminou: id => { emit('passagemFinalizada', id); void focarEstacaoDaEsteira() },
})
watch([() => props.passagem, animar], ([passagem, permitido]) => coreografia.iniciar(passagem ?? null, permitido), { flush: 'post', immediate: true })
onBeforeUnmount(() => coreografia.destruir())
function clicarPessoa(p: OfficePessoa) {
  if (transporte.value?.pessoaId === p.id && transporte.value.etapa === 'levar') { emit('cliente',transporte.value.passagem.leadId); return }
  const sala = salaDe.value.get(p.id)
  if (sala) { emit('abrirSala',sala.id); emit('abrirAgente',sala.id,p.id) }
}

/** Sala de cada pessoa: o toque no personagem abre a sala, não a pessoa. */
const salaDe = computed(() => {
  const mapa = new Map<string, { id: string; nome: string }>()
  for (const d of dominios.value) for (const p of d.pessoas) mapa.set(p.id, { id: d.id, nome: d.nome })
  return mapa
})
const slotSelecionado = computed(() => dominios.value.find(d => d.id === props.salaSelecionada)?.slot)
const salaSelecionadaNoMapa = (slot: [number, number]) => slotSelecionado.value?.[0] === slot[0] && slotSelecionado.value?.[1] === slot[1]

const trabalhosDosAtores = computed(() => trabalhosPorPessoa(pessoas.value, props.estacoesProducao, !!props.producaoDisponivel))
function proximoDoAtor(p: OfficePessoa) { return trabalhosDosAtores.value.get(p.id) }
const rotuloDoAtor = (p: OfficePessoa) => {
  if(transporte.value?.pessoaId === p.id) return `${p.nome}: exibição da passagem já registrada de ${transporte.value.passagem.empresa}. ${transporte.value.passagem.motivo}.`
  const sala = salaDe.value.get(p.id)
  const trabalho = proximoDoAtor(p)
  const estado = trabalho ? `Próximo: ${trabalho.acao}. Cliente: ${trabalho.empresa}.` : props.estados?.[p.id]?.texto ?? (props.estacoesProducao ? 'Sem tarefa atribuída nesta leitura' : 'Sem sinal')
  // O balão também é lido: quem usa leitor de tela não vê o texto em cima do boneco.
  const balao = estadoDoAtor.value[p.id]?.texto
  return `${p.nome}, ${p.papel}${sala ? `, sala ${sala.nome}` : ''}. ${balao ? `${balao}. ` : ''}${estado}. ${sala?.id.startsWith('prumo--') ? 'Conversar com o agente.' : 'Abrir a sala.'}`
}

// ---------------------------------------------------------------- escala

/** Tamanho do viewport em px de tela, medido por ResizeObserver. */
async function focarEstacaoDaEsteira() {
  await nextTick()
  const fase=props.estacaoSelecionada
  const mapa=mapaEl.value
  if(mapa && fase && (mapa.clientWidth < 768 || scale.value*(bounds.value.maxY-bounds.value.minY)>caixa.value.h-24)) {
    if(transporte.value?.passagem.para === fase) return
    olharParaPonto(pontoDaEsteiraNoMundo(fase,pontosDaProducao.value))
  }
  const mesa=mapa?.querySelector<HTMLElement>(`[data-fase="${fase}"]`)
  if(mapa && mesa && mapa.scrollWidth > mapa.clientWidth) { const alvo=mesa.getBoundingClientRect(), vista=mapa.getBoundingClientRect(); mapa.scrollTo({left:mapa.scrollLeft + alvo.left + alvo.width/2 - vista.left - vista.width/2,behavior:'auto'}) }
}
watch(() => props.estacaoSelecionada, focarEstacaoDaEsteira)
let roCaixa: ResizeObserver | null = null
function ligarViewport(el: unknown) {
  setViewportEl(el)
  roCaixa?.disconnect()
  roCaixa = null
  const no = el as HTMLElement | null
  if (!no || typeof ResizeObserver === 'undefined') return
  roCaixa = new ResizeObserver(() => {
    caixa.value = { w: no.clientWidth, h: no.clientHeight }
    // No celular o cenário mantém os personagens legíveis; o gesto lateral explora a sala.
    if (props.imersivo && mapaEl.value) mapaEl.value.scrollLeft = (mapaEl.value.scrollWidth - mapaEl.value.clientWidth) / 2
    if(props.estacaoSelecionada) requestAnimationFrame(() => void focarEstacaoDaEsteira())
  })
  roCaixa.observe(no)
}
onBeforeUnmount(() => roCaixa?.disconnect())

/** null = encaixe automático (a maior escala inteira em que o andar cabe). */
const zoom = ref<number | null>(null)
const encaixe = computed(() =>
  props.imersivo
    ? Math.max(props.estacoesProducao || caixa.value.w <= 720 ? .72 : .1, Math.min(2, (caixa.value.w - 24) / (bounds.value.maxX - bounds.value.minX), (caixa.value.h - 24) / (bounds.value.maxY - bounds.value.minY)))
    : escalaInteira(caixa.value, { w: bounds.value.maxX - bounds.value.minX, h: bounds.value.maxY - bounds.value.minY })
)
watchEffect(() => {
  scale.value = zoom.value ?? encaixe.value
})
const aproximar = () => { zoom.value = Math.min(ESCALA_MAXIMA, scale.value + 1) }
const afastar = () => { zoom.value = Math.max(1, scale.value - 1) }
const encaixar = () => { zoom.value = null }

// Só aqui `sheets` existe: liga o espelho. Imediato para nascer em sincronia.
watch(sheets, (chars) => (manifest.value = chars), { immediate: true })

/** Tile livre no miolo de todas as salas — onde o PO raiz para ao visitar. */
const VISIT_TILE: [number, number] = [4, 3]

/** O PO raiz é o dono do primeiro domínio: é ele quem circula pelo escritório. */
const poRaiz = computed(() => props.squad?.dominios[0]?.po.id ?? null)

/**
 * `agent` é o id de uma PESSOA (responsavel_id do turno). Quem anda é o PO
 * raiz, até a SALA DO DOMÍNIO dessa pessoa — visitar alguém é ir ao domínio
 * dele, não a uma coordenada pessoal. `visita` (a Central, 17/10/2026) é uma
 * sala por id, com um problema real nela, e vence o `agent`.
 */
const salaVisitada = computed<string | null>(() => {
  if (props.visita && dominios.value.some((d) => d.id === props.visita)) return props.visita
  return dominios.value.find((d) => d.pessoas.some((p) => p.id === props.agent))?.id ?? null
})

/**
 * Só a troca da SALA VISITADA move o PO raiz. O roster também entra no watch
 * porque o primeiro carregamento precisa posicionar a câmera — mas uma
 * contratação (§4.4) não pode puxar a câmera de volta para a sala do PO no
 * meio da animação de entrada do recém-chegado.
 */
watch(
  [salaVisitada, () => dominios.value.length > 0],
  ([sala, temSalas], anterior) => {
    const [salaAntes, tinhaSalas] = anterior ?? [undefined, false]
    const raiz = poRaiz.value
    if (!raiz || !temSalas) return
    const rosterChegou = !tinhaSalas
    if (!rosterChegou && sala === salaAntes) return
    const destino = dominios.value.find((d) => d.id === sala)
    if (destino && destino.id !== dominios.value[0].id) moveTo(raiz, destino.slot, VISIT_TILE)
    else moveTo(raiz, dominios.value[0].slot) // Idle ou próprio domínio: volta pra mesa
  },
  { immediate: true }
)

// A escolha do usuário conserva a câmera, inclusive quando o supervisor visita outra sala.
function focarSalaSelecionada() {
  const po = props.squad?.dominios.find(d => d.id === props.salaSelecionada)?.po.id
  if (po) focus(po)
}
watch([() => props.salaSelecionada, salaVisitada], focarSalaSelecionada, { flush: 'post' })
onMounted(focarSalaSelecionada)

const worldBox = computed(() => ({
  width: bounds.value.maxX - bounds.value.minX + 'px',
  height: bounds.value.maxY - bounds.value.minY + 'px',
  // O botão de toque divide por isto para ter 44 px na TELA em qualquer escala.
  '--escala': String(scale.value),
  '--profundidade-cena': `${-bounds.value.minX}px`,
}))
const paredeNorte = computed(() => ({ width: bounds.value.maxX + 'px', transform: WALL_MATRIX_X }))
const paredeOeste = computed(() => ({ width: -bounds.value.minX + 'px', transform: WALL_MATRIX_Y }))

// O escritório aberto reaproveita os postos e os caminhos do mapa, mas não a
// mobília duplicada das antigas salas: uma mesa por posto, apoio compartilhado.
function mobiliaDaCena(room: RoomView) {
  if (!props.imersivo) return room.props
  if (cenarioIlustrado.value) return []
  const indice = rooms.value.findIndex(r => r.key === room.key)
  let mesas = 0
  return room.props.filter(p => {
    if (p.kind === 'desk') return ++mesas === 1
    if (p.kind === 'chair') return false
    if (p.kind === 'shelf') return indice === 1 || indice === 4
    if (p.kind === 'plant') return indice === 0 || indice === 3 || indice === 5
    return p.kind !== 'glass'
  })
}
const plataforma = computed(() => {
  const w = bounds.value.maxX
  const h = -bounds.value.minX
  const centro = `${w - h},${(w + h) / 2}`
  const baixo = `${w - h},${(w + h) / 2 + 12}`
  return {
    esquerda: `${-h},${h / 2} ${centro} ${baixo} ${-h},${h / 2 + 12}`,
    direita: `${centro} ${w},${w / 2} ${w},${w / 2 + 12} ${baixo}`,
  }
})

function sheetOf(p: OfficePessoa) {
  return sheets.value?.[p.sprite] ?? null
}

/** Strip horizontal: uma linha, N frames de frameW. */
function stripStyle(p: OfficePessoa, anim: 'idle' | 'walk') {
  const sheet = sheetOf(p)
  const a = sheet?.anims?.[anim]
  if (!sheet || !a) return {}
  const base: Record<string, string> = {
    backgroundImage: `url(${a.file})`,
    backgroundSize: `${a.frames * sheet.frameW}px ${sheet.frameH}px`,
    width: `${sheet.frameW}px`,
    height: `${sheet.frameH}px`,
  }
  if (anim === 'idle') {
    // Ciclo parado em CSS puro: nenhum frame de rAF é gasto com quem não anda.
    base['--strip-end'] = `${-a.frames * sheet.frameW}px`
    base.animation = `strip 1.4s steps(${a.frames}) infinite`
  }
  return base
}

/**
 * Crescimento do escritório (§4.4). 'pending' = o slot já conta para o mapa
 * (a câmera precisa poder enquadrá-lo) mas nada aparece; 'building' toca
 * `room-build`. Sem fase, a sala é só uma sala. 'closing' toca room-build ao
 * contrário: a sala de um domínio arquivado some no lugar em que estava.
 */
function faseClasse(room: { phase: RoomPhase }) {
  return {
    'room--pending': room.phase === 'pending',
    'room--new': room.phase === 'building',
    'room--closing': room.phase === 'closing',
  }
}

function actorStyle(p: OfficePessoa) {
  const sheet = sheetOf(p)
  return {
    width: `${sheet ? sheet.frameW : TILE}px`,
    height: `${sheet ? sheet.frameH : TILE}px`,
    filter: p.hue ? `hue-rotate(${p.hue}deg)` : undefined,
  }
}
</script>

<template>
  <section ref="mapaEl" class="mapa" :class="{ 'mapa--compacto': compacto, 'mapa--imersivo': imersivo, 'mapa--ilustrado': imersivo && cenarioIlustrado }" :aria-label="`Escritório de agentes de ${squad?.nome ?? 'squad'}`">
    <p v-if="erroSprites" class="recado recado--erro" role="alert">{{ erroSprites }} <button type="button" class="botao botao--leve" @click="carregarSprites">Tentar carregar sprites</button></p>
    <div v-if="!imersivo" class="mapa__barra">
      <p class="mapa__status" role="status">{{ status || 'Aguardando pedidos' }}<template v-if="pausado"> · animação pausada (mapa fora de vista)</template></p>

    </div>

    <!-- Viewport: recorta o mundo. A câmera é o transform de .world. -->
    <div :ref="ligarViewport" class="office-viewport" :data-movimento="preferenciaDeMovimento" :class="{ 'office--pausado': pausado }">
      <!-- SCALE aparece em UM lugar: este transform (escrito por useOffice). -->
      <div :ref="setWorldEl" class="office-world" :style="worldBox">
        <template v-if="imersivo">
          <img v-if="cenarioIlustrado" class="cena-ilustrada" :src="cenarioDoEscritorio" :width="CENA_ILUSTRADA.nativa.largura" :height="CENA_ILUSTRADA.nativa.altura" :style="{ left: CENA_ILUSTRADA.esquerda + 'px', top: CENA_ILUSTRADA.topo + 'px', width: CENA_ILUSTRADA.largura + 'px', height: CENA_ILUSTRADA.altura + 'px' }" alt="" aria-hidden="true" draggable="false" @error="imagemDaCenaDisponivel = false"/>
          <svg v-else class="cena-plataforma" width="1" height="1" aria-hidden="true"><polygon :points="plataforma.esquerda" fill="#5d5146"/><polygon :points="plataforma.direita" fill="#403f3c"/></svg>
          <EsteiraNoEscritorio v-if="estacoesProducao" :pontos="pontosDaProducao" :estacoes="estacoesProducao" :selecionada="estacaoSelecionada" :disponivel="!!producaoDisponivel" @selecionar="emit('estacao',$event)" @cliente="emit('cliente',$event)" @etapa="emit('etapa',$event)" />
          <div class="cena-parede cena-parede--oeste" :style="paredeOeste">
            <button class="cena-tela cena-tela--agentes" type="button" aria-label="Abrir jornada do time e clientes" @click="emit('painel', 'agentes')">
              <span class="cena-tela__luz" aria-hidden="true"></span><strong>Jornada do time</strong>
              <span class="cena-tela__numero">{{ painelAgentes?.resumo ?? 'Lendo o time…' }}</span>
              <span class="cena-tela__detalhe">{{ painelAgentes?.detalhe ?? 'Acompanhe o trabalho' }}</span>
              <span class="cena-tela__abrir">Ver jornada →</span>
            </button>
          </div>
          <div class="cena-parede cena-parede--norte" :style="paredeNorte">
            <span v-if="!cenarioIlustrado" class="cena-marca" aria-hidden="true">SQUAD ONE <small>ESTÚDIO DE OPERAÇÕES</small></span>
            <div v-if="!cenarioIlustrado" class="cena-janela" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            <button class="cena-tela cena-tela--decisoes" type="button" aria-label="Abrir minha vez na jornada" @click="emit('painel', 'decisoes')">
              <span class="cena-tela__luz" aria-hidden="true"></span><strong>Sua vez</strong>
              <span class="cena-tela__numero">{{ painelDecisoes?.resumo ?? 'Lendo as conversas…' }}</span>
              <span class="cena-tela__detalhe">{{ painelDecisoes?.detalhe ?? 'O que depende de você' }}</span>
              <span class="cena-tela__abrir">Continuar jornada →</span>
            </button>
          </div>
        </template>
        <!-- Chão: retângulos em coordenadas de mundo, projetados pela matriz. -->
        <div class="ground" :style="{ transform: ISO_MATRIX }">
          <div v-if="imersivo && !cenarioIlustrado" class="floor cena-chao" :style="{ width: bounds.maxX + 'px', height: -bounds.minX + 'px' }"></div>
          <template v-if="imersivo && !cenarioIlustrado">
            <div class="cena-luz" aria-hidden="true"></div>
            <div class="cena-tapete cena-tapete--criacao" aria-hidden="true"></div>
            <div class="cena-tapete cena-tapete--operacoes" aria-hidden="true"></div>
            <div class="cena-tapete cena-tapete--encontro" aria-hidden="true"></div>
          </template>
          <div
            v-for="room in (imersivo ? [] : rooms)"
            :key="room.key + '-base'"
            class="base"
            :class="faseClasse(room)"
            :style="{
              left: room.base.left + 'px',
              top: room.base.top + 'px',
              width: room.base.width + 'px',
              height: room.base.height + 'px',
            }"
          ></div>
          <!-- `data-tapete` só varia a cor do tapete entre salas vizinhas; sai do
               slot, então a mesma sala tem sempre o mesmo tapete. -->
          <div
            v-for="room in (imersivo ? [] : rooms)"
            :key="room.key + '-floor'"
            class="floor"
            :class="faseClasse(room)"
            :data-tapete="(room.slot[0] + 2 * room.slot[1]) % 3"
            :style="{
              left: room.floor.left + 'px',
              top: room.floor.top + 'px',
              width: room.floor.width + 'px',
              height: room.floor.height + 'px',
            }"
          ></div>
        </div>

        <!-- Objetos: já projetados, ordenados por diagonal do mundo. -->
        <div class="objects">
          <!-- Um wrapper por sala para que paredes, props e placa materializem
               JUNTOS com o chão. O wrapper é estático e sem filtro fora da
               animação: não cria contexto de empilhamento e o z-index de cada
               objeto continua valendo contra `.objects` (painter's algorithm). -->
          <div v-for="room in rooms" :key="room.key" class="room-objects" :class="faseClasse(room)">
            <!-- Paredes de trás, um tile por div: o vão da porta é o tile ausente. -->
            <div
              v-for="w in (imersivo ? [] : room.walls)"
              :key="w.key"
              class="wall"
              :class="`wall--${w.axis}`"
              :style="{
                left: w.left + 'px',
                top: w.top + 'px',
                width: w.len + 'px',
                height: WALL_H + 'px',
                zIndex: w.z,
                transform: w.axis === 'x' ? WALL_MATRIX_X : WALL_MATRIX_Y,
              }"
            ></div>

            <div
              v-for="(p, i) in mobiliaDaCena(room)"
              :key="room.key + '-p' + i"
              class="prop"
              :style="{
                left: p.left + 'px',
                top: p.top + 'px',
                width: p.width + 'px',
                height: p.height + 'px',
                zIndex: p.z + (VIES_Z[p.kind] ?? 0),
              }"
            >
              <img
                class="prop__sprite"
                :src="PROP_SPRITE[p.kind]"
                :width="p.width"
                :height="p.height + PE_DO_PROP"
                alt=""
                draggable="false"
              />
            </div>

            <!-- A placa é do DOMÍNIO: a sala inteira pertence a ele. -->
            <span
              v-if="!imersivo"
              class="room__label"
              :data-selecionada="salaSelecionadaNoMapa(room.slot) || undefined"
              :style="{ left: room.label.left + 'px', top: room.label.top + 'px' }"
              >{{ room.label.text }}</span
            >
          </div>

          <!-- Cantinho de encontro: desenho vetorial em pixels, na mesma
               projeção 2:1 das mesas; deixa as rotas dos postos livres. -->
          <svg v-if="imersivo && !cenarioIlustrado" class="cena-encontro" :style="{ left: `${130 + bounds.minX}px`, top: `${-bounds.minX / 2 - 24}px`, zIndex: 148 - bounds.minX }" width="168" height="112" viewBox="0 0 168 112" aria-hidden="true" shape-rendering="crispEdges">
            <g stroke="#222b30" stroke-width="2" stroke-linejoin="miter">
              <path d="M12 54 40 40 76 58 48 72Z" fill="#6d8e85"/><path d="M12 54 48 72 48 90 12 72Z" fill="#48675f"/><path d="M48 72 76 58 76 76 48 90Z" fill="#38574f"/>
              <path d="M98 30 126 16 160 33 132 47Z" fill="#6d8e85"/><path d="M98 30 132 47 132 65 98 48Z" fill="#48675f"/><path d="M132 47 160 33 160 51 132 65Z" fill="#38574f"/>
              <path d="M66 52 104 33 130 46 92 65Z" fill="#c89866"/><path d="M66 52 92 65 92 71 66 58Z" fill="#a77950"/><path d="M92 65 130 46 130 52 92 71Z" fill="#7b573e"/>
              <path d="M74 60V80M120 55V73" fill="none" stroke-width="4"/>
              <path d="M87 47 101 40 113 46 99 53Z" fill="#f1e6cb"/><path d="m92 46 8-4m-5 6 8-4" stroke="#8f9c9a" stroke-width="1"/>
              <path d="M114 37v7l6 3 5-3v-7" fill="#ede1c3"/><path d="m114 37 6-3 5 3-5 3Z" fill="#705847"/>
            </g>
          </svg>

          <!-- Atores: billboards, movidos por translate3d direto no style.
               Nada de :class aqui: useOffice escreve `actor--walk`/`actor--focus`
               por classList e o patch de class do Vue apagaria as duas. O estado
               que vem do componente entra por data-attribute. -->
          <div
            v-for="p in pessoas"
            :key="p.id"
            :ref="(el) => setActorEl(p.id, el)"
            class="actor"
            :data-ativo="p.id === props.agent ? 'true' : undefined"
            :style="actorStyle(p)"
          >
            <div class="actor__shadow"></div>
            <!-- Área de toque do corpo: o ator inteiro tem a caixa do frame, com
                 muito vazio transparente em volta, e segue sem eventos. O botão
                 tem 44×44 px de tela e abre a sala de quem foi tocado. -->
            <button
              type="button"
              class="actor__hit"
              :aria-label="rotuloDoAtor(p)"
              :aria-pressed="salaSelecionada ? salaDe.get(p.id)?.id === salaSelecionada : undefined"
              @click="clicarPessoa(p)"
            ></button>
            <div data-billboard class="actor__billboard">
              <template v-if="sheetOf(p)">
                <div class="actor__strip actor__strip--idle" :style="stripStyle(p, 'idle')"></div>
                <div data-walk class="actor__strip actor__strip--walk" :style="stripStyle(p, 'walk')"></div>
              </template>
              <div v-else class="actor__sem-sprite" aria-hidden="true"></div>
            </div>
            <span class="actor__name" aria-hidden="true">{{ imersivo ? p.nome : `${p.nome} · ${p.papel}` }}</span>
            <span v-if="transporte?.pessoaId === p.id" class="actor__intencao" :data-carregando="transporte.etapa === 'levar' || undefined" aria-hidden="true"><i v-if="transporte.etapa === 'levar'" class="actor__documento"></i>{{ transporte.etapa === 'voltar' ? 'Passagem registrada ✓' : `Registro: ${transporte.passagem.motivo}` }}</span>
            <span v-else-if="proximoDoAtor(p)" class="actor__intencao actor__intencao--fila" aria-hidden="true">Próximo: {{ proximoDoAtor(p)!.acao }}</span>
            <span
              v-if="estadoDoAtor[p.id] && (!salaSelecionada || salaDe.get(p.id)?.id === salaSelecionada || estadoDoAtor[p.id].destaque)"
              class="actor__estado"
              aria-hidden="true"
              :data-tom="estadoDoAtor[p.id].tom"
              :data-destaque="estadoDoAtor[p.id].destaque ? 'true' : undefined"
              >{{ estadoDoAtor[p.id].texto }}</span
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.actor__intencao { position:absolute;z-index:2;left:50%;bottom:100%;transform:translateX(-50%);max-width:calc(170px / var(--escala,1));white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:calc(4px / var(--escala,1)) calc(7px / var(--escala,1));background:#233c3d;color:#fff0ca;border:1px solid #d3b775;border-radius:4px;font:700 calc(12px / var(--escala,1))/1.3 var(--fonte);pointer-events:none; }
.actor__intencao[data-carregando] { background:#f2cf7a;color:#273329; }
.actor__documento { display:inline-block;width:calc(10px / var(--escala,1));height:calc(12px / var(--escala,1));margin-right:calc(5px / var(--escala,1));background:#fff8db;border:1px solid #736b50;vertical-align:middle; }
.mapa--imersivo { height: 100%; border: 0 !important; box-shadow: none !important; background: #20283a; }
.mapa--imersivo .office-viewport { height: 100%; min-height: 0; flex: 1; background: radial-gradient(ellipse at 50% 55%, #34414b, #1b2730 78%); }
@media(max-width:47.99rem) {
  .mapa--imersivo { display: block; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; overscroll-behavior-x: contain; }
  .mapa--imersivo .office-viewport { width: max(100%, 42rem); }
}
.mapa--imersivo .floor { box-shadow: none; }
.mapa--imersivo .cena-chao { background-color: #c1a27c; background-image: repeating-linear-gradient(0deg, #6e5e491c 0 1px, transparent 1px 24px), repeating-linear-gradient(90deg, transparent 0 79px, #6e5e4926 79px 80px), repeating-linear-gradient(0deg, #e5d3a833 0 24px, transparent 24px 48px); background-size: 100% 100%, 160px 48px, 100% 100%; border: 3px solid #534e43; }
.cena-chao::after { display: none; }
.cena-plataforma { position: absolute; left: 0; top: 0; overflow: visible; z-index: -2; }
.cena-luz { position: absolute; left: 28px; top: 4px; width: 200px; height: 174px; clip-path: polygon(0 0, 66% 0, 100% 100%, 30% 100%); background: linear-gradient(#fff1bd38, #fff1bd00); pointer-events: none; }
.mapa--imersivo .actor__estado { display: none; }
.mapa--imersivo .actor__estado[data-destaque] { display: block; top: -28px; font-size: 9px; padding: 4px 7px; color: #392c1b; background: #f8d27d; border: 2px solid #473a2d; box-shadow: 2px 2px #192b33; animation: none; }
.mapa--imersivo .actor__name { visibility: visible; top: -5px; font-size: 9px; padding: 3px 6px; background: #f1e7ca; color: #263839; border: 1px solid #263839; box-shadow: 2px 2px #14232b66; }
.mapa--imersivo .prop__sprite { filter: saturate(.73); }
.cena-tapete { position: absolute; pointer-events: none; border: 3px solid #536861; background: repeating-linear-gradient(90deg, #d8e1c514 0 2px, transparent 2px 7px), #6b8273; box-shadow: inset 0 0 0 3px #a4ad8e, inset 0 0 0 6px #536861; clip-path: polygon(8px 0, calc(100% - 8px) 0, calc(100% - 8px) 4px, 100% 4px, 100% calc(100% - 8px), calc(100% - 4px) calc(100% - 8px), calc(100% - 4px) 100%, 8px 100%, 8px calc(100% - 4px), 0 calc(100% - 4px), 0 8px, 8px 8px); }
.cena-tapete--criacao { left: 28px; top: 36px; width: 368px; height: 108px; }
.cena-tapete--operacoes { left: 236px; top: 206px; width: 182px; height: calc(var(--profundidade-cena) - 252px); background-color: #a9765f; border-color: #7e5649; box-shadow: inset 0 0 0 3px #c49e7b, inset 0 0 0 6px #7e5649; }
.cena-tapete--encontro { left: 64px; top: calc(var(--profundidade-cena) - 122px); width: 148px; height: 106px; background-color: #c6b98d; border-color: #9c8d69; box-shadow: inset 0 0 0 3px #dfd1aa, inset 0 0 0 6px #9c8d69; }
.cena-encontro { position: absolute; pointer-events: none; }
.cena-parede { position: absolute; left: 0; top: -174px; height: 174px; transform-origin: 0 0; border: 3px solid #26383b; border-bottom: 8px solid #26383b; background: linear-gradient(0deg, #3d5859 0 20px, #678079 20px 23px, transparent 23px), repeating-linear-gradient(90deg, transparent 0 79px, #253a3e26 79px 81px), #91a396; box-shadow: inset 0 5px #b9c1a7, inset 0 -4px #30484b; }
.cena-parede--oeste { background: linear-gradient(0deg, #344c50 0 20px, #536e6b 20px 23px, transparent 23px), repeating-linear-gradient(90deg, transparent 0 79px, #233b4126 79px 81px), #738f87; z-index: -1; }
.cena-parede--norte { z-index: 0; }
.cena-marca { position: absolute; top: 24px; left: 26px; color: #293f42; font: 900 17px monospace; letter-spacing: 3px; }
.cena-marca small { display: block; margin-top: 4px; font-size: 6px; letter-spacing: 1.5px; }
.cena-janela { position: absolute; left: 28px; top: 76px; width: 136px; height: 67px; display: grid; grid-template-columns: 1fr 1fr; gap: 4px; padding: 4px; border: 4px solid #324e52; background: #516d6d; box-shadow: 4px 4px #55716a, inset 0 0 0 2px #c4cab0; }
.cena-janela i { background: linear-gradient(140deg, #cbd9c0 0 40%, #dce2cb 40% 46%, #b4cbbd 46% 70%, #9bbba9 70%); }
.cena-tela { position: absolute; top: 20px; display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 5px; width: 288px; height: 124px; padding: 10px 12px; border: 4px solid #263b3d; outline: 2px solid #c4c6a9; background: #203b40; box-shadow: 5px 5px #415e58, inset 0 0 0 2px #4c716e; color: #edf2dc; text-align: left; font: 10px/1.3 var(--fonte); cursor: pointer; }
.cena-tela--agentes { left: calc(100% - 28px); transform: scaleX(-1); transform-origin: 0 0; --tela-cor: #9bdbbc; }
.cena-tela--decisoes { left: 184px; width: 266px; --tela-cor: #f2d386; }
.cena-tela:hover, .cena-tela:focus-visible { outline: 4px solid var(--tela-cor); background: #1b3b49; }
.cena-tela strong { font-size: 14px; font-weight: 850; color: var(--tela-cor); }
.cena-tela__numero { font-size: 16px; line-height: 1.2; font-weight: 800; }
.cena-tela__detalhe { overflow: hidden; color: #c9d9cd; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.cena-tela__abrir { font-size: 8px; text-transform: uppercase; letter-spacing: 1px; color: var(--tela-cor); }
.cena-tela__luz { position: absolute; width: 6px; height: 6px; right: 7px; top: 7px; background: var(--tela-cor); box-shadow: 0 0 8px var(--tela-cor); }
.cena-ilustrada { position: absolute; max-width: none; z-index: -1; pointer-events: none; image-rendering: pixelated; user-select: none; }
.mapa--ilustrado .cena-parede { background: transparent; border: 0; box-shadow: none; z-index: 0; }
.mapa--ilustrado .cena-tela { height: 110px; grid-template-rows: auto auto minmax(0, 1fr); gap: 4px; border: 0; outline: 0; box-shadow: none; background: transparent; padding: 10px 11px; }
.mapa--ilustrado .cena-tela:hover, .mapa--ilustrado .cena-tela:focus-visible { outline: 2px solid var(--tela-cor); background: #ffffff08; }
.mapa--ilustrado .cena-tela--agentes { left: 441px; width: 255px; top: 19px; }
.mapa--ilustrado .cena-tela--decisoes { left: 193px; width: 236px; top: 34px; }
.mapa--ilustrado .cena-tela strong { font-size: 12px; line-height: 1.15; }
.mapa--ilustrado .cena-tela__numero { font-size: 14px; line-height: 1.15; }
.mapa--ilustrado .cena-tela__detalhe { font-size: 9px; line-height: 1.15; max-height: 2.3em; }
.mapa--ilustrado .cena-tela__abrir { display: none; }
.mapa--ilustrado .cena-tela__luz { right: 6px; top: 7px; width: 4px; height: 4px; }
@media (max-width: 47.99rem) { .mapa--imersivo .cena-tela__detalhe, .mapa--imersivo .cena-tela__abrir { display: none; } .mapa--imersivo .cena-tela { grid-template-rows: 1fr 1fr; gap: 6px; } .mapa--imersivo .cena-tela strong { font-size: 23px; } .mapa--imersivo .cena-tela__numero { font-size: 20px; line-height: 1.05; } }
.room__label[data-selecionada] { background: var(--destaque); color: var(--destaque-texto); }
.mapa {
  display: flex;
  min-width: 0;
  flex-direction: column;
  border: var(--linha);
  background: #8cb07a;
  box-shadow: var(--sombra);
}
.mapa__barra {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--esp-2);
  padding: var(--esp-2) var(--esp-3);
  border-bottom: var(--linha);
  background: var(--superficie);
  color: var(--texto);
}
.mapa__status { margin: 0; font-weight: var(--peso-forte); overflow-wrap: anywhere; }
.mapa__zoom { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); }
.mapa__escala { font-size: 0.8rem; font-weight: var(--peso-medio); font-variant-numeric: tabular-nums; }

.office-viewport {
  position: relative;
  height: min(62dvh, 40rem);
  min-height: 18rem;
  overflow: hidden;
  background: #20283a;
}

/* Fora da tela ou com a aba no fundo: nem os ciclos parados em CSS gastam. */
/* !important: o ciclo idle vem no style inline, e o shorthand dele diz `running`. */
.office--pausado .actor__strip {
  animation-play-state: paused !important;
}

@media (prefers-reduced-motion: reduce) {
  .office-viewport:not([data-movimento="true"]) .actor__strip--idle {
    animation: none !important;
  }
}
.office-viewport[data-movimento="false"] .actor__strip { animation-play-state: paused !important; }

.office-world {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.ground,
.objects {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
}

.base {
  position: absolute;
  background-color: #2a3448;
}

/*
 * Chão em coordenadas de MUNDO: tudo aqui é retângulo e a matriz da `.ground`
 * transforma em losango. Por isso o xadrez é um conic-gradient de 64px (2
 * tiles) e a sombra de canto é um degrau reto — projetados, viram ladrilho
 * isométrico e rodapé sem nenhuma conta de ângulo.
 */
.floor {
  position: absolute;
  background-color: #eadfc8;
  background-image:
    /* sombra dura junto das paredes de trás (norte e oeste) */
    linear-gradient(to bottom, rgba(20, 22, 31, 0.22) 5px, transparent 5px),
    linear-gradient(to right, rgba(20, 22, 31, 0.16) 5px, transparent 5px),
    /* rejunte */
    linear-gradient(to right, rgba(0, 0, 0, 0.1) 2px, transparent 2px),
    linear-gradient(to bottom, rgba(0, 0, 0, 0.1) 2px, transparent 2px),
    /* xadrez de 2 tons */
    conic-gradient(#dccdaf 25%, transparent 0 50%, #dccdaf 0 75%, transparent 0);
  background-size: 100% 100%, 100% 100%, 32px 32px, 32px 32px, 64px 64px;
  box-shadow: inset 0 0 0 2px #000;
}

/* Tapete no miolo (x 2..5, y 2..3): é chão, não prop — fica sempre sob os
   atores e não entra no pintor. Some e aparece junto com o chão na obra. */
.floor::after {
  content: '';
  position: absolute;
  inset: 32px;
  background-color: var(--tapete, #e58a6e);
  background-image: repeating-linear-gradient(
    to right,
    transparent 0 12px,
    rgba(255, 255, 255, 0.18) 12px 16px
  );
  box-shadow:
    0 0 0 2px #14161f,
    inset 0 0 0 3px var(--tapete, #e58a6e),
    inset 0 0 0 5px rgba(255, 255, 255, 0.55);
}
.floor[data-tapete='1']::after {
  --tapete: #5fb3ab;
}
.floor[data-tapete='2']::after {
  --tapete: #e0b44c;
}

/*
 * Parede: faixas horizontais na face (a matriz só cisalha em Y, então as
 * faixas continuam paralelas ao chão). De cima para baixo: aresta preta, fio
 * de luz, painel, frisa, lambri mais escuro e rodapé. As duas faces usam as
 * mesmas faixas com tons diferentes, a leste pegando mais luz que a oeste.
 */
.wall {
  --parede-luz: #5a6a8e;
  --parede: #3d4a63;
  --parede-frisa: #2a3448;
  --parede-lambri: #354157;
  --parede-rodape: #1a202d;
  position: absolute;
  transform-origin: 0 0;
  background-color: var(--parede);
  background-image: linear-gradient(
    to bottom,
    var(--parede-luz) 0 3px,
    transparent 3px calc(100% - 17px),
    var(--parede-frisa) calc(100% - 17px) calc(100% - 15px),
    var(--parede-lambri) calc(100% - 15px) calc(100% - 5px),
    var(--parede-rodape) calc(100% - 5px)
  );
  border-top: 3px solid #000;
  /* junta entre placas: um tile por div, então a junta sai de graça */
  box-shadow: inset 1px 0 0 rgba(0, 0, 0, 0.28);
}
.wall--y {
  --parede-luz: #3f4c68;
  --parede: #2a3448;
  --parede-frisa: #1c2433;
  --parede-lambri: #242d3f;
  --parede-rodape: #12161f;
}

.prop {
  position: absolute;
  pointer-events: none;
}
/* O desenho desce meio losango abaixo da caixa (PE_DO_PROP): overflow visível. */
.prop__sprite {
  position: absolute;
  left: 0;
  top: 0;
  display: block;
  max-width: none;
  image-rendering: pixelated;
  user-select: none;
}

/* Plaquinha de porta: creme, borda de 2px e sombra dura, como os cards da UI.
   Sobe 6px além da âncora: a cadeira (1,2) fica logo abaixo do canto da sala,
   e sem a folga o rótulo de quem senta nela some atrás da placa (que está
   acima de todo ator). Mais que isso a placa sai do topo do mapa em 2x. */
.room__label {
  position: absolute;
  z-index: 100000;
  transform: translate(-50%, -6px);
  font-size: 9px;
  line-height: 1;
  font-weight: var(--peso-forte);
  letter-spacing: 0.04em;
  white-space: nowrap;
  text-transform: uppercase;
  color: #000;
  background: #f4f0e6;
  border: 2px solid #000;
  box-shadow: 2px 2px 0 #000;
  padding: 2px 5px 3px;
  pointer-events: none;
}

.actor {
  position: absolute;
  left: 0;
  top: 0;
  will-change: transform;
  pointer-events: none;
}

/*
 * Em hover o ator sobe acima de tudo (placas incluídas) para o rótulo não ficar
 * embaixo de quem está na frente. Só em hover: foco e ativo ficam na
 * profundidade do pintor, senão atravessariam mesas e paredes enquanto andam.
 * `!important` porque o z-index de profundidade é escrito no style pelo loop.
 */
.actor:hover,
.actor:focus-within {
  z-index: 100001 !important;
}
/* Quem leva um balão que pede o Rômulo fica acima das placas das salas: sem isso, o PO raiz em
   visita tinha o "Falhou: …" escondido atrás da placa da sala que foi ver. */
.actor:has(.actor__estado[data-destaque]) {
  z-index: 100000 !important;
}

/* 44×44 px de TELA em qualquer escala (o mundo é escalado inteiro). */
.actor__hit {
  --lado: calc(44px / var(--escala, 1));
  position: absolute;
  left: 50%;
  bottom: 0;
  width: var(--lado);
  height: var(--lado);
  margin-left: calc(var(--lado) / -2);
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
.actor__hit:focus-visible {
  outline: calc(3px / var(--escala, 1)) solid #ffd23f;
  outline-offset: 0;
}

/* Elipse em degraus de 2px: um radial-gradient sairia com borda borrada. */
.actor__shadow {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: 32px;
  height: 12px;
  margin-left: -16px;
  --sombra: linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.3));
  background:
    var(--sombra) 8px 0 / 16px 2px no-repeat,
    var(--sombra) 2px 2px / 28px 2px no-repeat,
    var(--sombra) 0 4px / 32px 4px no-repeat,
    var(--sombra) 2px 8px / 28px 2px no-repeat,
    var(--sombra) 8px 10px / 16px 2px no-repeat;
}

.actor__billboard {
  position: absolute;
  inset: 0;
  transform-origin: 50% 100%;
}

.actor__strip {
  position: absolute;
  left: 0;
  bottom: 0;
  background-repeat: no-repeat;
  background-position: 0 0;
}
.actor__strip--walk {
  display: none;
}
.actor--walk .actor__strip--walk {
  display: block;
}
.actor--walk .actor__strip--idle {
  display: none;
}

.actor__sem-sprite { position: absolute; inset: 10px; border: 1px dashed var(--texto-2); opacity: 0.5; }

/*
 * Rótulo escondido por padrão: com cinco pessoas numa sala os rótulos fixos
 * se empilhavam e nenhum era legível. Aparece em três casos — hover, foco da
 * câmera (`actor--focus`, ligado por useOffice) e o agente ativo da demanda
 * (`data-ativo`, do GameMap). visibility em vez de v-if: o nó continua lá e a
 * troca não re-renderiza nada.
 */
.actor__name {
  position: absolute;
  left: 50%;
  top: -14px;
  transform: translateX(-50%);
  font-size: 8px;
  line-height: 1;
  font-weight: var(--peso-forte);
  white-space: nowrap;
  color: #000;
  background: #fff;
  border: 2px solid #000;
  box-shadow: 2px 2px 0 #000;
  padding: 1px 3px 2px;
  pointer-events: none;
  visibility: hidden;
}
.actor:hover .actor__name,
.actor:focus-within .actor__name,
.actor--focus .actor__name,
.actor[data-ativo] .actor__name {
  visibility: visible;
}
/* Balão de estado (office/baloes.ts: finanças, robôs, leads, agenda): sempre visível,
   acima da plaquinha do nome. A borda esquerda é o tom; o texto já diz o estado, então a
   cor nunca é a única pista. Cores fixas como o resto do mapa (o mapa não segue o tema). */
.actor__estado {
  position: absolute;
  left: 50%;
  top: -30px;
  transform: translateX(-50%);
  font-size: 8px;
  line-height: 1;
  font-weight: var(--peso-forte);
  white-space: nowrap;
  color: #000;
  background: #f4f0e6;
  border: 2px solid #000;
  border-left-width: 6px;
  box-shadow: 2px 2px 0 #000;
  padding: 2px 4px 3px;
  pointer-events: none;
}
.actor__estado[data-tom='verde'] { border-left-color: #167a4c; }
.actor__estado[data-tom='amarelo'] { border-left-color: #e0b100; }
.actor__estado[data-tom='laranja'] { border-left-color: #ff6a2b; }
.actor__estado[data-tom='vermelho'] { border-left-color: #c92f3f; background: #ffd9d2; }
.actor__estado[data-tom='neutro'] { border-left-color: #6b7a99; }
/* Sem sinal: tracejado e apagado, para não ser lido como "tudo bem" nem como alarme. */
.actor__estado[data-tom='sem_sinal'] { border-left-style: dashed; border-left-color: #8a8a8a; color: #4a4a4a; background: #e4e0d6; }
/* O que pede o Rômulo salta: acima de todos os balões, com um pulso que para sozinho. */
.actor__estado[data-destaque] {
  z-index: 1;
  border-width: 3px;
  border-left-width: 8px;
  animation: balao-pede 1.2s steps(2) 6;
}
@keyframes balao-pede {
  50% { transform: translateX(-50%) translateY(-3px); }
}
.office--pausado .actor__estado[data-destaque] { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) {
  .actor__estado[data-destaque] { animation: none; }
}

/* Na Central: o mapa é uma faixa da tela, com altura fixa legível no celular. */
.mapa--compacto .office-viewport {
  height: clamp(16rem, 48dvh, 26rem);
  min-height: 0;
}
.mapa--compacto .mapa__barra { padding: var(--esp-1) var(--esp-3); }
.mapa--compacto .mapa__status { font-size: var(--tam-apoio); }
/* Quem atende a demanda ganha a plaquinha amarela com a setinha de pixel. */
.actor[data-ativo] .actor__name {
  background: #ffd23f;
}
.actor[data-ativo] .actor__name::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 100%;
  width: 6px;
  height: 4px;
  margin: 2px 0 0 -3px;
  background:
    linear-gradient(#000, #000) 0 0 / 6px 2px no-repeat,
    linear-gradient(#000, #000) 2px 2px / 2px 2px no-repeat;
}
</style>
