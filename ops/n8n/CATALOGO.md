# Catálogo do n8n da Mel

Fonte de verdade para quem (pessoa ou IA) vai mexer nos fluxos do n8n sem contexto. Retrato de
**28/10/2026**: 21 workflows, 16 ativos. Feito a partir do export dos 21 fluxos vivos e da leitura
da `main`. Nada aqui foi publicado nem alterado no n8n.

IDs de planilha abreviados: **Site** = "Leads — Site antes da venda" (`1Obv…`), **PRUMO** =
"PRUMO — Fila de revisão" (`1rkU…`), **Form** = respostas do formulário de 16 perguntas (`17Ya…`).
Abas por gid: Leads `396728619`, Buscas `52197070`, Prospects `1838781376`, Clínicas `669388871`,
Estamparias `1842019534`, Descartados `1418162405`; a aba CRM vai pelo nome.

---

## 1. Como o n8n é operado

### Onde roda e por onde se publica

- O n8n roda **só na Mel** (o Dell, em Docker). API local em `http://127.0.0.1:5679/api/v1`.
  Nunca rode nada de n8n no PC; do PC, só `ssh mel`.
- Todo fluxo é publicado pela API por `deploy/dell/claude-ops/n8n.py` (`api()` e `put()`), chamado
  pelos geradores. A chave fica em `~/.config/claude-ops/n8n-api-key` (600) e é lida **na importação**
  do módulo: importar qualquer script exige um HOME com a chave. Os testes falsificam o HOME.
- Os scripts rodam a partir da cópia instalada, `~/.local/share/claude-ops/`. O
  `deploy/dell/instalados.json` copia todo `claude-ops/*.py`, `*.js` e o `prumo-ofertas.json` para lá.
  Mudou um script no repo: merge na `main`, reinstale a cópia (`dell-status --instalados` diz o que
  está atrás) e só então rode o gerador.

### Nunca editar no editor sem refletir no gerador

Os geradores montam o grafo inteiro e fazem PUT por id ou upsert por nome. **A próxima regeneração
apaga o que foi feito à mão no editor.** O `prumo-contexto.timer` também faz PUT dos fluxos em escopo
a cada mudança do contexto. Exceção conhecida: o **01 · Caçador não tem gerador**. Ele só recebe
remendos (GET, muda, PUT); ver a seção 3.2.

### Cadeia de ganchos do `api()` (POST/PUT de `/workflows[/<id>]` com `nodes`)

Antes de qualquer mutação (POST/PUT/PATCH/DELETE), se existir
`~/.config/claude-ops/workflow-operacao.json`, o `api()` valida a política
(`workflow_operacao.validar_config` + `conferir_pedido`). Config ilegível bloqueia **qualquer**
mutação. Depois, nesta ordem:

1. `workflow_confiabilidade.preparar`: sempre; escolhe a transformação pelo nome ou pelo formato do
   fluxo (Caçador, WhatsApp, 07, cliques com "Decidir" + "Marcar").
2. `garantir_erro_salvo`: `saveDataErrorExecution: "all"`, exceto os dois fluxos da Fonte, que ficam
   com tudo `none` (privacidade).
3. `configuracao_contexto()` + `preparar_simplificacao_se_configurado`: contexto WhatsApp (v1 ou v2
   compatível) e `pausarJev`, se `workflow-contexto-whatsapp.json` existir.
4. `workflow_luna.usar_luna`, se existir `luna-workflows-cred` (só o 01 · Caçador).
5. `prumo_contexto.preparar`, se `do_escopo(body)`: nome com "prumo", "site antes da venda",
   "01 · caçador", "whatsapp —", "04 · clique no wa_link" ou "00 · avisar falha". Lê
   `~/prumo/00-contexto/organizacao.md` a cada publicação.
6. `preparar_comercial_se_configurado` (08 e WhatsApp resposta; `workflow-comercial.json`).
7. `preparar_lote_se_configurado` (`contextoLote`, v2 do contexto WhatsApp).
8. `preparar_publicacao_crm_se_configurado` (08; `workflow-publicacao-crm.json`).

Consequência: **o fluxo publicado = gerador + 5 configs opt-in locais da Mel**
(`workflow-operacao.json`, `workflow-comercial.json`, `workflow-contexto-whatsapp.json`,
`workflow-publicacao-crm.json`, `luna-workflows-cred`, todas em `~/.config/claude-ops/`) + o
`organizacao.md` do repo prumo. O repo sozinho não reproduz os fluxos.

### Pausas: política vs `DESLIGADOS`

- **`workflow-operacao.json`** é a pausa que vale. Ele recusa `activate` de id pausado (devolve
  `{active:false, desligado:true, operacao:true}` sem rede), recusa criar ou renomear para nome ou id
  reservado e recusa `DELETE` de pausado. Hoje protege o 05, o 06 e os caçadores pausados.
- **`DESLIGADOS`** (`n8n.py:28`) é letra morta: só tem o id do Lead Scout, que não existe mais. O
  `rodar-agora.py` também o consulta. Não use `DESLIGADOS` para pausar nada novo.
- Para pausar ou religar um caçador de oferta: `python3 prumo-ofertas.py --estado|--ativar|--desativar
  <id>`. Religar exige aprovação específica do Rômulo.

### Falhas e execuções

