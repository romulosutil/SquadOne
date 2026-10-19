<script setup lang="ts">
/**
 * Design system (/design-system, 16/10/2026): o design system vivo, para mexer no app junto
 * com o Claude sem adivinhar nome de classe nem valor.
 *
 *  - Os tokens saem do tokens.css cru (blueprint/tokens.ts): token novo aparece aqui sozinho.
 *  - Mudar um valor aplica no app inteiro desta aba (style do <html>) até recarregar; o
 *    "Copiar pedido" devolve o bloco de CSS e o porquê, para colar na conversa.
 *  - Contraste medido no tema da hora, com as cores resolvidas pelo navegador.
 *  - Componentes e telas com código fixo (BP-…, blueprint/catalogo.ts) e a Ficha de verdade
 *    com um lead inventado, sem gravar nada.
 *
 * Nada aqui grava no servidor; no localStorage só o tema (o mesmo de Mais › Aparência). O resto é
 * um espelho do código, não uma configuração.
 */
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import CSS_DOS_TOKENS from '../estilos/tokens.css?raw'
import Sheet from '../components/Sheet.vue'
import SeletorDeTema from '../casca/SeletorDeTema.vue'
import { useTema } from '../casca/temaVivo'
import CrmFicha from '../operations/CrmFicha.vue'
import CrmTrecho from '../operations/CrmTrecho.vue'
import '../operations/crm.css'
import { ANATOMIA_DA_FICHA, CATALOGO, PRINCIPIOS, REGRAS_DE_COMPOSICAO } from '../blueprint/catalogo'
import { LEAD_DE_EXEMPLO } from '../blueprint/exemplo'
import {
  GRUPOS, PARES_DE_CONTRASTE, contraste, lerRgb, lerTokens, nivelWcag, pedidoDeMudanca,
  type GrupoDeToken, type Mudanca, type NivelWcag, type Token,
} from '../blueprint/tokens'
import type { CrmVisao } from '../operations/types'
import type { Trecho } from '../operations/colinha'

const tokens = lerTokens(CSS_DOS_TOKENS)

// ------------------------------------------------------------ tema

// O mesmo estado e o mesmo seletor de Mais › Aparência (temaVivo.ts): trocar aqui fica guardado
// e vale para o app inteiro, e o contraste é remedido a cada troca (inclusive do sistema, no automático).
const html = document.documentElement
const { temaVisto } = useTema()
watch(temaVisto, () => medir())

// ------------------------------------------------------------ edição de tokens
// Fora do componente: sair do blueprint e voltar não perde a lista do que já foi mudado
// (o valor continua aplicado no <html> até recarregar).

const editados = estadoDaAba()
function estadoDaAba(): Record<string, string> {
  const w = window as unknown as { __blueprintEditados?: Record<string, string> }
  w.__blueprintEditados ??= reactive({}) as Record<string, string>
  return w.__blueprintEditados
}

const valorDoArquivo = (t: Token) => (temaVisto.value === 'escuro' && t.escuro !== undefined ? t.escuro : t.valor)
const valorAtual = (t: Token) => editados[t.nome] ?? valorDoArquivo(t)

function editar(t: Token, valor: string) {
  const v = valor.trim()
  if (!v || v === valorDoArquivo(t)) {
    delete editados[t.nome]
    html.style.removeProperty(t.nome)
  } else {
    editados[t.nome] = v
    html.style.setProperty(t.nome, v)
  }
  medir()
}
function desfazerTudo() {
  for (const nome of Object.keys(editados)) {
    html.style.removeProperty(nome)
    delete editados[nome]
  }
  medir()
}

const mudancas = computed<Mudanca[]>(() => tokens
  .filter((t) => editados[t.nome] !== undefined)
  .map((t) => ({ nome: t.nome, de: valorDoArquivo(t), para: editados[t.nome] })))
const porque = ref('')
const pedido = computed(() => pedidoDeMudanca(mudancas.value, temaVisto.value, porque.value))
const copiado = ref('')
const caixaDoPedido = ref<HTMLTextAreaElement | null>(null)
async function copiarPedido() {
  try {
    await navigator.clipboard.writeText(pedido.value)
    copiado.value = 'Copiado: cole na conversa com o Claude.'
  } catch {
    caixaDoPedido.value?.select()
    copiado.value = 'Selecionado: copie com Ctrl+C.'
  }
}

// ------------------------------------------------------------ busca e grupos

