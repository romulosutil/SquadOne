# Manifesto da estrutura: PC, Dell e celular

Atualizado em 04/10/2026. É a versão para ler de duas coisas que devem dizer o mesmo:
a Central do Dell (`http://127.0.0.1:9120/`, seção "Como funciona") e o canvas
**Estrutura do SquadOne** (página "04/10 · espelho da Central").
Na dúvida entre os três, vale esta ordem: **o Dell de verdade → a Central → este manifesto → o canvas**.

Marcas usadas no texto: **hoje** é o que existe agora; **alvo** é para onde a estrutura vai;
**conferido** quer dizer que olhei no Dell em 04/10/2026; **conferir** é o que ainda não sei.

---

## 1. A ideia em 30 segundos

| | Papel |
|---|---|
| **PC** | Mãos e olhos. Código, IA e visualização acontecem aqui. É daqui que um projeto vai para o GitHub. |
| **Dell** | A **Mel** (o "Jarvis"; o nome é apelido, o nome técnico na tailnet não muda). Fica sempre ligada e cuida do que não pode parar: backend, infra, bancos, n8n, Docker, Hermes e a operação do PRUMO e do Site antes da venda. |
| **Celular** | Controle remoto. Recebe o Hermes no WhatsApp e abre os links do Dell. |
| **GitHub** | A fronteira do código: o que está na `main` é o que vale. |
| **Tailscale** | A ponte privada entre os três. Nada precisa ficar aberto para a internet. |
| **Google Drive** | Material e backup (não é lugar de código). |

**"Você" nos fluxos é o Rômulo, no PC ou no celular.** O PC edita e decide; o celular só abre links e manda WhatsApp.

Três regras que resumem o resto:

1. **Código vai por Git. Material vai pelo Drive. Nada vai aberto para a internet.**
2. **O Dell é a verdade da operação**; o PC não escreve direto onde o Docker de produção lê.
3. **O Hermes informa; quem decide é você** (até você mudar isso, ver seção 12).

```
                    git push                  pull (timer)
      PC  ────────────────────▶  GitHub  ─────────────────▶  DELL (sempre ligado)
       │                                                      │ Docker · n8n · Hermes
       │  Tailscale: SSH, links, bancos                       │ bancos · Central · esteira
       └──────────────────────────────────────────────────────┤
                                                              │ rclone
   CELULAR ◀──── WhatsApp (Hermes) ───────────────────────────┤────────▶ Google Drive
   CELULAR ────── Tailscale: Central, webhooks ──────────────▶┘          (espelho e cofre)
```

## 2. Os três aparelhos (conferido)

| | Nome na tailnet | IP | Sistema | Estado em 04/10 |
|---|---|---|---|---|
| PC | `paiduben` | 100.124.120.127 | Windows | online |
| Dell | `romulo-sutil-corr-a-latitude-7420` | 100.68.136.88 | Linux (Ubuntu) | online, sempre ligado |
| Celular | `s25-ultra-de-rmulo` | 100.95.237.32 | Android | offline há 1 dia (app do Tailscale desligado) |

Endereço do Dell na tailnet: `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net`.

## 3. Os quatro caminhos

1. **Código (alvo).** PC → `git push` → GitHub → o Dell puxa sozinho → reconstrói → avisa no WhatsApp.
   *Hoje* isso só existe para a Central do SquadOne (`atualizar-central`, a cada 10 min) e **ainda não tem rollback**.
2. **Operação.** Um gatilho (horário ou evento) acorda o n8n, um timer ou o Hermes; o resultado chega no seu WhatsApp; você decide.
3. **Acesso.** PC e celular entram no Dell pela Tailscale: links, SSH, bancos.
4. **Material.** O Dell espelha pastas no Drive (só no sentido Dell → Drive) e guarda um cofre cifrado. A pasta da Silmer é bidirecional com o Drive.

### Backup na pasta `Estrutura` do Drive (proposto)

Você criou a pasta `Estrutura` no Meu Drive (conferido: existe, uma só). O que vai nela é o **mapa e as configurações**, em texto e leve; o cofre cifrado com a home inteira continua em `Backups/dell-worker`.

