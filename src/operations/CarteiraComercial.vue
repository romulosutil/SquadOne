<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CarteiraCrm, ContaDaCarteira, OportunidadeDaCarteira } from './carteira-crm'
import { ROTULO_DO_PRODUTO, diaEscolhido } from './crm-formato'

const props = defineProps<{ carteira?: CarteiraCrm; disponivel: boolean }>()
const emit = defineEmits<{ abrir: [id: string, origem: HTMLElement | null] }>()
const busca = ref('')
const limite = ref(20)
const recorte = ref<'oportunidades' | 'encerradas' | 'conversas' | 'cadastros'>('oportunidades')
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR')
const oportunidadesPorId = computed(() => new Map((props.carteira?.oportunidades ?? []).map(o => [o.id, o])))
const conversasPorId = computed(() => new Map((props.carteira?.conversas ?? []).map(c => [c.id, c])))
const contas = computed(() => {
  const termo = normalizar(busca.value.trim())
  return (props.carteira?.contas ?? []).filter(c => {
    if (recorte.value === 'oportunidades' && !c.oportunidadeIds.some(id => oportunidadesPorId.value.get(id)?.situacao !== 'encerrada')) return false
    if (recorte.value === 'encerradas' && !c.oportunidadeIds.some(id => oportunidadesPorId.value.get(id)?.situacao === 'encerrada')) return false
    if (recorte.value === 'conversas' && !c.conversaIds.some(id => conversasPorId.value.get(id)?.humana)) return false
    return !termo || normalizar(`${c.nome} ${c.fontes.map(f => ROTULO_DO_PRODUTO[f]).join(' ')}`).includes(termo)
  }).sort((a, b) => b.oportunidadeIds.length - a.oportunidadeIds.length || a.nome.localeCompare(b.nome, 'pt-BR'))
})
watch([busca, recorte], () => { limite.value = 20 })
const oportunidadeDaConta = (ids: string[]) => ids.map(id => oportunidadesPorId.value.get(id)).filter(o => o !== undefined)
  .filter(o => recorte.value === 'oportunidades' ? o.situacao !== 'encerrada' : recorte.value === 'encerradas' ? o.situacao === 'encerrada' : true)
const dinheiro = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const rotuloOferta = (o: OportunidadeDaCarteira) => o.oferta ? ROTULO_DO_PRODUTO[o.oferta] : 'Oferta a confirmar'
const ofertasDaConta = (c: ContaDaCarteira) => [...new Set(c.origens.map(o => o.oferta ? ROTULO_DO_PRODUTO[o.oferta] : 'Oferta a confirmar'))].join(' · ')
const alertasDaConta = (c: ContaDaCarteira) => [...new Set([...c.alertas, ...c.conversaIds.flatMap(id => conversasPorId.value.get(id)?.alertas ?? [])])]
function abrir(id: string, e: MouseEvent) { emit('abrir', id, e.currentTarget instanceof HTMLElement ? e.currentTarget : null) }
</script>

