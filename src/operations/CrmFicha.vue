<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CrmMomento from './CrmMomento.vue'
import CrmObjecao from './CrmObjecao.vue'
import { colinhaDoLead } from './colinha'
import { anotadoEm, textoDaAnotacao, type EnviosAnotados, type TipoDeEnvioAnotado } from './anotacao-de-envio'
import { DIAS_SEM_RESPOSTA, ROTULO_DA_ETAPA, ROTULO_DA_RESPOSTA, ROTULO_DO_PRODUTO, dataCurta, dataHora, diaEscolhido, diasNaEtapa, hojeEmSP, hora, onde, rotuloDoFollowup, textoDaAbordagem, textoDaLeitura } from './crm-formato'
import { ROTULO_DE_LIBERAR, ehPrimeiroContato, envioTravado, linksDePrimeiroContato, type EnviosLiberados } from './trava-de-horario'
import type { CrmLead, CrmTipoDeRegistro, CrmVisao } from './types'
import { raioXAvulso } from '../../server/site-mensagem.ts'

// Ficha de um lead. As únicas escritas da Central são as três deste arquivo
// (nota, próximo passo, proposta, sem contato fácil) e todas vão para a aba CRM da planilha pelo
// n8n (POST /api/operations/crm/registro); o toque na 2ª mensagem e no follow-up também
// anota o envio por essa rota, pelo CrmPanel (14/10/2026). Recusou/Fechou/Desfazer ficam na
// página do lead do n8n (fluxo 07); a Etapa do PRUMO muda na planilha.
// `aviso`/`liberados` (trava-de-horario.ts): fora do expediente, enviar a primeira mensagem, o
// convite e o reenvio do só-robô esperam o "Liberar" deste lead, como na Hoje e no Funil.
// `anotados`/`falhaDaAnotacao` (anotacao-de-envio.ts): o toque na 2ª mensagem ou no follow-up anota
// o envio pelo CrmPanel, em segundo plano; a ficha mostra a marca ou o pedido de anotar à mão.
const props = defineProps<{
  lead: CrmLead
  visao: CrmVisao
  aviso?: string | null
  liberados: EnviosLiberados
  anotados: EnviosAnotados
  falhaDaAnotacao?: string
}>()
// Abre numa folha cheia (CrmPanel): fechar é o "Fechar" da folha, o Esc ou o
// voltar do navegador, então a ficha não tem botão de voltar próprio.
// `colinha`: o CrmPanel troca para /crm?ver=colinha (fecha a folha, sem recarregar).
const emit = defineEmits<{ registrado: []; colinha: []; liberar: [leadId: string]; anotar: [leadId: string, tipo: TipoDeEnvioAnotado] }>()

const titulo = ref<HTMLHeadingElement | null>(null)
const nota = ref('')
const proximoTexto = ref('')
const proximoData = ref('')
const propostaData = ref(hojeEmSP())
const salvando = ref<CrmTipoDeRegistro | null>(null)
const mensagem = ref('')
const erro = ref('')