| De onde | Para onde | Quando | Por quê |
|---|---|---|---|
| Dell | `Estrutura/dell/` | **todo dia, de madrugada (por volta das 04:00)** | Meia hora depois do cofre (03:30), sem disputar a mesma trava. Texto muda pouco: diário basta |
| PC | `Estrutura/pc/` | **todo dia, quando o PC estiver ligado** (ao entrar no Windows e a cada 24 h) | O PC manda por SSH para o Dell, e o Dell sobe para o Drive: um só caminho, uma só credencial |
| Os dois | versões antigas | **30 dias** na lixeira do backup | Mesmo padrão do espelho que já existe |

Entra: manifesto, `LEIA-ME`, `AGENTS.md`, registro de projetos, units do systemd, `fontes.toml`, arquivos `docker-compose`, lista de repositórios e remotos, estado do Tailscale e do `serve`, `docker ps`, exportação dos fluxos do n8n **sem credenciais**, e no PC o `~/.ssh/config` (sem chaves), as configurações do editor e a lista de programas.
**Nunca entra:** `.env`, tokens, chaves privadas, `rclone.conf`, sessão do WhatsApp, bancos. Isso fica só no cofre cifrado.
O remote novo (`gdrive-estrutura`) é uma cópia do `gdrive-silmer` (que já tem escopo `drive`) com a raiz trocada para a pasta `Estrutura`: não precisa de novo login e não mexe no remote `gdrive`.

## 4. O que roda no Dell e onde abrir (conferido)

| Serviço | Porta no Dell | Como abrir do PC ou do celular | Observação |
|---|---|---|---|
| **Central do SquadOne** | 9120 | `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net:8443/` | "Precisa de você", Como funciona, CRM em `/crm` |
| **Hermes** (painel) | 9119 | `https://romulo-sutil-corr-a-latitude-7420.tail20cfb0.ts.net/` | O gateway do WhatsApp roda como outro serviço |
| **n8n** | 5679 | só `/webhook` pela tailnet | O editor abre só no Dell (`127.0.0.1:5679`): o login do Google dele depende desse endereço |
| **code-server** | 8080 | só no Dell | Editor no navegador; não está na tailnet |
| **Bancos dos projetos** | tailnet | `100.68.136.88`: Postgres 5432 e 5435 (p4f), 5433 (iris), 5434 (crm-silmer), 5436 (aladdin); MySQL 3306 e Redis 6379 (espectro); MinIO 9000 e 9001 (iris) | Já publicados no IP da tailnet; o PC pode usar direto |
| **MoneyPrinterTurbo** | 8501, 8090 | `http://100.68.136.88:8501` | |
| **SSH** | 22 | `ssh romulo-sutil-corr-a@romulo-sutil-corr-a-latitude-7420`, ou só `ssh mel` com o atalho `Host mel` no `~/.ssh/config` do PC | Ver seção 9: está aberto demais |
| **Syncthing** | 22000, 8384 | `https://100.68.136.88:8384` | Ver seção 9 |

Sempre ligados: Central, Hermes (painel e gateway), n8n, collector do PNCP, whatsapp-observador, healthwatch e os 12 containers.
O **healthwatch religa Hermes, Central, n8n e code-server a cada 30 s**: parar um deles à mão dura 30 s, a não ser que se pause o healthwatch antes.

## 5. As operações (espelho do "Como funciona")

