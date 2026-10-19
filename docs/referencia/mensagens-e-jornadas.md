# Mensagens e jornadas: retrato de 17/10/2026

> **Registro de época.** Descreve a Central de 17/10/2026. Desde 19/10/2026 (`docs/auditoria-de-fluxos-2026-10-19.md`) a Próxima venda não é mais um cartão
> (`ProximaVenda.vue` saiu): a fila de venda alimenta a Ficha, o "Envie para X" do Telegram e a lista **Conversas para você**; as abas de Vendas se chamam
> Conversas para você, Primeiros contatos e Entender (Funil, Diagnóstico, Resultados); abrir o WhatsApp nunca registra envio; e o follow-up e o Perdido (7 dias)
> têm um dono só, a Central.

Levantamento feito antes do redesenho em três menus (Central de comando, Assistente,
Vendas). Parte 1: como uma mensagem de WhatsApp do lead vira ação. Parte 2: os fluxos de
cada item de menu, com o que manter, fundir, esconder ou cortar.

## 1. Mensagens

### 1.1 Como são lidas

```
Evolution 2.3.7 -> webhook -> evolution-adaptador.py (traduzir)
  -> respostas.jsonl (lead) e enviadas.jsonl (Rômulo)
  -> observador.py (ler_respostas, Conversas._anexar)
  -> ~/.local/share/whatsapp-conversas/<DDD + 8 últimos dígitos>.jsonl
  -> server/conversa-do-lead.ts (resumo PURO: última mensagem, link já mandado)
```

- Linha da conversa: `{em, direcao: entrada|saida, texto<=2000, origem, id?}`.
- Mídia vira marcador: imagem `[imagem] legenda`, vídeo `[vídeo] legenda`, documento
  `[documento] nome`, figurinha `[figurinha]`. Até 17/10 o áudio era `[áudio]` fixo, sem
  duração nem conteúdo: o sistema não sabia o que o lead disse.
- O lote de entradas (45 s sem mensagem) também vai ao n8n, onde o Gemini classifica.

### 1.2 Como são interpretadas

- O TypeScript não classifica resposta. `resposta.tipo` (negativa, exclusao, interesse,
  neutra, bot) vem só do Gemini do n8n (`whatsapp-conversa.py`).
- Regras determinísticas que sobram: a regra dos 5 min contra saudação, `resultados.ts`
  (`respondeuDeGente` = não é bot; `quisVer` = interesse), `colinha.ts` (só escolhe a
  resposta pronta) e `mandar-proposta.ts`.
- Até 17/10 não havia detecção de robô de atendimento (`[Atendimento X]`) nem de recepção
  (`*[Nome]*`), nem de negativa educada.

### 1.3 Como são trabalhadas

`montarHoje` cria o item "resposta"; `filaDeVenda` ordena; `fraseDaAcao` e `tatica` dão o
texto. Perdido: 7 dias sem mensagem, contados da última entrada. O copiloto roda só quando a
última mensagem é do lead.

### 1.4 Como são respondidas

Textos prontos (`site-mensagem`, `prumo-mensagem`, `plus-mensagem`, `colinha`,
`mandar-proposta`) abrem o `wa.me`; quem envia é o Rômulo, e o toque anota o envio.
O vendedor do Telegram avisa e nunca envia. Iris e estamparia não têm 2ª mensagem pronta.

### 1.5 O caso Baobá (Iris), por que o cartão errou

1. O lead mandou um áudio de 27 s: virou `[áudio]`, sem sentido para o classificador.
2. Rômulo perguntou "posso mandar o vídeo? Sem compromisso". O lead respondeu "CLaro, pode
   enviar sim.". O Gemini só via as mensagens DELE, nunca a pergunta, e "pode enviar sim"
   bate literalmente com "pode mandar" (sinal de interesse). Gravou `interesse`.
3. A frase "disse sim: combine a demonstração" é `fraseDaAcao('responder')` fixa para Iris.
4. Depois do vídeo, o cartão seguiu em "RESPONDER": `interesseParado` só se resolve com
   link, e vídeo é mídia, não URL.
