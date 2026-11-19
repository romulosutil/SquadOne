<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CarteiraCrm, ContaDaCarteira, OportunidadeDaCarteira } from './carteira-crm'
import { ROTULO_DO_PRODUTO, dataHora } from './crm-formato'
import { conversasParaConduzir } from './conversas-para-conduzir'
import { indexarResponsaveisDaConversa, telefoneDaConversa } from './responsavel-conversa'
import { ESTADO_WHATSAPP, resumirFicha } from './fila-da-carteira'
import type { CanaisComerciais } from './canais-comerciais'
import type { CrmLead } from './types'

const props = defineProps<{ carteira?: CarteiraCrm; disponivel: boolean; leads: CrmLead[]; agora: number; canais: CanaisComerciais | null }>()
const emit = defineEmits<{ abrir: [id: string, origem: HTMLElement | null] }>()
const busca = ref('')
const limite = ref(20)
const recorte = ref<'atencao' | 'oportunidades' | 'encerradas' | 'conversas' | 'cadastros'>('atencao')
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
const oportunidadesPorId = computed(() => new Map((props.carteira?.oportunidades ?? []).map(o => [o.id, o])))
const conversasPorId = computed(() => new Map((props.carteira?.conversas ?? []).map(c => [c.id, c])))
const fichas = computed(() => {
  const pendencias = new Map(conversasParaConduzir(props.leads, props.agora).map(p => [p.lead.id, p]))
  const responsaveis = indexarResponsaveisDaConversa(props.leads, props.agora)
  return new Map(props.leads.map(lead => {
    const oportunidade = oportunidadesPorId.value.get(lead.id)
    const registro = props.canais?.whatsapp.porFicha[lead.id]
    const resumo = resumirFicha(lead, props.agora, registro, pendencias.get(lead.id), oportunidade,
      responsaveis.get(telefoneDaConversa(lead) ?? ''))
    return [lead.id, { lead, oportunidade, registro, ...resumo }]
  }))
})
const prioridade = (f: { prioridade: number | null }) => f.prioridade ?? Infinity
const horaDoEvento = (f: { ultimo?: { em: string } }) => Date.parse(f.ultimo?.em ?? '') || 0
const contas = computed(() => {
  const termo = normalizar(busca.value.trim())
  return (props.carteira?.contas ?? []).flatMap(conta => {
    if (termo && !normalizar(`${conta.nome} ${conta.fontes.map(f => ROTULO_DO_PRODUTO[f]).join(' ')}`).includes(termo)) return []
    if (recorte.value === 'conversas' && !conta.conversaIds.some(id => conversasPorId.value.get(id)?.humana)) return []
    const relacoes = conta.relacoes.map(id => fichas.value.get(id)).filter(f => f !== undefined).filter(f => {
      if (recorte.value === 'atencao') return f.prioridade !== null
      if (recorte.value === 'oportunidades') return f.oportunidade && f.oportunidade.situacao !== 'encerrada'
      if (recorte.value === 'encerradas') return f.oportunidade?.situacao === 'encerrada'
      if (recorte.value === 'conversas') return conta.conversaIds.some(id => {
        const conversa = conversasPorId.value.get(id)
        return conversa?.humana && conversa.relacoes.includes(f.lead.id)
      })
      return true
    }).sort((a, b) => prioridade(a) - prioridade(b) || horaDoEvento(b) - horaDoEvento(a))
    return relacoes.length ? [{ conta, relacoes, prioridade: prioridade(relacoes[0]) }] : []
  }).sort((a, b) => a.prioridade - b.prioridade || (Number.isFinite(a.prioridade) ? horaDoEvento(b.relacoes[0]) - horaDoEvento(a.relacoes[0]) : 0) || a.conta.nome.localeCompare(b.conta.nome, 'pt-BR'))
})
watch([busca, recorte], () => { limite.value = 20 })
const dinheiro = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const rotuloOferta = (o: OportunidadeDaCarteira) => o.oferta ? ROTULO_DO_PRODUTO[o.oferta] : 'Oferta a confirmar'
const ofertasDaConta = (c: ContaDaCarteira) => [...new Set(c.origens.map(o => o.oferta ? ROTULO_DO_PRODUTO[o.oferta] : 'Oferta a confirmar'))].join(' · ')
const alertasDaConta = (c: ContaDaCarteira) => [...new Set([...c.alertas, ...c.conversaIds.flatMap(id => conversasPorId.value.get(id)?.alertas ?? [])])]
function abrir(id: string, e: MouseEvent) { emit('abrir', id, e.currentTarget instanceof HTMLElement ? e.currentTarget : null) }
</script>

