# Entrada da Mel (Fase 6)

Uma página privada, **só pela tailnet**, onde o Rômulo manda texto e arquivos; o Hermes mantém tudo arrumado; o objetivo é que **segredo não chegue ao modelo**. Decisão de 04/10/2026; o texto original está em `docs/mel/PROMPT-MEL.md` (Fase 6).

**Princípio:** a garantia vem do código antes do modelo. O modelo só *propõe* um JSON; o código valida e executa dentro de uma lista de permissão. Prompt nenhum é barreira.

**Honestidade sobre o filtro:** filtro por padrões acha o que tem *forma* de segredo; **não é infalível**. Por isso são duas camadas (abaixo) e o caminho certo para segredo é sempre o cofre. Os limites estão na seção "O que NÃO está garantido".

## Como funciona

```
 celular/PC ──tailnet──▶ Central (tailscale serve :8443 JÁ existente) ─ menu "Entrada" ─▶ /entrada/
 Dell: 127.0.0.1:9120/entrada/                     (server/entrada-proxy.ts, só 3 rotas)
                                                        │ repasse para um destino fixo
                                                        ▼
                                                  127.0.0.1:9130 (servidor.py)
                                                        │
        ┌───────────────────────────────┬───────────────┴───────────────┐
   "Guardar no cofre"              "Organizar"                    "Só guardar"
   age cifra na hora               filtro de segredos             filtro de segredos
   (nunca ao modelo)               achou → BLOQUEIA               achou → BLOQUEIA
        │                          não achou → fila/              não achou → chegou/
        ▼                               │
  ~/Mel/Cofre/*.age                     ▼   a cada 5 min (job do Hermes, sem agente)
  indice.json (sem valor)        organizar.py ── fila vazia: silêncio, zero token
                                        │       um item de texto por chamada; `hermes -z -t clarify` (SEM ferramentas)
                                        ▼
                                  executor.py valida o plano e arruma em
                                  ~/Mel/Entrada/organizado/…  ou  ~/Arquivo/<hoje>/…
```

| Arquivo | Papel |
|---|---|
| `segredos.py` | **O** filtro de segredos (um módulo só): `procurar`, `redigir` (valor → `{{SEGREDO:id}}`), `mascarar_para_o_modelo` (a 2ª camada), `Varredor` (arquivos grandes, em fluxo) |
| `cofre.py` | cofre `age`: cifra para todos os destinatários, texto claro nunca em disco, índice sem valor |
| `entrada.py` | recebimento: limites, as 3 ações, fila, diário (sem conteúdo), temporário sem nome em disco |
| `executor.py` | valida e executa o plano do modelo (lista de permissão, por descritor de pasta) |
| `servidor.py` + `pagina.html` | a página e a API (`127.0.0.1:9130`) |
| `organizar.py` | o job do Hermes: monta o texto para o modelo, chama, executa, resume |
| `cofre_cli.py` | `cofre listar / ler / destinatarios / adicionar-destinatario / recifrar` |
| `bin/cofre`, `bin/entrada_organizar.py` | atalhos instalados em `~/.local/bin` e `~/.hermes/scripts` |
| `bin/proteger-identidade` | **opcional, ainda não usado** (o Rômulo deixou a identidade sem senha em 04/10): protege a identidade `age` da Mel com uma senha SUA (só em terminal; só apaga a cópia em claro depois de conferir que a senha decifra) |
| `server/entrada-proxy.ts` (na Central, fora desta pasta) | repasse de `/entrada/*` da Central ao serviço, para um destino fixo e 3 rotas |
| `entrada.service` | unit de usuário do servidor |

## Como abrir

Pelo menu **Entrada**, logo abaixo de CRM, na Central: no Dell em `http://127.0.0.1:9120/entrada/`, pela tailnet em `https://<nome da Mel>.ts.net:8443/entrada/` (a mesma porta da Central). **Não há listener novo do `tailscale serve`**: as 3 linhas atuais (`/`→9119, `/webhook`→5679, `:8443`→9120) não mudam. A Central só **repassa** `GET /`, `GET /api/estado` e `POST /api/enviar` ao serviço (`127.0.0.1:9130`), para um destino fixo, só com uma lista de cabeçalhos (nunca `Cookie` nem `Authorization`, sem a query) e com o corpo em fluxo; o serviço continua decidindo sozinho o que é segredo, o tamanho e a origem (`RULES.md`, regra 23). A página usa URLs relativas e mostra um link "← Voltar à Central" quando aberta por lá.