5. "Respondeu ontem" usa a primeira resposta de gente; "Perdido em 6 dias" conta a última
   entrada, qualquer uma (inclusive robô).

Correções em andamento (17/10/2026): tipo `licenca` ("sim" a um pedido de licença não é
interesse), classificador com as últimas mensagens do Rômulo, papel `robo`/`recepcao` no
JSONL, vídeo/documento/imagem enviados contam como material (o cartão vira "perguntar o que
achou"), cartão nunca diz "disse sim" quando a última mensagem é nossa, e transcrição do
áudio do lead (Gemini, teto 20/dia, ≤120 s) com "áudio não ouvido" enquanto não há texto.

## 2. Jornadas por item de menu

Hoje a navegação tem 7 destinos e a Entrada é outro serviço. O desenho novo tem três
menus: Central de comando, Assistente, Vendas. Frequências abaixo são ESPERADAS pelo código;
o contador de uso (`/api/operations/uso`) não foi lido (o ssh para a Mel recusou a chave).

### 2.1 Navegação

```mermaid
flowchart TD
  G["Toque na barra / trilho / Ctrl+K"] --> N{"Destino"}
  N -->|Hoje| H["/ Hoje"]
  N -->|Vendas| V["/crm"]
  N -->|Financas| F["/financas"]
  N -->|Agenda| A["/agenda"]
  N -->|Escritorio| E["/squadone"]
  N -->|Mais| M["/mais"]
  N -->|Entrada| EN["/entrada/ recarrega a pagina, outro servico"]
  N -->|"＋ ou Assistente"| AS["Painel do Assistente"]
  N -->|"Ctrl+K lead pelo nome"| FI["/crm?lead= Ficha"]
  N -->|"Ctrl+K Design system"| DS["/design-system"]
  H & V & F & A & E & M --> B["beacon /api/operations/uso conta a tela"]
```

### 2.2 Hoje

```mermaid
flowchart TD
  H["Abre Hoje"] --> L["Le overview + crm + financas/estado a cada 5 min"]
  L --> PV["Cartao Proxima venda"]
  PV --> D1{"Decide"}
  D1 -->|"Abrir WhatsApp"| W["wa.me com texto pronto, envia VOCE"] --> ANO["Anota envio no CRM via n8n/planilha"] --> EN2["Enviei, proxima"]
  D1 -->|Pular| PU["Marca no venda-do-dia"]
  D1 -->|Ficha| FI["Abre Ficha em /crm?lead="]
  D1 -->|"Fora do expediente"| LB["Liberar, vale o dia, no servidor"]
  EN2 --> TG["Fecha o aviso aberto no Telegram"]
  H --> PQ["Por que nao vende: so o gargalo"] --> NU["Numeros"]
  H --> PR["Precisa de voce, max 3"]
  PR --> C1["Dell: so titulos"] --> MM["Mais > Manutencao"]
  PR --> C2["Financas >=90%"] --> FN["Financas"]
  PR --> C3["Troca / Ajuste / Crescimento"] --> GG["Aprova: Calendar / roster"]
  H --> PX["Proximos 3 compromissos"] --> AG["Agenda"]
  H --> SZ["Resolve sozinho, fechado"] --> MM
```

### 2.3 Vendas

```mermaid
flowchart TD
  V["Vendas /crm"] --> T{"Aba"}
  T -->|"A fazer N"| AF["Proxima venda: porque + tatica + mensagem pronta"]
  AF --> AF1{"Acao"}
  AF1 -->|"Abrir WhatsApp"| WA["wa.me, Romulo envia"] --> AN["POST crm/registro -> n8n -> planilha CRM"] --> AF2["Enviei, proxima"]
  AF1 -->|Pular| AF3["Proxima da fila"]
  AF1 -->|"Marcar a recusa"| AF4["Registro de perdido"]
  AF1 -->|Ficha| FI
  T -->|"Triagem N"| TR["Lote de 10 prospects"]
  TR --> TR1{"Cada um"}
  TR1 -->|Convidar| TR2["WhatsApp, convite, anota"]
  TR1 -->|Dispensar| TR3["Registro dispensado, Desfazer 8 s"]
  TR1 -->|"Dispensar os que sobraram"| TR4["Serie com segundo toque"]
  T -->|"Funil N"| FU{"Quadro ou Lista"}
  FU --> FU1["Filtros Buscar Nicho Cidade Passo"] --> FI
  T -->|Numeros| NU["Por que nao vende, Depois do sim, por nicho, A/B"]
  FI["Ficha do lead, folha cheia"] --> F1["Agora: acao primaria"]
  FI --> F2{"Desfecho"}
  F2 -->|Ganhou| F3["Confirma, registro ganhou"]
  F2 -->|Perdeu| F4["Motivo, registro perdido"]
  F2 -->|"Proposta enviada"| F5["Registro proposta"]
  FI --> F6["Conversa + Como vender + Copiloto so copia"]
  FI --> F7["Anotar nota ou proximo passo com data"]
  F1 -->|"Liberar / ritmo"| F8["Trava de horario e ritmo"]
```

### 2.4 Finanças

```mermaid
flowchart TD
  F["Financas"] --> S["Saude + dados ate + Atualizar"]
  S -->|Atualizar| SY["POST sincronizar, Pluggy le bancos"]
  F --> T{"Aba"}
  T -->|Visao| V1["Tenho / Devo / Gastei / Orcamento / Todo mes"]
  V1 --> V2{"Acao"}
  V2 -->|"Mes anterior-proximo ou Competencia-Caixa"| V3["GET visao"]
  V2 -->|"Marcar recorrente"| V4["PUT recorrentes"]
  V2 -->|"Importar PDF ou OFX-CSV"| V5["POST importar, dedupe"]
  V2 -->|"Explicar este mes"| V6["Previa exata, confirma, Gemini"]
  V2 -->|"Toque na categoria"| LA
  T -->|Lancamentos| LA["Lista de lancamentos"] --> LA1["Editor de categoria PATCH, cria regra"]
  T -->|Organizar| OR["Categorias + orcamento + regras"] --> OR1["Criar/renomear/remover, PUT orcamento, tirar regra"]
  AV["Telegram: alerta 70-90-100 / gastei 30"] -.-> F
```

### 2.5 Agenda

```mermaid
flowchart TD
  A["Agenda"] --> C{"Google conectado?"}
  C -->|Nao| C1["Conectar o Google Calendar, OAuth loopback"]
  C -->|Sim| L["GET mochila: compromissos por dia"]
  C -->|"Sim sem Tasks"| C2["Autorizar o Google Tasks"]
  L --> Q["Ajustar compromisso"] --> Q1["AjusteCard, aprova, PATCH no Calendar"]
  L --> R["Atualizar"]
```

### 2.6 Escritório

```mermaid
flowchart TD
  E["Escritorio"] --> SQ["Andar (squad) + Editar a squad + Nova squad"]
  E --> VI{"Lista ou Mapa"}
  VI --> SA["Salas e pessoas"]
  SA --> A1["Contratar / Editar treino / Arquivar / Substituir PO"] --> A2["POST api/squad, roster com copia datada"]
  SA --> A3["Sala Financas"] --> FN["Financas"]
  SA --> A4["Sala PRUMO: leads por passo"] --> FU["Vendas > Funil ?passo="]
  SA --> A5["Robo da sala"] --> CF["Mais > Entender ?fluxo=&passo="]
```

### 2.7 Mais

```mermaid
flowchart TD
  M["Mais"] --> U["Usar: Agenda, Escritorio, Entrada (so no celular)"]
  M --> EN["Entender fechado"]
  EN --> CF["Como funciona: 13 fluxos + Um dia"] --> BP["Ver no blueprint"]
  EN --> RO["Roteiro de venda: copiar, nunca abre WhatsApp"]
  M --> MA["Manutencao"]
  MA --> AC["Ferramentas: Terminal / n8n / Hermes / Nuvem"] --> EXT["Abre link do Dell"]
  MA --> DC["Tudo que o Dell confere"]
  MA --> DG["Desconectar o Google, 2o toque, 6 s"] --> GG["Revoga acesso, agenda para"]
  MA --> DS["Design system"]
```

### 2.8 Assistente

```mermaid
flowchart TD
  G["＋ / Assistente / Ctrl+K Assistente"] --> P["Painel: atalhos por pagina"]
  P --> Q["Pergunta ou pedido"] --> R{"Roteador"}
  R -->|"Pagina financas"| RF["Resposta por regra fixa, sem modelo"]
  R -->|Normal| GM["Gemini + leituras: Vendas, agenda, Dell"]
  GM -->|Estrategia| HE["Consulta Hermes ~20 s"]
  GM --> CT{"Cartao"}
  CT -->|"Pedido ao time"| T1["Toca Mandar -> /api/orquestrar -> Google Calendar/Tasks"]
  CT -->|"Anotacao no CRM"| T2["Toca Anotar -> crm/registro -> n8n/planilha"]
  CT -->|"Mensagem ao lead"| T3["Copiar, Romulo cola no WhatsApp"]
  CT -->|Descartar| T4["So mede"]
```

### 2.9 Entrada

A Entrada não é Pedir, ditado nem Telegram: é a página privada da Mel em `/entrada/`
(serviço Python separado, repassado por `server/entrada-proxy.ts`).

```mermaid
flowchart TD
  EN["Entrada (lateral ou Mais>Usar)"] --> PG["/entrada/ pagina da Mel, recarrega"]
  PG --> TX["Texto ou arquivo ate 200 MB"] --> AC{"Acao"}
  AC -->|"Guardar no cofre"| CO["Filtro de segredos -> age cifra ~/Mel/Cofre"]
  AC -->|Organizar| OR["Filtro -> fila -> Hermes sem ferramentas -> ~/Mel/Entrada/organizado"]
  AC -->|"So guardar"| SG["Filtro -> chegou/"]
  OR --> AVI["Resumo vira aviso no dell-status"]
  PG --> VO["SquadOne"]
```

### 2.10 Vereditos

| Item | Frequência esperada | Veredito |
|---|---|---|
| Hoje | Alta | MANTER como Central de comando, mais enxuta |
| Hoje, Próxima venda | Alta | FUNDIR em Vendas (a Central fica com o contador) |
| Hoje, Por que não vende | Média | FUNDIR em Vendas, Números |
| Hoje, cartão do Dell | Média | MANTER, número único (o chip do topo repete) |
| Hoje, Resolve sozinho | Baixa | ESCONDER em Manutenção |
| Agenda | Média | FUNDIR na Central |
| Agenda, Conectar Google | Raro | ESCONDER em Manutenção |
| Vendas, A fazer | Alta | MANTER |
| Vendas, Triagem | Média | MANTER enquanto os caçadores seguem pausados |
| Vendas, Funil | Média | MANTER a Lista; o Quadro vira opção |
| Vendas, Números | Baixa | MANTER; ESCONDER os blocos A/B |
| Ficha | Alta | MANTER |
| Ficha, Copiloto | Baixa | ESCONDER (flag) |
| Roteiro (em Mais) | Média | Perto de Vendas (botão em Entender) |
| Finanças, Visão e Lançamentos | Média | MANTER, abertas pela Central |
| Finanças, Organizar, Importar | Raro | ESCONDER |
| Escritório, Lista | Raro | ESCONDER em Manutenção |
| Escritório, Mapa | Raro hoje | VIRA o centro da Central |
| Mais, Usar | Média | CORTAR |
| Mais, Entender | Raro | ESCONDER |
| Design system | Raro | ESCONDER |
| Assistente | Provável alta | MANTER (é um dos três menus) |
| Pedir (folha) | Zero no Dell | CORTAR (o Assistente a substitui) |
| Ctrl+K | Baixa | MANTER como atalho: Assistente e leads |
| Entrada | Baixa | MANTER como faixa da Central |

Desnecessário de ver no dia a dia: o número do Dell repetido três vezes, o Mapa
isométrico fora da Central, o "Usar" do Mais, Organizar e Importação de Finanças, os 13
fluxos do Como funciona, os experimentos A/B, o Copiloto em teste, o Design system e o
Quadro do Funil.
