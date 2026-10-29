# Oferta nova do PRUMO: como criar

Guia para pôr uma oferta nova (um produto ou projeto) no funil do PRUMO, ao lado de Iris e CRM de
estamparia. Escrito em 28/10/2026 sobre a `main`; os números de linha são dessa data e andam com o
código: confira antes de editar. O dono vai criar mais três ofertas; este guia existe para que cada
uma não custe uma tarde de caça a listas fixas.

Resumo honesto: **a aquisição já é genérica** (um bloco em `prumo-ofertas.json` gera aba, caçador e
clique), mas **o resto tem a lista de ofertas escrita à mão**. São ~50 pontos em ~35 arquivos, e quase
metade falha **calada**: a oferta some do funil, cai no texto do PRUMO ou é recusada como "Produto
inválido". Siga a lista inteira.

---

## 1. Antes de começar

### Regras da Prumo (fonte de nomes e aceite)

Leia `docs/referencia/organizacao-prumo.md` e `../prumo/00-contexto/organizacao.md` antes de criar
nome, oferta ou fluxo. A ordem para um produto entrar no portfólio (`prumo/00-contexto/produtos.md`,
"Regras"):

1. **Ficha** do produto preenchida.
2. **Titularidade** confirmada (quem é o autor, cessão por escrito quando não for o Rômulo).
3. **Id no catálogo em incubação**: `qualidade.py --novo-produto` em `prumo/06-qualidade/catalogo.json`.
4. **Sai da incubação na Prumo**: o produto ganha `funil: true` e `receita` diferente de `incubacao`
   (`isca`, `porta`, `projeto`, `recorrente` ou `assinatura`). Decisão de 28/10/2026: produto em incubação,
   sem preço, cobrança real ou cliente não vira oferta, caçador, convite nem proposta.
5. Só então **proposta**, site ou prospecção.

**Trava no código.** `catalogo_prumo` é obrigatório em toda oferta, e `nova-oferta.py --conferir` recusa
produto ausente do catálogo, com `funil` false, com receita `incubacao` ou sem os dois campos (catálogo
antigo: atualize a main da Prumo). O catálogo vem de `--prumo <dir>`, senão de `PRUMO_REPO`, senão de
`../prumo` ao lado do repo, senão de `~/prumo`; não achar é problema, nunca pula. Quando a pasta é um
repositório git, lê a `origin/main` (`git fetch` + `git show`, sem tocar a árvore de trabalho; a mesma
função do contexto do n8n, `prumo_contexto.ler_da_prumo`), para o PC e a Mel conferirem a mesma coisa
mesmo com o `~/prumo` da Mel atrasado. O contexto do n8n também leva `comercial` (`receita` e `funil`
por produto) e a regra de que produto fora do funil não é oferecido a lead.

O id do catálogo da Prumo **não é** o id do SquadOne: o CRM de estamparia é `crm` lá, `estampa` aqui,
e `crm-estamparia` em `src/operations/jornada.ts:212`. Registre os dois.

Situação dos candidatos em 28/10/2026 (catálogo da Prumo): Prisma PDV é o app Android, com cobrança, Pix
e API simulados e sem NFC-e, `funil: false`; SGP Escolar e TaxShield (o antigo IVA Dual, área regulada)
estão em incubação; Follow-up de cobrança é só ideia. Nenhum deles vira oferta hoje. Prospectar sem a ficha mínima faz a abordagem prometer o que não existe.

### Decisões que o molde preserva (não negociar no código)

- **Caçador nasce desligado.** `prumo-ofertas.py` publica sem ativar. Ligar é
  `prumo-ofertas.py --ativar <id>`, só com aprovação específica do Rômulo; nenhum documento de fase
  substitui essa aprovação. Os caçadores existentes estão pausados desde 17/10/2026 (AC-11).
- **Nada envia sozinho.** O clique só abre o wa.me; quem marca "Convite enviado" é o observador do
  WhatsApp quando a mensagem sai. Vendedor do Telegram, copiloto, lead quente e Assistente só
  propõem. Não crie nó de envio nem marque o convite.
