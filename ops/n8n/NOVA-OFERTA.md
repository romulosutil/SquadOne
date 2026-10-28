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
4. Só então **proposta**, site ou prospecção.

O id do catálogo da Prumo **não é** o id do SquadOne: o CRM de estamparia é `crm` lá, `estampa` aqui,
e `crm-estamparia` em `src/operations/jornada.ts:212`. Registre os dois.

Situação dos candidatos em 28/10/2026: Prisma PDV tem autoria de outra pessoa e cessão a confirmar;
SGP Escolar é protótipo sem backend nem Git; Follow-up de cobrança e IVA Dual são só ideia, e o IVA
Dual é área regulada. Prospectar sem a ficha mínima faz a abordagem prometer o que não existe.

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

## 2. Passo a passo de hoje

Marcado **⚠ calada** onde esquecer não dá erro: a oferta só some ou sai errada.

### 2.1 n8n: o bloco da oferta

1. `deploy/dell/claude-ops/prumo-ofertas.json:71-275`: acrescente `ofertas.<id>` (modelo na seção 3).
   `convite` é sempre `"convite-<id>"`; `webhook_id` é um UUID novo; `fluxo` começa com "PRUMO" (é
   isso que faz o `prumo_contexto` injetar o contexto).
2. `deploy/dell/claude-ops/prumo-ofertas-triar.js:160` e `:178`: **⚠ calada.** Os motivos de
   `fora_entidade`/`site_diretorio` dizem "Fora do perfil do Iris" fixo. Se a oferta nova usar esses
   campos, os descartes dela sairão com o nome do Iris. Troque por `CONFIG.rotulo`.
3. `deploy/dell/claude-ops/prumo-ofertas.py:426-429`: **⚠ calada.** `--codigo` imprime só o código do
   `iris`; o `node --check` não cobre a oferta nova. Itere por `CONFIG["ofertas"]`.