- **`errorWorkflow`**: 17 fluxos apontam para o **00 · Avisar falha pelo Hermes**, achado **pelo
  nome** em 5 geradores. Exceções: o próprio 00; a Fonte, que aponta para a Fonte-falha de propósito;
  a Fonte-falha; e a **Medição, que não tem nenhum** (pendência).
- **`saveDataErrorExecution: all`** em todos, menos a Fonte e a Fonte-falha (`none`). Vários fluxos
  não guardam as execuções boas (08, Números, Fonte, Fonte-falha, Medição): "0 execuções" neles não
  quer dizer parado.
- **Exceção de privacidade da Fonte.** O 00 copia `execution.error.message` para o aviso. Na Fonte,
  essa mensagem pode carregar a pergunta ou a resposta do cliente. Por isso a Fonte tem um fluxo de
  falha próprio, que avisa sem dados. A regra mora em `n8n.py` (`garantir_erro_salvo`, conjunto
  `privados`).

### Contexto Prumo injetado

`prumo_contexto.py` põe um nó `Prumo · organização · <gatilho>` depois de cada gatilho dos fluxos em
escopo, inclusive dentro dos subworkflows embutidos (40 nós em 20 fluxos; o Radar é o único sem). O
nó grava o guia em `$getWorkflowStaticData('global').prumo_contexto`. O
`prumo-contexto.timer` (`prumo-contexto-sincronizar.py`, a cada 15 min) republica quando o contexto
muda e preserva os fluxos pausados. A cópia operacional fica em `~/.local/share/prumo-contexto/`,
identificada por SHA256. É decisão registrada no `CLAUDE.md`: não tire o nó ao regenerar.

### Avisos

Avisos dos fluxos vão para a fila do Hermes, `/home/node/.n8n-files/avisos/` no container
(`FILA_NO_CONTAINER`). Use `n8n.aviso_nodes(...)`: ele monta o JSON no schema da fila e põe a origem
padrão (`ORIGEM_JS`, `"n8n:<nome do fluxo>"`). Não escreva aviso à mão em gerador novo; nenhum "R$"
passa pela fila.

---

## 2. Os 21 fluxos

"Ativo" é o estado de 28/10/2026. Os geradores ficam em `deploy/dell/claude-ops/`.