- **Texto do convite revisado pelo Rômulo** antes de ir ao ar. Padrão de 27/10/2026: Rômulo e Prumo
  identificados, intenção comercial explícita, exemplo ou análise, **uma** pergunta, sem R$, sem link,
  sem "fundador", sem desconto. Não diga que o produto já roda em cliente sem prova. Permissão para
  receber material (`licenca`) não é intenção de compra.
- **Preço.** Sem preço aprovado, a receita fica bloqueada (como a estampa). Nunca invente nem copie
  preço de outra oferta.
- **Cliente nunca vira prospect** (`clientes` no JSON, hoje "silmer").
- **Colunas novas só no fim** das abas: os fluxos do WhatsApp gravam pelo nome da coluna.
- **Teto diário de primeiros contatos é único** entre todas as ofertas, sem cota por oferta. Oferta
  nova divide o mesmo teto; não crie teto próprio nem aumente o geral. **Confira o valor antes:** o
  `CLAUDE.md` diz 30/dia (Fase 0, 19/10), mas `src/operations/trava-de-ritmo.ts:48-55` está em 5 por
  dia, 2 por hora e 30 min (retomada de 22/10 a 50%). O código vale; a doc está atrás.
- **Escritório.** A squad PRUMO usa 6 de 9 salas (geral, prospecção, site, organizar, iris,
  estamparias). Três ofertas novas lotam o 3×3 (`server/squad.ts`, máximo 9 domínios). Uma quarta
  exige decisão (sala compartilhada ou outra squad).
- **Glossário.** "CRM" solto é proibido na tela (`src/operations/glossario.ts:33`); só "CRM de
  estamparia" e "CRM da Silmer" passam. Rótulo novo com "CRM" quebra `src/operations-glossario.test.ts`.
- **Riscos abertos da Fase 5** (dedupe que tolera falha de leitura; append com retry sem recibo):
  corrigir antes de ampliar volume. Cada aba nova soma uma leitura de Sheets por chamada nos três
  fluxos do WhatsApp. Antes de qualquer aumento, o checklist de capacidade de
  `docs/PRUMO-PROSPECCAO-FASE5-2026-10-24.md`.
- **Blueprint.** Antes de atacar a OT-15 ("uma esteira de venda, a oferta como parâmetro"), leia a
  decisão dela no banco do Artifact (coleção `decisoes`).

---

## 2. Passo a passo

### 2.0 Com o comando (desde 28/10/2026)

```bash
cd deploy/dell/claude-ops
# exemplo fictício: "otica" não é produto da Prumo
python3 nova-oferta.py otica --como iris --rotulo "Ótica" --plural óticas --aba Óticas --catalogo-prumo otica   # cria o bloco
# preencha os "TODO: ..." do bloco (segmento, perfil, nichos, cidades, mensagem, conversa, catalogo_prumo...)
python3 nova-oferta.py --conferir otica [--prumo ../prumo]                                                     # diz o que falta
```

O primeiro copia a estrutura da oferta-modelo para `ofertas.<id>` com os nomes derivados (`convite-<id>`,
caçador e clique `PRUMO · <rótulo> — ...`, `webhook_id` novo, sala `prumo--<id>`, `planilha<Id>`,
`tipo: "propria"`, teto 15) e `TODO` em todo campo de negócio; nunca sobrescreve oferta e só insere texto
no JSON. O `--conferir` faz o lint (contrato, regex, texto do convite, glossário, sem `TODO`), monta o
código de **todas** as ofertas e do 08 · CRM e passa no `node --check`, roda os testes Python de contrato,
mostra as listas escritas fora de `claude-ops` que faltam e imprime o resto, na ordem: lado TS, decisões,
documentação e os passos na Mel. Sai com 1 enquanto houver o que corrigir. **Nunca publica nem liga.**

