# Aviso único: uma lib para a fila de avisos da Mel (11/10/2026)

Origem: auditoria da Mel de 11/10/2026. Havia uma dúzia de `avisar()` copiadas
pelos scripts, cada uma gravando na fila do dell-status
(`~/.local/share/avisos/fila`) do seu jeito, e três jobs `no_agent` do Hermes
que entregam direto no WhatsApp, fora do silêncio das 22h às 7h, da chave de
24 h e do teto de 20 por hora que o dell-status aplica à fila.

Este documento é o plano. O primeiro PR entrega a lib
(`deploy/dell/lib/aviso.py`), os testes dela e **um** script trocado
(`auto-entrada`). Cada um dos outros vira um PR próprio, na ordem abaixo.

## 1. Inventário das cópias (main de 11/10/2026, commit 452ef2c)

Formato da fila: `deploy/dell/README.md`, "Fila de avisos". O dell-status
valida ao drenar (`validar_aviso`) e manda para `avisos-recusados/` o que não
passa, deixando a verificação vermelha. Ele **não** confere "R$" (só o
`server/avisos.ts` e o `funil-aprendizado` conferem).

| # | Onde | Nome do arquivo | Campos | Valida | Atômico | Cria a pasta | Erro de gravação |
|---|---|---|---|---|---|---|---|
| 1 | `deploy/dell/auto-entrada.py` `avisar` | `auto-entrada-{ns}.json` | titulo fixo, texto, origem | não | não (direto no `.json`) | sim (`mkdir`) | levanta, dentro do `except` do laço: derruba a rodada e os pacotes seguintes ficam parados. `write_text` sem `encoding` (locale). **Trocado neste PR** |
| 2 | `deploy/dell/site-pastas.py` `avisar` | `site-pastas-{ns}.json` | titulo fixo, texto, origem | não | não | sim | levanta (chamado dentro de `except`). **Trocado em 11/10/2026** |
| 3 | `deploy/dell/site-demos-pausa.py` `avisar` | `site-demos-pausa-{ns}.json` | titulo fixo, texto, origem | não (texto com até 25 nomes) | não | sim | levanta (um dos usos está dentro de `except RuntimeError`). **Trocado em 11/10/2026** |
| 4 | `deploy/dell/site-demos-limpeza.py` `avisar` | `site-demos-limpeza-{ns}.json` | titulo fixo, texto, origem | não | não | sim | levanta. **Trocado em 11/10/2026** |
| 5 | `deploy/dell/gerador-de-sites.py` `avisar` | `gerador-{int(time.time())}.json`: **dois no mesmo segundo se sobrescrevem** | titulo fixo, texto, origem | não | não | sim | `except OSError` → log |
| 6 | `deploy/dell/backup/backup-dell.py` `avisar(titulo, texto)` | `backup-dell-{ns}.json` | titulo variável, texto, origem | não | sim (`backup-dell-{ns}.tmp` + `replace`) | sim | levanta. `BACKUP_DELL_SEM_AVISO=1` cala |
| 7 | `deploy/dell/prumo-mapa/prumo_mapa.py` `avisar(texto, teste)` | `prumo-mapa-{ns}.json` | titulo fixo, texto (`[teste]` no teste), origem | não (texto leva nome de empresa) | não | sim | levanta |
| 8 | `deploy/dell/funil-aprendizado.py` `gravar_aviso` | `funil-aprendizado-{ns}.json` | todos, menos link (chave, prioridade 3, expira_em) | **sim** (`conferir_aviso`: formato, R$, dado pessoal; não confere link nem 16 KB) | **sim** (`.nome.tmp` oculto, `open("x")`, `chmod 660`) | **não**: ausente é `ErroDoFunil` | levanta `ErroDoFunil` (de propósito: a rodada registra a falha) |
| 9 | `deploy/dell/whatsapp-observador/observador.py` `avisar_pelo_hermes` | `observador-{ns}.json` | titulo fixo, texto (trecho de lead), origem | não: texto de lead pode ter "R$" ou passar de 4000 | não | sim | `except OSError` → log; depois `entregar_ja()` (`dell-status --drenar` em 2º plano) |
| 10 | `deploy/hermes/scripts/graphify_projetos.py` `avisar_na_fila` | `graphify-duplicatas-{AAAAmmddHHMMSS}-{ns%10⁶}.json` | titulo fixo, texto (lista), origem `hermes:graphify-projetos` | não (lista pode passar de 4000) | não | sim | levanta: o traceback vira stdout/erro do job e vai ao WhatsApp às 03:00. Grava `\n` no fim, `write_text` sem `encoding` |
| 11 | `deploy/hermes/scripts/patch_bridge_envios.py` `avisar` | `bridge-envios-{int(time.time())}.json`: colide no mesmo segundo | titulo fixo, texto (com mensagem de exceção), origem | não | não | sim | `except OSError` → stderr. Roda do clone `~/SquadOne` (não é cópia instalada) |
| 12 | `deploy/dell/claude-ops/site-acompanhamento.py --resumo-backlog --enviar` | `site-acervo-{int(time.time())}.json` | dict de `resumo_backlog()` (titulo, texto, origem) | não (texto com a lista do acervo pode passar de 4000) | não | **não** (pasta ausente = exceção) | levanta (uso manual, raro). `write_text` sem `encoding` |
| 13 | `deploy/dell/atualizar-central.sh` `avisar_falha` (bash) | `atualizar-central-{AAAAmmddHHMMSS}.json` | titulo, texto, origem, chave (`printf` fixo) | não precisa (texto fixo) | não | sim (`mkdir -p`) | roda no `trap ERR`; falha dele é engolida |
| 14 | n8n: `claude-ops/n8n.py` `aviso_nodes` e os nós Code montados à mão em `site-acompanhamento.py` (e outros `claude-ops/*`) | `/home/node/.n8n-files/avisos/{wf}-{exec}-{i}.json` (a fila montada no container) | titulo, texto, `origem: 'n8n:'+$workflow.name` | não | não (o dell-status espera 5 s pelo arquivo novo) | não (montagem do compose) | o nó falha e cai no Error Workflow. Os 2 recusados de 07/10/2026 vieram daqui (fluxo publicado antes do `origem`) |
| — | `server/avisos.ts` (Central) | `{iso}-squadone-{hex}.json` | todos | **sim** (o espelho mais completo: R$, 16 KB) | sim (`.nome.tmp` oculto, `wx`, `0660`) | não | lança `AvisoInvalido` / erro de fila ausente |

