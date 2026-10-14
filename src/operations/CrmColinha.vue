<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import CrmMomento from './CrmMomento.vue'
import CrmObjecao from './CrmObjecao.vue'
import CrmTrecho from './CrmTrecho.vue'
import { CARDAPIO, CDL, FRASE_SOB_PROPOSTA, OBJECOES, ROTEIRO, ROTULO_DA_ETAPA, ROTULO_DO_TIPO, precoDaTabela, precoParaOCliente, type Trecho } from './colinha'
import { ROTULO_DO_PRODUTO } from './crm-formato'
import type { CrmProduto } from './types'

// A colinha inteira (/crm?ver=colinha, 08/10/2026): tudo para consultar durante
// uma ligação, sem precisar de lead aberto. É estática (colinha.ts), então
// aparece mesmo com o retrato do CRM ilegível ou fora do ar.
// Sem lead não há número: só Copiar, nunca WhatsApp. O nome digitado aqui fica
// só na memória da tela (não vai para a planilha nem para o endereço).
const props = defineProps<{ produto: 'todos' | CrmProduto }>()

const nome = ref('')
// Com o campo vazio, os marcadores ficam à mostra; preenchido, {NOME} e {ARTIGO}
// viram o nome, e {URL} vira "[link do demo]" (só a ficha do lead sabe o link).
const lead = computed(() => (nome.value.trim() ? { empresa: nome.value.trim(), links: {} } : undefined))

const serve = (t: Trecho) => props.produto === 'todos' || t.produtos.includes(props.produto)

// O filtro de produto tira os trechos que não servem; o momento que ficou sem
// nada por causa do filtro some (ex.: "Depois do pode mandar" só tem texto do
// Site). Momento ainda sem texto nenhum fica, se tiver objetivo: diz o que a
// conversa precisa conseguir ali.
const momentos = computed(() => ROTEIRO.flatMap((p) => {
  const trechos = p.trechos.filter(serve)
  if (trechos.length || p.perguntas?.length) return [{ ...p, trechos }]
  return !p.trechos.length && p.objetivo ? [{ ...p, trechos }] : []
}))
const objecoes = computed(() => OBJECOES.filter((o) => serve(o.resposta)))
const cdl = computed(() => CDL.filter(serve))
const filtrado = computed(() => (props.produto === 'todos' ? '' : ` para ${ROTULO_DO_PRODUTO[props.produto]}`))

const PARTES = [
  { id: 'crm-colinha-cardapio', rotulo: 'Cardápio' },
  { id: 'crm-colinha-roteiro', rotulo: 'Roteiro' },
  { id: 'crm-colinha-objecoes', rotulo: 'Objeções' },
  { id: 'crm-colinha-cdl', rotulo: 'CDL' },
]

// Rolagem e foco à mão em vez do #âncora: o fragmento entraria no histórico e o
// "voltar" do celular passaria a andar dentro da página em vez de sair dela.
async function irPara(id: string) {
  await nextTick()
  const alvo = document.getElementById(id)
  if (!alvo) return
  alvo.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
  alvo.focus({ preventScroll: true })
}
</script>

<template>
  <div class="crm-colinha">
    <header class="crm-colinha__topo">
      <span class="crm-kicker">PRUMO · atendimento</span>
      <h2 id="crm-colinha-titulo" tabindex="-1">Colinha</h2>
      <p class="crm-muted">O que dizer em cada momento da conversa. Na ficha de cada lead, a parte que serve para ele aparece já com o nome e o link.</p>
      <nav class="crm-colinha__indice" aria-label="Partes da colinha">
        <a v-for="p in PARTES" :key="p.id" :href="`#${p.id}`" @click.prevent="irPara(p.id)">{{ p.rotulo }}</a>
      </nav>
      <label class="crm-colinha__campo">
        <span>Nome da empresa <small>(opcional)</small></span>
        <input v-model="nome" type="text" maxlength="120" autocomplete="off" placeholder="Ex.: Clínica Bem Viver">
      </label>
      <p class="crm-colinha__dica">
        <template v-if="lead">Os textos abaixo já levam “{{ lead.empresa }}”. O link do demo fica como [link do demo]: complete antes de mandar.</template>
        <template v-else>Vazio, os campos <mark class="crm-colinha__marca">{NOME}</mark> e <mark class="crm-colinha__marca">{URL}</mark> ficam à mostra nos textos.</template>
      </p>
    </header>

    <section class="crm-colinha__secao" aria-labelledby="crm-colinha-cardapio">
      <h2 id="crm-colinha-cardapio" tabindex="-1">Cardápio</h2>
      <!-- A hierarquia de 09/10/2026: a ordem do cardápio é a do caminho, e cada oferta é de um tipo só. -->
      <p class="crm-muted">Ver → arrumar → manter. O Raio-X é a porta de todos; o Mapa vem depois dele, só com empresa com equipe; a Fonte, só depois do Mapa.</p>
      <ul class="crm-colinha__cardapio">
        <li v-for="s in CARDAPIO" :key="s.id" class="crm-colinha__servico">
          <span class="crm-kicker">{{ ROTULO_DA_ETAPA[s.etapa] }} · {{ ROTULO_DO_TIPO[s.tipo] }}</span>
          <h3>{{ s.nome }}</h3>
          <!-- Sob proposta: o cliente ouve a frase sem número; a base da proposta fica só para o Rômulo. -->
          <p class="crm-colinha__preco">{{ precoParaOCliente(s) }}</p>
          <template v-if="s.sobProposta">
            <p><strong>Para o cliente:</strong> “{{ FRASE_SOB_PROPOSTA }}”</p>
            <p class="crm-colinha__dica"><strong>Base da proposta (só para você):</strong> {{ precoDaTabela(s) }}</p>
          </template>
          <p v-if="s.entrega">{{ s.entrega }}</p>
          <p v-if="s.paraQuem" class="crm-colinha__dica"><strong>Para quem:</strong> {{ s.paraQuem }}</p>
        </li>
      </ul>
    </section>

    <section class="crm-colinha__secao" aria-labelledby="crm-colinha-roteiro">
      <h2 id="crm-colinha-roteiro" tabindex="-1">Roteiro</h2>
      <CrmMomento v-for="m in momentos" :key="m.momento" :passo="m" :lead="lead" :nivel="3" />
      <p v-if="!momentos.length" class="crm-muted">Nenhum momento com texto{{ filtrado }}.</p>
    </section>

    <section class="crm-colinha__secao" aria-labelledby="crm-colinha-objecoes">
      <h2 id="crm-colinha-objecoes" tabindex="-1">Objeções</h2>
      <CrmObjecao v-for="o in objecoes" :key="o.id" :objecao="o" :lead="lead" :nivel="3" />
      <p v-if="!objecoes.length" class="crm-muted">Nenhuma objeção{{ filtrado }}.</p>
    </section>

    <section class="crm-colinha__secao" aria-labelledby="crm-colinha-cdl">
      <h2 id="crm-colinha-cdl" tabindex="-1">CDL</h2>
      <p class="crm-muted">O que mandar à CDL (por ela o associado pode entrar direto no Mapa) e ao associado que vier dela.</p>
      <CrmTrecho v-for="t in cdl" :key="t.id" :trecho="t" :lead="lead" />
      <p v-if="!cdl.length" class="crm-muted">Nenhum texto para a CDL ainda{{ filtrado }}.</p>
    </section>
  </div>
</template>