O lado Python/n8n deriva do JSON por `deploy/dell/claude-ops/ofertas.py` (falta do JSON ou JSON inválido
é exceção, nunca lista vazia). Os itens abaixo marcados **✓ automático** já não pedem edição. O lado TS é
o `npx tsx scripts/ofertas-gerar.ts` (seções 2.4 e 2.5).

Marcado **⚠ calada** onde esquecer não dá erro: a oferta só some ou sai errada.

### 2.1 n8n: o bloco da oferta

1. `prumo-ofertas.json`: o bloco `ofertas.<id>` (`nova-oferta.py` cria; modelo na seção 3).
2. ✓ automático. `prumo-ofertas-triar.js`: os motivos de `fora_entidade`/`site_diretorio` vêm de
   `fora_entidade_motivo`/`site_diretorio_motivo` da oferta (o Iris guarda lá o texto de sempre); sem
   eles, um texto genérico, nunca mais "do Iris".
3. ✓ automático. `prumo-ofertas.py --codigo` imprime o código de todas as ofertas.
4. ✓ feito (docstrings). `--ativar` agora **exige o nome** da oferta: sem nome ligaria a oferta nova.
5. ✓ automático. `prospeccao_contrato.py` confere `webhook_id` (UUID, único), `clique` e `fluxo`
   (únicos, começam com "PRUMO"), `convite == "convite-<id>"`, `empresa`, o id e os campos novos
   (`sigla`, `tipo`, `sala`, `cacador_rotulo`, `fonte`, `link_retrato`, `conversa`). `prumo-ofertas.py`,
   `crm.py` e `whatsapp-conversa.py` rodam esse contrato antes de tocar o n8n.

O caçador lê o dedupe de todas as abas do JSON: a oferta nova entra no dedupe das antigas na próxima
republicação, sem código. A posse exclusiva (`serializacao_aquisicao.NOMES`) também deriva do JSON.

### 2.2 Retrato do CRM (`deploy/dell/claude-ops/crm.py`, fluxo 08)

6–9, 11–12. ✓ automático. A leitura `Ler <aba>`, a cadeia, a contagem, `links.<link_retrato>`,
   `fontes.<id>` e a lista de produtos do VALIDAR_JS saem do JSON (para Iris e estampa, o código
   publicado é byte a byte o de antes). O `--testar` itera as ofertas.
10. **Decisão.** Preço: só as ofertas em `crm.py` `OFERTAS_COM_TABELA` (hoje `iris`) aceitam
    `valor_proposta`/`pagamento_confirmado`; a oferta nova nasce bloqueada, como a estampa.

### 2.3 Fluxos do WhatsApp

13–14. ✓ automático. `whatsapp-conversa.py` lê `conversa.o_que_foi`/`conversa.interesse` do JSON; oferta
    sem `conversa` para com o nome da oferta (não mais `KeyError`).
15. ✓ automático. `workflow_contexto_whatsapp.LEITURAS` é Prospects + Leads do site + uma leitura por
    oferta (para Iris e estampa, a mesma tupla e o mesmo GUARDA_JS); o lote (`workflow_contexto_lote.py`)
    agrupa todas as abas do PRUMO. Uma aba nova soma uma leitura de Sheets por chamada.
16. `observador.py` `ROTULO`: lista escrita (roda de `~/.local/bin`); `ofertas.test.py` falha até ter o
    rótulo do JSON.

### 2.4 Servidor da Central (`server/`)

17. `server/crm.ts:63` `PRODUTOS` (raiz do tipo `CrmProduto`).
18. `server/crm.ts:66` `PRODUTOS_DE_PROSPECCAO`: é o que faz `montarCrm` ler a fonte (`:2124`).
19. `server/crm.ts:78-84` `ROTULO_DO_PRODUTO` (o TS cobra).
20. `server/crm.ts:87-93` `OFERTA_DE_PROSPECCAO`: `aba`, `cacador` ("Encontrado pelo…") e `link`. O
    tipo do `link` é união fixa `"planilhaPrumo"|"planilhaIris"|"planilhaEstampa"`: estenda.