<template>
  <section class="carteira-comercial" aria-labelledby="carteira-titulo">
    <header class="cabecalho-bloco">
      <div>
        <h2 id="carteira-titulo">Carteira comercial</h2>
        <p class="texto-2">Acompanhe necessidades, propostas e recebimentos. Cadastros pesquisados ficam separados das oportunidades.</p>
      </div>
    </header>
    <p v-if="!disponivel" class="recado recado--atencao" role="status">A leitura está indisponível ou atrasada. Confira a fonte antes de decidir a próxima ação.</p>
    <p v-if="!carteira || !carteira.cobertura.fonteDisponivel" class="texto-2" role="status">A fonte da carteira está indisponível. Não é possível confirmar as contagens ou a ausência de oportunidades. Confira a leitura e tente atualizar Vendas.</p>
    <template v-else>
      <dl class="carteira-comercial__balanco" aria-label="Marcos comerciais registrados nesta leitura">
        <div><dt>Oportunidades abertas</dt><dd>{{ carteira.contagens.oportunidadesAtivas + carteira.contagens.oportunidadesEmRevisao }}</dd></div>
        <div><dt>Propostas enviadas</dt><dd>{{ carteira.contagens.propostasEnviadas }}</dd></div>
        <div><dt>Contratações confirmadas</dt><dd>{{ carteira.contagens.contratacoesConfirmadas }}</dd></div>
        <div><dt>Com recebimento</dt><dd>{{ carteira.contagens.comRecebimento }}</dd></div>
      </dl>
      <p class="texto-2 texto-pequeno">{{ carteira.contagens.oportunidadesEmRevisao }} oportunidade{{ carteira.contagens.oportunidadesEmRevisao === 1 ? '' : 's' }} precisa{{ carteira.contagens.oportunidadesEmRevisao === 1 ? '' : 'm' }} de revisão. Propostas, contratações e recebimentos incluem os fatos históricos registrados.</p>
      <form class="carteira-comercial__filtros" role="search" @submit.prevent>
        <label>Buscar empresa<input v-model="busca" type="search" class="campo" autocomplete="off" placeholder="Nome da empresa" /></label>
        <label>Mostrar<select v-model="recorte" class="campo"><option value="oportunidades">Oportunidades abertas e em revisão</option><option value="encerradas">Oportunidades encerradas</option><option value="conversas">Conversas humanas</option><option value="cadastros">Todos os cadastros</option></select></label>
      </form>
      <p class="texto-2 texto-pequeno" aria-live="polite">{{ contas.length }} conta{{ contas.length === 1 ? '' : 's' }} neste recorte.</p>
      <p v-if="!contas.length" class="carteira-comercial__vazio">
        <template v-if="busca">Nenhuma empresa corresponde à busca. Tente outro nome ou mude o recorte.</template>
        <template v-else-if="recorte === 'oportunidades'">Nenhuma oportunidade comprovada neste recorte. Revise as conversas para registrar a necessidade e a intenção de avaliar uma solução, ou conferir propostas já enviadas.</template>
        <template v-else>Nenhum registro neste recorte.</template>
      </p>
      <ul v-else class="carteira-comercial__lista" aria-label="Contas da carteira">
        <li v-for="conta in contas.slice(0, limite)" :key="conta.id">
          <header class="carteira-comercial__empresa">
            <h3>{{ conta.nome }}</h3>
            <span v-if="conta.identidade === 'provisoria'" class="texto-2 texto-pequeno">Identidade da empresa a conferir</span>
          </header>
          <details v-if="alertasDaConta(conta).length"><summary>Identidade e fontes</summary><ul><li v-for="a in alertasDaConta(conta)" :key="a">{{ a }}</li></ul><p class="texto-2 texto-pequeno">{{ ofertasDaConta(conta) }}. Os vínculos conservam os registros de origem.</p></details>
          <template v-if="conta.oportunidadeIds.length">
            <article v-for="o in oportunidadeDaConta(conta.oportunidadeIds)" :key="o.id" class="carteira-comercial__oportunidade">
              <p class="carteira-comercial__marcos"><strong>{{ rotuloOferta(o) }}</strong><span v-if="o.canal === 'plus'">Canal: Plus</span><span v-if="o.propostaEnviada">Proposta enviada</span><span v-if="o.contratacaoConfirmada">Contratação confirmada</span><span v-if="o.recebidoCentavos > 0">Recebido: {{ dinheiro(o.recebidoCentavos) }}</span></p>
              <p class="texto-2 texto-pequeno">{{ o.situacao === 'encerrada' ? 'Encerrada; conferir o motivo no histórico antes de qualquer ação.' : o.situacao === 'revisar' ? 'Revisar contexto e pendências.' : 'Em andamento.' }}</p>
              <p v-if="o.proximoPasso"><strong>Próxima ação:</strong> {{ o.proximoPasso.texto }} <span v-if="o.proximoPasso.data" class="texto-2">{{ diaEscolhido(o.proximoPasso.data) }}</span></p>
              <p v-else class="texto-2">Próxima ação ainda não registrada.</p>
              <p class="texto-2 texto-pequeno">Responsável: {{ o.responsavel === 'romulo' ? 'Rômulo' : o.responsavel === 'time' ? 'Time' : 'a definir' }}.</p>
              <details><summary>Evidências e pendências</summary><ul><li v-for="e in o.evidencias" :key="e">{{ e }}</li><li v-for="a in o.alertas" :key="a">{{ a }}</li></ul></details>
              <button type="button" class="botao botao--leve" @click="abrir(o.id, $event)">Abrir oportunidade</button>
            </article>
          </template>
          <template v-else>
            <p class="texto-2">{{ ofertasDaConta(conta) }}. Necessidade e intenção de compra ainda não comprovadas.</p>
            <button type="button" class="botao botao--leve" @click="abrir(conta.relacoes[0], $event)">Conferir histórico</button>
          </template>
        </li>
      </ul>
      <button v-if="contas.length > limite" class="botao botao--leve" type="button" @click="limite += 20">Mostrar mais contas</button>
      <details class="dobra carteira-comercial__cobertura">
        <summary>Cadastros e qualidade da carteira</summary>
        <p>{{ carteira.contagens.cadastros }} registros de origem; {{ carteira.contagens.contas }} contas, sendo {{ carteira.contagens.contasProvisorias }} com identidade provisória. Contas provisórias podem representar a mesma empresa e precisam de conferência.</p>
        <p>{{ carteira.contagens.conversasHumanas }} conversas com participação humana observada. Resposta ou permissão para material não confirma oportunidade.</p>
        <ul v-if="carteira.cobertura.alertas.length"><li v-for="a in carteira.cobertura.alertas" :key="a">{{ a }}</li></ul>
      </details>
    </template>
  </section>
</template>

<style scoped>
.carteira-comercial { display: grid; gap: var(--esp-4); min-width: 0; }
.carteira-comercial header p { margin-top: var(--esp-2); max-width: var(--leitura-max); }
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
.carteira-comercial details summary { cursor: pointer; min-height: var(--toque); align-content: center; }
.carteira-comercial details ul { padding-left: var(--esp-5); line-height: 1.6; }
.carteira-comercial__cobertura p { margin-top: var(--esp-3); max-width: var(--leitura-max); }
.carteira-comercial__vazio { padding-block: var(--esp-4); max-width: var(--leitura-max); }
.carteira-comercial :focus-visible { outline: 3px solid var(--foco); outline-offset: 2px; }
@media (max-width: 39.99rem) { .carteira-comercial__balanco { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