<template>
  <section class="carteira-comercial" aria-labelledby="carteira-titulo">
    <h2 id="carteira-titulo">Carteira comercial</h2>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">A leitura está indisponível ou atrasada. Confira a fonte antes de decidir a próxima ação.</p>
    <p v-if="!carteira || !carteira.cobertura.fonteDisponivel" class="texto-2" role="status">A fonte da carteira está indisponível. Não é possível confirmar as contagens ou a ausência de oportunidades. Confira a leitura e tente atualizar Vendas.</p>
    <template v-else>
      <form class="carteira-comercial__filtros" role="search" @submit.prevent>
        <label>Buscar empresa<input v-model="busca" type="search" class="campo" autocomplete="off" placeholder="Nome da empresa" /></label>
        <label>Mostrar<select v-model="recorte" class="campo"><option value="atencao">Precisa de atenção</option><option value="oportunidades">Oportunidades abertas e em revisão</option><option value="encerradas">Oportunidades encerradas</option><option value="conversas">Conversas humanas</option><option value="cadastros">Todos os cadastros</option></select></label>
      </form>
      <p class="texto-2 texto-pequeno" aria-live="polite">{{ contas.length }} conta{{ contas.length === 1 ? '' : 's' }} neste recorte.</p>
      <p v-if="!contas.length" class="carteira-comercial__vazio">
        <template v-if="busca">Nenhuma empresa corresponde à busca. Tente outro nome ou mude o recorte.</template>
        <template v-else-if="recorte === 'atencao'">{{ disponivel ? 'Nenhuma ficha pede atenção nesta leitura.' : 'Aguarde uma leitura válida para conferir as pendências.' }}</template>
        <template v-else-if="recorte === 'oportunidades'">Nenhuma oportunidade comprovada neste recorte.</template>
        <template v-else>Nenhum registro neste recorte.</template>
      </p>
      <ul v-else class="carteira-comercial__lista" aria-label="Contas da carteira">
        <li v-for="{ conta, relacoes } in contas.slice(0, limite)" :key="conta.id">
          <header class="carteira-comercial__empresa">
            <h3>{{ conta.nome }}</h3>
            <span v-if="conta.identidade === 'provisoria'" class="texto-2 texto-pequeno">Identidade da empresa a conferir</span>
          </header>
          <details v-if="alertasDaConta(conta).length"><summary>Identidade e fontes</summary><ul><li v-for="a in alertasDaConta(conta)" :key="a">{{ a }}</li></ul><p class="texto-2 texto-pequeno">{{ ofertasDaConta(conta) }}. Os vínculos conservam os registros de origem.</p></details>
          <article v-for="ficha in relacoes" :key="ficha.lead.id" class="carteira-comercial__oportunidade">
            <div>
              <strong>{{ ficha.oportunidade ? rotuloOferta(ficha.oportunidade) : ROTULO_DO_PRODUTO[ficha.lead.produto] }}</strong>
              <p v-if="ficha.revisao" class="texto-pequeno">Conferir a captura ou o vínculo da resposta</p>
              <p v-if="ficha.registro && ficha.registro.estado !== 'enviado'" class="texto-pequeno">{{ ESTADO_WHATSAPP[ficha.registro.estado] }} · WhatsApp</p>
            </div>
            <dl class="carteira-comercial__acao">
              <div>
                <dt>Último evento confirmado</dt>
                <dd v-if="ficha.ultimo">{{ ficha.ultimo.rotulo }} · <time :datetime="ficha.ultimo.em">{{ dataHora(ficha.ultimo.em) }}</time></dd>
                <dd v-else>Sem evento disponível</dd>
              </div>
              <div><dt>Responsável</dt><dd>{{ ficha.dono }}</dd></div>
              <div><dt>Próxima ação</dt><dd>{{ ficha.proximo }}</dd></div>
            </dl>
            <details v-if="ficha.oportunidade">
              <summary>Evidências da oportunidade</summary>
              <p class="carteira-comercial__marcos">
                <span v-if="ficha.oportunidade.propostaEnviada">Proposta enviada</span>
                <span v-if="ficha.oportunidade.contratacaoConfirmada">Contratação confirmada</span>
                <span v-if="ficha.oportunidade.recebidoCentavos > 0">Recebido {{ dinheiro(ficha.oportunidade.recebidoCentavos) }}</span>
              </p>
              <ul><li v-for="e in ficha.oportunidade.evidencias" :key="e">{{ e }}</li><li v-for="a in ficha.oportunidade.alertas" :key="a">{{ a }}</li></ul>
            </details>
            <button type="button" class="botao botao--leve" @click="abrir(ficha.lead.id, $event)">Abrir ficha <span class="so-leitor">de {{ ficha.lead.empresa }}</span></button>
          </article>
        </li>
      </ul>
      <button v-if="contas.length > limite" class="botao botao--leve" type="button" @click="limite += 20">Mostrar mais contas</button>
      <details class="dobra carteira-comercial__cobertura">
        <summary>Cadastros, oportunidades e qualidade da carteira</summary>
      <dl class="carteira-comercial__balanco" aria-label="Marcos comerciais registrados nesta leitura">
        <div><dt>Oportunidades abertas</dt><dd>{{ carteira.contagens.oportunidadesAtivas + carteira.contagens.oportunidadesEmRevisao }}</dd></div>
        <div><dt>Propostas enviadas</dt><dd>{{ carteira.contagens.propostasEnviadas }}</dd></div>
        <div><dt>Contratações confirmadas</dt><dd>{{ carteira.contagens.contratacoesConfirmadas }}</dd></div>
        <div><dt>Com recebimento</dt><dd>{{ carteira.contagens.comRecebimento }}</dd></div>
      </dl>
        <p>{{ carteira.contagens.cadastros }} registros de origem; {{ carteira.contagens.contas }} contas, sendo {{ carteira.contagens.contasProvisorias }} com identidade provisória. Contas provisórias podem representar a mesma empresa e precisam de conferência.</p>
        <p>{{ carteira.contagens.conversasHumanas }} conversas com participação humana observada. Resposta ou permissão para material não confirma oportunidade.</p>
        <ul v-if="carteira.cobertura.alertas.length"><li v-for="a in carteira.cobertura.alertas" :key="a">{{ a }}</li></ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.carteira-comercial { display: grid; gap: var(--esp-4); min-width: 0; }
