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
  ~/Mel/Cofre/*.age                     ▼   a cada 5 min (entrada-organizar.timer)
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
| `organizar.py` | o organizador: monta o texto para o modelo, chama, executa, resume. Com `--fila` (o `entrada-organizar.service`, desde 11/10/2026) o resumo vira aviso na fila do `dell-status`; sem argumento imprime, que era o jeito do job "Entrada — organizar" do Hermes (`cbb21e966fce`, hoje pausado) |
| `cofre_cli.py` | `cofre listar / ler / destinatarios / adicionar-destinatario / recifrar` |
| `bin/cofre`, `bin/entrada_organizar.py` | atalhos instalados em `~/.local/bin` e `~/.hermes/scripts` |
| `bin/proteger-identidade` | **opcional, ainda não usado** (o Rômulo deixou a identidade sem senha em 04/10): protege a identidade `age` da Mel com uma senha SUA (só em terminal; só apaga a cópia em claro depois de conferir que a senha decifra) |
| `server/entrada-proxy.ts` (na Central, fora desta pasta) | repasse de `/entrada/*` da Central ao serviço, para um destino fixo e 3 rotas |
| `entrada.service` | unit de usuário do servidor |
| `../entrada-organizar.service` + `.timer` | o organizador a cada 5 min, sem `Persistent` (a rodada seguinte pega a fila inteira) |

## Como abrir

Pelo menu **Entrada**, logo abaixo de CRM, na Central: no Dell em `http://127.0.0.1:9120/entrada/`, pela tailnet em `https://<nome da Mel>.ts.net:8443/entrada/` (a mesma porta da Central). **Não há listener novo do `tailscale serve`**: as 3 linhas atuais (`/`→9119, `/webhook`→5679, `:8443`→9120) não mudam. A Central só **repassa** `GET /`, `GET /api/estado` e `POST /api/enviar` ao serviço (`127.0.0.1:9130`), para um destino fixo, só com uma lista de cabeçalhos (nunca `Cookie` nem `Authorization`, sem a query) e com o corpo em fluxo; o serviço continua decidindo sozinho o que é segredo, o tamanho e a origem (`RULES.md`, regra 23). A página usa URLs relativas e mostra um link "← Voltar à Central" quando aberta por lá.

## As duas camadas do filtro

1. **Filtro principal (`procurar`)**: bloqueia. Tem de ter poucos falsos positivos (cada um custa um clique). Reconhece: chave privada (PEM, OpenSSH, PGP), `AGE-SECRET-KEY-`, tokens conhecidos (`ghp_`, `github_pat_`, `sk-`, `sk_live_`, `AKIA`, `xox`, `AIza`, `glpat-`, `hf_`, `npm_`, `SG.`, Telegram, JWT…), `Authorization: Bearer/Basic`, URL com senha (que pode ter `@`), tag XML (`<password>X</password>`), `define('DB_PASSWORD', 'x')` do WordPress, `.netrc` numa linha, SQL (`IDENTIFIED BY 'x'`), `net user nome X /add`, `echo X | sudo -S`, comandos com a senha no argumento (`--password X`, `mysql -pX`, `curl -u u:X` inclusive com aspas, `sshpass -p X`, `redis-cli -a X`, `docker login -p X`, `zip -P X`, `ssh-keygen -N X`, `mongo -p X`), **chave-valor** (`senha: x`, `a senha é x`, `chave da API do cliente: x`, `"password": "x"`, `DB_PWD=x`, `pswd: x`, e também em camelCase: `senhaAdmin`, `passwordRoot`, `tokenBot`; o valor vai até o **fim da linha**, então senha com espaço, `;`, aspas ou `@` não escapa pela metade; `password: |` e `>-` valem as linhas de baixo), base64 de usuário:senha e cadeia longa de alta entropia. Enxerga através de caracteres invisíveis (hífen suave, largura zero, isolados de direção), de segredo **partido em linhas** e de texto que só vira segredo depois da normalização Unicode (largura total, acento decomposto): nesses dois casos só bloqueia, porque não há posição para redigir. **O que NÃO conta como segredo** (para não bloquear texto comum): valor que descreve (`ver no Bitwarden`, `expira em 24h`, `token=expired`: só com ESPAÇO e outra palavra depois), que é código (`getpass.getpass()`, `input('Senha: ')`, `req.headers.authorization`, `$PG_PASS postgres:16`), chave de configuração (`token_expiry`, `password_min_length`, `secret_name`, `DB_PASSWORD_FILE`) com valor de configuração, `segredo` como assunto ("segredo do bolo", "o segredo é paciência"; **não** "segredo do wifi/banco/cofre"), cadeia longa dentro de URL (id do Drive, do YouTube; **não** `?token=`, `&pwd=`, `&sig=`, nem caminhos de webhook, `/magic/`, `/reset/`), `sha512-…` de integridade (40+ caracteres), `<id@host>` só em cabeçalho de e-mail (`Message-ID:`…), imagem ou fonte `data:…;base64,`, caminho relativo em minúsculas e a constante fixa do pacote XMP. De 20 a 31 caracteres a cadeia só vale com um dígito. **Texto curto** (rótulo, nome de arquivo, partes do plano) usa o **modo estrito**, sem nenhum desses afrouxamentos.
2. **Camada do que vai ao modelo (`mascarar_para_o_modelo`)**: aqui o falso positivo é de graça (o agente só arruma pastas), então é agressiva. Antes de tudo: sem caracteres de controle (um NUL derrubava o `subprocess`), sem invisíveis e em NFKC. Esconde (`<oculto>`) a **linha inteira** com palavra de contexto (senha, password, contraseña, Passwort, wachtwoord, пароль, 密码, パスワード, psw, pw, mdp, passcode, token, segredo, código, pin, cvv, otp, 2fa, autenticador, recovery, seed, frase, carteira, cartão, wi-fi, acesso, login, `chave do cofre/portão/alarme…`, `api key`, `private key`…; também em camelCase), o que fica **antes** da palavra incluso ("X é a senha do wifi"); só a palavra fica. Se a linha só nomeia o segredo (termina em `:`, é curta, está no plural como "as senhas novas…", ou é cabeçalho de tabela/CSV), somem também as linhas de baixo: numa **tabela**, toda linha com a mesma estrutura, **sem teto**; no resto, até 30 linhas, atravessando linhas em branco (até 10) e linhas longas de prosa; a linha de `senha: {{SEGREDO:id}}` (já no cofre) também esconde as 5 de baixo. Esconde o argumento das flags de senha (`-p X`, `-P X`, `-a X`, `-N X`, `--password X`, `user%X`, `X /user:nome`), grupos curtos que parecem senha de app, chave do autenticador, códigos de backup ou cartão (`abcd efgh ijkl mnop`, `4111 1111 1111 1111`, `Kx9; mP2) vL8]`), toda palavra de 8+ caracteres com símbolo no meio, de 10+ com letra e número, de 16+ com maiúsculas e minúsculas, hex de 16+, base32 (TOTP) e frase-semente **em qualquer formato e língua** (12+ palavras seguidas de 3 a 8 letras, numeradas `1 - w`, `#1 w`, `1: w`, em tabela, JSON, com vírgulas, hífen, barra, Capitalizadas, em inglês, espanhol ou francês). Se desconfiar de segredo partido, **não manda texto nenhum**. É **idempotente** (o sistema mascara duas vezes: ao chegar e ao montar o prompt) e só se aplica ao trecho (até 8.000 caracteres, cortado em fim de linha); o arquivo original não muda. **Nome e rótulo** passam por uma versão mais leve (grupos, frase-semente, pedaço com 3 classes ou símbolo, palavra de contexto): `contrato-silmer-2026.pdf` segue como está, `senha-wifi-casa2026.txt` e `chave-cofre-482193.txt` viram `<oculto> … <oculto>.txt` (a extensão fica).

## O que NÃO está garantido (limites medidos)

- **Segredo sem palavra-chave, em texto corrido, não é bloqueado** (não se distingue de texto): senha aleatória solta de 94 caracteres ASCII com 10+ caracteres é escondida do modelo em 97% a 100% dos casos; só letras e números de 16+ em 100%; de 8 a 12 caracteres só letras e números, em 73% a 86% (uma "palavra" aleatória curta é indistinguível de palavra).
- **Rótulo ou nome sem palavra de contexto** (`roteador admin / casa2026` como RÓTULO) vai ao modelo e ao WhatsApp: não há como saber que é senha. `ssh pi@192.168.0.10  # casa2026` (comentário) idem.
- **Homóglifos** (um `е` cirílico no lugar do `e` de `senha`) escapam das duas camadas: é só adversarial e não está tratado.
- **Hex puro sem palavra-chave** (parece checksum/commit) não é bloqueado, só mascarado para o modelo.
- **Trocas aceitas para não bloquear texto comum:** cadeia aleatória de 20 a 31 caracteres **só com letras** não é bloqueada (só escondida do modelo); `senha: ver1234` e `senha: Valid@2026` bloqueiam, mas `senha: ver no Bitwarden` não; "a senha é pessoal" (frase) bloqueia, porque não se distingue de uma frase-senha; `admin_password_id: 482193` e `secret_hint: minha casa azul` (chave de configuração com valor que parece descrição) não bloqueiam; `data:`/`sha256-`/`<id@host>` só deixam de contar como chave nas formas legítimas acima.
- **Segredo que continua na linha de baixo sem contexto** (`senha: x` e, embaixo, `x-reserva`) só tem a 1ª linha achada: o modelo não vê a 2ª (a camada 2 esconde as de baixo), mas ela fica em claro em `chegou/`.
- **Arquivo compactado, cifrado ou imagem** não é lido por dentro. UTF-8 e UTF-16/32 com BOM com **texto latino, grego ou cirílico** são entendidos; **japonês, chinês, árabe, hebraico e emoji em UTF-16 viram "binário"** (sem trecho para o modelo; em UTF-8 viram texto). Um arquivo UTF-16 com **qualquer par de bytes ASCII legível** (o `echo >>` do Windows acrescentando ASCII) ou com NUL também vira binário. Latin-1 e binários passam pela varredura de bytes (com a regra de entropia, só onde a visão parece texto).
- **O que o filtro não bloqueou fica em claro em `chegou/` e `organizado/`** (permissão 600; entra no backup cifrado do cofre do Dell). Só o que foi pelo cofre fica cifrado.
- Falsos positivos existem, mas bem menos: num corpus de 73 textos comuns (notas, e-mails, JSON/config, código, links, logs) bloqueavam **26 (36%)**, agora **3 (4%)**, e os 3 são credenciais de verdade (`?pwd=` do Zoom, `session=` em base64) ou indistinguíveis ("a senha é pessoal…"). Em arquivos reais do sistema: **0 de 150 imagens, 0 de 12 PDFs, 0 de 100 fontes** (eram 141 de 320 bloqueados, sem segundo clique); código Python da biblioteca padrão ainda bloqueia ~21% (fala de senha de verdade). O segundo clique (ou o cofre) resolve o resto. A camada do modelo esconde mais do texto que fala de senha, código ou acesso (cerca de 14% das palavras de notas e e-mails comuns).

## As três ações

- **Guardar no cofre (segredo):** exige rótulo (o índice é texto claro, então rótulo e nome do arquivo também passam pelo filtro). Cifra na hora com `age` para **todos** os destinatários de `~/Mel/Cofre/recipients.txt` (a cifra recebe as chaves já validadas, uma a uma, com `-r`). O valor não é gravado em claro, não vai a log, não volta à página e não vai ao modelo.
- **Organizar:** até 5 MB o envio fica **só em memória** até passar pelo filtro; acima disso vai em fluxo para um arquivo temporário **sem nome em disco** (se o processo morrer, ele some junto). Achou: bloqueia, nada fica em disco, e a resposta diz só a regra e a linha. Não achou: entra na fila com o trecho já mascarado.
- **Só guardar (sem IA):** vai para `chegou/`. **Também bloqueia** se o filtro achar segredo (o lugar dele é o cofre).
- **Segundo clique** ("guardar os segredos no cofre e seguir só com o resto"), só para **texto de até 5 MB e até 20 segredos**: cada valor vai inteiro para o cofre e vira `{{SEGREDO:id}}`. Recusa (sem guardar nada) se passar do teto, se houver segredo partido em linhas ou se sobrar pedaço colado ao marcador. Binário com segredo não se redige: use o cofre para o arquivo todo.

## O que vai ao modelo

Nome, tipo, tamanho, rótulo e, de arquivo de texto, o trecho mascarado. **Nome, rótulo e texto passam pela camada do modelo na hora de montar o prompt** (e não só quando o item chegou): um item gravado por uma versão anterior do filtro leva a máscara da atual. Nome e rótulo só mudam se tiverem cara de segredo (palavra de contexto ou achado do filtro principal): `contrato-silmer-2026.pdf` segue como está, `senha-wifi-casa2026.txt` vira `<oculto> senha <oculto>.txt` (a extensão fica). No WhatsApp vai o **id** quando o nome tem cara de segredo, e o destino escolhido pelo modelo também passa pela máscara. **Um item de texto por chamada** (o que está escrito num arquivo não consegue ditar o plano de outro; os que só têm metadados vão juntos, em uma chamada à parte; no máximo 5 chamadas por rodada). O texto exato de cada chamada fica em `~/Mel/Entrada/requisicoes/` (a prova) e o organizador o passa pelo filtro de novo antes de enviar; item que o filtro reprovar não vai. O prompt é limitado a ~100 KB (o argv do Linux recusa mais que ~128 KiB) e usa blocos de texto sem escape de JSON, com delimitador aleatório por rodada.

O modelo roda com `hermes -z … -t clarify` (o único conjunto de ferramentas é o que só faz perguntas: **sem terminal, arquivos, código nem navegador**; o `-z` aprova tudo sozinho, por isso nada além disso fica ligado) numa pasta vazia. Medido em 04/10: ~5.100 tokens por chamada, contra 14.716 com as ferramentas padrão. `hermes secrets` (Bitwarden/1Password) e `hermes egress` (proxy de credenciais de API) não usam `age` como fonte e por isso não entram. **Conferido em 04/10** perguntando ao próprio modelo quais ferramentas ele consegue chamar: com `-t clarify` ele enxerga só `clarify` (mais o invólucro `multi_tool_use.parallel`), sem terminal, escrita de arquivo, navegador nem as ferramentas dos servidores MCP; no padrão (sem `-t`) enxerga 24, entre elas `terminal`, `write_file` e `tool_call`.

**O que o `hermes -z` carrega, medido em 04/10 com uma chamada real** (a sessão gravada mostra): um prompt de sistema de ~17 mil caracteres (a persona "Secretário do Rômulo", a memória e o índice de skills, ~4.400 tokens mesmo para um "OK"; não dá para desligar por flag); o `AGENTS.md` só da **pasta de trabalho** (o do `~` **não** entra), por isso a pasta `~/Mel/Entrada/.agente` tem de estar vazia (as chamadas reais não escrevem nada nela); `-t clarify` não chama ferramenta nenhuma; se o modelo chamar `clarify` sem terminal ele recebe "Não houve resposta" em ~15 s e termina (sem travar). O título da sessão vem de um modelo (`title_source=llm`).

- **Pasta de trabalho suja** (qualquer arquivo, até oculto): o organizador **não chama o modelo, não gasta tentativa dos itens, não grava "prova" de prompt que não saiu** e avisa **uma vez** no WhatsApp (um marcador evita repetir a cada 5 minutos); some o aviso quando a pasta volta a ficar vazia.
- **O `-z` grava uma sessão** (com o texto do prompt) no `state.db`, onde o Hermes do WhatsApp poderia achá-la numa busca. O organizador apaga as sessões **dessa pasta** ANTES da chamada (sobra de uma rodada que caiu: o `hermes` órfão grava depois) e DEPOIS, também quando a chamada falha ou estoura o tempo. Lê o `hermes sessions list --workspace <pasta> --limit 200` **da direita** (colunas Title, Workspace, Last Active, ID: o título é texto livre e pode ter algo com cara de id) e só apaga linha de workspace **exatamente** `.agente` (o `--workspace` do Hermes casa por substring: `.agente-velho` aparece na lista e não pode ser apagado). Tenta de novo se o banco estiver travado, confere no fim e, se sobrar sessão, avisa e registra no diário (`sessoes_restantes`). **Nunca `sessions prune`**: ele se recusa com o gateway no ar e `--force` arriscaria o banco do Hermes. **Apagar a sessão a tira da busca, não do disco**: o texto pode ficar em páginas livres e no WAL do SQLite, e `~/.hermes/*.db` entra no backup cifrado.
- **Ambiente e entrada do filho:** `stdin` fechado e só `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `LC_*`, `TZ`, `TMPDIR`, `XDG_*` e `HERMES_HOME` (as credenciais ele lê de `~/.hermes/.env`; o gateway exporta outras `HERMES_*`, como `HERMES_SUPERVISED_CHILD`, que não repasso porque não medi o efeito). O binário é `~/.local/bin/hermes` por caminho absoluto (o `PATH` do cron do Hermes começa por outra pasta). `ENTRADA_HERMES_CMD` (gancho de teste) só vale com `ENTRADA_TESTE=1`.
- **Tempo:** 180 s por chamada (as reais levam 10 a 20 s) e no máximo 5 chamadas por rodada: o pior caso (15 min) cabe folgado na 1 h que o Hermes dá ao script do cron.
- **Limite aceito:** o `hermes -z` só aceita o prompt como argumento, então o texto (já mascarado) fica visível em `/proc/<pid>/cmdline` enquanto a chamada dura (segundos a minutos) para **qualquer conta local**; a Mel não monta `/proc` com `hidepid` e há contas de sistema com processos (avahi, dnsmasq, syslog…).

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
install -m 644 <clone>/src/estilos/fontes/inter-latin-wght-normal.woff2 ~/.local/lib/mel-entrada/   # a Inter do app (16/10/2026); sem ela, fonte do sistema
install -m 755 $D/bin/cofre ~/.local/bin/cofre
install -m 644 $D/bin/entrada_organizar.py ~/.hermes/scripts/entrada_organizar.py
install -m 644 $D/entrada.service ~/.config/systemd/user/entrada.service
install -m 644 <clone>/deploy/dell/backup/fontes.toml ~/.config/backup-dell/fontes.toml   # obrigatorios do cofre
install -m 644 <clone>/deploy/dell/entrada-organizar.service <clone>/deploy/dell/entrada-organizar.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now entrada.service entrada-organizar.timer
```

Até 11/10/2026 o organizador era um job do Hermes (`hermes cron create "every 5m" --name "Entrada — organizar" --script entrada_organizar.py --no-agent --deliver whatsapp`), que hoje está pausado. Não o retome com o timer ligado: os dois organizariam a mesma fila.

Depois do merge a Central se atualiza sozinha (reinício de ~0,5 s) e passa a ter o menu e a rota `/entrada/`; com o serviço no ar, `curl -s http://127.0.0.1:9120/entrada/ | grep -o '<title>[^<]*</title>'` deve mostrar `Entrada da Mel`. **Só o código 200 não prova nada:** antes da Central atualizar (e com a Entrada desligada) `/entrada/` também dá 200, porque cai na SPA (`<title>SquadOne</title>`). `tailscale serve status` segue com as 3 linhas.

Pré-requisitos (feitos em 04/10): `age` 1.2.1 (`sudo apt install age`), `~/.config/mel/age/identity.txt` (600), `~/Mel/Entrada` e `~/Mel/Cofre` (700), `~/Mel/Cofre/recipients.txt` com a chave pública da Mel. O serviço lê o nome da Mel na tailnet com `tailscale status`; se falhar, sai com erro e o systemd tenta de novo (ou defina `ENTRADA_NOMES=<mel>.<tailnet>.ts.net`).

**Desfazer:** `systemctl --user disable --now entrada-organizar.timer entrada.service` (e `hermes cron remove cbb21e966fce`, o job pausado); remover `~/.local/lib/mel-entrada`, `~/.local/bin/cofre`, `~/.hermes/scripts/entrada_organizar.py` e a unit; restaurar `fontes.toml.bak-…`. As pastas `~/Mel/Entrada` e `~/Mel/Cofre` ficam (têm dado do Rômulo).

## Conferência (critério da fase)

Com um arquivo **falso** `chave-teste.txt` com `AGE-SECRET-KEY-…` falso: "Organizar" bloqueia; "Cofre" cifra e o `indice.json` não tem o valor; log e `diario.jsonl` não têm o valor; `cofre ler <id>` (no terminal) recupera; o texto de `requisicoes/` só tem `{{SEGREDO:id}}`; `tailscale serve status` mantém as 3 linhas; os 12 containers seguem `Up`; o menu **Entrada** da Central abre a página em `127.0.0.1:9120/entrada/` (confira o título `Entrada da Mel`, não só o 200). Tudo isso tem teste automatizado; a página pelo celular é conferência manual.

## Testes

```bash
cd deploy/dell/entrada
for t in segredos cofre cofre_cli entrada executor servidor organizar; do python3 $t.test.py; done
```

308 testes em Python (91 `segredos`, 16 `cofre`, 9 `cofre_cli`, 52 `entrada`, 40 `executor`, 34 `servidor`, 66 `organizar`) e 13 em `node:test` para o repasse da Central (`server/entrada-proxy.test.ts`). `cofre*`, `entrada`, `servidor` e `organizar` usam o `age` de verdade (sem ele, pulam). `organizar` usa um `hermes` de mentira: nenhum modelo é chamado. Todo segredo de teste é falso e montado em tempo de execução ou sorteado com semente fixa. Os testes olham **pedaços** do valor, nunca só o valor inteiro (redigir pela metade passaria num teste de "valor inteiro não aparece"). Há teste de propriedade (senhas aleatórias de 94 caracteres em 9 formatos), do corpus de 27 casos da revisão, de desempenho com a palavra-chave presente (cerca de 1 s por MB) e de processo morto no meio do envio. O executor, o repasse da Central e as proteções das revisões passaram por teste de mutação (proteções quebradas de propósito, cada uma numa cópia do código): **93 de 93 pegas**, mais 1 mutante **equivalente** (`expira\w*` no valor descritivo: a trava `(?=[ \t]+letra)` que veio depois já impede o mesmo caso; as duas se sobrepõem). Na primeira versão do PR #10, **9 de 94 sobreviveram** e mostraram testes que pareciam cobrir e não cobriam (um UTF-16 de tamanho ímpar que falhava por outro motivo, uma tabela cujos valores o filtro de palavra já escondia, um caso de camelCase com **duas** palavras de contexto, um `echo >>` que a checagem de plausibilidade pegava antes da varredura de bytes).

## Revisão adversarial (04/10/2026)

Dois revisores (Opus 5.5) tentaram quebrar o código: um nos caminhos de vazamento, outro em HTTP, executor e negação de serviço. Eles quebraram a primeira versão: **26 de 27 segredos falsos chegavam ao modelo**, UTF-16/Latin-1 passavam como "binário" e ficavam em claro, um temporário com texto claro sobrava depois de `SIGKILL`, o segundo clique redigia só parte de uma frase-senha, o `recipients.txt` com separador exótico fazia o cofre cifrar para menos gente, uma resposta envenenada do modelo travava a fila para sempre, e o filtro era quadrático com muitas ocorrências. Tudo foi corrigido e virou teste; os exploits deles rodam hoje contra o código corrigido sem vazar (0 de 27). O que sobra está em "O que NÃO está garantido" e em "Cofre e agentes". Confirmado por mim, e **não** pelo revisor: o sandbox de montagem não funciona em unidade de usuário aqui (ele disse que funcionava).

**2ª e 3ª rodadas.** O revisor de HTTP achou um problema **alto**: três regras do filtro eram quadráticas em entradas comuns (100 KB com a palavra "mysql" repetida levava 7 s e travava o servidor inteiro, porque o regex segura o interpretador). Hoje é linear (cerca de 1 s por MB no pior caso medido, `/healthz` responde durante um envio pesado) e tem teste. Também corrigidos: memória com caracteres invisíveis (50 MB por MB, hoje 3 MB), bytes que não são UTF-8 vindos do modelo, item preso para sempre depois de mover, vaga de conexão que vazava. Na 3ª rodada, sobre o repasse da Central, ele confirmou por medida que não há contrabando de pedido, que `Cookie`/`Authorization`/query não seguem e que 502 não vaza detalhe. Dois pontos **aceitos e documentados** (RULES, regra 23): a `Origin` aceita por `/entrada/api/enviar` é a da Central inteira (um XSS em qualquer rota da Central escreveria na Entrada; hoje `src/` não usa `v-html` nem `innerHTML`, e um token na página não adiantaria), e o repasse passa `Host`/`X-Forwarded-For` como vieram (a Entrada é quem confere). O repasse agora também recusa `GET` com corpo.

**2ª rodada de vazamento (chegou depois do merge do PR #9, corrigida neste PR).** O revisor mostrou 40 segredos falsos realistas que passavam pelas duas camadas até o modelo: valor na linha de baixo, em tabela, antes da palavra, em outro idioma (`contraseña`, `Passwort`), abreviado (`psw`, `pw`), como argumento de comando (`sshpass -p X`, `zip -P X`), em grupos curtos (senha de app do Google, chave do autenticador, códigos de backup, cartão) e como frase-semente fora do formato canônico. **Hoje: 0 de 40** (rodados os scripts dele contra o código novo). Também: um arquivo que só **começa** com o BOM UTF-16 e é ASCII escondia qualquer segredo (virava ideogramas reversíveis; acontece de verdade no Windows com `echo >>`); rótulo e nome de arquivo iam crus ao prompt e ao WhatsApp; o 2º clique guardava só a 1ª palavra de "a senha é minha casa azul 2026" (e o resto ficava em claro); PDF e imagem com XMP, fontes e links comuns eram bloqueados sem saída (141 de 320 arquivos reais, 36% dos textos comuns). Tudo corrigido e com teste; as duas proteções que sobreviviam à mutação (a conferência depois de redigir e a do prompt inteiro) ganharam teste. O que ele **não** pôde provar pelo código, eu medi com uma chamada real do `hermes -z` (ver "O que vai ao modelo"): o prompt de sistema carrega a persona e a memória, o `AGENTS.md` do `~` não entra, cada `-z` grava sessão no `state.db` (agora apagada) e o `clarify` sem terminal não trava.

**Revisão do PR #10 (dois revisores Opus 5.5 independentes, depois da correção da 2ª rodada).** Um atacou os afrouxamentos que eu fiz na camada 1 e a camada 2; o outro, a integração com o Hermes e os testes. Eles acharam o que eu não tinha visto, e vale dizer sem rodeio que **a primeira versão do PR #10 ainda tinha buraco**:
- (alto) frase-semente fora dos 6 formatos que eu cobria (`1 - abandon`, `#1 w`, `1: w`, JSON, vírgula sem espaço, hífen, tabela, e BIP39 em espanhol/francês, cujas palavras têm acento que quebrava a sequência): vazava 12 de 12; (alto) o UTF-16 legítimo com ASCII acrescentado depois chegava ao modelo como ideogramas reversíveis, porque o corpo legítimo fazia o arquivo parecer texto; (alto no sentido contrário) **cinco dos meus afrouxamentos eram largos demais** e deixavam passar o que a `main` bloqueava (`senha: Valid@2026`, `senha = casa(2026)`, `segredo do wifi: minha casa azul`, `senha: $HOME casa2026`, webhooks do Discord e do Slack, `data:text/plain;base64,…`, `sha256-…` curto);
- (médio) `senhaAdmin`, `passwordRoot` e `tokenBot` escapavam das duas camadas (a fronteira de palavra tratava a maiúscula seguinte como letra); palavras de contexto que faltavam (`chave do cofre`, `api key`, `pswd`, `mdp`, outros idiomas e escritas); nomes de pasta que o próprio modelo cria travavam **todo** item para sempre (12% dos conjuntos plausíveis: o filtro "colava" as linhas vizinhas da lista de pastas); um NUL no texto derrubava a rodada; rótulo e nome tinham máscara mais fraca que o texto; a limpeza de sessões lia o título (texto livre) e podia apagar a sessão errada ou falhar calada;
- (testes) os testes novos passavam por motivo errado: um teste de UTF-16 não testava nada (`encode().decode()` é a identidade), outro tinha dados de tamanho ímpar que falhavam por outro motivo, o `hermes` de mentira não criava sessão (então "limpar só antes" passava), e a máscara era testada em **uma** passada quando o sistema real passa **duas**. A mutação do revisor: 12 de 17 sobreviveram.

Tudo isso foi corrigido e virou teste: a camada do modelo ganhou idempotência (testada) e a janela das linhas de baixo (tabelas por estrutura, plural, marcador do cofre); a camada 1 ganhou o **modo estrito** para texto curto e apertou cada afrouxamento; o UTF-16 só vale sem nenhum par de bytes ASCII legível; os nomes de pasta vão como `• nome` e, se o prompt ainda parecer segredo, a lista de pastas é descartada em vez de travar o item; a limpeza lê da direita, confere e tenta de novo; a pasta suja avisa uma vez sem gastar tentativa; o ambiente do filho ficou na lista literal. O `hermes` de mentira dos testes agora imita o real (cabeçalho da tabela, `-z` que grava sessão, banco travado, tempo esgotado).

## Pendências

- **Instalado e no ar (04/10/2026).** Serviço às 20:36 (PR #9); correção do filtro às 23:26 (PR #10, `.bak-2026-10-04-fase6c` em cada arquivo); **job do Hermes `Entrada — organizar` (`cbb21e966fce`, a cada 5 min, `--no-agent`) criado às 23:30**, com `jobs.json.bak-2026-10-04-fase6c`. Conferido pelo **runner real do cron** com duas notas falsas na fila: as duas foram organizadas, o valor da senha não estava em nenhum prompt enviado ao modelo (`requisicoes/`), cada chamada apagou a sua sessão do Hermes (`sessoes_restantes: 0`) e a pasta do agente ficou vazia. Para desfazer o job: `hermes cron remove cbb21e966fce`.
- **Chave `age1…` do PC já está no cofre** (04/10, 23:27): 2 destinatários; os itens antigos foram recifrados. `cofre adicionar-destinatario <chave> --recifrar` é o comando para uma terceira.
- **Tokens de entrada por chamada sob o runner do cron variaram** no teste (789 e 5.009 nas duas chamadas; ~5.700 numa chamada do shell) e **não medi o porquê**: acompanhar `entrada_tokens` no `diario.jsonl`.
- O `dell-status` ainda não monitora a Entrada (só `systemctl --user --failed`, que a `saude.sh` já olha). `fila/`, `requisicoes/` e `diario.jsonl` não têm rotação.
- A varredura de duplicatas ainda não alimenta o agente.
- Quem está na tailnet abre a página: o controle é a tailnet (ACL do Tailscale), não um login.