const aberto = computed(() => props.lead.etapa !== 'ganho' && props.lead.etapa !== 'perdido')
// Perdido pelo tempo (regra dos 7 dias) não teve desfecho: a proposta ainda pode ser marcada, e o traz de volta.
const saiuPeloPrazo = computed(() => props.lead.motivoPerda === 'expirou' || props.lead.motivoPerda === 'esfriou')
const eventos = computed(() => [...props.lead.eventos].reverse())
// As ações que são o "próximo passo" do lead (convite, primeira mensagem, diagnóstico ou link do site
// depois do "sim", follow-up do dia) ficam fixas no topo da folha, para não se perderem rolando a ficha.
// Em "Ações" sobram as de apoio.
interface AcaoDaFicha { chave: string; rotulo: string; href: string; principal: boolean }
const acoes = computed<AcaoDaFicha[]>(() => {
  const l = props.lead.links
  const prumo = props.lead.produto === 'prumo'
  const interesse = props.lead.resposta?.tipo === 'interesse'
  // Site com a variação C: a segunda (segundaDe) leva o raio-x e o demo, não só o site. Com o Raio-X
  // avulso (demo sob pedido, 14/10/2026): só o raio-x antes do demo, só o demo depois do "Gerar demo".
  const recebeuC = !prumo && props.lead.abordagem?.mensagem === 'C' && Boolean(l.raioX)
  const segunda = prumo ? 'Mandar o Raio-X (segunda mensagem)'
    : !recebeuC ? 'Mandar o link do site (segunda mensagem)'
    : !raioXAvulso(l.raioX) ? 'Mandar o raio-x e o demo (segunda mensagem)'
    : l.site ? 'Mandar o demo (com o preço)' : 'Mandar o raio-x (segunda mensagem)'
  const todas: Array<[string, string, string | undefined, boolean]> = [
    ['enviar', 'Enviar a primeira mensagem pelo WhatsApp (marca como enviado)', l.enviar, true],
    ['convite', 'Enviar convite (marca como enviado)', l.convite, true],
    ['segunda', segunda, l.segunda, interesse],
    ['gerarDemo', 'Gerar demo (sai em uns 20 a 40 minutos; o aviso chega no WhatsApp)', l.gerarDemo, interesse],
    ['followup', `${rotuloDoFollowup(props.lead)} (${props.lead.reenvioDoRobo ? 'reenvio único, ' : ''}texto pronto)`, l.followup, true],
    ['whatsapp', 'Abrir conversa no WhatsApp', l.whatsapp, false],
    ['site', prumo ? 'Ver o site da empresa' : 'Ver o demo', l.site, false],
    ['raioX', 'Ver o Raio-X', l.raioX, false],
    ['acoes', 'Recusou · Fechou · Desfazer (página do lead)', l.acoes, false],
    ['planilha', prumo ? 'Abrir na planilha (mudar a Etapa)' : 'Abrir a linha na planilha', l.planilha, false],
  ]
  return todas.flatMap(([chave, rotulo, href, principal]) => (href ? [{ chave, rotulo, href, principal }] : []))
    // Primeiro contato fora do expediente (envio, convite, reenvio do só-robô): some até o "Liberar"
    // (o botão entra no lugar, no topo).
    .filter((a) => !(travado.value && ehPrimeiroContato(props.lead, a.href)))
})
const travado = computed(() => envioTravado(props.aviso, props.liberados, props.lead.id) && linksDePrimeiroContato(props.lead).length > 0)
/** Os links que anotam o envio ao serem tocados. */
const TIPO_DA_ACAO: Record<string, TipoDeEnvioAnotado> = { segunda: 'segunda_enviada', followup: 'followup_enviado' }
function aoTocar(chave: string) {
  const tipo = TIPO_DA_ACAO[chave]
  if (tipo) emit('anotar', props.lead.id, tipo)
}
/** "2ª mensagem anotada às 14:02 · Follow-up anotado às 14:05", enquanto o retrato não confirma. */
const anotacoes = computed(() => (['segunda_enviada', 'followup_enviado'] as const).flatMap((tipo) => {
  const t = anotadoEm(props.anotados, props.lead.id, tipo)
  return t === undefined ? [] : [textoDaAnotacao(tipo, hora(new Date(t).toISOString()))]
}).join(' · '))
const acoesFixas = computed(() => acoes.value.filter((a) => a.principal))
const acoesDeApoio = computed(() => acoes.value.filter((a) => !a.principal))
const hoje = hojeEmSP()
const situacaoDoProximo = computed(() => {
  const data = props.lead.proximoPasso?.data
  if (!data) return ''
  return data < hoje ? 'atrasado' : data === hoje ? 'para hoje' : ''
})
const disponivel = computed(() => props.visao.registro.disponivel)
// A colinha do momento deste lead (colinha.ts): sai da etapa e da última resposta,
// com os textos já preenchidos com o nome, o artigo e o link do demo dele.
const colinha = computed(() => colinhaDoLead(props.lead))

// Ctrl/Cmd/Shift/meio abrem a página numa aba nova, como os links da casca (casca/rota.ts).
function verColinha(e: MouseEvent) {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
  e.preventDefault()
  emit('colinha')
}

onMounted(async () => {
  await nextTick()
  titulo.value?.focus()
})
watch(() => props.lead.id, () => {
  nota.value = ''
  proximoTexto.value = ''
  proximoData.value = ''
  mensagem.value = ''
  erro.value = ''
})