| Fluxo | O que a máquina faz | O que é com você |
|---|---|---|
| **Site antes da venda** | 06:00 o Caçador acha o lead (Places + Gemini). A pasta nasce em `~/auto-site`. 08:00 o gerador faz e publica o site (Claude + Vercel), até 4 por dia. O Hermes avisa. O Balcão marca "pronto" (:10). 10:30 resumo no WhatsApp. O observador marca envio, leitura e resposta. Follow-up no 3º dia, expira no 10º, demo pausada em 15 dias. Funil por nicho às segundas. | Escolher os nichos. Abordar o lead (o botão do CRM abre o WhatsApp). Conversar, propor, fechar ou recusar. |
| **PRUMO · Organizar** | 09:00 Lead Scout acha prospects (o CNPJ descarta MEI, micro e redes). Diagnóstico de hora em hora. Rascunho do Mapa em PDF (7 páginas) em `~/prumo-entregas`. | Revisar o prospect. Enviar o convite. Completar o Mapa, o workshop e a proposta. |
| **CRM** | A planilha é a verdade. Retrato a cada 10 min. Divergência entre planilha e pasta vira nota, nada se corrige sozinho. | Hoje, Funil e Ficha: próximo passo, "proposta enviada". |
| **Radar PNCP** | 07:30 coleta. Tira o que vence em menos de 3 h. 08:00 repescagem (se faltou) e resumo no WhatsApp. | Montar o dossiê do edital em `~/Licitacoes`. |
| **Alertas e saúde** | O monitor confere tudo a cada minuto. O WhatsApp só fala no vermelho: quando quebra, a cada 12 h enquanto durar, e quando volta. | Resolver, ou pedir ao Claude com a frase pronta. |
| **Backup** | Espelho dos sites de hora em hora. PRUMO e Entregas por dia. Cofre cifrado às 03:30. Ensaio de restauração por mês. | Guardar o kit de recuperação (uma vez). |
| **O que chega no WhatsApp** | Radar 08:00; funil segunda 08:00; receita segunda 08:30; follow-up 09:00; ASMR 09:00 e 09:30; demos pausadas 09:40; sites e pendências 10:30; avisos a qualquer hora. | Ler. |
| **Código e Central** | `atualizar-central` a cada 10 min; grafo dos projetos às 03:00. | Pedir ao Claude ou ao Codex; push na `main`. |
| **Agenda e agentes** | Uma frase vira evento no Google Calendar; lembrete no celular 10 min antes. | Mandar a demanda. |

**Um dia no Dell** (horário de Brasília): 03:00 grafo · 03:30 cofre · 06:00 Caçador · 07:30 coleta PNCP ·
08:00 gerador, repescagem, radar, funil (seg) · 08:30 receita (seg) · 09:00 Lead Scout, acompanhamento, ASMR ·
09:30 ASMR · 09:40 pausa de demos · 10:30 sites e pendências. De hora em hora: Balcão (:10), espelho dos sites (:05), Diagnóstico.
Dell desligado: o Caçador, a coleta e os fluxos de hora em hora **não se repetem**; gerador, cofre e repescagem rodam quando ele liga.

## 6. O conceito, em uma tabela: quem faz o quê

| | Faz |
|---|---|
| **Você (PC e celular)** | Decide, aborda, vende, escreve código, edita, visualiza. |
| **Claude e Codex** | Executam e corrigem. *Hoje* rodam no Dell; *alvo*: desenvolvimento no PC, e no Dell só para operar e consertar a operação. |
| **Hermes** | Secretário: informa, não opera. |
| **n8n** | Orquestra os fluxos. |
| **systemd** | Agenda e vigia. |
| **Docker** | Serve o n8n, o collector e os bancos dos projetos. |
| **SquadOne** | Agenda (app) e a Central, que mostra o Dell. |

## 7. As pastas

### Alvo, no PC (a estrutura que você definiu)

```
Dev/
  Corp/        projetos Pay4Fun (hoje ~/Corporativo-dev)
  Pessoal/     aladdin, iris, portfolio, espectro, port, agent-context, silmer-web, ...
Prumo/         (Drive; o Dell é quem opera)  Licitações · Auto-site · Prumo
Digital/       (PC e Drive)                  Clientes/Silmer
```

### Hoje, no Dell: o que **não se move** (serviços dependem do caminho)