21. `server/crm.ts:377-382`: `CrmRetrato.links.planilha<X>`, `fontes.<x>`, `LINKS_DO_RETRATO`.
22. `server/crm.ts:453-457` (`validarRetrato`): `<x>: lerFonte(fontes.<x>, "<x>")`.
23. `server/crm.ts:2065-2072` `NOME_DA_FONTE` (o TS cobra).
24. `server/crm.ts:1891` e `:1970`: `iris || estampa` → "combinar a demonstração" (comportamento de
    oferta própria).
25. `server/convite-mensagem.ts:15-16`: **⚠ calada, crítico.** Cópia à mão da `mensagem` do JSON.
    Produto sem `if` cai no convite da **consultoria PRUMO** (`:17-21`): a Central montaria o wa.me da
    oferta nova com o texto errado, sem erro nenhum.
26. `server/operations.ts:30` `PRODUTOS_DO_CRM` (validação das rotas).
27. Listas de validação repetidas: `server/uso.ts:52`, `server/assistente.ts:144`,
    `server/assistente-ferramentas.ts:35` (enum do Gemini), `server/frente-comercial.ts:77`,
    `server/revisao-resposta.ts:13, 40`, `server/mensagem-da-decisao.ts:14`. Sem o id, a oferta vira
    "lead inválido" ou `desconhecido`.
28. `server/decisoes-comerciais.ts:35` `['prumo','iris','estampa']` (confirmar convite enviado).
29. Opcional, só se o Plus puder mandar a oferta nova: `server/crm.ts:1626` e `:2452`,
    `server/plus-catalogo.ts:31, 289`, `server/plus-mensagem.ts:25-41`.

### 2.5 Interface (`src/`)

30. `src/operations/types.ts:69` `CrmProduto`, `:214` (`plus.oferta`), `:298` (`links`).
31. `src/operations/crm-formato.ts:86-101`: `PRODUTOS`, `ROTULO_DO_PRODUTO`, `SIGLA_DO_PRODUTO`,
    `ROTULO_DA_OFERTA_DO_PLUS`.
32. `src/operations/proxima-venda.ts:192-197` (`PERGUNTA_DEPOIS_DO_LINK`), `:372` (`ROTULO_CURTO`),
    `:475` (`iris || estampa` → "combine a demonstração").
33. `src/operations/jornada.ts:212`, `:221-235` (`OFERTAS_PROPRIAS`) e `:266, 295, 374, 523-525`.
    Regenera `docs/referencia/jornada-do-cliente.md` (`scripts/jornada-guia.ts`; o teste falha se
    ficar para trás).
34. `src/operations/mandar-proposta.ts:54, 150-171`: oferta sem cardápio e rascunho da proposta.
35. `src/operations/colinha.ts:677, 774-780`: objeção "quanto custa" por oferta.
36. `src/operations/copiloto.ts:289` (`proprias = iris || estampa`).
37. `src/operations/primeiro-contato.ts:79, 103`.
38. `src/operations/followup-experimento.ts:13, 16-21` (`FOLLOWUP_NOVO`).
39. `src/operations/assistente.ts:259`, `src/operations/cohort.ts:277`.
40. Ofertas comerciais e receita: `src/operations/aarr.ts:20, 55-58, 95`, `ciclo-comercial.ts:5`,
    `qualificacao-comercial.ts:4`, `CrmCicloComercial.vue:28`, `CrmSpiced.vue:28`,
    `CrmReceita.vue:108-110`. Sem preço aprovado: como a estampa (receita bloqueada).
41. `src/operations/CrmPanel.vue:502-503`: link "Aba … ↗" por oferta.
42. `src/operations/fluxos.ts:98-99, 165-195`: o fluxo "PRUMO · <oferta>" do Como funciona, com o
    `trabalhador` (o robô da sala; `src/office/trabalhadores.ts` deriva disto).