## As duas camadas do filtro

1. **Filtro principal (`procurar`)**: bloqueia. Tem de ter poucos falsos positivos (cada um custa um clique). Reconhece: chave privada (PEM, OpenSSH, PGP), `AGE-SECRET-KEY-`, tokens conhecidos (`ghp_`, `github_pat_`, `sk-`, `sk_live_`, `AKIA`, `xox`, `AIza`, `glpat-`, `hf_`, `npm_`, `SG.`, Telegram, JWT…), `Authorization: Bearer/Basic`, URL com senha, linha de comando (`--password X`, `mysql -pX`, `curl -u u:X`), tag XML (`<password>X</password>`), `define('DB_PASSWORD', 'x')` do WordPress, `.netrc` numa linha, comandos com a senha em argumento separado (`sshpass -p X`, `redis-cli -a X`, `docker login -p X`, `zip -P X`, `ssh-keygen -N X`, `mongo -p X`), **chave-valor** (`senha: x`, `a senha é x`, `chave da API do cliente: x`, `"password": "x"`, `DB_PWD=x`; o valor vai até o **fim da linha**, então senha com espaço, `;`, aspas ou `@` não escapa pela metade; `password: |` e `>-` valem as linhas de baixo), base64 de usuário:senha e cadeia longa de alta entropia. **O que NÃO conta como segredo** (2ª rodada, para não bloquear texto comum): valor que descreve (`ver no Bitwarden`, `expira em 24h`, `token=expired`), que é código (`getpass.getpass()`, `req.headers.authorization`, `$PG_PASS`), chave de configuração (`token_expiry`, `password_min_length`, `secret_name`, `DB_PASSWORD_FILE`) com valor de configuração, `segredo` como assunto ("segredo do bolo", "o segredo é paciência"), cadeia longa dentro de URL (id do Drive, do YouTube; **não** `?token=`, `&pwd=`, `&sig=`), `sha512-…` de integridade, `<id@host>` de e-mail, imagem `data:…;base64,`, caminho relativo em minúsculas e a constante fixa do pacote XMP. De 20 a 31 caracteres a cadeia só vale com um dígito. Enxerga através de caracteres invisíveis (hífen suave, largura zero) e de segredo **partido em linhas** (nesse caso só bloqueia: não há posição para redigir).
2. **Camada do que vai ao modelo (`mascarar_para_o_modelo`)**: aqui o falso positivo é de graça (o agente só arruma pastas), então é agressiva. Esconde (`<oculto>`) a **linha inteira** com palavra de contexto (senha, password, contraseña, Passwort, mot de passe, psw, pw, passcode, token, segredo, código, pin, cvv, otp, 2fa, autenticador, recovery, seed, frase, carteira, cartão, wi-fi, acesso, login…), o que fica **antes** da palavra incluso ("X é a senha do wifi"); se a linha só nomeia o segredo (termina em `:`, é curta ou é cabeçalho de tabela/CSV), somem também as linhas de baixo até voltar a prosa (até 30). Esconde o argumento das flags de senha (`-p X`, `-P X`, `-a X`, `-N X`, `--password X`, `user%X`, `X /user:nome`), grupos curtos que parecem senha de app, chave do autenticador, códigos de backup ou cartão (`abcd efgh ijkl mnop`, `4111 1111 1111 1111`, `Kx9; mP2) vL8]`), toda palavra de 8+ caracteres com símbolo no meio, de 10+ com letra e número, de 16+ com maiúsculas e minúsculas, hex de 16+, base32 (TOTP) e frase-semente **em qualquer formato** (12+ palavras de 3 a 8 letras seguidas, numeradas, em linhas, com vírgulas ou Capitalizadas). Se desconfiar de segredo partido, **não manda texto nenhum**. Só se aplica ao trecho (até 8.000 caracteres, cortado em fim de linha); o arquivo original não muda.

## O que NÃO está garantido (limites medidos)