Leitores, não escritores: `dell-status.py` (drena), `claude-ops/aviso-de-falha.py`
(o `--testar` só lê a fila), `claude-ops/aviso-origem.py` (corrige fluxos do n8n).

Padrões que se repetem: **11 de 13 criam a pasta** (que é `2770` com o grupo do
n8n e não deve ser criada por script: se for criada com outra permissão, o n8n
deixa de gravar); **11 de 13 gravam direto no `.json`**; **4 usam só segundos
no nome** (gerador, bridge, acervo, atualizar-central) e podem se sobrescrever;
**só 1 (o funil) valida**; **8 não tratam erro de gravação**, e vários chamam o
`avisar` de dentro de um `except` (auto-entrada, site-pastas, site-demos-pausa,
prumo-mapa, backup), onde a exceção nova derruba o que vinha depois.

## 2. A lib (`deploy/dell/lib/aviso.py`)

- `avisar(titulo, texto, origem, *, chave, prioridade, expira_em, link, fila, prefixo, cortar=True) -> Resultado`
- `gravar(dict, fila=None, prefixo=None, cortar=True) -> Resultado` (para quem já monta o dict)
- `Resultado(estado, motivo, arquivo)`, `.gravado`; `estado` ∈ `gravado`, `recusado`, `fila_ausente`, `falhou`
- `validar(dict)` (levanta `AvisoInvalido`), `sem_valores(texto)`, `uma_linha`, `cortar_texto`, `chave_curta`

Regras: as do `validar_aviso` do dell-status, com as mesmas mensagens, mais "R$"
em titulo/texto/link e 16 KB conferidos antes de gravar. O dell-status **não é
importado**: as regras são espelhadas, e o `aviso.test.py` carrega o
`dell-status.py` do repo para conferir que as constantes batem, que todo arquivo
gravado passa no `validar_aviso` dele e que cada recusa da lib (fora o R$) ele
também recusaria. Se alguém mudar o formato no dell-status, esse teste quebra.