43. `src/office/operacao.ts:55-56` `JORNADA_DAS_SALAS`: `"prumo--<sala>": { recortes: [{ produto }] }`.
    Sala fora daqui não mostra jornada.
44. `src/office/linha-de-producao.ts:76`: mapa produto → sala (exceção `estampa → estamparias`).
45. `src/office/decisoes.ts:17` (`nomesDasOfertas`) e `src/office/jornada-do-escritorio.ts:41`
    (`semMaterial`).

### 2.6 Python da Mel e Hermes

Listas escritas de propósito (rodam fora de `claude-ops`, sem o JSON ao lado):
`deploy/dell/claude-ops/ofertas.test.py` falha até a oferta nova entrar nelas, e o `--conferir` mostra o
valor certo. Instaladas por `dell-status --instalados`.

46. `deploy/hermes/scripts/ler_comercial.py` `PRODUTOS` (lista escrita). `OFERTAS` (ofertas comerciais)
    só se a oferta tiver ciclo comercial próprio.
47. `deploy/hermes/skills/conversa-do-lead/SKILL.md:3` (e o SOUL, se citar ofertas): texto.
48. `deploy/dell/frente-comercial.py` `PRODUTOS_DO_FUNIL` (lista escrita). `OFERTAS_DO_EXECUTOR` é
    **opt-in**: oferta nova não entra no envio automático do time comercial sem decisão do Rômulo (com
    `perfil_do_lead`/`justificativa_comercial` próprios).
49. `deploy/dell/publicador-crm.py` `FONTES` (lista escrita): sem a fonte nova, todo retrato é recusado.
    `deploy/dell/aquisicao-guarda.py` `WORKFLOWS` (lista escrita): sem o caçador novo, a posse é recusada.
50. ✓ automático. `jev-respostas-resumo.py` lê as ofertas do JSON.
51. `scripts/publicar-aberturas.py:124, 152` (só se for reusar o publicador de aberturas).
52. Opcional: `deploy/dell/dell-status.py` `DICAS_DO_FLUXO`.

### 2.7 Testes que fixam a lista

53. `server/prumo-ofertas.test.ts:23` `deepEqual(keys, ["estampa","iris"])` e `:25`.
54. `server/decisoes-comerciais.test.ts:65` (`for (const produto of ['iris','estampa'])`).
55–56. ✓ Os testes Python derivam do JSON (`prospeccao_contrato.test.py`, `crm.test.py`,
    `serializacao_aquisicao.test.py`, `whatsapp-conversa.py --testar`); regra de uma oferta só
    (Iris, estampa) continua testada como dela.
57. `server/crm.test.ts`, `src/office/operacao.test.ts`, `src/operations-*.test.ts`: seguem válidos;
    acrescente um caso da oferta nova onde houver regra.

Rode no PC: `python3 nova-oferta.py --conferir <id>`, `npx vue-tsc --noEmit`, `npm test`. Só na Mel
(fcntl, tzdata): `frente-comercial*.test.py`, `crm.py --testar`, `whatsapp-conversa.py --testar-n8n`.

### 2.8 Documentação

58. `CLAUDE.md` (Perfis: "quatro ofertas"; o mapa de `server/crm.ts`) e `ARCHITECTURE.md:437-440`
    (tabela de salas).
59. `docs/referencia/perfis-e-experimentos.md:28-40`: registro da oferta, decisão e estado do caçador.
60. `docs/blueprint/servico.json:105-106` (glossário) e `:252-293` (jornada "Iris, Estamparias e Plus",
    cartões `OFERTAS-*`), no mesmo commit (o teste do blueprint confere códigos e arquivos).
61. No repo `prumo`: `00-contexto/produtos.md` (ficha), `06-qualidade/catalogo.json`, `decisoes.md`,
    `glossario.md`.
62. Este catálogo: `ops/n8n/CATALOGO.md` (os dois fluxos novos na tabela).

### 2.9 Passos manuais em produção (só na Mel, depois do merge)

