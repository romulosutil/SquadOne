<script setup lang="ts">
/**
 * Uma sala (um domínio) com quem trabalha nela e os gestos de cada um. Usada
 * na Lista do Escritório e na folha que abre quando se toca num personagem do
 * Mapa. Só emite: quem chama a API é o estado dos agentes.
 *
 * O estado de cada pessoa vem pronto (`estados`, de `estadoDaPessoa`): só com
 * fonte, e `Sem sinal` por extenso quando não há nenhuma.
 */
import { ref } from 'vue'
import type { Dominio, Pessoa } from '../types'
import type { EstadoDaPessoa } from '../casca/hoje'

const props = withDefaults(
  defineProps<{
    dominio: Dominio
    /** dominios[0]: a sala raiz não se arquiva (o PO dela circula pelo escritório). */
    ehRaiz: boolean
    desabilitado: boolean
    estados: Record<string, { estado: EstadoDaPessoa; texto: string }>
    /** Começa com os integrantes à mostra (na folha da sala). */
    aberta?: boolean
  }>(),
  { aberta: false }
)

const emit = defineEmits<{
  contratar: [dominioId: string]
  substituirPo: [dominioId: string]
  editarPessoa: [pessoaId: string]
  arquivarPessoa: [pessoaId: string]
  editarDominio: [dominioId: string]
  arquivarDominio: [dominioId: string]
}>()

/**
 * Integrantes recolhidos, só em memória: dez pessoas numa sala empurravam a
 * lista inteira. Recolher é conforto da vista, não preferência que precise
 * sobreviver a um reload — por isso nada de localStorage.
 */
const expandida = ref(props.aberta || props.dominio.integrantes.length <= 1)
const contagem = (d: Dominio) => (d.integrantes.length ? `${1 + d.integrantes.length} pessoas` : '1 pessoa')
const estadoDe = (p: Pessoa) => props.estados[p.id] ?? { estado: 'sem_sinal' as const, texto: 'Sem sinal' }
</script>

<template>
  <article class="sala" :aria-labelledby="`sala-${dominio.id}`">
    <header class="sala__topo">
      <div class="sala__nome">
        <h3 :id="`sala-${dominio.id}`">{{ dominio.nome }}</h3>
        <p class="texto-2 texto-pequeno">{{ contagem(dominio) }} · {{ dominio.escopo }}</p>
      </div>
      <button type="button" class="botao botao--primario" :disabled="desabilitado" @click="emit('contratar', dominio.id)">
        Contratar<span class="so-leitor"> em {{ dominio.nome }}</span>
      </button>
    </header>

    <ul class="sala__pessoas">
      <!-- PO sempre à vista: é quem responde pela sala. -->
      <li class="pessoa">
        <div class="pessoa__quem">
          <strong>{{ dominio.po.nome }}</strong>
          <span class="texto-2 texto-pequeno">{{ dominio.po.papel }} · PO</span>
          <span class="estado" :class="`is-${estadoDe(dominio.po).estado}`">{{ estadoDe(dominio.po).texto }}</span>
        </div>
        <div class="pessoa__acoes">
          <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('editarPessoa', dominio.po.id)">
            Editar<span class="so-leitor"> o treino de {{ dominio.po.nome }}</span>
          </button>
          <!-- PO não se arquiva: substitui-se, e o anterior vira integrante arquivado. -->
          <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('substituirPo', dominio.id)">
            Substituir<span class="so-leitor"> o PO de {{ dominio.nome }}</span>
          </button>
        </div>
      </li>
      <template v-if="expandida">
        <li v-for="p in dominio.integrantes" :key="p.id" class="pessoa">
          <div class="pessoa__quem">
            <strong>{{ p.nome }}</strong>
            <span class="texto-2 texto-pequeno">{{ p.papel }}</span>
            <span class="estado" :class="`is-${estadoDe(p).estado}`">{{ estadoDe(p).texto }}</span>
          </div>
          <div class="pessoa__acoes">
            <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('editarPessoa', p.id)">
              Editar<span class="so-leitor"> o treino de {{ p.nome }}</span>
            </button>
            <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('arquivarPessoa', p.id)">
              Arquivar<span class="so-leitor">{{ ` ${p.nome}` }}</span>
            </button>
          </div>
        </li>
      </template>
    </ul>

    <!-- Não desabilita com o roster ocupado: abrir a lista não escreve nada. -->
    <button
      v-if="dominio.integrantes.length > 1"
      type="button"
      class="botao botao--leve botao--largo"
      :aria-expanded="expandida"
      @click="expandida = !expandida"
    >
      {{ expandida ? 'Recolher os integrantes' : `Mostrar ${dominio.integrantes.length} integrantes` }}
    </button>

    <!-- Encaixe para a operação da sala (SalaOperacao: leads da jornada e robôs, só leitura). -->
    <slot name="rodape" />

    <div class="acoes sala__gestos">
      <button type="button" class="botao botao--leve" :disabled="desabilitado" @click="emit('editarDominio', dominio.id)">
        Editar a sala<span class="so-leitor">{{ ` ${dominio.nome}` }}</span>
      </button>
      <button type="button" class="botao botao--leve" :disabled="desabilitado || ehRaiz" @click="emit('arquivarDominio', dominio.id)">
        Arquivar a sala<span class="so-leitor">{{ ` ${dominio.nome}` }}</span>
      </button>
    </div>
    <p v-if="ehRaiz" class="texto-2 texto-pequeno">
      Sala raiz: não se arquiva (o PO dela circula pelo escritório). Arquive a squad inteira ou substitua o PO.
    </p>
  </article>
</template>

<style>
.sala { display: grid; gap: var(--esp-3); padding: var(--esp-4); border: var(--linha); background: var(--superficie); box-shadow: var(--sombra); }
.sala__topo { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--esp-2); }
.sala__nome { display: grid; gap: var(--esp-1); min-width: 0; flex: 1 1 12rem; }
.sala__nome h3 { margin: 0; font-size: var(--tam-nome); font-weight: var(--peso-titulo); overflow-wrap: anywhere; }
.sala__nome p { margin: 0; overflow-wrap: anywhere; }
.sala__pessoas { display: grid; gap: var(--esp-2); margin: 0; padding: 0; list-style: none; }
.pessoa { display: grid; gap: var(--esp-2); padding: var(--esp-2) var(--esp-3); border: var(--linha-fina); background: var(--superficie-2); }
.pessoa__quem { display: grid; gap: var(--esp-0); min-width: 0; }
.pessoa__quem strong { overflow-wrap: anywhere; }
.pessoa__quem span { overflow-wrap: anywhere; }
.pessoa__acoes { display: flex; flex-wrap: wrap; gap: var(--esp-2); }
.sala__gestos { border-top: var(--linha-fina); padding-top: var(--esp-3); }
@media (min-width: 40rem) {
  .pessoa { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
}
</style>