| Pasta | O que é | Quem depende |
|---|---|---|
| `~/SquadOne` | Git. É o checkout que a Central roda | `atualizar-central`, Central, scripts do Hermes |
| `~/prumo` | Git. Método, marca e propostas do PRUMO | espelho do backup, prumo-mapa |
| `~/crm-silmer` (+ `~/crm-silmer-wt`) | Git. CRM do cliente Silmer | grafo do Hermes, worktrees (1 commit só local em `fix/inbox-live-tests`) |
| `~/auto-site` | Sem Git. A esteira | n8n, gerador, auto-entrada, site-pastas, espelho, Syncthing |
| `~/prumo-entregas` | Rascunhos do Mapa (dado de cliente, fora do Git) | n8n, espelho |
| `~/licitacoes-automation` | n8n e collector (fora do Git) | Docker, healthwatch, Hermes |
| `~/prumo-automation` | Fluxos antigos do PRUMO | o n8n ainda monta a pasta |
| `~/workspace` | `infra-docker` e `moneyprinterturbo` | os containers dos bancos |
| `~/.hermes` | O Hermes | Hermes, backup |
| `~/renda-2026` | Notas de receita | Hermes (segundas) |
| `~/Silmer` | Marketing do cliente, bisync com o Drive a cada 5 min | `silmer-drive-sync` (mover exige `--resync`; deixe por último) |

Outros: `~/Mel` (**a criar**: `Repos` com os espelhos do Hermes, `Cofre` do age e `Entrada`; tudo que a Mel gerencia sozinha mora ali), `~/Licitacoes` (dossiês), `~/PRUMO` (índice de atalhos para as pastas de verdade, com os nomes do Drive),
`~/Arquivo/<data>` (guardado por via das dúvidas), `~/Pessoal-dev` e `~/Corporativo-dev` (réplicas congeladas de 25/09, candidatas a sair do Dell **depois** de copiadas para o PC).

### Uma pasta por projeto (contra pastas duplicadas)

O Dell já acumulou várias cópias do mesmo projeto, quase sempre criadas por agentes que não sabiam que a pasta existia:
`crm-silmer` em dois lugares (mais `crm-silmer-wt`), `Silmer` em dois, `agent-context` e `agent-context+`,
`Pessoal-dev/SquadOne` e `SquadOne-publish-…` (arquivadas em 30/09), e agora `port` e `portfolio`.
A regra que evita isso, para valer no PC também:

1. **Cada projeto tem um único caminho canônico**, escrito num registro (`PROJETOS.md`, a criar): nome, caminho, repositório e papel.
2. **Antes de criar pasta ou clonar, o agente lê o registro.** Se o projeto existe, trabalha nele; não cria "outra".
3. **Projeto novo entra no registro primeiro.** Só depois nasce a pasta.
4. **Cópia de leitura tem outro nome e outra marca** (espelho) e ninguém edita nela.
5. **`git clone` só no caminho canônico.** Para guardar uma versão, use `~/Arquivo/<data>`, nunca uma pasta ao lado.
6. *Ideia, ainda não feita:* uma varredura noturna do Hermes que avise na fila quando duas pastas tiverem o mesmo repositório remoto.

## 8. Antes de limpar o Dell: onde mora a única cópia (conferido)

O PC antigo queimou; o que não estava no Dell nem no GitHub se perdeu. Por isso **o Dell pode ser a única cópia** do que está abaixo.
Sequência segura: **copiar para o PC, conferir, só então arquivar no Dell** (`~/Arquivo/<data>`, nunca `rm`).

