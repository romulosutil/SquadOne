/**
 * PURO (16/10/2026): o catálogo do blueprint. Cada peça tem um código fixo (BP-…)
 * para a gente se referir a ela numa conversa sem ambiguidade: "o BP-ESCOLHAS está
 * alto demais no celular" diz qual componente, em que arquivo e sob que regra.
 * Código uma vez publicado não muda nem se reaproveita (o teste confere que são únicos).
 */

export interface PecaDoCatalogo {
  id: string
  nome: string
  /** A classe (ou o componente) que se usa no template. */
  classe: string
  /** Onde mora o estilo ou o componente. */
  onde: string
  /** A regra de uso, numa frase. */
  regra: string
}

export const CATALOGO: readonly PecaDoCatalogo[] = [
  { id: 'BP-BLOCO', nome: 'Bloco', classe: '.bloco', onde: 'estilos/agentes.css', regra: 'O único nível de contorno da tela ou da folha: 2 px, --raio-bloco, sem sombra. Dentro dele, nada com borda.' },
  { id: 'BP-ZONA', nome: 'Zona', classe: '.zona, .zona--realce, .zona--ok, .zona--atencao, .zona--erro', onde: 'estilos/agentes.css', regra: 'Agrupa dentro de um bloco por fundo, sem borda. O realce é o "o que fazer agora": um por bloco.' },
  { id: 'BP-BOTAO', nome: 'Botão', classe: '.botao, .botao--primario, .botao--leve, .botao--perigo', onde: 'estilos/agentes.css', regra: 'Três degraus: primário (amarelo e sombra, um por tela ou folha), secundário (contorno), leve (só fundo). Link que age é .botao também.' },
  { id: 'BP-MAIS-ACOES', nome: 'Mais ações', classe: 'details.mais-acoes > ul.lista-acoes', onde: 'estilos/agentes.css', regra: 'À vista, um primário e no máximo um secundário; o resto vem para cá, em lista. Nunca três botões ou mais em fileira.' },
  { id: 'BP-NUMERO', nome: 'Número grande', classe: '.numero-grande', onde: 'estilos/agentes.css', regra: 'O número protagonista de um bloco (total, contagem), com o rótulo colado. Um por bloco.' },
  { id: 'BP-SEGMENTADO', nome: 'Segmentado', classe: '.segmentado', onde: 'estilos/agentes.css', regra: 'Duas a quatro opções curtas, numa linha, em --raio-controle. Escolhido em --destaque, com aria-pressed.' },
  { id: 'BP-ESCOLHAS', nome: 'Escolhas', classe: '.escolhas', onde: 'estilos/agentes.css', regra: 'Chips em pílula que quebram linha: rótulo longo ou número variável de opções. É escolha, não ação.' },
  { id: 'BP-SELO', nome: 'Selo', classe: '.selo, .selo--ok, .selo--atencao, .selo--erro, .selo--destaque', onde: 'estilos/agentes.css', regra: 'Uma ou duas palavras, em caixa alta, 1 px e --raio-selo. A cor só reforça a palavra.' },
  { id: 'BP-RECADO', nome: 'Recado', classe: '.recado, .recado--ok, .recado--atencao, .recado--erro', onde: 'estilos/agentes.css', regra: 'Uma frase de estado dentro de um bloco, sem borda (é uma zona). Sempre diz o que fazer, não só o que houve.' },
  { id: 'BP-CAMPO', nome: 'Campo', classe: '.rotulo + .campo', onde: 'estilos/agentes.css', regra: '16 px de texto (o iOS não dá zoom), contorno de 2 px. Rótulo em cima, em caixa normal.' },
  { id: 'BP-CARTAO', nome: 'Cartão de decisão', classe: '.cartao, .cartao--decisao, .cartao--ajuste, .cartao--falha', onde: 'estilos/agentes.css', regra: 'A faixa à esquerda diz o tipo. Solto, tem contorno; dentro de bloco vira zona sozinho (sem borda nem sombra).' },
  { id: 'BP-ESTADO', nome: 'Estado de agente', classe: '.estado.is-…', onde: 'estilos/agentes.css', regra: 'Ponto + palavra. Sem fonte é "Sem sinal", tracejado; nunca um estado inventado.' },
  { id: 'BP-DOBRA', nome: 'Dobra', classe: 'details.dobra', onde: 'estilos/agentes.css', regra: 'O que é consulta e não decisão fica dobrado, com o título e a contagem à vista.' },
  { id: 'BP-ETAPA', nome: 'Etapa do funil', classe: '.crm-etapa.is-…', onde: 'operations/crm.css', regra: 'Pastel fixo nos dois temas, texto sempre --sobre-pastel.' },
  { id: 'BP-SINAL', nome: 'Sinal do funil', classe: '.crm-sinal.is-…', onde: 'operations/crm.css', regra: 'Uma palavra sobre o lead (Resposta, Follow-up, Divergência). Tracejado = incerto.' },
  { id: 'BP-TRECHO', nome: 'Texto pronto', classe: '<CrmTrecho>', onde: 'operations/CrmTrecho.vue', regra: 'Copiar e Abrir no WhatsApp. Marcador por preencher fica realçado e escrito por extenso.' },
  { id: 'BP-FOLHA', nome: 'Folha', classe: '<Sheet>', onde: 'components/Sheet.vue', regra: 'Tudo que abre por cima. A folha é o contorno e a sombra; dentro, blocos sem sombra. Título sempre, "Fechar" com texto, um primário no rodapé.' },
  { id: 'BP-TABELA', nome: 'Tabela do desktop', classe: '.fin-tabela, .crm-tabela', onde: 'operations/financas/financas.css, operations/crm.css', regra: 'Só a partir de 64 rem; abaixo, a lista de sempre. Cabeçalho preso, zebra no lugar do divisor, número à direita, linha de 44 px, uma linha por item.' },
  { id: 'BP-FICHA', nome: 'Ficha do lead', classe: '<CrmFicha>', onde: 'operations/CrmFicha.vue', regra: 'Na ordem da decisão: o que disse → onde está → como responder → anotar → histórico.' },
]

