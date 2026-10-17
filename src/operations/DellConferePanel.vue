<script setup lang="ts">
import { computed } from 'vue'
import { linkExterno, remedioEmComum, semFraseCortada, soNoDell, type ResumoDoDell } from './alertas'
import type { DellCheck, DellStatus } from './types'

// Tudo que o monitor confere, fechado no fim do Mais. Desde 17/10/2026 (AC-17) é aqui,
// e só aqui, que moram os detalhes técnicos de cada verificação (o "o que fazer" com
// comando e caminho de pasta, o link "No Dell"): a Hoje mostra só o título e manda
// para cá. O resumo vem da mesma regra do topo e da Hoje, para o "N de M ok" bater.
const props = defineProps<{ status: DellStatus | null; resumo: ResumoDoDell; aberto?: boolean }>()

const GRUPOS: Array<[DellCheck['grupo'], string]> = [
  ['servicos', 'Serviços'],
  ['fluxos', 'Fluxos do n8n'],
  ['dados', 'Dados, rotinas e backup'],
  ['containers', 'Containers'],
  ['maquina', 'Máquina'],
]

// Pendências são fila de trabalho, não saúde: ficam no CRM e fora do "N de M ok".
const checks = computed(() => (props.status?.verificacoes ?? []).filter(c => c.grupo !== 'pendencias'))
const porGrupo = computed(() => GRUPOS
  .map(([id, nome]) => ({ id, nome, itens: checks.value.filter(c => c.grupo === id) }))
  .filter(g => g.itens.length))
const emComum = computed(() => remedioEmComum(props.resumo.precisam))
const rotulo = (c: DellCheck) => c.estado === 'falha' ? 'Falhou' : c.estado === 'ok' ? 'Ok' : c.sozinho ? 'Resolve sozinho' : 'Aviso'
const fazer = (c: DellCheck) => (c.estado !== 'ok' && c.oQueFazer ? semFraseCortada(c.oQueFazer) : '')
</script>

<template>
  <section v-if="porGrupo.length" class="painel dell-confere" aria-labelledby="dell-confere-title">
    <details :open="aberto">
      <summary><h2 id="dell-confere-title">Tudo que o Dell confere</h2><span>{{ resumo.textoDoMais }} · abrir</span></summary>
      <p v-if="emComum" class="recado recado--atencao"><strong>{{ emComum.quantas }} pedem a mesma coisa:</strong> {{ emComum.texto }}</p>
      <div v-for="g in porGrupo" :key="g.id" class="dell-confere__grupo">
        <h3>{{ g.nome }}</h3>
        <ul>
          <li v-for="c in g.itens" :key="c.id">
            <span class="dell-dot" :class="`is-${c.estado}`" aria-hidden="true" />
            <strong>{{ c.nome }}</strong>
            <small>
              <span :class="{ 'so-leitor': c.estado === 'ok' }" class="dell-confere__estado">{{ rotulo(c) }}: </span>{{ c.detalhe }}
              <template v-if="fazer(c)"><br><span class="dell-confere__estado">O que fazer: </span>{{ fazer(c) }}</template>
              <!-- O link que resolve fica dentro do texto: como quinto item, a grade da linha o jogaria
                   na coluna do ponto. -->
              <template v-if="c.acao && c.estado !== 'ok'">
                <br><a
                  :href="c.acao.url"
                  :target="linkExterno(c.acao.url) ? '_blank' : undefined"
                  :rel="linkExterno(c.acao.url) ? 'noopener' : undefined"
                >{{ c.acao.rotulo }}<span class="so-leitor">: {{ c.nome }}</span><span v-if="linkExterno(c.acao.url)" aria-hidden="true">↗</span></a>
              </template>
            </small>
            <a v-if="c.link" :href="c.link" target="_blank" rel="noopener">{{ soNoDell(c.link) ? 'No Dell' : 'Abrir' }} <span class="so-leitor">{{ c.nome }}</span><span aria-hidden="true">↗</span></a>
          </li>
        </ul>
      </div>
    </details>
  </section>
</template>