| O quê | Situação | Cuidado |
|---|---|---|
| `Corporativo-dev` (7 projetos, 299 MB) | Cópia do Syncthing de 25/09, **igual ao que o PC mandou** (0 mudanças locais) e também dentro do cofre do backup. Sem `.git`. No GitHub há `ds4fun`, `ds_auditor`, `p4fhub` e `p4f` (confira se `p4f` é o `p4f-site-institucional`); **não achei** `databasepay4fun`, `Vera` nem `pay4fun-p4f-landpage-cms-*` | É da Pay4Fun: confira a política da empresa. `ds_auditor` está **público** no GitHub |
| `espectro` (1,3 GB) | Está no GitHub (`romulosutil/espectro`, privado, push de 24/09), **mas a cópia daqui tem 30 arquivos mais novos que o GitHub** (entre eles `cmd/server/main.go`, `internal/clinic/drift.go`, as migrations 042 a 044 e `CalendarCard.vue`) e 2 resumos diários que o GitHub não tem. O `.git` local está corrompido. Os dois `.env.local` e o `server.exe` **foram removidos do `main` do GitHub em 04/10** (commit `955e5e1`), mas continuam no histórico | **Não apague ainda.** Arquive sem `node_modules` e `.gomodcache`, e decida o que fazer com essas 30 mudanças. **Troque as senhas dos bancos do espectro**: ficaram no histórico do GitHub e os bancos escutam na tailnet |
| `port` (21 MB sem `node_modules`) | **Virou o repositório `product_designer`** (263 commits no GitHub; o `portfolio` daqui é o clone dele e está em dia). O histórico do GitHub guarda quase todos os docs antigos. **Só existem nesta pasta:** `pdf_exports/` (13 MB), `_to_delete/`, 7 dos 26 arquivos de `docs/`, e versões de `ABOUT.md`, `ARCHITECTURE.md`, `RULES.md` e `agents.md` diferentes das que foram commitadas | Arquive a pasta inteira em `~/Arquivo/<data>` (21 MB). Não precisa passar nada para o `portfolio` |
| `Pessoal-dev/Silmer` e `~/Silmer` | Sem Git (a pasta `.git` está vazia ou quebrada) | O `~/Silmer` tem cópia no Drive |
| `Pessoal-dev/crm-silmer` | Cópia antiga e divergente; a válida é `~/crm-silmer` | Arquivar, não apagar |
| `aladdin`, `iris`, `portfolio` | Têm remoto no GitHub | Confira se não há branch ou commit sem push (`iris` está em `fix/pequenos-ajustes-2`) |
| `licitacoes-automation` | Fluxos do n8n e coletor **só aqui** | O cofre do backup é a única cópia fora do Dell |

Os containers dos bancos usam volumes nomeados do Docker: mover ou arquivar pastas de projeto **não** mexe nos dados deles.
**Syncthing:** hoje nenhum par está conectado (conferido), então limpar é seguro. Não reconecte as pastas `pessoal-dev`,
`corporativo-dev` e `auto-site` ao PC **antes** de terminar a limpeza: elas são `sendreceive` e uma limpeza de um lado apaga do outro.

## 9. Rede e acesso: revisão

### Veredito

| Peça | Veredito | Por quê |
|---|---|---|
| **Tailscale** | Fica. É a base | Já resolve links, SSH e bancos. Plano pessoal gratuito. Substitui os túneis SSH de antes |
| **SSH** | Fica, mas **mais fechado** | Hoje aceita senha e escuta em qualquer rede |
| **Git + GitHub** | Fica. É o único caminho do código | Rollback, histórico e nada de arquivo salvo pela metade |
| **Syncthing** | **Opcional**, é o elo mais fraco | Não serve para código: as réplicas de `espectro` e `Silmer` têm o `.git` estragado (a sincronização é a causa mais provável, não confirmada). `auto-site` e `pessoal-dev` são `sendreceive` sem versionamento |
| **Drive (rclone)** | Fica para material e backup | Já funciona e não depende do PC |

"Portas abertas entre Dell, PC e celular" deve significar **alcançáveis só pela tailnet**, não abertas na LAN nem na internet.

### O que o Syncthing fazia, e o que ainda depende dele (conferido)