| id | Nome | Ativo | Gatilho | O que faz | Gerador | Lê / escreve | Decisão registrada |
|---|---|---|---|---|---|---|---|
| `5FlXnne7lTMihLic` | 00 · Avisar falha pelo Hermes | sim | `errorTrigger` | Transforma a falha de outro fluxo num aviso da fila | `aviso-de-falha.py` | E: erro da execução · S: `avisos/<wf>-<exec>-<i>.json` | Medição ainda não o usa |
| `oow8TkxrAf4fVvTj` | 01 · Caçador | sim | diário 06:00 + manual | Acha lead de Site no Places, filtra, resume com a Luna, pontua e grava | **sem gerador** (remendos) | E: Site/Buscas, Site/Leads, Places · S: Site/Leads, Buscas, `auto-entrada/`, guarda `:8791` | Guarda de aquisição de 25/10 fora da `main` |
| `wjuoIknp2qlWo0QI` | 03 · Balcão (Site antes da venda) | sim | de hora em hora, min 10 | Cruza recibos do gerador com o Leads e monta a abordagem A/B/C/D | `site-antes-da-venda.py --balcao` | E: `auto/**/publicado.json`, dossiês, Site/Leads · S: Site/Leads, `estado/site-*.json` | — |
| `9zeyrR1hNZJNFTqx` | 04 · Clique no wa_link (registra o clique) | sim | webhook GET `enviar` | Grava `clique_em` no 1º clique e redireciona ao wa.me | `fecha-ciclos.py` | E/S: Site/Leads | Rastro técnico do A/B (Fase 4B) |
| `4lFlWNGv5KDZytJE` | 05 · Acompanhamento (Site antes da venda) | **não** | diário 09:00 | Expirava lead em 7 dias e avisava follow-up | `site-acompanhamento.py` | E: recibos, Site/Leads, CRM · S: Site/Leads, `avisos/` | Pausado (Fase 4B), trava em `workflow-operacao.json` |
| `cn4KcQujNk9CwcN0` | 06 · Funil semanal (Site antes da venda) | **não** | segunda 08:00 | Funil por busca; pausava buscas fracas | construtor em `site-acompanhamento.py`, **não publica** | E: recibos, Leads, CRM, Buscas · S: `estado/site-funil.json`, Buscas | Pausado (Fase 5, 24/10); `nao_gerar` ainda é lido |
| `Kf5IWNdEFFnuSOy2` | 07 · Lead: página e ações (Site antes da venda) | sim | webhooks `lead`, `lead-acao` (GET/POST) + de hora em hora, min 20 | Página do lead, botões e o retrato `site-leads.json` | `site-lead-acoes.py` | E: `publicado.json`, Site/Leads · S: Site/Leads, `estado/site-acoes/`, `estado/site-leads.json` | — |
| `AsjxktRCqRJSmj9P` | 08 · CRM: retrato e registros | sim | a cada 10 min + webhooks POST `crm-atualizar`, `crm-registro` | Retrato das 5 abas para a Central; acrescenta registros na aba CRM | `crm.py` | E: Leads, Prospects, Clínicas, Estamparias, CRM · S: aba CRM, `estado/crm-publicacao/` | — |
| `QRVkAhJBvBxt9mx8` | PRUMO · Iris — Caçador de clínicas | **não** | `0 9 * * 1-5` + manual | Fábrica de ofertas com a config das clínicas | `prumo-ofertas.py` (+ `.json`, `-triar.js`) | E: abas de oferta, Prospects, Descartados, Site/Leads, Places · S: Clínicas ou Descartados, `avisos/` | Pausado por AC-11 (17/10) |
| `6pIzCCmktXAUGOdf` | PRUMO · CRM de estamparia — Caçador de estamparias | **não** | `0 9 * * 1-5` + manual | A mesma fábrica, config de estamparia | `prumo-ofertas.py` | idem · S: Estamparias ou Descartados | Pausado por AC-11; publicado atrás do template |
| `GkgYmWZJ65a2e9XF` | PRUMO — Clique em Enviar convite | sim | webhook GET `convite` | Lê a linha e redireciona ao wa.me com o convite | `prumo-simples.py` (ou `--convite`) | E: PRUMO/Prospects · S: redirect | Ramo `passo=diagnostico` morto desde 08/10 |
| `mfyO1YAhBrXxe5Mb` | PRUMO · Iris — Clique em Enviar convite | sim | webhook GET `convite-iris` | idem, aba Clínicas | `prumo-ofertas.py` → `prumo-simples.clique_workflow` | E: PRUMO/Clínicas · S: redirect | Usado como verificação em `fluxos.ts` |
| `rNp1Upq53IFIuRwT` | PRUMO · CRM de estamparia — Clique em Enviar convite | sim | webhook GET `convite-estampa` | idem, aba Estamparias | `prumo-ofertas.py` | E: PRUMO/Estamparias · S: redirect | — |
| `b091d18b-…` | PRUMO — Diagnóstico do dono | sim | de hora em hora + manual | Pendências do PRUMO, pontuação do formulário, ramo do Mapa | `prumo-simples.py` (+ `prumo-mapa-n8n.py`, `prumo-aviso-unico.py`) | E: Prospects, Form, `site-leads.json`, memórias · S: `estado/prumo.json`, Prospects, `mapa-fila/`, `avisos/` | Formulário não é mais oferecido desde 08/10 |
| `yNLwUy5bdEmC4Qss` | PRUMO · Fonte com IA (Luna do Hermes) | sim | a cada 30 s + manual | Reivindica pergunta no serviço público, pergunta à Luna, conclui | `prumo-publico.py` | E/S: Easypanel `/operacao/*`, `luna-workflows:8766/fonte` | Não guarda execuções; errorWorkflow = Fonte-falha |
| `9wCjxg7rcPRLONDe` | PRUMO · Fonte — falha sem dados | sim | `errorTrigger` | Aviso de falha da Fonte sem pergunta nem erro | `prumo-publico.py` | S: `avisos/fonte-<exec>.json` | Separado do 00 por privacidade |
| `qA5R9UXZj4UgIjFi` | PRUMO · Medição de eventos | sim | a cada 1 min + manual | Publica origens permitidas e grava as métricas | `prumo-publico.py` | E: `site-leads.json`, serviço público · S: `estado/prumo-metricas.json` | **Sem errorWorkflow** |
| `c8d62107-…` | Radar PNCP — coleta diária | **não** | `30 7 * * *` + manual | `POST collector:3000/collect` | declarativo: `deploy/dell/licitacoes-automation/workflows/radar-pncp.json` | — | Inativo desde 23/09; **arquivamento decidido em 28/10/2026** |
| `fd8gz4uDQkJtEd9W` | WhatsApp — conversa com lead (marca sozinho) | sim | webhook POST `whatsapp-conversa` | Saída/entrada/lido do observador → Etapa e datas | `whatsapp-conversa.py` | E: contexto (4 abas) · S: Prospects, Leads, Clínicas, Estamparias | Contrato do observador |
| `AGqVS4KoeqGqdey5` | WhatsApp — números dos leads (para o observador) | sim | webhook GET `whatsapp-telefones` | Devolve as chaves (DDD + 8) dos leads | `whatsapp-conversa.py` | E: contexto · S: resposta JSON | — |
| `IiuekGDVnjFaZpD1` | WhatsApp — resposta de lead (classifica) | sim | webhook POST `whatsapp-resposta` | Classifica a mensagem do lead com o Gemini e avisa a Central | `whatsapp-conversa.py` | E: contexto · S: 4 abas, `estado/site-acoes/`, `172.23.0.1:8766/comercial/evento` | Jev em sombra pausado (Fase 4) |

Execuções na janela de ~10 dias até 28/10: 01 (19, 5 falhas), 03 (238), 04 (48, 1 falha),
07 (238), Diagnóstico (236), WhatsApp conversa (1.223, 5 falhas), números (1.121, 1 falha),
resposta (421, **55 falhas**), Medição (2 falhas em 22/10), 00 (65 disparos). Os três cliques de
convite tiveram 0.

---

## 3. Ficha por família

### 3.1 Infra e erro

**00 · Avisar falha pelo Hermes**
- Propósito: toda falha de fluxo que o aponte vira um aviso que o Hermes entrega.
- Gatilho: `errorTrigger`. Saída: `avisos/<wf>-<exec>-<i>.json` (fluxo, nó, 300 caracteres do erro,
  link).
