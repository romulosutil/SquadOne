# Máquina de controle

## Estado em 28/09/2026: sem PC, o Dell controla

O PC Windows 11 (aparelho `Rômulo` no Syncthing, `LHPOUZN-…`) perdeu o NVMe.
O Dell o viu pela última vez em **25/09/2026 às 19:18** e ele não volta. O que
não tinha chegado ao Dell nem ao GitHub até lá foi perdido e **não se
recupera**: não procure, não reconstrua, não cite como pendência.

Um PC novo está sendo providenciado para ser a máquina de controle, e o
SquadOne inteiro vai ser organizado nele. Até ele chegar:

- **Claude e Codex trabalham no próprio Dell.** Git em clone próprio atualizado
  do GitHub (ex.: `~/SquadOne`), nunca na réplica `~/Pessoal-dev`. O GitHub
  continua a fronteira entre os agentes. Container com `docker` direto, sem
  `ssh dell-worker`.
- **Não há túnel.** No Dell as URLs `127.0.0.1` (9120, 9119, 5679, 8080) são
  locais. Os links rastreados `http://127.0.0.1:5679/webhook/enviar` (wa_link)
  e `/webhook/convite` (Enviar convite) só funcionam no navegador do próprio
  Dell.
- **A pasta `auto` do Drive parou em 25/09/2026.** O caminho era `~/auto-site`
  → Syncthing → `G:\Meu Drive\auto` no PC → Google Drive para Desktop. A esteira
  não depende do Drive (o Balcão lê `~/auto-site` direto), então segue rodando.
  Desde 28/09 o Dell manda direto ao Drive, sem PC (`deploy/dell/backup/`):
  espelho só de leitura em `PRUMO/Sites antes da venda` (a cada hora) e
  `PRUMO/Consultoria`, mais um cofre cifrado em `Backups/dell-worker`. A `auto`
  antiga virou `auto (até 25-09)`.
- **`~/Pessoal-dev` e `~/Corporativo-dev` são o último retrato do PC** e não
  recebem mais nada. A fonte é o GitHub. O `dev/DELL-WORKER.md`, as tarefas
  agendadas (`DellWorker-LocalPortForwards`, `EsteiraLeads08h`) e o pre-push
  que chamava o grafo (`dev/tools/trigger-graphify.ps1`) ficaram no PC.
- **O grafo do Hermes** ("Graphify — projetos", 03:00) continua rodando sobre
  a réplica congelada e não volta para lugar nenhum.
- **O monitor não percebeu a queda.** A verificação `syncthing` do
  `dell-status` só olha erro de pasta, não se o aparelho do outro lado está
  conectado: o PC sumiu em 25/09 e a Central seguiu verde.

## Checklist do PC novo

1. **Acesso ao Dell:** Tailscale e OpenSSH; alias `dell-worker` apontando para
   o nome MagicDNS. Se for Windows, `dell-worker-tunnels.ps1` (nesta pasta)
   como tarefa agendada no logon (`DellWorker-LocalPortForwards`).
2. **Código:** antes, levar ao GitHub o que só existe no Dell (commits locais
   em clones do Dell). No PC novo, clonar do GitHub (`romulosutil/SquadOne`,
   `romulosutil/prumo`…); não copiar da réplica, cujo `.git` é incompleto.
3. **Drive:** Google Drive para Desktop na conta sutil.romulo@gmail.com. Os
   sites e a consultoria já aparecem em `G:\Meu Drive\PRUMO\`, **só leitura**
   (o que se edita ali é desfeito pelo espelho do Dell).
   - **Não sincronize os sites pelo Syncthing:** o Drive já os traz, e o
     risco de ressuscitar leads na fila do gerador acaba.
   - **Para editar no PC,** use um Syncthing à parte, Dell↔PC, com o PC
     começando **vazio** e recebendo. Um aparelho novo não tem histórico, e
     tudo que ele tem vira "novo" e volta para o Dell. Mesmo cuidado com
     `Pessoal-dev` e `Corporativo-dev`: nunca "Override changes" do lado novo.
   - Apagar `auto (até 25-09)` quando o Rômulo decidir.
4. **Syncthing:** parear o aparelho novo; depois remover o antigo (`Rômulo`,
   `LHPOUZN-…`) das pastas e dos aparelhos do Dell. Decidir o sentido do
   `Corporativo-dev` (hoje `receiveonly` no Dell porque o PC era a origem).
5. **Monitor:** dar ao `syncthing()` do `deploy/dell/dell-status.py` uma
   verificação do aparelho do outro lado (desconectado há mais de 24 h vira
   atenção), para a próxima queda não passar calada.
6. **Documentação:** voltar o controle para o PC em `ARCHITECTURE.md`, no mapa
   do Hermes (`deploy/hermes/skills/mapa-do-ecossistema/SKILL.md`), neste
   arquivo e no `~/AGENTS.md` do Dell.