- **Até 28/09** era como o Dell via as pastas do PC: o Hermes rodava o graphify sobre a réplica `~/Pessoal-dev` e o resultado voltava ao PC pelo Syncthing.
- **Desde 29/09** o graphify das 03:00 lê clones Git do Dell (`~/SquadOne`, `~/prumo`, `~/auto-site`, `~/crm-silmer`). Não depende mais do Syncthing.
- **O Docker nunca dependeu dele.** Os composes ficam em `~/workspace/infra-docker` e `~/licitacoes-automation`, e os bancos usam volumes nomeados. A única pasta de produção que era do Syncthing é o `~/auto-site`, que o n8n monta.
- **O que se perde sem ele:** o graphify do Dell deixa de ver os projetos do PC.
- **Decisão de 04/10: o graphify lê todos os repositórios, e o Hermes é quem roda, inclusive em repositórios novos.** Desenho, ainda não implementado:
  1. O job das 03:00 (já é do Hermes) passa a **descobrir** os repositórios no GitHub com `gh repo list`: repositório novo entra sozinho.
  2. Os que o Dell já usa (`SquadOne`, `prumo`, `crm-silmer`) ficam onde estão. Cada um dos outros ganha **um clone raso** em `~/Mel/Repos/<nome>`, pasta do Hermes onde **ninguém edita**. A atualização é `fetch` mais `reset --hard`, nunca `pull` com merge.
  3. O que não tem Git entra por uma lista no registro de projetos: `auto-site` e `Corporativo-dev`.
  4. Para cada pasta: `graphify update` e `graphify global add`, como hoje. Só falha vira mensagem.
  5. Custo: 45 repositórios, 405 MB no GitHub; o Dell tem 376 GB livres.
  Um efeito bom: clone limpo não tem `.gomodcache`, que é o que levou o grafo do `espectro` a 157 MB e o deixou fora do grafo global (o limite é 40 MB).
  O que isso **não** vê: trabalho do PC ainda não commitado. Se for preciso, um Syncthing só de leitura cobre isso depois.

### O que está certo hoje (conferido)

- `tailscale serve` (só tailnet, sem `funnel`): Central, Hermes e `/webhook` do n8n.
- Bancos publicados no **IP da tailnet** e em `127.0.0.1`, nunca em `0.0.0.0`. Isso importa: **o Docker ignora o ufw**, então o `bind` explícito é a proteção de verdade.
- Firewall `ufw` ativo.

### O que ajustar (proposto, nada foi aplicado)

1. **SSH só por chave e só pela tailnet.** Hoje: `PasswordAuthentication yes`, porta 22 liberada para qualquer origem, escutando em `0.0.0.0` e `::`.
   No Dell, com uma segunda sessão SSH aberta para o caso de errar:

   ```bash
   sudo tee /etc/ssh/sshd_config.d/10-so-chave.conf >/dev/null <<'EOF'
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   EOF
   sudo sshd -t && sudo systemctl reload ssh
   sudo ufw allow in on tailscale0 to any port 22 proto tcp
   sudo ufw status numbered      # ache as duas linhas "22/tcp ALLOW Anywhere" (v4 e v6)
   sudo ufw delete <número>      # apague uma, releia a lista, apague a outra
   ```

2. **Chave do PC novo.** O `authorized_keys` só tem a chave do PC antigo (`sutil@Rômulo`), duplicada, e uma das linhas começa com um caractere invisível (BOM) que o SSH ignora.
   Gere uma chave no PC (`ssh-keygen -t ed25519`) e acrescente a `.pub` ao `authorized_keys`. No Windows, não redirecione arquivo com `>>` no PowerShell (grava UTF-16 ou com BOM, que é o que estragou aquela linha): mande o conteúdo pelo próprio ssh, com `type ~\.ssh\id_ed25519.pub | ssh romulo-sutil-corr-a@romulo-sutil-corr-a-latitude-7420 "cat >> ~/.ssh/authorized_keys"`.
   Depois remova a chave antiga e reveja `~/.ssh/hermes_windows_ed25519`: pelo nome parece ser do PC antigo, mas confirme antes de arquivar (não abri o conteúdo).
3. **Syncthing só pela tailnet.** Hoje: GUI em `0.0.0.0:8384`, porta 22000 liberada para qualquer origem, relays e descoberta global e local **ligados**.
   Na interface (Ações › Configurações): endereço de escuta `tcp://100.68.136.88:22000`; desmarcar descoberta global, local e retransmissão; GUI em `100.68.136.88:8384`;
   remover o dispositivo antigo `Rômulo (LHPOUZN)`; no ufw, trocar o 22000 "Anywhere" por `allow in on tailscale0`.