63. Reinstalar o que mudou: `dell-status --instalados` diz o que está atrás. O `prumo-ofertas.json`
    tem entrada própria em `deploy/dell/instalados.json`; `ofertas.py` (e por ele `crm.py`,
    `whatsapp-conversa.py`, a guarda do contexto e a da aquisição) o lê do próprio diretório. Antes de
    publicar, `cd ~/SquadOne/deploy/dell/claude-ops && python3 nova-oferta.py --conferir <id>` (só lê).
64. `cd ~/.local/share/claude-ops && python3 prumo-ofertas.py`: cria a aba na planilha "PRUMO — Fila
    de revisão" (`planilha()`, `:104-149`), publica o caçador **desligado** (`publicar_cacador`,
    `:343`) e o clique `GET /webhook/convite-<id>` (`clique`, `:332`; construtor em
    `prumo-simples.py:351`).
65. `python3 crm.py`: republica o 08. Confira no retrato que a fonte nova aparece com contagem.
66. `python3 whatsapp-conversa.py`: republica os três WhatsApp. Confira o opt-in
    `~/.config/claude-ops/workflow-contexto-whatsapp.json` e que a guarda aceitou a cadeia. Reinicie o
    observador.
67. Roster de produção: sala `prumo--<slug>` com PO e escopo "Não cuida de" (pela UI ✎ ou pela API).
68. `python3 prumo-ofertas.py --estado`: o caçador novo tem de aparecer **inativo**.
69. Ligar o caçador: **só** com aprovação específica do Rômulo (`--ativar <id>`).

---

## 3. Modelo comentado do bloco de oferta

O JSON não aceita comentário; o arquivo usa chaves `_campo` como nota. Os campos sem marca **já
existem** e são lidos por `prumo-ofertas.py`/`prumo-ofertas-triar.js`/`ofertas.py` (e pelo gerador TS).
Os marcados **PROPOSTO** ainda não existem nem são lidos por ninguém. O exemplo é fictício (`otica`).