async function registrar(tipo: CrmTipoDeRegistro, texto: string, data: string, feito: string) {
  salvando.value = tipo
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
    mensagem.value = `${feito} Gravado na aba CRM da planilha às ${dataHora(corpo.em).slice(-5)}; a ficha atualiza em alguns segundos.`
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
  if (!nota.value.trim()) { erro.value = 'Escreva a nota antes de salvar.'; return }
  if (await registrar('nota', nota.value, '', 'Nota salva.')) nota.value = ''
}
const salvarProximo = async () => {
  if (!proximoTexto.value.trim() || !proximoData.value) { erro.value = 'Diga o que fazer e quando.'; return }
  if (await registrar('proximo_passo', proximoTexto.value, proximoData.value, 'Próximo passo salvo.')) {
    proximoTexto.value = ''
    proximoData.value = ''
  }
}
const limparProximo = () => registrar('proximo_passo', '', '', 'Próximo passo limpo.')
const marcarProposta = () => registrar('proposta', '', propostaData.value || hoje, 'Proposta marcada.')
const desfazerProposta = () => registrar('proposta_desfeita', '', '', 'Proposta desfeita.')
const marcarSemContato = () => registrar('sem_contato', '', '', 'Lead marcado como perdido.')
const desfazerSemContato = () => registrar('sem_contato_desfeito', '', '', 'Perda desfeita.')
</script>