/** A ordem da Ficha, bloco a bloco, com a pergunta que cada um responde. É o contrato da tela. */
export const ANATOMIA_DA_FICHA: ReadonlyArray<{ bloco: string; pergunta: string; visivel: 'sempre' | 'quando houver' | 'dobrado' }> = [
  { bloco: 'Cabeça', pergunta: 'Quem é, em que etapa, quanto tempo falta para sair dela?', visivel: 'sempre' },
  { bloco: 'Faixa fixa', pergunta: 'Qual é a ação de hoje? (presa no topo ao rolar)', visivel: 'quando houver' },
  { bloco: 'O que respondeu', pergunta: 'O que ele disse, e de que tipo foi?', visivel: 'quando houver' },
  { bloco: 'Jornada', pergunta: 'Em que passo está, o que fazer agora e o que oferecer?', visivel: 'sempre' },
  { bloco: 'Colinha', pergunta: 'Com que texto respondo? (uma variante por vez)', visivel: 'sempre' },
  { bloco: 'Ações', pergunta: 'Onde abro o resto (demo, Maps, planilha)?', visivel: 'sempre' },
  { bloco: 'Anotar', pergunta: 'O que fica registrado? (um formulário por vez)', visivel: 'sempre' },
  { bloco: 'Sobre o lead · Linha do tempo · Gerador', pergunta: 'Consulta: de onde veio, o que já aconteceu.', visivel: 'dobrado' },
]

/**
 * As regras de composição do neobrutalismo saudável (16/10/2026), com código para citar numa
 * revisão ("isto fere a BP-R1"). Vieram da reclamação de sobrecarga: caixa dentro de caixa,
 * fileira de botões iguais, tudo com sombra e 3 px.
 */
export const REGRAS_DE_COMPOSICAO: ReadonlyArray<{ id: string; titulo: string; texto: string }> = [
  { id: 'BP-R1', titulo: 'Um nível de contorno', texto: 'Na tela ou na folha, só o bloco tem borda. Dentro dele, agrupe com .zona (fundo) ou --divisor; nunca outra caixa com borda. Cartão dentro de bloco já sai achatado.' },
  { id: 'BP-R2', titulo: 'Um primário por tela', texto: 'Uma ação em amarelo com sombra por tela ou folha: a que resolve o motivo de estar ali. As outras são secundárias (contorno) ou leves (fundo).' },
  { id: 'BP-R3', titulo: 'Secundárias agrupadas', texto: 'À vista, no máximo um secundário ao lado do primário. Três ou mais ações viram "Mais ações" (lista com divisor), nunca uma fileira de botões.' },
  { id: 'BP-R4', titulo: 'Respiro antes de borda', texto: 'Separe por espaço primeiro (--respiro-pilha entre blocos, --respiro-interno dentro), por fundo depois, por linha por último.' },
]

/** Os princípios, cada um com código, para citar numa conversa. */
export const PRINCIPIOS: ReadonlyArray<{ id: string; titulo: string; texto: string }> = [
  { id: 'BP-P1', titulo: 'Celular primeiro', texto: '390 px, 16 px de margem, sem rolagem lateral, toque de 44 px. O desktop só ganha colunas e respiro.' },
  { id: 'BP-P2', titulo: 'Texto antes da cor', texto: 'Todo estado tem palavra. A cor só reforça; semáforo sempre com rótulo.' },
  { id: 'BP-P3', titulo: 'Um nível de contorno', texto: 'O bloco tem borda de 2 px e canto de 16 px; dentro dele, divisor ou fundo pastel, nunca outra caixa com borda.' },
  { id: 'BP-P4', titulo: 'Uma decisão por vez', texto: 'Um primário por tela ou folha; o resto em "Mais ações". Variantes e formulários um de cada vez; consulta dobrada.' },
  { id: 'BP-P5', titulo: 'Só tokens', texto: 'Nada de cor, espaço, tamanho, peso, raio ou sombra solta. O teste do blueprint barra o que foge da escala.' },
  { id: 'BP-P6', titulo: 'Escolhido é amarelo', texto: 'Seleção, aba atual e ação primária em --destaque. Hover é --hover, nunca cor de estado.' },
  { id: 'BP-P7', titulo: 'A sombra é do primário', texto: 'Sombra dura só no botão primário e na folha que está por cima. Bloco, cabeça de tela e cartão ficam sem.' },
  { id: 'BP-P8', titulo: 'Respiro e número grande', texto: 'Mais espaço entre os blocos que dentro deles (--respiro-*). O número que importa em --tam-numero, um por bloco.' },
]