- **Segredo sem palavra-chave, em texto corrido, não é bloqueado** (não se distingue de texto): senha aleatória solta de 94 caracteres ASCII com 10+ caracteres é escondida do modelo em 97% a 100% dos casos; só letras e números de 16+ em 100%; de 8 a 12 caracteres só letras e números, em 73% a 86% (uma "palavra" aleatória curta é indistinguível de palavra).
- **Hex puro sem palavra-chave** (parece checksum/commit) não é bloqueado, só mascarado para o modelo.
- **Troca aceita na 2ª rodada:** cadeia aleatória de 20 a 31 caracteres **só com letras** já não é bloqueada (só escondida do modelo); `senha: ver1234` bloqueia, mas `senha: ver no Bitwarden` não; "a senha é pessoal" (frase) bloqueia, porque não se distingue de uma frase-senha. Código com `abc(def)` como valor de `senha =` não bloqueia.
- **Segredo que continua na linha de baixo sem contexto** (`senha: x` e, embaixo, `x-reserva`) só tem a 1ª linha achada: o modelo não vê a 2ª (a camada 2 a esconde), mas ela fica em claro em `chegou/`.
- **Arquivo compactado, cifrado ou imagem** não é lido por dentro. Texto UTF-8 e UTF-16/32 com BOM são entendidos; Latin-1 e binários passam pela varredura de bytes (com a regra de entropia).
- **O que o filtro não bloqueou fica em claro em `chegou/` e `organizado/`** (permissão 600; entra no backup cifrado do cofre do Dell). Só o que foi pelo cofre fica cifrado.
- Falsos positivos existem, mas bem menos: num corpus de 73 textos comuns (notas, e-mails, JSON/config, código, links, logs) bloqueavam **26 (36%)**, agora **3 (4%)**, e os 3 são credenciais de verdade (`?pwd=` do Zoom, `session=` em base64) ou indistinguíveis ("a senha é pessoal…"). Em arquivos reais do sistema: **0 de 150 imagens, 0 de 12 PDFs, 0 de 100 fontes** (eram 141 de 320 bloqueados, sem segundo clique); código Python da biblioteca padrão ainda bloqueia ~21% (fala de senha de verdade). O segundo clique (ou o cofre) resolve o resto. A camada do modelo esconde cerca de 14% das palavras de notas e e-mails comuns (era 6%).

## As três ações

- **Guardar no cofre (segredo):** exige rótulo (o índice é texto claro, então rótulo e nome do arquivo também passam pelo filtro). Cifra na hora com `age` para **todos** os destinatários de `~/Mel/Cofre/recipients.txt` (a cifra recebe as chaves já validadas, uma a uma, com `-r`). O valor não é gravado em claro, não vai a log, não volta à página e não vai ao modelo.
- **Organizar:** até 5 MB o envio fica **só em memória** até passar pelo filtro; acima disso vai em fluxo para um arquivo temporário **sem nome em disco** (se o processo morrer, ele some junto). Achou: bloqueia, nada fica em disco, e a resposta diz só a regra e a linha. Não achou: entra na fila com o trecho já mascarado.
- **Só guardar (sem IA):** vai para `chegou/`. **Também bloqueia** se o filtro achar segredo (o lugar dele é o cofre).
- **Segundo clique** ("guardar os segredos no cofre e seguir só com o resto"), só para **texto de até 5 MB e até 20 segredos**: cada valor vai inteiro para o cofre e vira `{{SEGREDO:id}}`. Recusa (sem guardar nada) se passar do teto, se houver segredo partido em linhas ou se sobrar pedaço colado ao marcador. Binário com segredo não se redige: use o cofre para o arquivo todo.

## O que vai ao modelo

Nome, tipo, tamanho, rótulo e, de arquivo de texto, o trecho mascarado. **Nome, rótulo e texto passam pela camada do modelo na hora de montar o prompt** (e não só quando o item chegou): um item gravado por uma versão anterior do filtro leva a máscara da atual. Nome e rótulo só mudam se tiverem cara de segredo (palavra de contexto ou achado do filtro principal): `contrato-silmer-2026.pdf` segue como está, `senha-wifi-casa2026.txt` vira `<oculto> senha <oculto>.txt` (a extensão fica). No WhatsApp vai o **id** quando o nome tem cara de segredo, e o destino escolhido pelo modelo também passa pela máscara. **Um item de texto por chamada** (o que está escrito num arquivo não consegue ditar o plano de outro; os que só têm metadados vão juntos, em uma chamada à parte; no máximo 5 chamadas por rodada). O texto exato de cada chamada fica em `~/Mel/Entrada/requisicoes/` (a prova) e o organizador o passa pelo filtro de novo antes de enviar; item que o filtro reprovar não vai. O prompt é limitado a ~100 KB (o argv do Linux recusa mais que ~128 KiB) e usa blocos de texto sem escape de JSON, com delimitador aleatório por rodada.