Cortes seguros (com `cortar=True`, o padrão): título e origem viram uma linha com
"…" no teto; texto longo termina em "… (cortado)"; chave longa vira prefixo +
`#` + 16 hex do sha256 (estável e distinta); texto encurta até o arquivo caber
em 16 KB. O que já está no formato passa intacto, byte a byte. Recusa sem
gravar: campo a mais, obrigatório vazio, prioridade fora de 0 a 3 (ou bool),
`expira_em` ilegível, link que não é http(s) ou passa de 500, "R$".

Gravação: `.<nome>.tmp` oculto (o dell-status só lê `*.json`), `O_EXCL`, `0660`,
`fsync`, `os.replace`. Nome `<prefixo>-<ns>-<6 hex>.json`; o prefixo padrão é a
origem em minúsculas. Nunca cria a pasta. Nunca levanta: tudo vira `Resultado`,
e o que não foi gravado sai numa linha no stderr (`aviso não gravado (estado,
origem): motivo`), que o systemd leva ao journal.

A fila padrão é `$SQUADONE_AVISOS_FILA` ou `~/.local/share/avisos/fila`, lida a
cada chamada (a mesma variável que o funil já usa).

### Instalação e import

`instalados.json`: `deploy/dell/lib/aviso.py` → `~/.local/lib/mel/aviso.py`
(o mesmo lugar onde já mora `~/.local/lib/mel-entrada/`). O dell-status passa a
cobrar a cópia ("Arquivos instalados", `faltando` até instalar):

```bash
install -D -m 644 ~/SquadOne/deploy/dell/lib/aviso.py ~/.local/lib/mel/aviso.py
```

Cada script carrega a lib pelo caminho, sem `sys.path` global, e cai no jeito
antigo quando não acha ou não consegue carregar nenhuma cópia:

```python
PASTAS_DA_LIB = [Path(__file__).resolve().parent / "lib",   # no repo (testes)
                 HOME / ".local/lib/mel"]                     # no Dell (instalada)

def lib_de_aviso():
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:
            continue
    return None
```

A primeira pasta é relativa ao script no repo: `lib` para `deploy/dell/*.py`,
`../lib` para `deploy/dell/<sub>/`, `../../dell/lib` para `deploy/hermes/scripts/`.
Instalado em `~/.local/bin`, `~/.hermes/scripts` etc., essa pasta não existe e
vale a segunda.

**Ordem de instalação**: a lib primeiro, o script depois. Ao contrário não
quebra (o script sem a lib volta ao jeito antigo), só adia a troca.

## 3. O primeiro script: `auto-entrada`

Por que ele: é o menor (65 linhas), o `avisar` tem um só uso e só no caminho de
erro (pacote ruim do n8n), não tem estado nem rede, roda por `.path` e é
oneshot (não precisa reiniciar serviço), e o aviso dele é informativo (o pacote
já fica em `~/.local/share/auto-entrada-erro/`). Ganha de verdade com a troca:
hoje um `OSError` ao gravar o aviso, dentro do `except`, derruba a rodada e os
pacotes seguintes ficam parados.

O `auto-entrada.test.py` prova que o arquivo gravado pela lib é **idêntico,
byte a byte**, ao do jeito antigo (texto com aspas, barra, acento, quebra de
linha e emoji), que sem a lib (cópia ausente ou quebrada) o script volta ao
jeito antigo e que a rodada segue com a fila ausente. Diferenças de propósito,
só com a lib: o nome ganha `-<6 hex>`; a pasta da fila não é criada; texto acima
de 4000 é cortado em vez de recusado pelo dell-status.

Instalar depois do merge (na ordem): a lib, depois
`install -m 755 ~/SquadOne/deploy/dell/auto-entrada.py ~/.local/bin/auto-entrada`.
Desfazer: reinstalar a versão anterior do script (`git show <commit>^:deploy/dell/auto-entrada.py`);
ou só apagar `~/.local/lib/mel/aviso.py`, que faz o script voltar ao jeito antigo.

## 4. Os demais, um PR por script

Em cada PR: o carregador acima, o `avisar` passando pela lib com o mesmo dict,
o jeito antigo como fallback, um teste "idêntico byte a byte" (lib × antigo) e
um teste com o dell-status aceitando o arquivo. Instalar a cópia depois do
merge (`dell-status --instalados` mostra o comando). Desfazer = reinstalar a
cópia anterior, ou apagar a lib (todos voltam ao jeito antigo de uma vez).