4. **Celular:** abrir o app do Tailscale e deixá-lo conectado (está offline há 1 dia). No Android, tirar o app da otimização de bateria.
5. **Bancos na tailnet:** confira que nenhum usa senha padrão, já que qualquer aparelho seu na tailnet alcança a porta.

### Como testar sem commit (sem Syncthing)

- **Front no PC, banco no Dell:** rode o servidor de desenvolvimento no PC e aponte `DATABASE_URL` para `100.68.136.88:<porta>`. Já funciona hoje.
- **VS Code Remote-SSH:** edita e roda direto no Dell, sem copiar nada.
- **Syncthing para `dev-teste`:** só se os dois acima não bastarem. Receive-only no Dell, `.stignore` nos dois lados (`.git`, `.env*`, `node_modules`, `.next`, `dist`, `.vercel`, `*.pem`, `*.key`), e o `.env` do container de teste fica no Dell, fora da pasta sincronizada.

## 10. Custo: tudo gratuito?

| Peça | Custo |
|---|---|
| Tailscale (plano pessoal), GitHub (repos privados), Syncthing, Docker, n8n autohospedado, Hermes, rclone, restic | Gratuitos |
| Google Drive | Conta com 5 TiB; o Drive usa 11 GiB no total, backup incluído (conferido) |
| Claude, ChatGPT | Assinaturas que você já tem; fora da infraestrutura |
| **Conferir** | **Vercel:** o plano Hobby é de uso pessoal, e demos para prospecção comercial podem contar como uso comercial (leia os termos atuais). **Google Places:** a API exige conta de faturamento, mesmo com cota gratuita. **Easypanel:** hospeda o `squadone-app` e um segundo n8n; descubra em que servidor ele roda e se esse servidor é pago |

Não verifiquei as condições atuais de Vercel, Places e Easypanel.

## 11. Regras de ouro

- **Nunca `rm`.** Descarte é `gio trash`; guardado vai para `~/Arquivo/<AAAA-MM-DD>/`.
- **Nunca revogar token OAuth do Google.** Hermes, n8n, backup e SquadOne são do mesmo projeto e caem juntos. O login desses serviços só no navegador do próprio Dell.
- **Segredos** (`.env`, `auth.json`, tokens, `rclone.conf`, sessão do WhatsApp) nunca em Git nem no Drive.
- **Porta de container:** publicar só em `127.0.0.1` ou no IP da tailnet. Nunca `-p 5432:5432` sem endereço.
- **Git só em clones atualizados do GitHub**, e nunca dentro de pasta sincronizada com Drive ou Syncthing.
- **Vercel:** os demos saem por `vercel deploy` sem Git. Não ligar esses projetos ao GitHub.
- **n8n:** o editor fica local; pela tailnet vai só `/webhook`. Não mudar as URLs `N8N_*`.
- **Tailscale Serve:** conferir `tailscale serve status` antes; nunca `serve reset` nem trocar o hostname: os links de envio e de convite gravados nas planilhas (cerca de 75 em 29/09) dependem dele.
- **Antes de parar um serviço:** pausar o `healthwatch`; avisar que o `dell-status` vai mandar WhatsApp.
- **Janela do gerador:** nada perto da esteira entre 08h e 11h30.
- **Não mover nem renomear** as pastas da seção 7: os serviços procuram cada uma pelo caminho.
- **Dados de cliente** (`~/prumo-entregas`) ficam fora do Git.

## 12. Decisões em aberto

Do canvas de 29/09, mais duas que surgiram agora. Cada uma muda o que um agente pode fazer sozinho.