O modelo roda com `hermes -z … -t clarify` (o único conjunto de ferramentas é o que só faz perguntas: **sem terminal, arquivos, código nem navegador**; o `-z` aprova tudo sozinho, por isso nada além disso fica ligado) numa pasta vazia. Medido em 04/10: ~5.100 tokens por chamada, contra 14.716 com as ferramentas padrão. `hermes secrets` (Bitwarden/1Password) e `hermes egress` (proxy de credenciais de API) não usam `age` como fonte e por isso não entram. **Conferido em 04/10** perguntando ao próprio modelo quais ferramentas ele consegue chamar: com `-t clarify` ele enxerga só `clarify` (mais o invólucro `multi_tool_use.parallel`), sem terminal, escrita de arquivo, navegador nem as ferramentas dos servidores MCP; no padrão (sem `-t`) enxerga 24, entre elas `terminal`, `write_file` e `tool_call`.

**O que o `hermes -z` carrega, medido em 04/10 com uma chamada real** (a sessão gravada mostra): um prompt de sistema de ~17 mil caracteres (a persona "Secretário do Rômulo", a memória e o índice de skills, ~4.400 tokens mesmo para um "OK"; não dá para desligar por flag); o `AGENTS.md` só da **pasta de trabalho** (o do `~` **não** entra), por isso a pasta `~/Mel/Entrada/.agente` tem de estar vazia e o organizador recusa chamar se não estiver; `-t clarify` não chama ferramenta nenhuma; se o modelo chamar `clarify` sem terminal ele recebe "Não houve resposta" em ~15 s e termina (sem travar). **O `-z` grava uma sessão** (com o texto do prompt) no `state.db`, onde o Hermes do WhatsApp poderia achá-la numa busca: depois de cada chamada o organizador apaga as sessões **dessa pasta**, uma por id (`hermes sessions delete --yes <id>`, só linha cujo workspace é `.agente`). **Nunca `sessions prune`**: ele se recusa com o gateway no ar e `--force` arriscaria o banco do Hermes. O filho recebe `stdin` fechado e só o ambiente que precisa (`PATH`, `HOME`, `LANG`, `XDG_*`, `HERMES_*`: as credenciais ele lê de `~/.hermes/.env`); `ENTRADA_HERMES_CMD` (gancho de teste) só vale com `ENTRADA_TESTE=1`. **Limite aceito:** o `hermes -z` só aceita o prompt como argumento, então o texto (já mascarado) fica visível em `/proc/<pid>/cmdline` por alguns segundos para qualquer usuário local; a Mel tem um usuário.

`tentativas` é gravada **antes** de chamar o modelo (uma queda já conta). Resposta estranha, id que não é texto, JSON aninhado, plano recusado ou erro na execução: o item fica em `chegou/` e tenta de novo; depois de 3 vira `sem-plano` e é avisado uma vez.

## O que o executor garante

Só `mover`, `resumir` e `registrar-projeto` (qualquer outro verbo é recusado); só duas raízes (`~/Mel/Entrada/organizado/` e `~/Arquivo/<hoje>/`); sem `..`, caminho absoluto ou link simbólico: as pastas são abertas uma a uma **por descritor com `O_NOFOLLOW`** e tudo o que se cria usa `dir_fd`, então trocar uma pasta por um link no meio da operação não leva o arquivo para fora; sem sobrescrever (nome repetido ganha ` (2)`); sem apagar (o item sai de `chegou/` por mover); pasta com nome curto e sem espaço (`[A-Za-z0-9À-ÿ._-]{1,30}`), nome de arquivo sem nome reservado do Windows e **com a mesma extensão do original**; nenhum texto do plano, nem o resumo, pode parecer segredo ou ter caractere de controle, invisível, de direção ou substituto solto. O texto extra (`.resumo.md`, proposta) é conferido **antes** de mover e leva a marca "conteúdo externo, não confiável". `registrar-projeto` só deixa uma proposta em `organizado/_propostas/`: não mexe no registro de projetos.

## A página