.carteira-comercial h2 { margin: 0; }
.carteira-comercial__balanco { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: var(--esp-4); margin: 0; padding-block: var(--esp-4); border-block: var(--divisor); }
.carteira-comercial__balanco dt { color: var(--texto-2); font-size: var(--tam-apoio); }
.carteira-comercial__balanco dd { margin: var(--esp-1) 0 0; font-weight: var(--peso-forte); font-size: var(--tam-nome); font-variant-numeric: tabular-nums; }
.carteira-comercial__filtros { display: flex; gap: var(--esp-4); flex-wrap: wrap; }
.carteira-comercial__filtros label { display: grid; gap: var(--esp-2); flex: 1 1 12rem; font-size: var(--tam-apoio); }
.carteira-comercial__filtros .campo { width: 100%; min-width: 0; min-height: var(--toque); }
.carteira-comercial__lista { list-style: none; margin: 0; padding: 0; }
.carteira-comercial__lista > li { padding-block: var(--esp-5); border-bottom: var(--divisor); overflow-wrap: anywhere; }
.carteira-comercial__lista > li:first-child { padding-top: 0; }
.carteira-comercial__empresa { display: flex; justify-content: space-between; gap: var(--esp-3); flex-wrap: wrap; align-items: baseline; }
.carteira-comercial__empresa h3 { font-size: var(--tam-nome); margin: 0; }
.carteira-comercial__oportunidade { display: grid; justify-items: start; gap: var(--esp-2); padding-top: var(--esp-3); }
.carteira-comercial__marcos { display: flex; flex-wrap: wrap; gap: var(--esp-3); align-items: baseline; }
.carteira-comercial__marcos span { font-size: var(--tam-apoio); }
.carteira-comercial__oportunidade p { margin: 0; }
.carteira-comercial__acao { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 0.7fr) minmax(0, 1.2fr); gap: var(--esp-3); width: 100%; margin: 0; }
.carteira-comercial__acao dt { color: var(--texto-2); font-size: var(--tam-apoio); }
.carteira-comercial__acao dd { margin: var(--esp-1) 0 0; }
@media (max-width: 42rem) { .carteira-comercial__acao { grid-template-columns: 1fr; } }
.carteira-comercial details summary { cursor: pointer; min-height: var(--toque); align-content: center; }
.carteira-comercial details ul { padding-left: var(--esp-5); line-height: 1.6; }
.carteira-comercial__cobertura p { margin-top: var(--esp-3); max-width: var(--leitura-max); }
.carteira-comercial__vazio { padding-block: var(--esp-4); max-width: var(--leitura-max); }
.carteira-comercial :focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
@media (max-width: 39.99rem) { .carteira-comercial__balanco { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