const busca = ref('')
const grupoAberto = ref<GrupoDeToken | 'todos'>('semanticos')
const gruposVisiveis = computed(() => {
  const q = busca.value.trim().toLowerCase()
  return GRUPOS
    .filter((g) => q || grupoAberto.value === 'todos' || g.id === grupoAberto.value)
    .map((g) => ({
      ...g,
      tokens: tokens.filter((t) => t.grupo === g.id && (!q || t.nome.includes(q) || (t.nota ?? '').toLowerCase().includes(q) || t.valor.includes(q))),
    }))
    .filter((g) => g.tokens.length)
})
const ehCor = (g: GrupoDeToken) => g === 'paleta' || g === 'semanticos' || g === 'etapas'

// ------------------------------------------------------------ contraste

const sonda = ref<HTMLElement | null>(null)
const medidas = ref<Array<{ texto: string; fundo: string; uso: string; minimo: number; razao: number | null; nivel: NivelWcag | null; passa: boolean }>>([])
function corResolvida(nome: string): string {
  const el = sonda.value
  if (!el) return ''
  el.style.color = `var(${nome})`
  return getComputedStyle(el).color
}
function medir() {
  // Depois do próximo quadro: o navegador só recalcula as variáveis com o data-theme já trocado.
  void nextTick(() => requestAnimationFrame(() => {
    medidas.value = PARES_DE_CONTRASTE.map((p) => {
      const a = lerRgb(corResolvida(p.texto))
      const b = lerRgb(corResolvida(p.fundo))
      const razao = a && b ? contraste(a, b) : null
      return { ...p, razao, nivel: razao === null ? null : nivelWcag(razao), passa: razao !== null && razao >= p.minimo }
    })
  }))
}
onMounted(medir)
const falhas = computed(() => medidas.value.filter((m) => !m.passa).length)

// ------------------------------------------------------------ exemplos vivos

const fichaAberta = ref(false)
// Só o `registro` é lido pela Ficha. Indisponível de propósito: o exemplo nunca grava na planilha.
const VISAO_DE_EXEMPLO = { registro: { disponivel: false, motivo: 'exemplo do blueprint, nada é gravado.' } } as unknown as CrmVisao
const RITMO_LIVRE = { motivo: null, ate: null, enviadosHoje: 0, teto: 10 }
const TRECHO_DE_EXEMPLO: Trecho = {
  id: 'bp-exemplo',
  produtos: ['site'],
  titulo: '2ª mensagem',
  texto: 'Oi, é o Rômulo de novo. Ficou pronta a demonstração do site do {NOME}: [link do demo]\n\nSe algo não ficou do jeito de vocês, eu mudo em um dia.',
  dica: 'Complete o link antes de mandar. É um exemplo: não sai nada daqui.',
}
const segmentoDeExemplo = ref('Lista')
const escolhaDeExemplo = ref(0)

const secoes = [
  { id: 'bp-principios', rotulo: 'Princípios' },
  { id: 'bp-composicao', rotulo: 'Composição' },
  { id: 'bp-tokens', rotulo: 'Tokens' },
  { id: 'bp-contraste', rotulo: 'Contraste' },
  { id: 'bp-componentes', rotulo: 'Componentes' },
  { id: 'bp-telas', rotulo: 'Telas' },
]
const peca = (id: string) => CATALOGO.find((c) => c.id === id)!
</script>