Escuta só em `127.0.0.1`. Confere `Host` (contra DNS rebinding; o nome da tailnet é relido se faltou no boot), `Origin` com **host e porta exatos**: só as da Central que repassa a página (**8443** pela tailnet e **9120** no Dell, configuráveis por `ENTRADA_PORTAS_ORIGEM`) e a do próprio serviço; `Origin` sem porta (443 = o painel do Hermes, outro site) e qualquer outra porta são recusados, `Sec-Fetch-Site`, todos os IPs do `X-Forwarded-For` (tailnet ou loopback) e recusa pedido marcado como Funnel. Só `Content-Length` (um só, só dígitos); método sem corpo que traga corpo é recusado (senão um `GET` contrabandearia um `POST`). Limite de 200 MB por envio, 3 envios ao mesmo tempo, prazo total por envio (vazão mínima ~50 KB/s, de 2 min a 1 h), 32 conexões, corpo lido em fluxo. **Nenhum conteúdo, rótulo, nome ou caminho desconhecido vai a log.** O texto da exceção nunca vai à resposta.

## Cofre e agentes (leia)

`cofre ler` pede o id e exige terminal: isso protege contra **engano**, não contra um agente com shell na Mel (que pode usar um pseudo-terminal ou chamar `age -d -i ~/.config/mel/age/identity.txt`). **Decisão do Rômulo, 04/10/2026: a identidade fica SEM senha por enquanto** (`~/.config/mel/age/identity.txt`, modo 600; ele tentou proteger e errou a digitação, e o script não alterou nada). Consequência, dita sem rodeio: qualquer processo seu na Mel (Hermes com terminal, Codex, Claude) consegue ler o cofre inteiro. O que o cofre faz, então, é: o segredo **não fica em texto claro** no Drive, no espelho nem na pasta `organizado/`, e **não chega ao modelo** (isso depende do filtro, não da senha).

Quando quiser fechar essa porta, é um comando só, num terminal (o serviço só cifra e nunca precisa da identidade; o código passa a preferir `identity.txt.age` quando existe, via `cofre.identidade_padrao`; depois troque `identity.txt` por `identity.txt.age` em `obrigatorios` do `fontes.toml` do backup):

```bash
bash deploy/dell/entrada/bin/proteger-identidade    # pede a senha 2x e uma 3ª para conferir; só então apaga a cópia em claro (shred)
```

O script recusa rodar sem terminal, não sobrescreve um `.age` existente, só apaga a cópia em claro depois de conferir que a senha decifra, e nunca imprime a chave (testado num HOME de mentira, com senha de teste por pseudo-terminal; e, na Mel, uma conferência que falhou deixou tudo como estava). Se a senha se perder, o cofre ainda abre com a chave `age` do Rômulo (gerada no PC), que é destinatário.

Sem namespace de montagem não dá para esconder `identity.txt` do servidor: ver "Sandbox" abaixo.

## Sandbox da unit: o que funciona e o que não

Conferido em 04/10/2026 com uma unidade transitória: em unidade de **usuário** nesta máquina, `ProtectSystem`, `ProtectHome`, `PrivateTmp` e `ReadWritePaths` **não têm efeito** (o `kernel.apparmor_restrict_unprivileged_userns = 1` impede o namespace: o processo fica no mesmo namespace de montagem da sessão). Valem `NoNewPrivileges` e os limites de cgroup (`MemoryMax=768M`, `TasksMax=64`, `CPUQuota=150%`). A unit só declara o que funciona. (Observação: a unit `squadone-operations.service` declara `ProtectSystem=strict` e `ProtectHome=read-only` e roda no mesmo namespace da sessão: essas linhas hoje são inertes.)

## Instalar (no Dell, depois do merge)

Cada arquivo que já existir ganha `.bak-AAAA-MM-DD`. Saúde antes e depois de cada passo (`saude.sh`).

```bash
D=<clone no commit do merge>/deploy/dell/entrada
install -d -m 755 ~/.local/lib/mel-entrada
for f in segredos cofre entrada executor servidor organizar cofre_cli; do install -m 644 $D/$f.py ~/.local/lib/mel-entrada/; done
install -m 644 $D/pagina.html ~/.local/lib/mel-entrada/
install -m 755 $D/bin/cofre ~/.local/bin/cofre
install -m 644 $D/bin/entrada_organizar.py ~/.hermes/scripts/entrada_organizar.py
install -m 644 $D/entrada.service ~/.config/systemd/user/entrada.service
install -m 644 <clone>/deploy/dell/backup/fontes.toml ~/.config/backup-dell/fontes.toml   # obrigatorios do cofre
systemctl --user daemon-reload && systemctl --user enable --now entrada.service
hermes cron create "every 5m" --name "Entrada — organizar" --script entrada_organizar.py --no-agent --deliver whatsapp
```