| Ordem | Script | Risco | O que muda além da troca | Instalar / desfazer |
|---|---|---|---|---|
| 2 | `site-pastas.py` | baixo: só caminho de erro, oneshot por `.path` | **Trocado (11/10/2026)**, com `site-pastas.test.py`. Único acréscimo: "R$" na mensagem da exceção vira `[valor]` (`sem_valores`, só quando há R$) em vez de a lib recusar, para o aviso de pacote ruim não se perder | `install -m 755 deploy/dell/site-pastas.py ~/.local/bin/site-pastas`; reverter a cópia (ou apagar a lib) |
| 3 | `site-demos-limpeza.py` | baixo: 1 aviso por rodada diária; já tem `.test.py` | **Trocado (11/10/2026)**, no `.test.py` que já existia. O texto monta-se em `texto_do_aviso` (até 25 nomes e 10 falhas de 200 caracteres, com "e mais N", encolhendo até caber em 3900 caracteres; as falhas todas vão ao journal), para o acervo inteiro com falhas não passar de 4000 e a lib não cortar justo a lista do que falhou. `avisar` devolve se ficou na fila e a rodada só grava `avisados.json` nesse caso (antes o aviso que não gravava levantava, e o estado também não era escrito). "R$" no nome vira `[valor]` | `install -m 755 deploy/dell/site-demos-limpeza.py ~/.local/bin/site-demos-limpeza`; reverter a cópia (ou apagar a lib) |
| 4 | `site-demos-pausa.py` | baixo: igual ao anterior | **Trocado (11/10/2026)**, com `site-demos-pausa.test.py` (novo; roda o `main` inteiro com a Vercel dublada). Igual ao anterior: o texto monta-se em `texto_do_aviso` (nomes e falhas com teto e "e mais N", encolhendo até caber em 3900 caracteres; as falhas ficam no `estado.json`), `avisar` não levanta de dentro de `except RuntimeError`, "R$" no nome vira `[valor]` | `install -m 755 deploy/dell/site-demos-pausa.py ~/.local/bin/site-demos-pausa`; reverter a cópia (ou apagar a lib) |
| 5 | `prumo-mapa/prumo_mapa.py` | médio: aviso de entrega ao cliente (Mapa pronto); texto com nome de empresa | **Trocado (12/10/2026)**, com `prumo_mapa.test.py` (18). Usar `sem_valores` no nome? Não: recusa + journal (a linha da lib mais a primeira linha do texto) é melhor que esconder. `[teste] ` preservado. Caminho `../lib` | `install` em `~/.local/share/prumo-mapa/` |
| 6 | `backup/backup-dell.py` | médio: aviso do ensaio de restauração (o único sinal de backup ruim além do dell-status) | **Trocado (12/10/2026)** (+18 testes, 42): `avisar` nunca levanta nem no jeito antigo e o código de saída do ensaio não muda; "R$" de exceção vira `[valor]`. Manter `BACKUP_DELL_SEM_AVISO`; o tmp deixa de ser `backup-dell-N.tmp` visível. Caminho `../lib` | `install` em `~/.local/bin/backup-dell` |
| 7 | `gerador-de-sites.py` | médio: o gerador está **pausado** (10/10); fazer antes de religar | **Trocado (12/10/2026)** (o gerador foi religado em 11/10; +13 testes, 72): some a colisão de nome no mesmo segundo; `FILA_AVISOS` e `PASTAS_DA_LIB` viraram constantes do módulo; `avisar` nunca levanta | idem |
| 8 | `claude-ops/site-acompanhamento.py --enviar` | baixo (manual) mas o dict vem pronto: `gravar(dict)` | **Trocado (12/10/2026)**, com `site-acompanhamento.test.py` (20): `enviar_para_a_fila` devolve `False` (saída 1) se não entrou; pasta ausente vira resultado, não exceção; texto longo cortado. Caminho `../lib` | cópia em `~/.local/share/claude-ops/` |
| 9 | `hermes/scripts/patch_bridge_envios.py` | médio: aviso de que a bridge perdeu o remendo (WhatsApp de leads); roda do clone, não precisa instalar | **Trocado (12/10/2026)**, com `patch_bridge_envios.test.py` (19): some a colisão; caminho `../../dell/lib` (no clone a lib sempre existe), `~/.local/lib/mel` de reserva | reverter o commit |
| 10 | `hermes/scripts/graphify_projetos.py` | médio: instalado pelo `aplicar-hermes`, roda no python do Hermes; tem `.test.py` | o `\n` no fim do arquivo some (o dell-status lê igual); ver também a seção 5 | `aplicar-hermes.py`; reverter |
| 11 | `whatsapp-observador/observador.py` | **alto**: serviço contínuo, texto de lead (pode ter R$ e passar de 4000), 8 avisos já se perderam em 07/10 por cópia velha | **Trocado (12/10/2026)** (observador.test.py de 26 para 49; instalado e reiniciado, continuando do mesmo byte do `bridge.log`). R$ de lead: recusar perde a resposta do lead; usar `sem_valores()` no trecho do lead antes de gravar. Manter `entregar_ja()` só quando `r.gravado`. Reiniciar `whatsapp-observador` | `install` + `systemctl --user restart whatsapp-observador`; desfazer igual com a cópia anterior |
| 12 | `funil-aprendizado.py` | baixo, mas por último: já é o modelo (atômico, valida, não cria pasta) | **Trocado (12/10/2026)** (`funil-aprendizado.test.py` de 55 para 72; `cortar=False` e `chmod 660` depois do rename). Achado não corrigido: `conferir_aviso` testa `texto + titulo` sem separador, então um telefone no fim do texto cola no título e escapa; hoje os textos são rótulos fixos. Manter `conferir_aviso` (dado pessoal é regra só dele) e trocar só a gravação; `Resultado` ≠ gravado vira `ErroDoFunil`, para a semântica de hoje não mudar | `install`; reverter |
| — | `atualizar-central.sh` | — | **não trocar**: texto fixo e válido, bash. Se um dia precisar, dar à lib um modo de linha de comando (`python3 ~/.local/lib/mel/aviso.py --titulo … --origem …`) e chamar dali | — |
| — | n8n (`aviso_nodes` e Code à mão) | — | fora da lib Python (JS no container). PR à parte: no `arquivo()` do `aviso_nodes`, cortar titulo em 120 e texto em 4000 e trocar os nós montados à mão pelo `aviso_nodes`. Depois, `aviso-origem.py --aplicar` | republicar os fluxos |