```jsonc
"otica": {
  // ---- identidade
  "rotulo": "Ótica",                    // nome longo: Ficha, aviso do caçador, prefixo do Motivo em Descartados
  "sigla": "Ótica",                     // rótulo curto único (gerador TS); único entre as ofertas
  "catalogo_prumo": "otica",            // OBRIGATÓRIO: id em prumo/06-qualidade/catalogo.json (pode diferir: estampa ↔ crm),
                                        // com funil true e receita fora de "incubacao" (nova-oferta.py --conferir recusa)
  "tipo": "propria",                    // só "propria": caminho curto sem Raio-X/Mapa/cardápio
  "sala": "prumo--otica",               // sala do Escritório ("prumo--<slug>", única); criar no roster à mão
  "cacador_rotulo": "Encontrado pelo Caçador de óticas",  // o "de onde veio" da Ficha
  "fonte": "PRUMO — Óticas (Ótica)",    // nome da fonte na Central
  "link_retrato": "planilhaOtica",      // chave do link da aba no crm.json ("planilha<Nome>", única)

  // ---- planilha e n8n
  "aba": "Óticas",                      // aba na planilha do PRUMO; criada por prumo-ofertas.py; única
  "fluxo": "PRUMO · Ótica — Caçador de óticas",          // nome do caçador; achado e trocado POR NOME; começa com "PRUMO"
  "clique": "PRUMO · Ótica — Clique em Enviar convite",  // fluxo do clique; só abre o wa.me
  "convite": "convite-otica",           // path do webhook (GET /webhook/convite-otica?id=<ID>); sempre "convite-<id>"
  "webhook_id": "<uuid4 novo>",         // id fixo do nó Webhook; único entre os fluxos (dois iguais colidem)
  "teto_por_rodada": 15,                // máximo gravado em Revisar por rodada; o resto fica para a próxima

  // ---- quem entra (regex sem acento e sem caixa, contra nome + tipo do Google + texto do site)
  "empresa": "ótica",                   // palavra do convite quando o nome da empresa é ilegível ({NOME})
  "plural": "óticas",                   // nos motivos "Fora do segmento (nada de <plural>…)" e no aviso
  "segmento": "otica|optica|oculos|…",  // tem de casar no nome/tipo ou no site, senão "Fora do segmento"
  "fora": "atacadista|distribuidora|…", // casou no nome/tipo: descarte "Fora do perfil (<tipo>)"
  "perfil": "exame de vista|optometr|…", // obrigatório no nome, tipo ou site; sem site: "perfil não confirmado"
  "perfil_motivo": "Fora do perfil da Ótica (…)",
  "fora_sem_perfil": "…",               // casou e não tem perfil: descarte com o motivo abaixo
  "fora_sem_perfil_motivo": "Fora do perfil (…)",
  "solo": "",                           // opcional: profissional sozinho → entra marcado, prioridade menor
  "instituicao": "",                    // opcional: o que desfaz o "solo"
  "fora_entidade": "",                  // opcional: entidade que não é cliente final
  "fora_entidade_motivo": "",           // opcional: motivo desse descarte (sem ele, um texto genérico)
  "site_diretorio": "",                 // opcional: site de diretório; o WhatsApp dele não é da empresa
  "site_diretorio_motivo": "",          // opcional: motivo desse descarte
  "sinais": [["exame de vista", "…"], ["lentes de contato", "lentes? de contato"]],  // [rótulo, regex]: coluna Sinais e Prioridade
  "nichos": ["…"],                      // a frase curta que rende mais vem primeiro (busca = nicho × cidade, menos usada antes)
  "cidades": ["Vitória ES", "…"],

  // ---- textos (revisados pelo Rômulo; nunca R$, link, "fundador" ou desconto)
  "mensagem": "{OLA}! Sou o Rômulo, do Prumo. … \n\nPosso te mostrar um exemplo com dados fictícios para a equipe da {NOME}?",
                                        // {OLA} = Bom dia/Boa tarde/Boa noite; {NOME} = nome limpo (prumo-nome.js)
                                        // HOJE: copie também em server/convite-mensagem.ts (passo 25)
  "proxima_enviado": "Aguarde a resposta. …",  // o que o OBSERVADOR grava na Próxima ação quando o convite sai de verdade
  "conversa": {                         // lido por whatsapp-conversa.py (resumo para o Gemini e o passo do interesse)
    "o_que_foi": "A abertura atual apresenta Rômulo, do Prumo, e oferece …. Um sim autoriza apenas o exemplo.",
    "interesse": "Combine a demonstração …"
  },
  "followup": "…",                      // PROPOSTO: hoje FOLLOWUP_NOVO em followup-experimento.ts
  "pergunta_depois_do_link": "…",       // PROPOSTO: hoje PERGUNTA_DEPOIS_DO_LINK em proxima-venda.ts
  // receita e funil NÃO moram aqui: são do produto no catálogo da Prumo (catalogo_prumo acima)
  "ativo": false                        // PROPOSTO: só documenta a decisão; quem liga é --ativar, nunca o gerador
}
```

Obrigatórios no contrato (`prospeccao_contrato.contrato_oferta`): `rotulo`, `aba`, `fluxo`, `plural`,
`segmento`, `fora`, `perfil`, `perfil_motivo`, `fora_sem_perfil`, `fora_sem_perfil_motivo`,
`convite` (`convite-<id>`), `proxima_enviado`, `mensagem`, `clique` e `fluxo` (únicos, começam com
"PRUMO"), `webhook_id` (UUID único), `empresa`, `sigla`, `tipo`, `sala`, `cacador_rotulo`, `fonte`,
`link_retrato`, `conversa`, `teto_por_rodada` (inteiro > 0), `nichos` e `cidades` (listas não vazias) e
`sinais` (pares). O id tem 3 a 12 letras minúsculas. O `--conferir` soma o lint do texto do convite, o
teto até 15, as regex e o glossário.

