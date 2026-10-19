<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAtualizacaoViva } from '../casca/atualizacao-viva'
import { esquecerAFrente, lerFrente, useFrente } from '../casca/frente'
import { dataHora, hora } from './crm-formato'
const props = defineProps<{ configurar?: boolean }>()
// O estado e a leitura são compartilhados com a Central (casca/frente.ts): uma leitura por ciclo.
const { frente, erro } = useFrente()
const salvando = ref(false)
const limite = ref(5)
/** O vendedor do Telegram, para o "Quem envia hoje" (GET /crm/vendedor): só o que o servidor já sabe. */
interface VendedorLido { configurado: boolean; ultimoEm: number | null }
const vendedor = ref<VendedorLido | null>(null)
async function lerVendedor(signal: AbortSignal) {
  try {
    const r = await fetch('/api/operations/crm/vendedor', { signal, cache: 'no-store' })
    if (!r.ok) throw new Error()
    const corpo = await r.json() as Partial<VendedorLido>
    vendedor.value = { configurado: corpo.configurado === true, ultimoEm: typeof corpo.ultimoEm === 'number' ? corpo.ultimoEm : null }
  } catch { if (!signal.aborted) vendedor.value = null }
}
async function ler(signal: AbortSignal) {
  await Promise.all([lerFrente(signal), lerVendedor(signal)])
}
const { sincronizar } = useAtualizacaoViva(ler)
const rotulo = computed(() => erro.value ? 'Sem leitura recente' : frente.value?.cicloParado ? 'Ciclo parado' : ({ iniciando: 'Preparando o time', avaliando: 'Time avaliando', pronto: 'Fila preparada', enviando: 'Iniciando conversa', 'fora-do-horario': 'Próximo expediente', pausado: 'Primeiros contatos pausados', bloqueado: 'Precisa de atenção', 'sem-sinal': 'Sem leitura recente', concluido: 'Rodada do dia concluída' }[frente.value?.estado ?? ''] ?? 'Lendo o time'))
/** "desde 11:42" (a última rodada que o script gravou) ou "sem nenhuma rodada ainda". */
const desdeQuando = computed(() => frente.value?.ultimaRodadaEm ? `desde ${hora(frente.value.ultimaRodadaEm)}` : 'sem nenhuma rodada gravada')
/**
 * Quem envia o primeiro contato hoje, com o que a Central sabe. O time tem dois interruptores (`ativo` e o
 * timer do systemd): "ativo" sem o ciclo andando é o pior caso, porque os leads da fila dele saem do
 * "Envie para X" do Telegram e ninguém os envia.
 */