4. `deploy/dell/claude-ops/prumo-ofertas.py:1-39` e `:358-359`: docstrings ("Iris e CRM de
   estamparia", `--ativar [iris|estampa]`).
5. `deploy/dell/claude-ops/prospeccao_contrato.py:17-39`: **⚠ calada.** O contrato não confere
   `clique`, `webhook_id` (UUID único), `empresa`, `convite == "convite-<id>"` nem o formato do id, e
   o `prumo-ofertas.py` usa todos (`:322`, `:337`). Um `webhook_id` repetido colide no n8n sem aviso.

O caçador lê o dedupe de todas as abas do JSON (`prumo-ofertas.py:235-237`): a oferta nova entra no
dedupe das antigas na próxima republicação, sem código.

### 2.2 Retrato do CRM (`deploy/dell/claude-ops/crm.py`, fluxo 08)

6. `crm.py:76` `ABAS_DAS_OFERTAS`: acrescente a aba.
7. `crm.py:87-90` `montar_js()`: um placeholder de link por oferta (como `%(IRIS_LINK)s`).
8. `crm.py:127-151` (MONTAR_JS): `ler('Ler <Aba>')`, contagem, `links.planilha<X>`, `fontes.<x>`.
9. `crm.py:164` (VALIDAR_JS): **⚠ calada, crítico.** `['site','prumo','iris','estampa','plus']`: sem
   o id, **todo registro da oferta** (nota, convite confirmado, ganho, dispensado) volta "Produto
   inválido".
10. `crm.py:186-195` (VALIDAR_JS, regra em `:194`): tabela de preços duplicada e "a condição pertence
    à oferta". Oferta sem preço: bloqueie como a estampa.
11. `crm.py:337-338` (nó `ler("ler-…", "Ler <Aba>")`) e `:356` (a cadeia de leituras).
12. `crm.py:459-531` (autoteste): casos da oferta nova.

### 2.3 Fluxos do WhatsApp

13. `deploy/dell/claude-ops/whatsapp-conversa.py:104-113` `CONVERSA_DAS_OFERTAS`: `o_que_foi` (o que
    o convite ofereceu, para o Gemini) e `interesse` (o passo de quem respondeu). **`:114-115` faz
    `CONVERSA_DAS_OFERTAS[k]`: oferta no JSON sem entrada aqui derruba o gerador com `KeyError`.**
14. `whatsapp-conversa.py:2026-2039`: o teste fixa `{"iris": "Clínicas", "estampa": "Estamparias"}`.
15. `deploy/dell/claude-ops/workflow_contexto_whatsapp.py:15` `LEITURAS`: **⚠ crítico.** A guarda da
    Fase 4 exige exatamente as 4 leituras (`:97-101`, `:165-179`). Com uma 5ª aba, o fluxo regenerado
    tem "cadeia inesperada" e a simplificação recusa, ou a aba nova fica fora da guarda de completude
    (o fluxo poderia confirmar "não é lead" sem ter lido a aba). Mexer aqui pede baseline e
    homologação próprias.
16. `deploy/dell/whatsapp-observador/observador.py:196` `ROTULO`: rótulo do aviso.

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

46. `deploy/hermes/scripts/ler_comercial.py:15, 109`: ofertas comerciais e produtos; fora deles, a
    consulta do secretário devolve vazio.
47. `deploy/hermes/skills/conversa-do-lead/SKILL.md:3` (e o SOUL, se citar ofertas).
48. `deploy/dell/frente-comercial.py:145, 212, 565`: linhas do funil e "oferta com convite".
49. `deploy/dell/publicador-crm.py:26` `FONTES`: fonte fora do conjunto não é publicada.
50. `deploy/dell/claude-ops/jev-respostas-resumo.py:144`.
51. `scripts/publicar-aberturas.py:124, 152` (só se for reusar o publicador de aberturas).
52. Opcional: `deploy/dell/dell-status.py:417-429` `DICAS_DO_FLUXO`.

### 2.7 Testes que fixam a lista

53. `server/prumo-ofertas.test.ts:23` `deepEqual(keys, ["estampa","iris"])` e `:25`.
54. `server/decisoes-comerciais.test.ts:65` (`for (const produto of ['iris','estampa'])`).
55. `deploy/dell/claude-ops/prospeccao_contrato.test.py:45, 132` (gids `{'iris':101,'estampa':102}`).
56. `whatsapp-conversa.py:2039` (ver passo 14).
57. `server/crm.test.ts`, `src/office/operacao.test.ts`, `src/operations-*.test.ts`: seguem válidos;
    acrescente um caso da oferta nova onde houver regra.

Rode no PC: `npx vue-tsc --noEmit`, `npm test`. Na Mel ou com HOME falso: `python3
prospeccao_contrato.test.py`, `python3 crm.py --testar`, `python3 whatsapp-conversa.py --testar`,
`python3 prumo-ofertas.py --codigo` com a saída conferida por `node --check` (só cobre a oferta nova
depois do passo 3).

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
    tem entrada própria em `deploy/dell/instalados.json:69`; `crm.py` e `whatsapp-conversa.py` o leem
    do próprio diretório.
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
existem** e são lidos por `prumo-ofertas.py`/`prumo-ofertas-triar.js`. Os marcados **PROPOSTO** não
existem: são a proposta da seção 4 e hoje não são lidos por ninguém.

```jsonc
"pdv": {
  // ---- identidade
  "rotulo": "Prisma PDV",              // nome longo: Ficha, aviso do caçador, prefixo do Motivo em Descartados
  "sigla": "PDV",                       // PROPOSTO: rótulo curto único (hoje 3 cópias: crm-formato, proxima-venda, office/decisoes)
  "catalogo_prumo": "pdv",              // PROPOSTO: id em prumo/06-qualidade/catalogo.json (pode diferir: estampa ↔ crm)
  "tipo": "propria",                    // PROPOSTO: caminho curto sem Raio-X/Mapa/cardápio; substitui os `iris || estampa`
  "sala": "prumo--pdv",                 // PROPOSTO: sala do Escritório (operacao.ts, linha-de-producao.ts)
  "cacador_rotulo": "Encontrado pelo Caçador de lojas",  // PROPOSTO: hoje OFERTA_DE_PROSPECCAO.cacador em server/crm.ts

  // ---- planilha e n8n
  "aba": "Lojas",                       // aba na planilha do PRUMO; criada por prumo-ofertas.py; única
  "fluxo": "PRUMO · Prisma PDV — Caçador de lojas",          // nome do caçador; achado e trocado POR NOME; começa com "PRUMO"
  "clique": "PRUMO · Prisma PDV — Clique em Enviar convite", // fluxo do clique; só abre o wa.me
  "convite": "convite-pdv",             // path do webhook (GET /webhook/convite-pdv?id=<ID>); sempre "convite-<id>"
  "webhook_id": "<uuid4 novo>",         // id fixo do nó Webhook; único entre os fluxos (dois iguais colidem)
  "teto_por_rodada": 15,                // máximo gravado em Revisar por rodada; o resto fica para a próxima

  // ---- quem entra (regex sem acento e sem caixa, contra nome + tipo do Google + texto do site)
  "empresa": "loja",                    // palavra do convite quando o nome da empresa é ilegível ({NOME})
  "plural": "lojas",                    // nos motivos "Fora do segmento (nada de <plural>…)" e no aviso
  "segmento": "loja|varejo|…",          // tem de casar no nome/tipo ou no site, senão "Fora do segmento"
  "fora": "atacadista|distribuidora|…", // casou no nome/tipo: descarte "Fora do perfil (<tipo>)"
  "perfil": "caixa|pdv|balc[aã]o|…",    // obrigatório no nome, tipo ou site; sem site: "perfil não confirmado"
  "perfil_motivo": "Fora do perfil do Prisma PDV (…)",
  "fora_sem_perfil": "…",               // casou e não tem perfil: descarte com o motivo abaixo
  "fora_sem_perfil_motivo": "Fora do perfil (…)",
  "solo": "",                           // opcional: profissional sozinho → entra marcado, prioridade menor
  "instituicao": "",                    // opcional: o que desfaz o "solo"
  "fora_entidade": "",                  // opcional: entidade que não é cliente final (motivo ainda diz "Iris": passo 2)
  "site_diretorio": "",                 // opcional: site de diretório; o WhatsApp dele não é da empresa
  "sinais": [["um caixa", "…"], ["NFC-e", "nfc-?e"]],  // [rótulo, regex]: coluna Sinais e Prioridade
  "nichos": ["…"],                      // a frase curta que rende mais vem primeiro (busca = nicho × cidade, menos usada antes)
  "cidades": ["Vitória ES", "…"],

  // ---- textos (revisados pelo Rômulo; nunca R$, link, "fundador" ou desconto)
  "mensagem": "{OLA}! Sou o Rômulo, do Prumo. … \n\nPosso te mostrar um exemplo com dados fictícios para a equipe da {NOME}?",
                                        // {OLA} = Bom dia/Boa tarde/Boa noite; {NOME} = nome limpo (prumo-nome.js)
                                        // HOJE: copie também em server/convite-mensagem.ts (passo 25)
  "proxima_enviado": "Aguarde a resposta. …",  // o que o OBSERVADOR grava na Próxima ação quando o convite sai de verdade
  "conversa": {                         // PROPOSTO: hoje CONVERSA_DAS_OFERTAS em whatsapp-conversa.py (passo 13)
    "o_que_foi": "A abertura atual apresenta Rômulo, do Prumo, e oferece …. Um sim autoriza apenas o exemplo.",
    "interesse": "Combine a demonstração …"
  },
  "followup": "…",                      // PROPOSTO: hoje FOLLOWUP_NOVO em followup-experimento.ts
  "pergunta_depois_do_link": "…",       // PROPOSTO: hoje PERGUNTA_DEPOIS_DO_LINK em proxima-venda.ts
  "receita": null,                      // PROPOSTO: null = sem preço aprovado (como estampa)
  "ativo": false                        // PROPOSTO: só documenta a decisão; quem liga é --ativar, nunca o gerador
}
```

Obrigatórios hoje no contrato (`prospeccao_contrato.py:17-39`): `rotulo`, `aba`, `fluxo`, `plural`,
`segmento`, `fora`, `perfil`, `perfil_motivo`, `fora_sem_perfil`, `fora_sem_perfil_motivo`,
`convite`, `proxima_enviado`, `mensagem`, `teto_por_rodada` (inteiro > 0), `nichos` e `cidades`
(listas não vazias) e `sinais` (pares). `clique`, `webhook_id` e `empresa` são usados pelo gerador
mas **não** são conferidos.

O nível de cima do JSON é comum a todas as ofertas: `colunas` (só acrescentar no fim), `ocultas`,
`descartados`, `etapas`, `clientes` e `proxima_revisar`.

---

## 4. Para ficar fácil (proposta, não implementada)

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

**Lado Python: `deploy/dell/claude-ops/ofertas.py`** (`carregar()`), usado por `crm.py` (abas, nós
`Ler <aba>`, cadeia, MONTAR_JS e a lista do VALIDAR_JS), `workflow_contexto_whatsapp.LEITURAS`,
`whatsapp-conversa.py` (`conversa` vindo do JSON), `frente-comercial.py`, `publicador-crm.py`,
`jev-respostas-resumo.py`, `observador.py`, `ler_comercial.py`. O observador e o Hermes rodam de
outras pastas: o JSON precisa ir para lá também (`instalados.json`), e a falta dele tem de derrubar o
boot, não virar lista vazia.

**Comando `python3 deploy/dell/claude-ops/nova-oferta.py <id> --como iris`** (PC ou Mel, sem rede):
copia o bloco modelo com os nomes derivados (`convite-<id>`, `fluxo`, `clique`, `webhook_id` novo,
`teto_por_rodada: 15`) e `TODO` nos campos de negócio; faz o lint da config (id, unicidade de aba,
fluxo, clique e webhook, regex que compilam, regras do texto do convite, glossário, sala com vaga,
`catalogo_prumo` existente); roda o `node --check` e os testes de contrato; e imprime a ordem de
publicação na Mel. **Nunca publica sozinho e nunca chama `--ativar`.**

**Ordem em lotes** (cada um com `npm test` verde):

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