Critério para seguir para o próximo: a cópia anterior instalada, uma semana sem
`avisos-recusados/` novo vindo dela e o `Arquivos instalados` verde.

## 5. Os três jobs `no_agent` do Hermes → timers do systemd

**Feito em 11/10/2026** (PRs #104, #105 e #107; units instaladas às 23:34 e os
três jobs pausados no Hermes, não removidos). Falta: a verificação por unit no
`dell-status` (item 2 abaixo, PR próprio) e, depois de uma semana estável,
tirar o Graphify e o Sites do `ajustar_cron` do `aplicar-hermes.py` e remover os
jobs pausados. Até lá, `aplicar-hermes.py` não roda; SOUL.md e as skills vão
para o Dell com `install -m 644`.

Hoje (lido de `~/.hermes/cron/jobs.json` em 11/10/2026):

| Job | Script | Agenda | Entrega |
|---|---|---|---|
| Entrada — organizar | `~/.hermes/scripts/entrada_organizar.py` (chama `organizar.principal()` em `~/.local/lib/mel-entrada`) | a cada 5 min | stdout → WhatsApp na hora; falha → WhatsApp (`failure_deliver`) |
| Graphify — projetos | `~/.hermes/scripts/graphify_projetos.py` | 03:00 | stdout (só falha) → WhatsApp **às 03:00, dentro do silêncio**; duplicatas já vão pela fila |
| Sites e pendências — 10h30 | `~/.hermes/scripts/sites_e_pendencias.py` | 10:30 | stdout (a mensagem do dia) → WhatsApp |

O stdout do job vira mensagem sem passar pela fila: não respeita silêncio, chave
de 24 h, teto por hora nem prioridade, e nada valida o tamanho.

### O que muda

Cada um vira `<nome>.service` (oneshot, `ExecStart=/usr/bin/python3 …`) +
`<nome>.timer` em `deploy/dell/`, instalados pelo curinga do `instalados.json`.
O script deixa de imprimir a mensagem e passa a gravar na fila pela lib; o
stdout vira log (journal). Falha do script = unit `failed`.

