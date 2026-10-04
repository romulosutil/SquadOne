# Prompt para a nova sessão (nuvem) e para uma sessão no Dell

Como usar: abra a sessão na nuvem **no repositório `romulosutil/SquadOne`, na branch `mel/checkpoint-2026-10-04`**, e cole o bloco "Prompt A". O bloco "Prompt B" é para uma sessão rodando **no Dell** (a nuvem não alcança a rede privada, então tudo que instala ou confere no Dell precisa dele).

---

## Prompt A: sessão na nuvem (cole inteiro)

```text
Você continua um trabalho já em andamento: a organização da "Mel" (o Dell do Rômulo, a máquina sempre ligada com n8n, Docker e o Hermes no WhatsApp) e a ponte com o PC dele. Fale com o Rômulo em português, direto.

LEIA ANTES DE QUALQUER COISA, nesta ordem (estão na branch em que você está):
1. docs/mel/CHECKPOINT.md  (a foto do estado: o que está feito, o que falta, regras, armadilhas)
2. docs/mel/PROMPT-MEL.md  (o prompt de execução original: fases 0 a 7, regras absolutas, Anexo B do PC)
3. docs/mel/mel-progresso.md  (o diário completo, com o que foi verificado e como desfazer cada passo)
4. docs/mel/MANIFESTO.md, PROJETOS.md, SILMER.md e PC-COMECAR.md, conforme a tarefa.

O CHECKPOINT é uma foto de 04/10/2026 por volta das 16:55. Antes de afirmar que algo está feito ou pendente, CONFIRA no GitHub: `gh pr list --repo romulosutil/SquadOne --state all`, o estado de cada PR e o que está na main.

O QUE VOCÊ PODE E NÃO PODE FAZER
- Esta sessão roda na nuvem: trabalha em clones do GitHub e provavelmente NÃO alcança o Dell (rede privada Tailscale). Não tente SSH nem instalar nada no Dell, e não afirme nada sobre o que roda lá sem prova. Tudo que precisa rodar no Dell (instalar, systemd, rclone, Docker, n8n, conferir saúde) vira uma tarefa escrita para o Rômulo executar numa sessão no Dell (ele tem um "Prompt B" para isso).
- Você pode: ler e revisar, planejar, escrever código e testes, abrir PR, e ajudar o Claude do PC (que também atua nesta sessão) com os repositórios.
- MERGE na main: só com autorização EXPLÍCITA do Rômulo nesta conversa ("pode mergear o PR #N"). Um "pode mergear" vale para aquele PR. Cada merge faz a Central do Dell reconstruir e reiniciar por ~0,5 s.
- Uma fase de código = um PR. Pare no PR e peça o merge.

REGRAS QUE NUNCA SE QUEBRAM
- Nunca imprima, grave em log, commite ou mande em mensagem token, chave, senha ou conteúdo de .env. Segredo nunca vai para Git nem em texto claro para o Drive. Se o código precisa de segredo de teste, monte um FALSO em tempo de execução.
- Nunca `rm` em arquivo do Rômulo (descarte é `gio trash` ou mover para ~/Arquivo/AAAA-MM-DD/). Não mova nem renomeie pasta que serviço do Dell usa.
- Não toque no `infra-docker`, nos containers, nos workflows e credenciais do n8n, nem troque senha de banco, sem ordem expressa.
- Compare por CONTEÚDO (git cherry, hash de blob), nunca só por SHA ou por data: foi o que me levou a um erro grave com o `crm-silmer` (ver CHECKPOINT, seção 5).
- Diga "feito" só depois de ter rodado a verificação, e diga claramente quando um achado contraria o que se disse antes.
- Teste a cada passo: o Rômulo não quer que caia a Central (127.0.0.1:9120), o n8n nem o Drive. O script docs/mel/ferramentas/saude.sh é a checagem (para rodar NO DELL).

O QUE FAZER AGORA (confirme cada item antes)
1. Veja o estado do PR #7 (backup da pasta Estrutura). Se ainda estiver aberto, revise o código com olho crítico (filtro de segredos em deploy/dell/backup/estrutura-coletar.py, mudanças em backup-dell.py, fontes.toml) e diga ao Rômulo o que você achou. Peça a autorização dele para o merge; depois do merge, escreva a lista de passos de instalação para a sessão no Dell (está no CHECKPOINT, seção 3, item 2).
2. Fase 6 (Entrada: página privada + cofre age + Hermes organiza): leia a Fase 6 do PROMPT-MEL.md e proponha o desenho em PR. O núcleo é: o modelo só propõe JSON e um executor determinístico valida e executa dentro de uma lista de permissão; o filtro de segredos é um módulo único com testes, e o texto que vai ao modelo só tem {{SEGREDO:id}}. Escreva o código e os testes (com segredos FALSOS); a instalação e os testes de ponta a ponta serão no Dell.
3. Ajude o Rômulo a destravar o que depende dele: a decisão sobre os 3 commits de docs do RFC 006 do crm-silmer (repositório PÚBLICO), a troca das 4 senhas de banco fracas (só com ordem dele), a chave pública age1... dele (gerada no PC), e o backup diário do PC (Anexo B5 do PROMPT-MEL.md).
4. Registre o que fizer em docs/mel/mel-progresso.md (no PR) e mantenha o CHECKPOINT atualizado.

Comece lendo os arquivos, confirmando o estado no GitHub e me dizendo em poucas linhas o que você entendeu e o que pretende fazer primeiro. Não comece a mudar nada antes disso.
```

---

## Prompt B: sessão no Dell (cole inteiro; abra em `/home/romulo-sutil-corr-a`)

```text
Você roda na Mel (o Dell do Rômulo). Leia, nesta ordem: ~/AGENTS.md, ~/PRUMO/CHECKPOINT.md, ~/PRUMO/PROMPT-MEL.md (regras absolutas) e ~/Arquivo/2026-10-04/mel-progresso.md. O CHECKPOINT é uma foto de 04/10 ~16:55: confira o estado real (git, gh pr list, systemctl) antes de agir.

Use sempre caminhos absolutos: um `cd` para dentro de ~/SquadOne, ~/Silmer ou ~/Pessoal-dev já me fez trabalhar no lugar errado. ~/SquadOne é o checkout de produção da Central: nunca edite nem troque de branch ali; trabalhe num `git worktree` em ~/.cache/mel-work/SquadOne e entregue por PR.

Rode ~/Arquivo/2026-10-04/ferramentas/saude.sh ANTES e DEPOIS de cada passo e pare se algo ficar vermelho. Nunca imprima segredo. Nunca `rm` (use `gio trash`; em /tmp o `gio trash` não funciona: use `truncate`). Faça backup `.bak-AAAA-MM-DD` de todo arquivo instalado e anote como desfazer em ~/Arquivo/<hoje>/mel-progresso.md.

Tarefa: <COLE AQUI A TAREFA, por exemplo "instalar a Fase 5 depois do merge do PR #7, conforme o CHECKPOINT seção 3 item 2, e fazer a primeira rodada à mão do bloco estrutura">.

Só instale depois de confirmar que o PR está mergeado. Antes de começar, me diga em poucas linhas o que vai fazer e o que vai conferir.
```