<template>
  <div class="bp">
    <span ref="sonda" class="bp-sonda" aria-hidden="true" />

    <header class="bp-topo">
      <span class="bp-kicker">SquadOne · design system</span>
      <h1>Design system</h1>
      <p class="bp-apoio">
        Os tokens e os componentes de verdade, lidos do código. Mude um valor e o app inteiro desta aba muda junto
        (até recarregar); depois copie o pedido e cole na conversa. Para apontar uma peça, use o código dela (ex.: <code>BP-BOTAO</code>).
      </p>
      <div class="bp-topo__linha">
        <SeletorDeTema />
        <nav class="bp-indice" aria-label="Seções do blueprint">
          <a v-for="s in secoes" :key="s.id" :href="`#${s.id}`">{{ s.rotulo }}</a>
        </nav>
      </div>
    </header>

    <!-- Pedido: só aparece com alguma mudança; fica perto do topo para não se perder. -->
    <section v-if="mudancas.length" class="bp-bloco bp-pedido" aria-labelledby="bp-pedido-titulo">
      <h2 id="bp-pedido-titulo">Pedido de mudança <span class="selo selo--destaque">{{ mudancas.length }}</span></h2>
      <label class="rotulo">Por quê <small>(opcional: o que você viu e queria diferente)</small>
        <input v-model="porque" class="campo" type="text" maxlength="300" placeholder="Ex.: o amarelo cansa no escuro">
      </label>
      <textarea ref="caixaDoPedido" class="campo bp-pedido__texto" :value="pedido" readonly rows="8" aria-label="Texto do pedido" />
      <div class="acoes">
        <button class="botao botao--primario" type="button" @click="copiarPedido">Copiar pedido</button>
        <button class="botao" type="button" @click="desfazerTudo">Desfazer tudo</button>
      </div>
      <p class="texto-2 texto-pequeno" role="status">{{ copiado }}</p>
    </section>

    <section id="bp-principios" class="bp-bloco" aria-labelledby="bp-principios-titulo">
      <h2 id="bp-principios-titulo">Princípios</h2>
      <ol class="bp-principios">
        <li v-for="p in PRINCIPIOS" :key="p.id">
          <span class="selo">{{ p.id }}</span>
          <strong>{{ p.titulo }}</strong>
          <span class="texto-2">{{ p.texto }}</span>
        </li>
      </ol>
    </section>

    <!-- Composição (16/10/2026): as regras do neobrutalismo saudável lado a lado com o erro que
         elas impedem. O "assim não" é desenhado à mão (bp-errado): com as classes de verdade, o
         cartão dentro do bloco já sairia achatado e não mostraria o problema. -->
    <section id="bp-composicao" class="bp-bloco" aria-labelledby="bp-composicao-titulo">
      <h2 id="bp-composicao-titulo">Composição</h2>
      <p class="texto-2 texto-pequeno">
        Quatro regras que valem em toda tela e folha (design.md, "Neobrutalismo saudável"). O teste do blueprint confere raio e sombra;
        o resto é revisão.
      </p>
      <ol class="bp-regras">
        <li v-for="r in REGRAS_DE_COMPOSICAO" :key="r.id">
          <span class="selo">{{ r.id }}</span>
          <strong>{{ r.titulo }}</strong>
          <span class="texto-2">{{ r.texto }}</span>
        </li>
      </ol>
      <div class="bp-compara">
        <figure class="bp-compara__lado">
          <figcaption><span class="selo selo--erro">assim não</span> caixa em caixa, cinco botões iguais</figcaption>
          <div class="bp-errado" aria-hidden="true">
            <strong>Mapa respondido</strong>
            <div class="bp-errado__caixa">
              <span class="texto-pequeno">Próximo passo · com você</span>
              <div class="bp-errado__caixa">Mandar o follow-up e oferecer os 20 minutos.</div>
            </div>
            <div class="bp-errado__fileira">
              <span v-for="b in ['WhatsApp', 'Demo', 'Maps', 'Planilha', 'Copiar']" :key="b" class="bp-errado__botao">{{ b }}</span>
            </div>
          </div>
        </figure>
        <figure class="bp-compara__lado">
          <figcaption><span class="selo selo--ok">assim</span> um contorno, fundo pastel, um primário</figcaption>
          <section class="bloco" aria-label="Exemplo de composição certa">
            <h3>Mapa respondido</h3>
            <div class="zona zona--realce">
              <span class="texto-2 texto-pequeno">Próximo passo · com você</span>
              <strong>Mandar o follow-up e oferecer os 20 minutos.</strong>
            </div>
            <div class="acoes">
              <button class="botao botao--primario" type="button">Abrir no WhatsApp</button>
              <details class="mais-acoes">
                <summary>Mais ações</summary>
                <ul class="lista-acoes">
                  <li><button type="button">Ver o demo</button></li>
                  <li><button type="button">Abrir no Maps</button></li>
                  <li><button type="button">Abrir a planilha</button></li>
                  <li><button type="button">Copiar o texto</button></li>
                </ul>
              </details>
            </div>
          </section>
        </figure>
      </div>
    </section>

    <section id="bp-tokens" class="bp-bloco" aria-labelledby="bp-tokens-titulo">
      <h2 id="bp-tokens-titulo">Tokens <span class="texto-2 bp-contagem">{{ tokens.length }} em src/estilos/tokens.css</span></h2>
      <div class="bp-filtros">
        <label class="rotulo">Buscar
          <input v-model="busca" class="campo" type="search" placeholder="destaque, esp, sombra…">
        </label>
      </div>
      <div v-if="!busca.trim()" class="escolhas" role="group" aria-label="Grupo de tokens">
        <button type="button" :aria-pressed="grupoAberto === 'todos'" @click="grupoAberto = 'todos'">Todos</button>
        <button v-for="g in GRUPOS" :key="g.id" type="button" :aria-pressed="grupoAberto === g.id" @click="grupoAberto = g.id">{{ g.titulo }}</button>
      </div>

      <div v-for="g in gruposVisiveis" :key="g.id" class="bp-grupo">
        <h3>{{ g.titulo }}</h3>
        <p class="texto-2 texto-pequeno">{{ g.uso }}</p>
        <ul class="bp-tokens">
          <li v-for="t in g.tokens" :key="t.nome" :class="{ 'is-editado': editados[t.nome] !== undefined }">
            <div class="bp-amostra" :class="`is-${g.id}`" aria-hidden="true">
              <span v-if="ehCor(g.id)" class="bp-amostra__cor" :style="{ background: `var(${t.nome})` }" />
              <span v-else-if="g.id === 'espaco' || g.id === 'respiro'" class="bp-amostra__barra" :style="{ width: `var(${t.nome})` }" />
              <span v-else-if="g.id === 'tamanho'" :style="{ fontSize: `var(${t.nome})` }">Aa</span>
              <span v-else-if="g.id === 'peso'" :style="{ fontWeight: `var(${t.nome})` }">Aa</span>
              <span v-else-if="g.id === 'fonte'" :style="{ fontFamily: `var(${t.nome})` }">Aa</span>
              <span v-else-if="g.id === 'toque'" class="bp-amostra__toque" :style="{ height: `var(${t.nome})`, width: `var(${t.nome})` }" />
              <span v-else-if="/^--(linha|divisor)/.test(t.nome) && t.nome !== '--linha-espessura'" class="bp-amostra__forma" :style="{ borderBottom: `var(${t.nome})` }" />
              <span v-else-if="t.nome.startsWith('--sombra')" class="bp-amostra__forma" :style="{ boxShadow: `var(${t.nome})`, border: 'var(--linha-fina)' }" />
              <span v-else-if="t.nome.startsWith('--faixa')" class="bp-amostra__forma" :style="{ borderLeft: `var(${t.nome}) solid var(--destaque)` }" />
              <span v-else-if="t.nome.startsWith('--raio')" class="bp-amostra__forma" :style="{ borderRadius: `var(${t.nome})`, border: 'var(--linha-fina)' }" />
              <span v-else class="texto-2">—</span>
            </div>
            <div class="bp-token">
              <code>{{ t.nome }}</code>
              <span v-if="t.nota" class="texto-2 texto-pequeno">{{ t.nota }}</span>
              <span v-if="t.escuro !== undefined" class="texto-2 texto-pequeno">claro {{ t.valor }} · escuro {{ t.escuro }}</span>
            </div>
            <label class="bp-valor">
              <span class="so-leitor">Valor de {{ t.nome }}</span>
              <input class="campo" type="text" :value="valorAtual(t)" spellcheck="false" @change="editar(t, ($event.target as HTMLInputElement).value)">
            </label>
          </li>
        </ul>
      </div>
      <p v-if="!gruposVisiveis.length" class="texto-2">Nenhum token com "{{ busca }}".</p>
    </section>

    <section id="bp-contraste" class="bp-bloco" aria-labelledby="bp-contraste-titulo">
      <h2 id="bp-contraste-titulo">Contraste <span class="texto-2 bp-contagem">tema {{ temaVisto }}</span></h2>
      <p class="texto-2 texto-pequeno">
        Medido agora, com as cores que o navegador resolveu (inclusive as que você mudou acima). Texto pede 4,5; anel de foco e contorno, 3.
        <template v-if="medidas.length"><strong>{{ falhas ? `${falhas} par${falhas === 1 ? '' : 'es'} abaixo do mínimo.` : 'Todos os pares passam.' }}</strong></template>
      </p>
      <ul class="bp-contraste">
        <li v-for="m in medidas" :key="m.texto + m.fundo" :class="{ 'is-falha': !m.passa }">
          <span class="bp-contraste__amostra" :style="{ color: `var(${m.texto})`, background: `var(${m.fundo})` }">Aa</span>
          <span class="bp-contraste__par"><code>{{ m.texto }}</code> sobre <code>{{ m.fundo }}</code><small class="texto-2">{{ m.uso }}</small></span>
          <span class="bp-contraste__nota">
            <strong>{{ m.razao === null ? '?' : m.razao.toFixed(2).replace('.', ',') }}</strong>
            <span class="selo" :class="m.passa ? 'selo--ok' : 'selo--erro'">{{ m.passa ? (m.nivel ?? '') : 'abaixo' }}</span>
          </span>
        </li>
      </ul>
    </section>

    <section id="bp-componentes" class="bp-bloco" aria-labelledby="bp-componentes-titulo">
      <h2 id="bp-componentes-titulo">Componentes</h2>
      <div class="bp-pecas">
        <article v-for="c in CATALOGO.filter((x) => x.id !== 'BP-FICHA')" :key="c.id" class="bp-peca" :aria-labelledby="`${c.id}-nome`">
          <header>
            <span class="selo">{{ c.id }}</span>
            <h3 :id="`${c.id}-nome`">{{ c.nome }}</h3>
            <code class="texto-pequeno">{{ c.classe }}</code>
            <span class="texto-2 texto-pequeno">{{ c.regra }} <span class="bp-onde">({{ c.onde }})</span></span>
          </header>
          <div class="bp-peca__vivo">
            <div v-if="c.id === 'BP-CABECALHO'" class="cabecalho-pagina"><div><span class="sobretitulo">Seu dia de vendas</span><h2>Conversas para avançar</h2><p>O que precisa de você, antes do que é consulta.</p></div></div>
            <div v-else-if="c.id === 'BP-ETIQUETA'" class="acoes"><span class="etiqueta" data-tom="ok">Resposta recebida</span><span class="etiqueta" data-tom="atencao">Sem leitura recente</span><span class="etiqueta">Time avaliando</span></div>
            <div v-else-if="c.id === 'BP-METRICAS'" class="metricas-venda"><div><strong>24<small> / 100</small></strong><span>contatos iniciados hoje</span></div><div><strong>6</strong><span>respostas observadas</span></div><div><strong>80</strong><span>leads avaliados</span></div></div>
            <ol v-else-if="c.id === 'BP-PRIORIDADES'" class="lista-prioridades"><li><span class="etiqueta" data-tom="atencao">Prioridade agora</span><h3>Conversa com resposta recebida</h3><p>Mostre o motivo e uma ação concreta para continuar.</p><button class="botao botao--primario" type="button">Continuar conversa</button></li><li>As demais prioridades usam ações secundárias.</li></ol>
            <div v-else-if="c.id === 'BP-OBSERVACAO'" class="zona"><span class="etiqueta" data-tom="ok">Mensagem observada</span><p>O envio apareceu na integração. O time acompanha a próxima resposta.</p></div>
            <section v-else-if="c.id === 'BP-BLOCO'" class="bloco" aria-label="Exemplo de bloco">
              <h3>Follow-up para mandar</h3>
              <p class="texto-2 texto-pequeno">Em contato há 3 a 6 dias. Quem leu e não respondeu vem primeiro.</p>
            </section>
            <div v-else-if="c.id === 'BP-ZONA'" class="bp-pilha bp-pilha--larga">
              <div class="zona zona--realce">
                <span class="texto-2 texto-pequeno">Próximo passo · com você</span>
                <strong>Mandar o follow-up e oferecer os 20 minutos.</strong>
              </div>
              <div class="zona"><span class="texto-pequeno">Neutro: agrupa o que é consulta.</span></div>
            </div>
            <div v-else-if="c.id === 'BP-BOTAO'" class="bp-pilha">
              <div class="acoes">
                <button class="botao botao--primario" type="button">Salvar nota</button>
                <button class="botao" type="button">Limpar</button>
                <button class="botao botao--leve" type="button">Ver no Maps ↗</button>
              </div>
              <div class="acoes">
                <button class="botao botao--perigo" type="button">Arquivar</button>
                <button class="botao" type="button" disabled>Aguarde…</button>
              </div>
            </div>
            <div v-else-if="c.id === 'BP-MAIS-ACOES'" class="acoes">
              <button class="botao botao--primario" type="button">Abrir conversa no WhatsApp</button>
              <details class="mais-acoes">
                <summary>Mais ações</summary>
                <ul class="lista-acoes">
                  <li><a href="#bp-componentes">Ver o demo</a></li>
                  <li><a href="#bp-componentes">Abrir no Maps</a></li>
                  <li><a href="#bp-componentes">Abrir a planilha</a></li>
                </ul>
              </details>
            </div>
            <div v-else-if="c.id === 'BP-NUMERO'" class="bp-numero">
              <span class="texto-2 texto-pequeno">Em contato</span>
              <p class="numero-grande">1.610</p>
              <span class="texto-2 texto-pequeno">12 com follow-up hoje</span>
            </div>
            <div v-else-if="c.id === 'BP-SEGMENTADO'" class="segmentado" role="group" aria-label="Exemplo de segmentado">
              <button v-for="o in ['Lista', 'Mapa']" :key="o" type="button" :aria-pressed="segmentoDeExemplo === o" @click="segmentoDeExemplo = o">{{ o }}</button>
            </div>
            <div v-else-if="c.id === 'BP-ESCOLHAS'" class="escolhas" role="group" aria-label="Exemplo de escolhas">
              <button v-for="(o, i) in ['Ainda sem link', 'Recebeu a C: lembra o raio-x', 'Link já enviado']" :key="o" type="button" :aria-pressed="escolhaDeExemplo === i" @click="escolhaDeExemplo = i">{{ o }}</button>
            </div>
            <div v-else-if="c.id === 'BP-SELO'" class="selos">
              <span class="selo">neutro</span><span class="selo selo--destaque">novo</span><span class="selo selo--ok">ok</span>
              <span class="selo selo--atencao">atenção</span><span class="selo selo--erro">falhou</span><span class="selo selo--forte">forte</span>
            </div>
            <div v-else-if="c.id === 'BP-RECADO'" class="bp-pilha">
              <p class="recado recado--ok">Atualizada às 14:02.</p>
              <p class="recado recado--atencao">Próximo expediente: o time inicia os contatos amanhã às 8h. As conversas continuam disponíveis.</p>
              <p class="recado recado--erro">Não foi gravado: a planilha não respondeu. Tente de novo.</p>
            </div>
            <label v-else-if="c.id === 'BP-CAMPO'" class="rotulo">O que fazer <small>(até 200 letras)</small>
              <input class="campo" type="text" placeholder="Ex.: ligar para combinar a conversa">
            </label>
            <div v-else-if="c.id === 'BP-CARTAO'" class="bp-pilha">
              <article class="cartao cartao--decisao"><h3>Contratar a Luna?</h3><p class="texto-2">Decisão: faixa coral.</p></article>
              <article class="cartao cartao--ajuste"><h3>Ajuste de 30 min</h3><p class="texto-2">Ajuste: faixa verde.</p></article>
              <article class="cartao cartao--falha"><h3>O Dell não respondeu</h3><p class="texto-2">Falha: faixa vermelha.</p></article>
            </div>
            <div v-else-if="c.id === 'BP-ESTADO'" class="bp-pilha">
              <span class="estado is-atendendo">Atendendo</span>
              <span class="estado is-com_agenda">Com agenda</span>
              <span class="estado is-livre">Livre</span>
              <span class="estado is-sem_sinal">Sem sinal</span>
            </div>
            <details v-else-if="c.id === 'BP-DOBRA'" class="dobra">
              <summary>Linha do tempo <span class="texto-2">(3)</span></summary>
              <p class="texto-2 texto-pequeno">Consulta: aberta só quando se precisa.</p>
            </details>
            <div v-else-if="c.id === 'BP-ETAPA'" class="crm-na-folha bp-linha">
              <span v-for="e in (['novo', 'contato', 'proposta', 'ganho', 'perdido'] as const)" :key="e" class="crm-etapa" :class="`is-${e}`">{{ { novo: 'Novo', contato: 'Em contato', proposta: 'Proposta', ganho: 'Ganho', perdido: 'Perdido' }[e] }}</span>
            </div>
            <div v-else-if="c.id === 'BP-SINAL'" class="crm-na-folha crm-sinais">
              <span class="crm-sinal is-resposta">Resposta</span><span class="crm-sinal is-followup">Follow-up</span>
              <span class="crm-sinal is-interesse">Interesse</span><span class="crm-sinal is-divergencia">Divergência</span>
              <span class="crm-sinal is-prazo">Sai em 4 dias</span>
            </div>
            <div v-else-if="c.id === 'BP-TRECHO'" class="crm-na-folha">
              <CrmTrecho :trecho="TRECHO_DE_EXEMPLO" :lead="LEAD_DE_EXEMPLO" />
            </div>
            <button v-else-if="c.id === 'BP-FOLHA'" class="botao" type="button" @click="fichaAberta = true">Abrir uma folha (a Ficha de exemplo)</button>
          </div>
        </article>
      </div>
    </section>

    <section id="bp-telas" class="bp-bloco" aria-labelledby="bp-telas-titulo">
      <h2 id="bp-telas-titulo">Telas</h2>
      <article class="bp-peca">
        <header>
          <span class="selo">{{ peca('BP-FICHA').id }}</span>
          <h3>{{ peca('BP-FICHA').nome }}</h3>
          <span class="texto-2 texto-pequeno">{{ peca('BP-FICHA').regra }}</span>
        </header>
        <ol class="bp-anatomia">
          <li v-for="(b, i) in ANATOMIA_DA_FICHA" :key="b.bloco">
            <span class="bp-anatomia__n">{{ i + 1 }}</span>
            <strong>{{ b.bloco }}</strong>
            <span class="texto-2">{{ b.pergunta }}</span>
            <span class="selo" :class="{ 'selo--ok': b.visivel === 'sempre', 'selo--atencao': b.visivel === 'quando houver' }">{{ b.visivel }}</span>
          </li>
        </ol>
        <div class="acoes">
          <button class="botao botao--primario" type="button" @click="fichaAberta = true">Abrir a Ficha de exemplo</button>
        </div>
        <p class="texto-2 texto-pequeno">Lead inventado (blueprint/exemplo.ts), links para example.com, registro desligado: nada sai nem é gravado.</p>
      </article>
    </section>

    <Sheet v-if="fichaAberta" cheia titulo="Ficha do lead" subtitulo="Exemplo do blueprint" @fechar="fichaAberta = false">
      <div class="crm-na-folha">
        <CrmFicha :lead="LEAD_DE_EXEMPLO" :visao="VISAO_DE_EXEMPLO" :liberados="new Set()" :anotados="{}" :ritmo="RITMO_LIVRE" />
      </div>
    </Sheet>
  </div>