<template>
  <article class="crm-ficha" aria-labelledby="crm-ficha-titulo">
    <header class="crm-ficha__cabeca">
      <span class="crm-kicker">{{ ROTULO_DO_PRODUTO[lead.produto] }} · {{ onde(lead) }}</span>
      <h2 id="crm-ficha-titulo" ref="titulo" tabindex="-1">{{ lead.empresa }}</h2>
      <p class="crm-ficha__etapa">
        <span class="crm-etapa" :class="`is-${lead.etapa}`">{{ ROTULO_DA_ETAPA[lead.etapa] }}</span>
        <span>{{ lead.subEtapa }} · {{ diasNaEtapa(lead) }}</span>
      </p>
      <p v-if="lead.diasParaSair !== undefined && lead.etapa === 'contato'" class="crm-ficha__fonte">
        Sem mensagem do lead, vai para Perdido {{ lead.diasParaSair <= 1 ? 'amanhã' : `em ${lead.diasParaSair} dias` }}
        (regra dos {{ DIAS_SEM_RESPOSTA }} dias). Um próximo passo segura o lead em Em contato.
      </p>
      <p v-else-if="saiuPeloPrazo" class="crm-ficha__fonte">
        Saiu pela regra dos {{ DIAS_SEM_RESPOSTA }} dias sem mensagem do lead, sem desfecho de ninguém. Volta sozinho se ele escrever;
        para trazer de volta agora, salve um próximo passo ou marque a proposta.
      </p>
      <p class="crm-ficha__fonte">
        Na planilha: <strong>{{ lead.estadoNaPlanilha }}</strong>
        <template v-if="lead.pasta"> · pasta: {{ lead.pasta.lugar }}</template>
        <template v-if="lead.diasDesdeUltimoEvento !== undefined"> · último evento {{ lead.diasDesdeUltimoEvento === 0 ? 'hoje' : `há ${lead.diasDesdeUltimoEvento} dia${lead.diasDesdeUltimoEvento === 1 ? '' : 's'}` }}</template>
      </p>
      <p v-if="textoDaAbordagem(lead)" class="crm-ficha__fonte">Recebeu: {{ textoDaAbordagem(lead) }}</p>
      <p v-if="lead.leitura !== 'nao-se-aplica'" class="crm-ficha__leitura">
        {{ textoDaLeitura(lead) }}<template v-if="lead.leitura === 'desconhecida'">: sem confirmação de leitura registrada (pode ter lido; o WhatsApp dele pode não mandar recibo).</template>
      </p>
    </header>

    <div v-if="acoesFixas.length || travado" class="crm-ficha__fixa" role="group" aria-label="Próximo passo">
      <button v-if="travado" type="button" class="botao botao--leve" @click="emit('liberar', lead.id)">{{ ROTULO_DE_LIBERAR }}</button>
      <a v-for="a in acoesFixas" :key="a.chave" :href="a.href" target="_blank" rel="noopener" @click="aoTocar(a.chave)">{{ a.rotulo }} ↗</a>
    </div>
    <p v-if="travado" class="crm-ficha__fonte">{{ aviso }}</p>
    <p class="crm-ficha__fonte" role="status" aria-live="polite">{{ anotacoes ? `${anotacoes} nesta tela; a planilha confirma no próximo retrato.` : '' }}</p>
    <p v-if="falhaDaAnotacao" class="crm-erro" role="alert">{{ falhaDaAnotacao }}</p>

    <div v-if="lead.divergencias.length" class="crm-divergencia" role="note">
      <strong>Divergência entre planilha e pasta</strong>
      <ul><li v-for="d in lead.divergencias" :key="d">{{ d }}</li></ul>
      <small>A Central não corrige nada: vale a planilha. Confira a planilha ou a pasta.</small>
    </div>

    <section v-if="lead.resposta" class="crm-ficha__bloco" aria-labelledby="crm-ficha-resposta">
      <h3 id="crm-ficha-resposta">O que respondeu</h3>
      <p class="crm-resposta" :class="`is-${lead.resposta.tipo}`">
        <strong>{{ ROTULO_DA_RESPOSTA[lead.resposta.tipo] }}</strong>
        <template v-if="lead.resposta.em"> · {{ dataHora(lead.resposta.em) }}</template>
      </p>
      <blockquote v-if="lead.resposta.trecho" class="crm-resposta__trecho">{{ lead.resposta.trecho }}</blockquote>
      <p v-else class="crm-muted">Só mensagem automática (saudação, horário, menu): ninguém respondeu ainda.</p>
    </section>

    <!-- Logo depois da resposta: é o que se lê para responder a ela. -->
    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-colinha">
      <h3 id="crm-ficha-colinha">Colinha</h3>
      <p v-if="colinha.motivo" class="crm-colinha__motivo">{{ colinha.motivo }}</p>
      <CrmObjecao v-for="o in colinha.objecoes" :key="o.id" :objecao="o" :lead="lead" :nivel="4" />
      <CrmMomento v-for="m in colinha.momentos" :key="m.momento" :passo="m" :lead="lead" :nivel="4" />
      <a class="crm-colinha__inteira" href="/crm?ver=colinha" @click="verColinha">Ver a colinha inteira <span aria-hidden="true">→</span></a>
    </section>

    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-acoes">
      <h3 id="crm-ficha-acoes">Ações</h3>
      <p v-if="lead.demoPedidoEm" class="crm-aviso" role="note">
        <strong>Demo pedido em {{ dataHora(lead.demoPedidoEm) }}.</strong> O gerador está fazendo o site; quando ele estiver no ar, chega o aviso
        no WhatsApp e "Mandar o demo" aparece aqui.
      </p>
      <p v-if="lead.demoApagadoEm" class="crm-aviso" role="note">
        <strong>Demo apagado da Vercel em {{ dataHora(lead.demoApagadoEm) }}</strong> (o lead estava em Perdido): o link antigo dá erro, e por isso
        nem "Ver o demo" nem o link do site aparecem aqui. Para mandar de novo, publique a pasta{{ lead.pasta ? ` ${lead.pasta.slug}` : '' }} outra vez
        (<code>vercel link</code> + <code>vercel deploy</code>, como o passo 5 do gerador).
      </p>
      <div v-if="acoesDeApoio.length" class="crm-ficha__links">
        <a v-for="a in acoesDeApoio" :key="a.chave" :href="a.href" target="_blank" rel="noopener" @click="aoTocar(a.chave)">{{ a.rotulo }} ↗</a>
      </div>
      <div class="crm-form__botoes">
        <button v-if="aberto" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="marcarSemContato">{{ salvando === 'sem_contato' ? 'Marcando…' : 'Sem contato fácil: marcar como perdido' }}</button>
        <button v-else-if="lead.motivoPerda === 'sem-contato'" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="desfazerSemContato">{{ salvando === 'sem_contato_desfeito' ? 'Desfazendo…' : 'Desfazer perda por falta de contato' }}</button>
      </div>
    </section>

    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-proximo">
      <h3 id="crm-ficha-proximo">Próximo passo</h3>
      <p v-if="lead.proximoPasso" class="crm-proximo" :class="{ 'is-atrasado': situacaoDoProximo === 'atrasado' }">
        <strong>{{ lead.proximoPasso.texto }}</strong>
        <span>para {{ diaEscolhido(lead.proximoPasso.data) }}<template v-if="situacaoDoProximo"> ({{ situacaoDoProximo }})</template></span>
      </p>
      <p v-else class="crm-muted">Nenhum próximo passo marcado.</p>
      <form class="crm-form" @submit.prevent="salvarProximo">
        <label><span>O que fazer</span><input v-model="proximoTexto" type="text" maxlength="200" :disabled="!disponivel" placeholder="Ex.: ligar para combinar a conversa"></label>
        <label><span>Quando</span><input v-model="proximoData" type="date" :min="hoje" :disabled="!disponivel"></label>
        <div class="crm-form__botoes">
          <button class="botao botao--primario" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'proximo_passo' ? 'Salvando…' : 'Salvar próximo passo' }}</button>
          <button v-if="lead.proximoPasso" class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="limparProximo">Limpar</button>
        </div>
      </form>
    </section>

    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-proposta">
      <h3 id="crm-ficha-proposta">Proposta</h3>
      <template v-if="lead.etapa === 'proposta'">
        <p>Proposta enviada em {{ diaEscolhido(lead.proposta?.data) || dataCurta(lead.proposta?.em) }} (marcada à mão).</p>
        <button class="botao" type="button" :disabled="!disponivel || salvando !== null" @click="desfazerProposta">{{ salvando === 'proposta_desfeita' ? 'Desfazendo…' : 'Desfazer proposta' }}</button>
      </template>
      <form v-else-if="aberto || saiuPeloPrazo" class="crm-form" @submit.prevent="marcarProposta">
        <label><span>Enviada em</span><input v-model="propostaData" type="date" :max="hoje" :disabled="!disponivel"></label>
        <div class="crm-form__botoes"><button class="botao botao--primario" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'proposta' ? 'Marcando…' : 'Marcar proposta enviada' }}</button></div>
      </form>
      <p v-else class="crm-muted">Lead encerrado ({{ ROTULO_DA_ETAPA[lead.etapa] }}). Para reabrir, use Desfazer na página do lead.</p>
    </section>

    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-nota">
      <h3 id="crm-ficha-nota">Nova nota</h3>
      <form class="crm-form" @submit.prevent="salvarNota">
        <label><span>Nota <small>({{ lead.notas }} já registrada{{ lead.notas === 1 ? '' : 's' }})</small></span><textarea v-model="nota" rows="3" maxlength="1000" :disabled="!disponivel" placeholder="O que ele disse, o que ficou combinado…" /></label>
        <div class="crm-form__botoes"><button class="botao botao--primario" type="submit" :disabled="!disponivel || salvando !== null">{{ salvando === 'nota' ? 'Salvando…' : 'Salvar nota' }}</button></div>
      </form>
    </section>

    <p v-if="!disponivel" class="crm-aviso">Registro indisponível: {{ visao.registro.motivo }}</p>
    <p class="crm-status" role="status" aria-live="polite">{{ mensagem }}</p>
    <p v-if="erro" class="crm-erro" role="alert">{{ erro }}</p>

    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-tempo">
      <h3 id="crm-ficha-tempo">Linha do tempo</h3>
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
    </section>

    <section v-if="lead.pasta?.artefatos" class="crm-ficha__bloco" aria-labelledby="crm-ficha-pasta">
      <h3 id="crm-ficha-pasta">Na fila do gerador</h3>
      <ul class="crm-artefatos">
        <li>{{ lead.pasta.artefatos.conteudo ? '✓ content.md' : '× sem content.md' }}</li>
        <li>{{ lead.pasta.artefatos.fotos ? `✓ ${lead.pasta.artefatos.fotos} foto(s)` : '× sem fotos' }}</li>
        <li>{{ lead.pasta.artefatos.capa ? '✓ capa' : '× sem capa' }}</li>
        <li>{{ lead.pasta.artefatos.gerado ? '✓ index.html' : '× site ainda não gerado' }}</li>
        <li v-if="lead.pasta.falha">! falha.log: {{ lead.pasta.falha }}</li>
      </ul>
      <small class="crm-muted">Pasta ~/auto-site/{{ lead.pasta.lugar === 'raiz' ? '' : lead.pasta.lugar }}{{ lead.pasta.slug }}/. A Central só lê: não confirma publicação.</small>
    </section>
  </article>
</template>