O nível de cima do JSON é comum a todas as ofertas: `colunas` (só acrescentar no fim), `ocultas`,
`descartados`, `etapas`, `clientes` e `proxima_revisar`.

---

## 4. Para ficar fácil

Objetivo: uma oferta nova = um bloco de config + um comando.

**Registro único.** `deploy/dell/claude-ops/prumo-ofertas.json` vira o registro de tudo que hoje está
espalhado (os campos PROPOSTO acima). Ele já é instalado na Mel e já é lido por `prumo-ofertas.py`,
`whatsapp-conversa.py` e por testes TS.

**Lado TS: `server/ofertas.gerado.ts`.** Um gerador (`scripts/ofertas-gerar.ts`, no estilo de
`scripts/jornada-guia.ts`) escreve `OFERTAS_PROPRIAS = [...] as const` e um `OFERTA` com rótulo,
sigla, aba, sala, caçador e mensagem. `PRODUTOS`, `PRODUTOS_DE_PROSPECCAO`, os `Record` de rótulo e
as ~10 listas de validação passam a derivar dele; um predicado `ehOfertaPropria()` substitui os ~12
`iris || estampa`; `convite-mensagem.ts` lê `OFERTA[produto].mensagem` e lança erro para produto
desconhecido. Gerar (e não importar o JSON) mantém a união literal `CrmProduto`, então o `vue-tsc`
continua apontando `Record` incompleto. Um teste falha se o gerado ficar atrás do JSON.

**Lado Python: feito em 28/10/2026.** `deploy/dell/claude-ops/ofertas.py` (`carregar()`, `ids()`,
`oferta()`, `leituras()`, `conversa()`...) é usado por `crm.py`, `whatsapp-conversa.py`,
`workflow_contexto_whatsapp.py` (e o lote), `serializacao_aquisicao.py`, `jev-respostas-resumo.py` e
`nova-oferta.py`; falta do JSON derruba o gerador. Para Iris e estampa, o que os geradores mandam ao n8n
saiu idêntico ao de antes (comparado corpo a corpo, com e sem os opt-ins do contexto e da aquisição),
exceto o código do Triar (motivos de identidade vindos da oferta, mesmo texto para o Iris). Os scripts
que rodam fora de `claude-ops` (observador, publicador do CRM, guarda de aquisição, frente comercial,
Hermes) ficaram com a lista escrita e um teste de paridade (`ofertas.test.py`): copiar o JSON para cinco
lugares de instalação custava mais que uma linha por oferta.

**Comando: feito.** `nova-oferta.py` (seção 2.0). Não confere ainda a vaga de sala no roster (fica no
servidor da Mel). `catalogo_prumo` é obrigatório desde 28/10/2026 e conferido contra o catálogo da Prumo
(seção 1, "Trava no código").

**Ordem em lotes** (cada um com `npm test` verde; do lado Python, a parte de 1 e os lotes 3, 5 e 6 foram
feitos em 28/10/2026):

1. Corrigir as falhas caladas: `convite-mensagem.ts` lendo o JSON, motivos "do Iris" no
   `triar.js`, `--codigo` para todas, contrato com `webhook_id`/`clique`/`convite`.
2. `ofertas.gerado.ts` + listas de id e rótulo derivadas; testes lendo o JSON.
3. `ofertas.py` + `crm.py` e scripts Python derivados; `CONVERSA_DAS_OFERTAS` para o JSON.
4. `ehOfertaPropria()` no lugar dos `iris || estampa`.
5. `LEITURAS` derivada, em lote próprio com baseline (mexe na guarda da Fase 4).
6. `nova-oferta.py`.

**Dependência.** O trabalho que estava sem commit no checkout da Mel (inclusive a guarda de aquisição,
`serializacao_aquisicao.py` e `aquisicao-guarda.py`) entrou na `main` em 28/10/2026. Antes de refatorar,
confira que o `~/SquadOne` da Mel está limpo (`git status`): um caçador publicado sem a guarda perde a
exclusão entre caçadores.