</template>

<style>
/* A página segue a regra que mostra (16/10/2026): cada seção é um bloco (um contorno), sem
   sombra; dentro, as peças se separam por divisor e o palco dos exemplos é fundo, não caixa.
   Só o pedido de mudança, preso por cima ao rolar, leva sombra. */
.bp { display: grid; gap: var(--respiro-pilha); width: 100%; max-width: 72rem; margin: 0 auto; color: var(--texto); }
.bp code { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: var(--tam-apoio); overflow-wrap: anywhere; }
.bp-sonda { position: absolute; width: 0; height: 0; overflow: hidden; }
.bp-kicker { color: var(--texto-2); font-size: var(--tam-apoio); font-weight: var(--peso-medio); }
.bp-topo,
.bp-bloco { display: grid; gap: var(--respiro-interno); min-width: 0; padding: var(--respiro-bloco); border: var(--linha); border-radius: var(--raio-bloco); background: var(--superficie); }
.bp-topo h1 { margin: 0; font-size: var(--tam-titulo); font-weight: var(--peso-titulo); letter-spacing: -0.02em; line-height: 1.05; }
.bp-bloco h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--esp-2); margin: 0; font-size: var(--tam-secao); font-weight: var(--peso-titulo); letter-spacing: -0.02em; }
.bp-bloco h3 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-forte); letter-spacing: -0.01em; }
.bp-bloco > p { margin: 0; }
.bp-apoio { margin: 0; max-width: var(--largura-leitura); color: var(--texto-2); }
.bp-contagem { font-size: var(--tam-apoio); font-weight: var(--peso-medio); letter-spacing: 0; }
.bp-topo__linha { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--esp-3); }
.bp-indice { display: flex; flex-wrap: wrap; gap: var(--esp-1) var(--esp-3); }
.bp-indice a { display: inline-flex; min-height: var(--toque); align-items: center; color: var(--texto); font-weight: var(--peso-forte); text-underline-offset: 3px; }