Depois do merge a Central se atualiza sozinha (reinício de ~0,5 s) e passa a ter o menu e a rota `/entrada/`; com o serviço no ar, `curl -s http://127.0.0.1:9120/entrada/ | grep -o '<title>[^<]*</title>'` deve mostrar `Entrada da Mel`. **Só o código 200 não prova nada:** antes da Central atualizar (e com a Entrada desligada) `/entrada/` também dá 200, porque cai na SPA (`<title>SquadOne</title>`). `tailscale serve status` segue com as 3 linhas.

Pré-requisitos (feitos em 04/10): `age` 1.2.1 (`sudo apt install age`), `~/.config/mel/age/identity.txt` (600), `~/Mel/Entrada` e `~/Mel/Cofre` (700), `~/Mel/Cofre/recipients.txt` com a chave pública da Mel. O serviço lê o nome da Mel na tailnet com `tailscale status`; se falhar, sai com erro e o systemd tenta de novo (ou defina `ENTRADA_NOMES=<mel>.<tailnet>.ts.net`).

**Desfazer:** `hermes cron remove <id>`; `systemctl --user disable --now entrada.service`; remover `~/.local/lib/mel-entrada`, `~/.local/bin/cofre`, `~/.hermes/scripts/entrada_organizar.py` e a unit; restaurar `fontes.toml.bak-…`. As pastas `~/Mel/Entrada` e `~/Mel/Cofre` ficam (têm dado do Rômulo).

## Conferência (critério da fase)

Com um arquivo **falso** `chave-teste.txt` com `AGE-SECRET-KEY-…` falso: "Organizar" bloqueia; "Cofre" cifra e o `indice.json` não tem o valor; log e `diario.jsonl` não têm o valor; `cofre ler <id>` (no terminal) recupera; o texto de `requisicoes/` só tem `{{SEGREDO:id}}`; `tailscale serve status` mantém as 3 linhas; os 12 containers seguem `Up`; o menu **Entrada** da Central abre a página em `127.0.0.1:9120/entrada/` (confira o título `Entrada da Mel`, não só o 200). Tudo isso tem teste automatizado; a página pelo celular é conferência manual.

## Testes

```bash
cd deploy/dell/entrada
for t in segredos cofre cofre_cli entrada executor servidor organizar; do python3 $t.test.py; done
```

260 testes em Python (74 `segredos`, 16 `cofre`, 9 `cofre_cli`, 41 `entrada`, 40 `executor`, 34 `servidor`, 46 `organizar`) e 13 em `node:test` para o repasse da Central (`server/entrada-proxy.test.ts`). `cofre*`, `entrada`, `servidor` e `organizar` usam o `age` de verdade (sem ele, pulam). `organizar` usa um `hermes` de mentira: nenhum modelo é chamado. Todo segredo de teste é falso e montado em tempo de execução ou sorteado com semente fixa. Os testes olham **pedaços** do valor, nunca só o valor inteiro (redigir pela metade passaria num teste de "valor inteiro não aparece"). Há teste de propriedade (senhas aleatórias de 94 caracteres em 9 formatos), do corpus de 27 casos da revisão, de desempenho com a palavra-chave presente (cerca de 1 s por MB) e de processo morto no meio do envio. O executor, o repasse da Central e as proteções da 2ª rodada passaram por teste de mutação (proteções quebradas de propósito numa cópia: **41 de 41 pegas**; três sobreviveram na 1ª tentativa e mostraram testes que pareciam cobrir e não cobriam, como um UTF-16 de tamanho ímpar que falhava por outro motivo).

## Revisão adversarial (04/10/2026)