- Gerador: `aviso-de-falha.py`. Ele também põe o `errorWorkflow` em todos os fluxos; `--testar`
  dispara um aviso de prova.
- Armadilhas: o 00 é achado **pelo nome** em 5 lugares (`fecha-ciclos.py`, `prumo-ofertas.py`,
  `prumo-simples.py`, `site-antes-da-venda.erro_wf`, `whatsapp-conversa.py`). Renomear o 00 quebra
  todos. Ele copia a mensagem de erro: fluxo com dado sensível na mensagem precisa de falha própria
  (ver Fonte).

### 3.2 Site antes da venda (01 a 08)

**01 · Caçador**
- Propósito: com a posse da aquisição garantida, escolhe a busca ativa menos usada da aba Buscas,
  consulta o Places, filtra (raio, telefone, 5+ avaliações, rede/franquia, já na planilha), classifica
  e resume com a Luna (`luna-workflows:8766/inferir`), checa o site, pontua e grava no Leads. Entrega
  `content.md` e foto em `auto-entrada/` para o gerador de sites.
- Gatilhos: diário às 06:00 e manual.
- Envelope (igual nos três caçadores desde 25/10): `Reservar aquisição exclusiva → Posse confirmada?
  → Executar aquisição reservada → Concluir posse`, HTTP para `172.23.0.1:8791` (credencial "Prumo ·
  Guarda da aquisição").
- Gerador: **nenhum**. Remendos: `site-cacador-escolha.py`, `site-cacador-site-no-ar.py` (+ `.js`),
  `site-nichos.py`. Ganchos: `workflow_confiabilidade.concluir_cacador` e `workflow_luna`. Cópia de
  auditoria em `workflows/01-Cacador.sanitizado.json` (não publicar).
- Armadilhas: a guarda **não tem TTL**; erro, crash ou resposta ambígua conserva a posse, e os três
  caçadores terminam **verdes e calados** com `acquired=false`. Conferir com `GET /status` da guarda
  ou `aquisicao-guarda --status`; nunca chamar `/claim` ou `/release` à mão. Sem `executionTimeout`.
  O construtor da guarda não está na `main` (seção 6).

**03 · Balcão**
- Propósito: de hora em hora, cruza os recibos do gerador (`publicado.json`, `personalizado.json`,
  `DOSSIE.md`, descartados) com o Leads, monta a abordagem (A/B/C/D de `site-mensagem.js`) e grava o
  estado da esteira e das pastas a mover.
- Gerador: `python3 site-antes-da-venda.py --balcao` (`--balcao-restrito` só troca o Code). O nó
  "Cruzar recibos e montar abordagem" vem de `balcao-cruzar.js` + `site-mensagem.js`.
- Armadilhas: host do Tailscale fixo em `LINKS`; nó de 45 KB (gerado, aceitável).

**04 · Clique no wa_link**
- Propósito: o link de envio do Site passa aqui, grava `clique_em` e redireciona ao wa.me.
- Gerador: `python3 fecha-ciclos.py`.
- Armadilhas: lê a aba inteira a cada clique; ID da planilha no `jsCode`.

**05 · Acompanhamento** e **06 · Funil semanal** (pausados)
- 05: expirava lead em 7 dias e avisava follow-up. 06: funil semanal por busca, pausava buscas fracas
  e gravava `site-funil.json` com `nao_gerar`.
- Gerador: `site-acompanhamento.py` publica o 05; o `__main__` **não publica mais o 06** ("nunca
  reconfigurar o 06"). O construtor `funil()` e `site-funil-regra.js` só servem a `--testar` e
  `--simular`.
- Armadilhas: não religar nem apagar. A trava de `workflow-operacao.json` bloqueia ativação, exclusão
  e recriação. O `site-funil.json` gravado pelo 06 segue restringindo a fila do gerador. Religar o 06
  exige contrato completo da Central (Fase 5).

**07 · Lead: página e ações**
- Propósito: três entradas. Página do lead (GET `lead`), botão (GET `lead-acao`) com confirmação
  (POST `lead-acao`), e o retrato de hora em hora (min 20) que grava `site-leads.json`, lido pela
  Medição e pelo Diagnóstico.
- Gerador: `python3 site-lead-acoes.py` (`--retrato-agora` refaz o retrato).
- Armadilhas: webhooks sem autenticação (link do Rômulo na tailnet); varre `publicado.json` 3× por
  visita; `Wait` fixo de 2 s.

**08 · CRM: retrato e registros**
- Propósito: retrato de Leads, Prospects, Clínicas, Estamparias e CRM para a Central, a cada 10 min ou
  sob pedido; acrescenta os registros da Central na aba CRM.
- Webhooks com header auth (credencial "CRM Central", criada pelo próprio `crm.py`).
- Gerador: `python3 crm.py` (+ ganchos `workflow_comercial`, `workflow_publicacao_crm`).
- Armadilhas: cada registro dispara releitura completa das 5 abas. Clínicas e Estamparias vão
  **pelo nome** da aba. A lista de produtos do `VALIDAR_JS` vem do registro
  (`prumo-ofertas.json` lido por `ofertas.py`, `produtos_do_crm()`; `crm.py validar_js()`): oferta nova entra
  sozinha ao republicar o 08 · CRM, e oferta que não está no JSON volta "Produto inválido" (ver `NOVA-OFERTA.md`).

### 3.3 PRUMO: diagnóstico e convites

**PRUMO — Diagnóstico do dono**
- Propósito: de hora em hora grava as pendências do PRUMO; lê o formulário de 16 perguntas, calcula
  Índice e Briefing e grava em Prospects; avisa resposta fora da lista. Ramo do Mapa: monta o pacote em
  `mapa-fila/` para quem pediu.
- Gerador: `python3 prumo-simples.py` monta o grafo inteiro e faz PUT por id. Usa `prumo-mapa-n8n.py`
  e `prumo-aviso-unico.py` como módulos.
- Armadilhas: o formulário não é mais oferecido desde 08/10, mas o Mapa está encadeado depois da
  leitura do Form; enxugar exige cuidado. As 16 perguntas só existem no fluxo vivo, no
  `prumo-perguntas.js` instalado (gravado por `perguntas_atuais()`, fora do git) e na fixture
  `testes/prumo-diagnostico.fixture.json`.

**Os três "Clique em Enviar convite"** (`convite`, `convite-iris`, `convite-estampa`)
- Propósito: o botão "Enviar convite" das abas abre o wa.me com o texto pronto. **Não marca nada**:
  quem muda a Etapa para "Convite enviado" é o observador do WhatsApp quando a mensagem sai.
- Esqueleto igual (5 nós): webhook GET sem auth → contexto → `Ler a linha` (aba inteira, retry 3) →
  `Decidir` (texto de `prumo-nome.js`) → `Abrir o canal` (redirect 302).
- Geradores: PRUMO em `prumo-simples.py`; Iris e estampa em `prumo-ofertas.py`, que chama
  `prumo-simples.clique_workflow`.
- Armadilhas: a Central **não** usa esses webhooks; ela monta o wa.me direto com
  `server/convite-mensagem.ts`, que tem **cópia à mão** dos textos do `prumo-ofertas.json`. Mudou o
  texto: mude os dois. O convite do PRUMO ainda tem o ramo morto `passo=diagnostico` (Google Form +
  TinyURL). `scripts/publicar-aberturas.py` (one-shot de 27/10) publicou textos nesses três ids.

### 3.4 Ofertas: caçadores Iris e Estamparia

- Propósito: a fábrica comum de prospecção das ofertas (Fase 5). Escolhe a busca nicho × cidade
  menos usada, consulta o Places (até 3 páginas), tria com `prumo-ofertas-triar.js`, deduplica contra
  **todas** as abas de oferta + Prospects + Descartados + Site/Leads e grava em Revisar na aba da oferta
  (ou em Descartados com motivo). Teto por rodada no JSON. Avisa pelo Hermes.
- Gatilhos: `0 9 * * 1-5` e manual. Ambos **pausados** (AC-11, 17/10/2026: ~1.800 achados num dia
  contra 10 envios). Religar quando a Triagem cair para ~2 semanas de envio, com aprovação do Rômulo.
- Gerador: `python3 prumo-ofertas.py` cria a aba, publica o caçador **sem ativar** e o clique.
  `--estado`, `--ativar`, `--desativar`, `--rodar`, `--reavaliar`, `--busca`, `--codigo`.
- Armadilhas:
  - A Estamparia publicada está **atrás do template**: faltam 13 linhas (`fora_entidade`,
    `site_diretorio`) que a Iris tem. Sem efeito hoje (a estampa não define esses campos); a próxima
    regeneração muda o código dela, e isso é esperado.
  - Leituras de dedupe toleram falha (aba que falha vira lista vazia). Risco registrado na Fase 5;
    corrigir antes de ampliar volume.
  - Os motivos de `fora_entidade`/`site_diretorio` dizem "do Iris" fixo (`prumo-ofertas-triar.js:160,
    178`).
  - Não juntar os dois num fluxo: os nomes são identidade da guarda de aquisição e do
    `workflow-operacao.json`.

### 3.5 Fonte e Medição (serviço público do PRUMO)

**PRUMO · Fonte com IA (Luna do Hermes)**
- Propósito: a cada 30 s faz `POST …/operacao/reivindicar` no serviço público (Easypanel); sem
  pergunta, para em `Separar pergunta`. Com pergunta, `POST luna-workflows:8766/fonte` (timeout 140 s)
  e `/operacao/concluir`. O serviço público não alcança a Mel, por isso o poll.
- Settings: não guarda nada; `executionTimeout` 170 s; errorWorkflow = Fonte-falha.
- Gerador: `python3 prumo-publico.py` (instala os três). Credenciais lidas de
  `~/.config/claude-ops/prumo-publico-cred` e `luna-workflows-cred`.
- Armadilha: com a Luna levando até 140 s e o gatilho de 30 s, até ~5 execuções podem rodar juntas. O
  lease do servidor evita repetir pergunta, mas não limita o paralelismo.

**PRUMO · Fonte — falha sem dados**
- `errorTrigger` → aviso sanitizado em `avisos/fonte-<exec>.json`, sem pergunta nem erro. Timeout
  30 s, não guarda nada. Existe por privacidade; não juntar com o 00.

**PRUMO · Medição de eventos**
- Propósito: a cada minuto lê `site-leads.json`, publica a lista de origens permitidas no serviço
  público (só quando muda ou a cada 30 min, estado em staticData), lê as contagens e grava
  `estado/prumo-metricas.json`. `executionTimeout` 170 s.
- Gerador: `prumo-publico.py`.
- Armadilha: **sem `errorWorkflow`**. As 2 falhas de 22/10 só apareceram no monitor.

### 3.6 WhatsApp (três fluxos)

| | números (GET `whatsapp-telefones`) | conversa (POST `whatsapp-conversa`) | resposta (POST `whatsapp-resposta`) |
|---|---|---|---|
| Contrato | devolve as chaves DDD + 8 dos leads | saída/entrada/lido → Etapa e datas | mensagem do lead → Gemini → resposta + envelope para a Central |
| Escrita | nenhuma | `Persistir antes de confirmar` (Switch + 4 updates) | idem + pedido de pasta + `POST 172.23.0.1:8766/comercial/evento` |

- Autenticação: header auth, credencial "Observador WhatsApp" (criada pelo `whatsapp-conversa.py`).
  Chamados pelo observador (`deploy/dell/whatsapp-observador/observador.py`).
- Contexto: os três embutem o mesmo subworkflow de contexto (`workflow_contexto_whatsapp.py`, Fase 4):
  2 `batchGetByDataFilter` (planilhas Site e PRUMO) com as 4 abas, normalização e
  `Contexto WhatsApp: conferir fontes`, que **fecha** se uma fonte falhar (nunca confirma "não é lead"
  com contexto parcial). A guarda exige exatamente as leituras de `LEITURAS`
  (`workflow_contexto_whatsapp.py:15`).
- Classificação: Gemini `models/gemini-3.6-flash` (credencial "Google Gemini (Dell)"). Os 4 nós do
  Jev estão desativados e sem entrada (pausa da Fase 4); manter até decisão do Rômulo.
- Gerador: `python3 whatsapp-conversa.py` publica os três, com os ganchos de contexto, papéis e
  comercial. `--testar` roda os testes embutidos.
- Armadilhas:
  - A resposta tem **13% de falha** (55 de 421). Causas prováveis, a confirmar: contexto incompleto
    (fecha de propósito), Gemini, ou o `comercial/evento`. Conferir se o observador repete e se
    nenhuma resposta fica sem classificar.
  - O `Decidir pela resposta` (46 KB) embute uma **cópia antiga** de `site-mensagem.js` (antes de
    19/10 e 27/10). Só `segundaDe` e `numeroDoLead` são usadas, e essas batem com o repo. São ~33 KB
    mortos; regenerar no próximo lote, preservando os ganchos da Fase 4.
  - Nomes genéricos escondem a leitura das planilhas: `Decidir` (conversa), `Montar chaves`
    (números) e `Montar pergunta` (resposta) são subworkflows inteiros.
  - Conversa e resposta escrevem colunas diferentes da mesma linha; cada update só manda as suas.

### 3.7 Radar PNCP

- `POST collector:3000/collect` às 07:30, mais um nó que repassa a resposta. Inativo desde 23/09; o
  `collector` está no profile `radar` do compose e não sobe. A frente de licitações está pausada desde
  11/10 (`deploy/dell/README.md`, seção "Radar PNCP").
- **Arquivamento no n8n decidido em 28/10/2026.** Reversível: restaura pelo próprio n8n (desarquivar)
  ou pela fonte declarativa `deploy/dell/licitacoes-automation/workflows/radar-pncp.json`, importada
  pelo bootstrap do compose. O vivo tem `errorWorkflow` e o JSON não.
- Na limpeza de 28/10/2026 a frente `pncp` saiu de `src/operations/fluxos.ts` (fica um comentário
  com o caminho de volta). Continuam citando o Radar: `deploy/dell/README.md` (seção "Radar PNCP") e
  `dell-status.py` (marca `pausa-pncp`, dica do fluxo). O `dell-status` só lista fluxos ativos:
  arquivar não deixa nada vermelho.

---

## 4. Por que não juntamos (avaliações de 28/10/2026)

- **Os três convites.** Dá para ser um webhook só (três nós webhook, um Switch e um mapa por oferta).
  O ganho é pequeno: 10 nós, código já gerado pela mesma regra (`prumo-nome.js`). O custo é mexer em
  dois geradores, no `publicar-aberturas.py`, no `fluxos.ts` e contrariar a Fase 4B ("não fundir
  entradas distintas só para reduzir a contagem"). Os paths precisam continuar, porque as linhas antigas
  das abas guardam as URLs. Ficam separados; só o ramo `diagnostico` do PRUMO sai.
- **Os três caçadores.** Só o envelope da guarda é comum. O núcleo do 01 é outro pipeline (35 nós,
  Luna, gerador de sites), sem nenhum código em comum com a fábrica de ofertas. Iris e Estamparia já
  saem da mesma fábrica; juntá-los num fluxo mudaria nomes que a guarda e a política usam como
  identidade. A Fase 5 decidiu não criar segunda fábrica.
- **Os três WhatsApp.** Contratos diferentes (ler chaves, marcar etapa, classificar resposta) e
  escritas diferentes. Juntar contraria a Fase 4B. O contexto repetido já sai de um construtor só; a
  melhoria possível é virar subworkflow chamado por id, o que muda os construtores e os testes da
  Fase 4.
- **Fonte-falha e 00.** O 00 copia a mensagem de erro, que na Fonte pode trazer a pergunta do cliente.
  Juntar faria o 00 tratar a Fonte como exceção e acoplaria privacidade a um fluxo genérico.

---

## 5. Pendências achadas em 28/10/2026 (não resolvidas aqui)

1. **Medição sem `errorWorkflow`.** Corrigir em `prumo-publico.py` e republicar.
2. **01 · Caçador sem gerador.** Só remendos; a única cópia é o export sanitizado. Decidir entre
   escrever um gerador a partir dele ou assumir os remendos como fonte.
3. **Estamparia publicada atrás do template** (13 linhas de `fora_entidade`/`site_diretorio`).
   Regenerar antes de religar, com a guarda de aquisição instalada.
4. **Ramo morto `passo=diagnostico`** no convite do PRUMO (Form + TinyURL + ID do Form fixo). Limpar em
   `prumo-simples.py`.
5. **Classificador WhatsApp com 13% de falhas** (55/421). Investigar com `dell-status` ou a API de
   execuções.
6. **Cópia antiga de `site-mensagem.js` no classificador.** Regenerar pelo `whatsapp-conversa.py`.
7. **Nó de contexto repetido 40× sem leitor.** ~476 KB de JSON igual e ~13 KB de staticData gravados
   a cada execução (inclusive Fonte a cada 30 s e Medição a cada minuto). Nenhum nó de produção lê;
   só o validador `prumo-contexto-validar.py`. É decisão registrada; para cortar custo, gravar só
   versão + SHA256 e deixar o texto num arquivo.
8. **Sem `executionTimeout`** em todos, menos Fonte (170 s), Fonte-falha (30 s) e Medição (170 s). Nos
   caçadores pesa: uma execução pendurada segura a posse da aquisição.
9. **Constantes duplicadas** (cópias literais no código):

   | Constante | Cópias | Onde |
   |---|---|---|
   | Planilha Site `1Obv…` | 3 | site-antes-da-venda, prumo-ofertas, whatsapp-conversa |
   | `LEADS_GID` | 4 | site-antes-da-venda, crm, prumo-ofertas, whatsapp-conversa |
   | Planilha PRUMO `1rkU…` | 4 | crm, prumo-ofertas, prumo-simples, whatsapp-conversa |
   | `PROSPECTS_GID` | 3 | crm, prumo-ofertas, whatsapp-conversa |
   | Credencial Sheets `5Dy1…` | 5 | site-antes-da-venda, prumo-ofertas, prumo-simples, sheets_proxy, whatsapp-conversa |
   | Credencial Places `v7aU…` | 2 (1 usada) | prumo-ofertas; site-antes-da-venda (sobra) |
   | Webhook da tailnet `…ts.net/webhook` | 6 + 1 origem | balcao-cruzar.js, crm, prumo-ofertas, prumo-simples, site-antes-da-venda, whatsapp-conversa, workflow_confiabilidade |
   | n8n local `127.0.0.1:5679` | 13 | n8n.py, crm, site-lead-acoes e inline em mais 10 |
   | id do Diagnóstico | 3 | prumo-aviso-unico, prumo-mapa-n8n, prumo-simples |
   | id do Caçador | 2 | site-antes-da-venda, lote-continuo |
   | ids do 08 e da resposta | 2–3 | workflow_comercial, workflow_publicacao_crm, workflow_papeis, workflow_contexto_whatsapp |
   | nome do 00 | 5 buscas | ver 3.1 |
   | bloco de settings `executionOrder/timezone/errorWorkflow` | 8 | geradores |
   | upsert por nome | ~8 versões | cada gerador com a própria regra de ativar |
   | URL pública do Easypanel do PRUMO | 2 | prumo-publico, scripts/fonte-homologar |

   Também no `jsCode`: 18 IDs de planilha em 11 nós, o host do Tailscale em 9 nós, o IP da bridge
   `172.23.0.1` e o host do Easypanel. Abas Clínicas/Estamparias vão por nome em uns fluxos e por gid
   em outros: renomear a aba quebra só metade.
10. **Guarda de aquisição.** O envelope dos caçadores está ativo em produção desde 25/10. O código
    (`serializacao_aquisicao.py`, `deploy/dell/aquisicao-guarda.py` e `.service`) e a doc
    `docs/revops/n8n.md` estavam só no checkout da Mel e entraram na `main` em 28/10/2026, com a entrada
    em `instalados.json`.
11. **Resíduos menores.** `DESLIGADOS` (`n8n.py:28`) ainda só com o Lead Scout; a dica do 05 em
    `dell-status.DICAS_DO_FLUXO` está desatualizada (fala em follow-up do 3º dia e expiração no 10º) e
    os prefixos não pegam os fluxos `PRUMO · …`; o comentário de `whatsapp-conversa.py:1056` sobre a
    credencial Gemini está errado; staticData residual no 01; nenhum fluxo tem sticky note dizendo de
    onde vem. Já resolvidos na limpeza de 28/10/2026: a dica do Lead Scout no `dell-status` e os
    imports `prumo-lead-scout-v1`/`prumo-diagnostic-score-v1` do bootstrap do compose
    `licitacoes-automation`.

---

## 6. Mapa de scripts

Pasta `deploy/dell/claude-ops/`, salvo indicação. Papel: **gerador** (monta e publica), **remendo**
(GET, muda, PUT sobre o vivo), **gancho** (transformação da cadeia do `api()`), **biblioteca**,
**JS embutido**, **ferramenta**, **serviço**, **teste**. **Morto** = sendo removido em 28/10/2026.

| Arquivo | Papel | Fluxo alvo |
|---|---|---|
| `n8n.py` | biblioteca (cliente + cadeia de ganchos) | todos |
| `workflow_confiabilidade.py` | gancho (sempre) | Caçador, WhatsApp, 07, cliques |
| `workflow_luna.py` | gancho (opt-in `luna-workflows-cred`) | 01 |
| `prumo_contexto.py` | gancho (por nome, `do_escopo`) | 20 fluxos |
| `workflow_comercial.py` | gancho (opt-in) | 08, WhatsApp resposta |
| `workflow_contexto_whatsapp.py` | gancho (opt-in v1) | 3 WhatsApp |
| `workflow_contexto_lote.py` | gancho (opt-in v2 `contextoLote`) | 3 WhatsApp |
| `workflow_papeis.py` | gancho (opt-in `pausarJev`) | WhatsApp resposta |
| `workflow_publicacao_crm.py` | gancho (opt-in) | 08 |
| `workflow_operacao.py` | gancho/política (pausa e nomes reservados) | 05, 06, caçadores |
| `aviso-de-falha.py` | gerador + ferramenta (`--testar`) | 00 (+ errorWorkflow de todos) |
| `site-antes-da-venda.py` | gerador + módulo de constantes | 03 |
| `balcao-cruzar.js` | JS embutido | 03 |
| `site-mensagem.js` | JS embutido (textos) | 03, 05, WhatsApp |
| `fecha-ciclos.py` | gerador + módulo | 04 |
| `site-acompanhamento.py` | gerador (05) + construtor não publicado (06) + ferramenta | 05 |
| `site-funil-regra.js` | JS embutido (dormente) | 06 |
| `site-lead-acoes.py` | gerador | 07 |
| `crm.py` | gerador (+ credencial "CRM Central", aba CRM) | 08 |
| `whatsapp-conversa.py` | gerador ×3 + testes embutidos | 3 WhatsApp |
| `jev-respostas-resumo.py` | ferramenta só leitura (dormente) | Data Table do Jev |
| `prumo-simples.py` | gerador + módulo (`clique_workflow`) | Diagnóstico, convite PRUMO |
| `prumo-aviso-unico.py` | módulo (o `main()` é one-shot já absorvido) | Diagnóstico |
| `prumo-mapa-n8n.py` | módulo + remendo + `--teste` | Diagnóstico |
| `prumo-nome.js` | JS embutido | 3 convites |
| `prumo-ofertas.py` | gerador + CLI | caçadores e cliques Iris/estampa |
| `prumo-ofertas.json` | config | idem; também lido por `whatsapp-conversa.py` e testes TS |
| `prumo-ofertas-triar.js` | JS embutido | caçadores Iris/estampa |
| `prospeccao_contrato.py` | biblioteca de contrato (só teste) | — |
| `prumo-publico.py` | gerador | Fonte, Fonte-falha, Medição |
| `site-cacador-escolha.py` | remendo | 01 |
| `site-cacador-site-no-ar.py` + `.js` | remendo + JS | 01 |
| `site-nichos.py` | remendo multi-fluxo (quase sem uso) | fluxos com `const FEMININOS` |
| `sheets_proxy.py` | biblioteca (workflow ZZ temporário) | temporário |
| `rodar-agora.py` | ferramenta (cópia temporária com webhook) | qualquer |
| `prumo-contexto-sincronizar.py` | remendo automático (timer 15 min) | fluxos em escopo |
| `prumo-contexto-validar.py` | ferramenta de QA | temporário |
| `prumo-fonte-cliente.py` | ferramenta (sem API n8n) | — |
| `fonte_luna.py`, `luna_workflows.py` | biblioteca + serviço | chamados por 01 e Fonte |
| `prumo-metricas.py` | serviço (sem API n8n) | — |
| `testes/prumo-diagnostico.fixture.json` | fixture | `workflow_confiabilidade.test.py` |
| `*.test.py` | teste (rodados à mão) | — |
| `prumo-porte-cnpj.py` | **morto** (remendo do Lead Scout); fica enquanto o cartão `PRUMO-1-B1` do blueprint o citar | Lead Scout, que não existe |
| `prumo-porte-cnpj.js` | **morto**; lido pelo `.py` acima | Lead Scout |

Apagados em 28/10/2026 (one-shots já aplicados, sem referência viva): `teste-migracao.py` (23/09),
`site-buscas-ampliar.py` (07/10) e `aviso-origem.py` (06/10; o `ORIGEM_JS` já cobre). As cópias antigas
em `~/.local/share/claude-ops/` da Mel também saíram.

Fora de `claude-ops`: `deploy/dell/dell-status.py` (lê workflows e execuções), `lote-continuo.py`
(usa `rodar-agora` no 01), `instalar-qualidade-prumo.py` (instalador de 21/10),
`frente-comercial.py` e `whatsapp-observador/observador.py` (clientes de webhook),
`scripts/fonte-n8n-contratos.py` e `scripts/fonte-homologar.py` (QA da Fonte),
`scripts/publicar-aberturas.py` (one-shot de 27/10, já aplicado).