.bp-pedido { position: sticky; top: 0; z-index: var(--camada-fixa); box-shadow: var(--sombra); }
.bp-pedido__texto { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: var(--tam-apoio); }
.bp-pedido p { margin: 0; }

.bp-principios,
.bp-regras { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
@media (min-width: 48rem) { .bp-principios, .bp-regras { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bp-principios li,
.bp-regras li { display: grid; align-content: start; justify-items: start; gap: var(--esp-1); padding: var(--esp-3) var(--esp-4); border-radius: var(--raio-controle); background: var(--superficie-2); }

.bp-compara { display: grid; gap: var(--respiro-interno); }
@media (min-width: 48rem) { .bp-compara { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bp-compara__lado { display: grid; align-content: start; gap: var(--esp-2); min-width: 0; margin: 0; padding: var(--esp-4); border-radius: var(--raio-controle); background: var(--fundo); }
.bp-compara__lado figcaption { display: flex; flex-wrap: wrap; align-items: center; gap: var(--esp-2); color: var(--texto-2); font-size: var(--tam-apoio); }
/* O erro desenhado à mão: é o app de antes (3 px, canto vivo, sombra em tudo, caixa em caixa). */
.bp-errado { display: grid; gap: var(--esp-2); padding: var(--esp-3); border: 3px solid var(--borda); background: var(--superficie); box-shadow: var(--sombra); }
.bp-errado__caixa { display: grid; gap: var(--esp-1); padding: var(--esp-2); border: 2px solid var(--borda); }
.bp-errado__fileira { display: flex; flex-wrap: wrap; gap: var(--esp-1); }
.bp-errado__botao { padding: var(--esp-1) var(--esp-2); border: 3px solid var(--borda); background: var(--superficie); font-size: var(--tam-apoio); font-weight: var(--peso-forte); box-shadow: var(--sombra-pequena); }

.bp-filtros { max-width: 24rem; }
.bp-grupo { display: grid; gap: var(--esp-2); padding-top: var(--esp-4); border-top: var(--divisor); }
.bp-grupo p { margin: 0; }
.bp-tokens { display: grid; margin: 0; padding: 0; list-style: none; }
.bp-tokens li { display: grid; grid-template-columns: 4rem minmax(0, 1fr); align-items: center; gap: var(--esp-2) var(--esp-3); padding: var(--esp-2) 0; border-bottom: var(--divisor); }
.bp-tokens li.is-editado { box-shadow: inset var(--faixa) 0 0 var(--destaque); padding-left: var(--esp-3); }
.bp-valor { grid-column: 1 / -1; }
@media (min-width: 48rem) {
  .bp-tokens li { grid-template-columns: 4rem minmax(0, 1fr) minmax(12rem, 22rem); }
  .bp-valor { grid-column: auto; }
}
.bp-valor .campo { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size: var(--tam-apoio); }
.bp-token { display: grid; gap: var(--esp-0); min-width: 0; }
.bp-amostra { display: grid; min-height: var(--toque); place-items: center start; color: var(--texto); }
.bp-amostra__cor { width: 3rem; height: 2rem; border: var(--linha-fina); border-radius: var(--raio-selo); }
.bp-amostra__barra { height: 1rem; border: var(--linha-fina); border-radius: var(--raio-selo); background: var(--destaque); }
.bp-amostra__toque { display: block; max-width: 4rem; max-height: 4rem; border: var(--linha-espessura) dashed var(--borda); border-radius: var(--raio-controle); }
.bp-amostra__forma { display: block; width: 3rem; height: 2rem; background: var(--superficie-2); }

.bp-contraste { display: grid; margin: 0; padding: 0; list-style: none; }
.bp-contraste li { display: grid; grid-template-columns: 3rem minmax(0, 1fr) auto; align-items: center; gap: var(--esp-3); padding: var(--esp-2) 0; border-bottom: var(--divisor); }
.bp-contraste li.is-falha { box-shadow: inset var(--faixa) 0 0 var(--negativo); padding-left: var(--esp-3); }
.bp-contraste__amostra { display: grid; width: 3rem; height: 2.5rem; place-items: center; border: var(--linha-fina); border-radius: var(--raio-selo); font-weight: var(--peso-forte); }
.bp-contraste__par { display: grid; gap: var(--esp-0); min-width: 0; }
.bp-contraste__nota { display: flex; align-items: center; gap: var(--esp-2); font-variant-numeric: tabular-nums; }

/* Peças separadas por divisor, não por caixa; o palco é o fundo da página, onde elas moram. */
.bp-pecas { display: grid; gap: 0 var(--respiro-bloco); }
@media (min-width: 64rem) { .bp-pecas { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.bp-peca { display: grid; align-content: start; gap: var(--esp-3); min-width: 0; padding: var(--respiro-interno) 0 var(--respiro-bloco); border-top: var(--divisor); }
.bp-peca > header { display: grid; justify-items: start; gap: var(--esp-1); }
.bp-peca__vivo { min-width: 0; padding: var(--esp-4); border-radius: var(--raio-controle); background: var(--fundo); }
.bp-onde { font-style: italic; }
.bp-pilha { display: grid; gap: var(--esp-2); justify-items: start; }
.bp-pilha--larga { justify-items: stretch; }
.bp-linha { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.bp-numero { display: grid; gap: var(--esp-1); }

.bp-anatomia { display: grid; margin: 0; padding: 0; list-style: none; counter-reset: none; }
.bp-anatomia li { display: grid; grid-template-columns: 2rem minmax(0, 1fr); align-items: start; gap: var(--esp-0) var(--esp-3); padding: var(--esp-2) 0; border-bottom: var(--divisor); }
.bp-anatomia li > :not(.bp-anatomia__n) { grid-column: 2; justify-self: start; }
.bp-anatomia__n { grid-row: span 3; display: grid; width: 2rem; height: 2rem; place-items: center; border-radius: var(--raio-pilula); background: var(--destaque); color: var(--destaque-texto); font-weight: var(--peso-titulo); font-variant-numeric: tabular-nums; }
</style>