Dois revisores (Opus 5.5) tentaram quebrar o código: um nos caminhos de vazamento, outro em HTTP, executor e negação de serviço. Eles quebraram a primeira versão: **26 de 27 segredos falsos chegavam ao modelo**, UTF-16/Latin-1 passavam como "binário" e ficavam em claro, um temporário com texto claro sobrava depois de `SIGKILL`, o segundo clique redigia só parte de uma frase-senha, o `recipients.txt` com separador exótico fazia o cofre cifrar para menos gente, uma resposta envenenada do modelo travava a fila para sempre, e o filtro era quadrático com muitas ocorrências. Tudo foi corrigido e virou teste; os exploits deles rodam hoje contra o código corrigido sem vazar (0 de 27). O que sobra está em "O que NÃO está garantido" e em "Cofre e agentes". Confirmado por mim, e **não** pelo revisor: o sandbox de montagem não funciona em unidade de usuário aqui (ele disse que funcionava).

**2ª e 3ª rodadas.** O revisor de HTTP achou um problema **alto**: três regras do filtro eram quadráticas em entradas comuns (100 KB com a palavra "mysql" repetida levava 7 s e travava o servidor inteiro, porque o regex segura o interpretador). Hoje é linear (cerca de 1 s por MB no pior caso medido, `/healthz` responde durante um envio pesado) e tem teste. Também corrigidos: memória com caracteres invisíveis (50 MB por MB, hoje 3 MB), bytes que não são UTF-8 vindos do modelo, item preso para sempre depois de mover, vaga de conexão que vazava. Na 3ª rodada, sobre o repasse da Central, ele confirmou por medida que não há contrabando de pedido, que `Cookie`/`Authorization`/query não seguem e que 502 não vaza detalhe. Dois pontos **aceitos e documentados** (RULES, regra 23): a `Origin` aceita por `/entrada/api/enviar` é a da Central inteira (um XSS em qualquer rota da Central escreveria na Entrada; hoje `src/` não usa `v-html` nem `innerHTML`, e um token na página não adiantaria), e o repasse passa `Host`/`X-Forwarded-For` como vieram (a Entrada é quem confere). O repasse agora também recusa `GET` com corpo.

**2ª rodada de vazamento (chegou depois do merge do PR #9, corrigida neste PR).** O revisor mostrou 40 segredos falsos realistas que passavam pelas duas camadas até o modelo: valor na linha de baixo, em tabela, antes da palavra, em outro idioma (`contraseña`, `Passwort`), abreviado (`psw`, `pw`), como argumento de comando (`sshpass -p X`, `zip -P X`), em grupos curtos (senha de app do Google, chave do autenticador, códigos de backup, cartão) e como frase-semente fora do formato canônico. **Hoje: 0 de 40** (rodados os scripts dele contra o código novo). Também: um arquivo que só **começa** com o BOM UTF-16 e é ASCII escondia qualquer segredo (virava ideogramas reversíveis; acontece de verdade no Windows com `echo >>`); rótulo e nome de arquivo iam crus ao prompt e ao WhatsApp; o 2º clique guardava só a 1ª palavra de "a senha é minha casa azul 2026" (e o resto ficava em claro); PDF e imagem com XMP, fontes e links comuns eram bloqueados sem saída (141 de 320 arquivos reais, 36% dos textos comuns). Tudo corrigido e com teste; as duas proteções que sobreviviam à mutação (a conferência depois de redigir e a do prompt inteiro) ganharam teste. O que ele **não** pôde provar pelo código, eu medi com uma chamada real do `hermes -z` (ver "O que vai ao modelo"): o prompt de sistema carrega a persona e a memória, o `AGENTS.md` do `~` não entra, cada `-z` grava sessão no `state.db` (agora apagada) e o `clarify` sem terminal não trava.

## Pendências

- **Job do Hermes ("Organizar") ainda não criado.** O serviço, o cofre e o "Só guardar" estão no ar desde 04/10 às 20:36; o job só nasce depois do merge deste PR e da reinstalação (`hermes cron create "every 5m" --name "Entrada — organizar" --script entrada_organizar.py --no-agent --deliver whatsapp`).
- **Chave pública `age1…` do Rômulo** (gerada no PC): `cofre adicionar-destinatario <chave> --recifrar`. Até lá a página avisa que o cofre só abre na Mel.
- O `dell-status` ainda não monitora a Entrada (só `systemctl --user --failed`, que a `saude.sh` já olha). `fila/`, `requisicoes/` e `diario.jsonl` não têm rotação.
- A varredura de duplicatas ainda não alimenta o agente.
- Quem está na tailnet abre a página: o controle é a tailnet (ACL do Tailscale), não um login.