1. **O Hermes passa a agir com sua aprovação?** Hoje só informa. Você responderia "ok `<lead>`" e ele mandaria o texto; "recusou `<lead>`" moveria a pasta e atualizaria a planilha.
2. **"Manda pro Claude".** Uma fila que um `claude -p` consome no Dell. É o passo que mais se aproxima do "Jarvis". Atenção: o gerador de sites já roda `claude -p --dangerously-skip-permissions`.
3. **Permissões maiores que o papel.** O token Google do Hermes pode mandar e-mail e escrever no Drive.
4. **Codex, dois n8n e as demos antigas.** Codex sem papel definido; o n8n do Easypanel (Silmer, Food Helper) fica fora do monitor do Dell; as demos já pausam em 15 dias.
5. **(nova) Quem edita o código da operação** (`SquadOne`, `prumo`, `crm-silmer`): o PC, via Git (alvo), ou o Claude no Dell. Enquanto isso não estiver decidido, a Central e o `AGENTS.md` ainda dizem que o Dell é a máquina de controle.
6. **(nova) Syncthing: manter ou aposentar.** A recomendação da seção 9 é manter só se o teste rápido ou a decisão 7 pedirem.
7. **(decidida em 04/10) O graphify lê tudo e o Hermes roda em qualquer repositório** (desenho na seção 9). O **Corp (Pay4Fun) entra no grafo global**, por decisão sua: nomes de arquivos e funções do Corp podem chegar ao modelo do Hermes (conta do ChatGPT). Confira a política da empresa.
8. **(decidida em 04/10) Caixa de entrada da Mel:** uma **página simples, só pela tailnet** (sem Telegram), onde você manda texto e arquivos. Os segredos vão para um cofre com **age**, e o agente, o **Hermes**, só recebe referências e mantém tudo arrumado. O que protege os segredos é **código antes do agente**, não o prompt. Isso relaxa o "Hermes só informa" **apenas dentro da Entrada**. Prompt de execução em `~/PRUMO/PROMPT-MEL.md`.

## 13. Próximos passos, em ordem

1. **Fechar o acesso** (seção 9, itens 1 a 4): reversível, cerca de 15 minutos.
2. **Entrar no Dell pelo PC** com chave: `ssh` funcionando pela tailnet.
3. **Levar o que só existe no Dell** (seção 8) para o PC: `tar` no Dell, `scp` pela tailnet; conferir. Arquivar `espectro` e `port` (nada de apagar) e decidir as 30 mudanças do `espectro`.
4. **Montar `Dev/` no PC** e clonar do GitHub o que tem remoto.
5. **Limpar o Dell:** mover para `~/Arquivo/<data>`, sem `rm`; depois atualizar o `LEIA-ME.md` e o `AGENTS.md`.
6. **Celular:** Tailscale ligado, testar a Central.
7. **Só então**, em ordem: deploy por Git com rollback (generalizar o `atualizar-central`), teste rápido, e as decisões 1 a 3.
8. **Atualizar a Central e o canvas** para o modelo novo: o fluxo "Código e Central" ainda diz que o Claude edita no Dell.
9. **Dois jobs no `SquadOne`, num clone separado e por pull request:** o graphify de todos os repositórios (seção 9) e o backup para a `Estrutura` (seção 3). Teste manual antes de instalar; o job das 03:00 só muda depois.

## 14. Fontes e manutenção

- Conteúdo da Central: `~/SquadOne/src/operations/fluxos.ts` (o arquivo pede: "ao mudar um fluxo, mude aqui também").
- Regras do Dell: `~/AGENTS.md`. Mapa das pastas: `~/PRUMO/LEIA-ME.md`.
- Backup: `~/.config/backup-dell/fontes.toml` (fonte versionada em `~/SquadOne/deploy/dell/backup/`).
- Arquivos instalados (units do systemd, scripts do Hermes, `fontes.toml`) vêm de `~/SquadOne/deploy/…`: **edite na fonte e reinstale**, senão a próxima instalação desfaz.
- Canvas: `https://claude.ai/artifact/4X54aRKcqSJc4wDAHUgFQ7`. O artefato `Fluxos da operação` (`…/Cq7R8yYVTbwoN8Bn2Gp9fW`) está parado em 29/09.
- Este arquivo não é versionado: o backup do Dell o guarda (cofre), mas ele não tem histórico.
