<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { ROTULO_DA_ETAPA, ROTULO_DA_RESPOSTA, ROTULO_DO_PRODUTO, dataCurta, dataHora, diaEscolhido, diasNaEtapa, hojeEmSP, onde, textoDaAbordagem, textoDaLeitura } from './crm-formato'
import type { CrmLead, CrmTipoDeRegistro, CrmVisao } from './types'

// Ficha de um lead. As únicas escritas da Central são as três deste arquivo
// (nota, próximo passo, proposta, sem contato fácil) e todas vão para a aba CRM da planilha pelo
// n8n (POST /api/operations/crm/registro). Recusou/Fechou/Desfazer ficam na
// página do lead do n8n (fluxo 07); a Etapa do PRUMO muda na planilha.
const props = defineProps<{ lead: CrmLead; visao: CrmVisao }>()
// Abre numa folha cheia (CrmPanel): fechar é o "Fechar" da folha, o Esc ou o
// voltar do navegador, então a ficha não tem botão de voltar próprio.
const emit = defineEmits<{ registrado: [] }>()

const titulo = ref<HTMLHeadingElement | null>(null)
const nota = ref('')
const proximoTexto = ref('')
const proximoData = ref('')
const propostaData = ref(hojeEmSP())
const salvando = ref<CrmTipoDeRegistro | null>(null)
const mensagem = ref('')
const erro = ref('')

const aberto = computed(() => props.lead.etapa !== 'ganho' && props.lead.etapa !== 'perdido')
const eventos = computed(() => [...props.lead.eventos].reverse())
const hoje = hojeEmSP()
const situacaoDoProximo = computed(() => {
  const data = props.lead.proximoPasso?.data
  if (!data) return ''
  return data < hoje ? 'atrasado' : data === hoje ? 'para hoje' : ''
})
const disponivel = computed(() => props.visao.registro.disponivel)

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

    <section class="crm-ficha__bloco" aria-labelledby="crm-ficha-acoes">
      <h3 id="crm-ficha-acoes">Ações</h3>
      <p v-if="lead.demoApagadoEm" class="crm-aviso" role="note">
        <strong>Demo apagado da Vercel em {{ dataHora(lead.demoApagadoEm) }}</strong>, por 10 dias sem interação: o link antigo dá erro, e por isso
        nem "Ver o demo" nem o link do site aparecem aqui. Para mandar de novo, publique a pasta{{ lead.pasta ? ` ${lead.pasta.slug}` : '' }} outra vez
        (<code>vercel link</code> + <code>vercel deploy</code>, como o passo 5 do gerador).
      </p>
      <div class="crm-ficha__links">
        <a v-if="lead.links.enviar" class="is-principal" :href="lead.links.enviar" target="_blank" rel="noopener">Enviar a primeira mensagem pelo WhatsApp (marca como enviado) ↗</a>
        <a v-if="lead.links.convite" class="is-principal" :href="lead.links.convite" target="_blank" rel="noopener">Enviar convite (marca como enviado) ↗</a>
        <a v-if="lead.links.segunda" :class="{ 'is-principal': lead.resposta?.tipo === 'interesse' }" :href="lead.links.segunda" target="_blank" rel="noopener">{{ lead.produto === 'prumo' ? 'Mandar o diagnóstico (link do formulário)' : 'Mandar o link do site (segunda mensagem)' }} ↗</a>
        <a v-if="lead.links.whatsapp" :href="lead.links.whatsapp" target="_blank" rel="noopener">Abrir conversa no WhatsApp ↗</a>
        <a v-if="lead.links.site" :href="lead.links.site" target="_blank" rel="noopener">{{ lead.produto === 'site' ? 'Ver o demo' : 'Ver o site da empresa' }} ↗</a>
        <a v-if="lead.links.acoes" :href="lead.links.acoes" target="_blank" rel="noopener">Recusou · Fechou · Desfazer (página do lead) ↗</a>
        <a v-if="lead.links.planilha" :href="lead.links.planilha" target="_blank" rel="noopener">{{ lead.produto === 'prumo' ? 'Abrir na planilha (mudar a Etapa)' : 'Abrir a linha na planilha' }} ↗</a>
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
      <form v-else-if="aberto" class="crm-form" @submit.prevent="marcarProposta">
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