| | Entrada — organizar | Graphify — projetos | Sites e pendências |
|---|---|---|---|
| Timer | `OnCalendar=*:0/5`, `Persistent=false` (rodada perdida não importa) | `OnCalendar=*-*-* 03:00`, `Persistent=true`, `TimeoutStartSec=1h` (o Hermes matava em 1 h; o `ORCAMENTO_S` de 50 min continua) | `OnCalendar=*-*-* 10:30`, `Persistent=true` (Dell desligado às 10:30 → sai quando ligar) |
| titulo | `📥 Entrada` | `Mel: graphify` (falha) e o das duplicatas | primeira linha de hoje: `🌐 Sites e pendências — dd/mm` |
| chave | `entrada:<sha1 dos ids do lote>` (rodada repetida não duplica) | `graphify:falha:<data>` | `sites-e-pendencias:<data>` (rodar de novo no dia não manda duas) |
| prioridade | 2; "pasta do agente suja" 1 | 2 | **1**: com a fila cheia, o que passa do teto vira resumo só com título; P1 sai antes e não perde o corpo |
| expira_em | não | próxima rodada (03:00 do dia seguinte) | 22:00 do dia |
| Silêncio | item organizado entre 22h e 7h chega às 7h (hoje chega na hora). Se ele quiser na hora, só P0 fura, e P0 também iria ao Telegram: não usar | a falha das 03:00 passa a chegar às 7h (hoje chega às 3h) | 10:30 está fora do silêncio: nada muda |
| Atraso | até 1 min (drenagem a cada minuto) | idem | idem |
| Tamanho | texto ≤ 4000 (hoje até 10 linhas + avisos: cabe) | lista cortada com "… (cortado)" | hoje sem teto; com 15 leads e links pode passar de 4000: a lib corta com marca, ou o script reduz `MAX_LEADS` |
| `--teste` | — | — | `--teste` imprime e **não** grava na fila |

### O que precisa existir antes

1. A lib instalada (este PR).
2. **Cobrança pelo dell-status**: hoje "Rotinas do Hermes" cobra os três; como
   timers, saem de lá. Precisa de uma verificação por unit (como já existe para
   `funil-aprendizado.service`/`prumo-mapa.service` via `_unit_resultado`):
   `failed` = vermelho; não rodou depois do último horário + folga = atenção.
   É mudança no `dell-status.py`: PR próprio, coordenado com quem mexe nele.
3. **Falha que chega ao Rômulo**: o Hermes mandava a falha (`failure_deliver`).
   Com systemd, ou o próprio script grava um aviso no `except` de topo (pela
   lib; mais simples) ou um `OnFailure=` com um template que grava um aviso
   (precisa do modo de linha de comando da lib). Recomendo o primeiro.
4. **Ambiente**: o Hermes roda os scripts com o ambiente do cron dele. Conferir
   no Dell, para cada um, o interpretador que ele usa hoje (`python3` do sistema
   ou o venv do Hermes) e o PATH: o Entrada chama `hermes -z` (já resolve
   `~/.local/bin/hermes` quando o PATH não tem) e lê `HERMES_HOME`; o Graphify
   chama `git`, `gh` (autenticação em `~/.config/gh`) e `graphify`
   (`~/.local/bin` ou `venv-hermes`). Dar `Environment=PATH=%h/.local/bin:/usr/bin:/bin`
   na unit.
5. **Quem dispara à mão**: `deploy/hermes/scripts/run-graphify.sh` pede ao
   Hermes que rode o job; passa a `systemctl --user start graphify-projetos.service`.
   CLAUDE.md, `deploy/hermes/SOUL.md` e as skills do Hermes que citam "o job
   Graphify do Hermes" mudam no mesmo PR.

### Ordem e como desfazer

Um PR por job: **Graphify** primeiro (o ganho é o silêncio às 03:00; uma falha
noturna atrasada até as 7h não custa nada), depois **Sites e pendências**
(mensagem diária; conferir no primeiro dia que chegou inteira), por último
**Entrada** (o mais interativo: ele larga um arquivo e espera a resposta; medir
se o atraso de até 1 min incomoda).

Para cada um, na troca: instalar service + timer, `systemctl --user enable --now
<nome>.timer` e **pausar** o job no Hermes (`hermes cron pause <id>`), nessa
ordem, no mesmo minuto (os dois juntos duplicariam a mensagem; a chave de 24 h
segura só os que têm chave). Desfazer: `systemctl --user disable --now
<nome>.timer` e `hermes cron resume <id>`; o script novo, rodando pelo Hermes,
grava na fila e não imprime, então reinstalar a versão anterior do script antes
de retomar o job (ou manter um `--imprimir` que devolve o comportamento antigo).