const quemEnvia = computed(() => {
  const f = frente.value
  const time = !f ? 'Lendo o time…'
    : !f.ativo ? 'Pausado: os primeiros contatos do Site são seus, pela Ficha e pelo "Envie para X" do Telegram.'
    : f.cicloParado ? `Ativo, mas o ciclo está parado ${desdeQuando.value}. Os leads da fila dele saem do Telegram e ninguém os envia até o ciclo voltar; pause o time para eles voltarem para você.`
    : 'Ativo e rodando: os primeiros contatos do Site, dentro do expediente e do teto do dia, são do time.'
  const v = vendedor.value
  const telegram = !v ? 'Sem leitura do vendedor agora.'
    : !v.configurado ? 'Desligado nesta Central (SQUADONE_VENDEDOR e o bot do Telegram).'
    : v.ultimoEm ? `Ligado; último aviso em ${dataHora(new Date(v.ultimoEm).toISOString())}.` : 'Ligado; ainda sem aviso registrado.'
  return { time, telegram }
})
async function alterarConfiguracao() {
  if (!frente.value || salvando.value) return
  salvando.value = true
  try { const r = await fetch('/api/operations/crm/frente/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ativo: !frente.value.ativo }) }); if (!r.ok) throw new Error(); frente.value.ativo = !frente.value.ativo; esquecerAFrente(); await sincronizar() }
  catch { erro.value = 'Não foi possível alterar a configuração. O estado anterior foi mantido.' }
  finally { salvando.value = false }
}
</script>
<template>
  <section class="frente-comercial painel-venda" aria-labelledby="frente-titulo">
    <header class="cabecalho-bloco"><div><p class="sobretitulo">Prospecção pelo time</p><h2 id="frente-titulo">Primeiros contatos</h2></div><span class="etiqueta" :data-tom="erro || frente?.estado === 'bloqueado' ? 'atencao' : 'neutro'" role="status">{{ rotulo }}</span></header>
    <p class="texto-2">Diego seleciona. Elisa avalia a entrega. Carla prepara e inicia a conversa. Você entra quando o lead responde.</p>
    <div v-if="frente?.atualizadoEm" class="metricas-venda" aria-label="Resultado do time hoje">
      <div><strong>{{ frente.enviados }}<small> / {{ frente.limite }}</small></strong><span>contatos iniciados hoje</span></div>
      <div><strong>{{ frente.respondidos }}</strong><span>respostas observadas</span></div>
      <div><strong>{{ frente.avaliados }}</strong><span>leads avaliados pelo time</span></div>
    </div>
    <p v-if="erro" class="recado recado--atencao" role="status">{{ erro }}</p>
    <p v-else-if="frente?.cicloParado" class="recado recado--atencao" role="status"><strong>Ativo, mas o ciclo está parado {{ desdeQuando }}.</strong> O time não está avaliando nem enviando; o timer do Dell (frente-comercial.timer) precisa voltar.</p>
    <p v-else-if="frente?.detalhe" class="frente-comercial__detalhe">{{ frente.detalhe }}</p>
    <p v-else-if="!frente?.atualizadoEm" class="texto-2">As avaliações e os envios aparecem aqui assim que o serviço iniciar. Nenhum contato é considerado enviado antes da confirmação da integração.</p>
    <section class="frente-comercial__quem" aria-labelledby="frente-quem">
      <h3 id="frente-quem">Quem envia hoje</h3>
      <ul>
        <li><strong>Time comercial</strong> {{ quemEnvia.time }}</li>
        <li><strong>Vendedor do Telegram</strong> {{ quemEnvia.telegram }}</li>
        <li><strong>Você</strong> A Triagem (convidar), as respostas e as conversas; abrir o WhatsApp não registra envio.</li>
      </ul>
    </section>
    <details v-if="frente?.fila.length" class="dobra frente-comercial__fila"><summary>Ver escolhas do time <span class="etiqueta">{{ frente.selecionados }} selecionados</span></summary>
      <ol class="lista-prioridades"><li v-for="(c, i) in frente.fila.slice(0, limite)" :key="c.id">
        <div class="frente-comercial__linha"><span class="ordem-venda">{{ i + 1 }}</span><div><a :href="`/crm?lead=${encodeURIComponent(c.id)}`"><strong>{{ c.empresa }}</strong></a><p class="texto-2">{{ c.motivo }}</p></div><span class="etiqueta" :aria-label="`Pontuação ${c.nota} de 100`">{{ c.nota }}/100</span></div>
        <details class="frente-comercial__avaliacoes"><summary>Avaliação dos agentes · {{ c.estado === 'enviado' ? 'Mensagem enviada' : c.estado === 'incerto' ? 'Envio em conferência' : 'Em preparação' }}</summary><ul><li v-for="a in c.avaliacoes" :key="a.agente"><strong>{{ a.agente }} · {{ a.nota }}/100</strong><p>{{ a.motivo }}</p></li></ul><blockquote v-if="c.mensagem">{{ c.mensagem }}</blockquote></details>
      </li></ol>
      <button v-if="frente.fila.length > limite" class="botao botao--leve" type="button" @click="limite += 10">Ver mais escolhas</button>
    </details>
    <footer class="frente-comercial__rodape"><template v-if="props.configurar"><button class="botao" type="button" :disabled="!frente || salvando" @click="alterarConfiguracao">{{ salvando ? 'Salvando…' : frente?.ativo ? 'Pausar primeiros contatos' : 'Ativar primeiros contatos' }}</button><p class="texto-2 texto-pequeno">Conta: WhatsApp do PRUMO. Só no expediente e dentro da trava de ritmo da Central, a mesma das telas e do Telegram. A pausa impede novos envios; as conversas continuam disponíveis.</p></template><a v-else class="link-discreto" href="/mais?abrir=primeiros-contatos">Configurar primeiros contatos →</a></footer>
  </section>
</template>
<style scoped>
.frente-comercial { display: grid; gap: var(--esp-4); }
.frente-comercial__linha { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: var(--esp-3); align-items: start; }
.frente-comercial__linha a { color: inherit; }
.frente-comercial__linha p { font-size: var(--tam-apoio); margin-top: var(--esp-1); }
.frente-comercial__avaliacoes { margin: var(--esp-2) 0 0 var(--esp-6); font-size: var(--tam-apoio); }
.frente-comercial__avaliacoes summary { min-height: var(--toque); align-content: center; cursor: pointer; }
.frente-comercial__avaliacoes ul { display: grid; gap: var(--esp-3); padding: var(--esp-3); background: var(--superficie-2); list-style: none; border-radius: var(--raio-controle); }
.frente-comercial__avaliacoes blockquote { margin: var(--esp-3) 0; padding-left: var(--esp-3); border-left: var(--linha-fina); white-space: pre-wrap; }
.frente-comercial__rodape { display: grid; gap: var(--esp-2); padding-top: var(--esp-2); }
.frente-comercial__detalhe { color: var(--texto-2); font-size: var(--tam-apoio); }
.frente-comercial__quem h3 { margin: 0 0 var(--esp-2); font-size: var(--tam-apoio); font-weight: var(--peso-forte); }
.frente-comercial__quem ul { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; font-size: var(--tam-apoio); color: var(--texto-2); }
.frente-comercial__quem strong { display: block; color: var(--texto); font-weight: var(--peso-forte); }
</style>
