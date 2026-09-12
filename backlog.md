# Backlog — SquadOne

Atualizado em 12/09/2026. Objetivo da V1 de persistência: **roster de agentes + conexão OAuth sobrevivem a reinício e deploy.** Nada além disso.

---

## Status

### Pronto e no ar

| # | Item | Evidência |
|---|---|---|
| 1 | Volume Docker montado em `/app/data` | Easypanel → squadone-app → Armazenamento |
| 2 | Seed movida para fora do volume | commit `f1b596d`; testado com volume vazio simulado |
| 3 | Deploy com volume | `GET /api/squad` respondeu **200** em produção |
| 4 | Redirect URIs no Google Cloud | salvos e reconferidos na página do client |
| 5 | `TOKEN_ENC_KEY` gerada | 32 bytes, gravada no `.env` local |

### Pronto no código, **ainda não implantado**

| # | Item | Evidência |
|---|---|---|
| 6 | OAuth authorization code flow no backend | commit `ac48654`, `server/auth-store.ts` |
| 7 | Frontend sem token do Google | `src/auth/google.ts` reescrito; `App.vue` sem header `Authorization` |
| 8 | Porteiro de IP | `server/acesso.ts`; testado: IP certo 200, IP alheio 403, localhost 200 |
| 9 | `npx vue-tsc --noEmit` e `npm run build` | ambos passam |

**Bloqueio para implantar:** faltam `GOOGLE_CLIENT_SECRET` e `TOKEN_ENC_KEY` no Easypanel. Sem elas o app sobe e o roster funciona, mas conectar o calendário devolve 500 com `configuracao: true`.

### Sabido e não resolvido

| Item | Situação |
|---|---|
| Refresh token expira em 7 dias | Consent screen em **Externo + Testando**. Política do Google. Publicar remove o prazo. |
| Botão "Publicar app" desabilitado | Todos os campos com `*` do Branding estão preenchidos. O bloqueio exato **não foi confirmado** — suspeita é a seção "Domínio do app" vazia. Não investigado até o fim. |
| Persistência não testada ponta a ponta | O roster foi semeado no volume novo, mas ninguém escreveu → redeployou → conferiu que sobreviveu. |

---

## Tarefas manuais — só você

Ordem importa. Do 1 ao 4 é o que destrava tudo.

### 1. Pegar o client secret

1. Abrir https://console.cloud.google.com/auth/clients/967425780201-8varul68r00uj81l7ldbju1k4j5ngbmb.apps.googleusercontent.com?project=gen-lang-client-0086006291
2. Olhar a caixa **"Chaves secretas do cliente"**. Existe uma criada em 12/09/2026 (`****j2L-`), mas o Google avisa que **não dá mais para visualizar secret antiga**.
3. Se você tem o valor salvo em algum lugar, use esse. Se não tem, clicar **"+ Add secret"** e copiar a nova na hora — ela só aparece uma vez.
4. Guardar num gerenciador de senhas.

### 2. Pegar a chave de cifra

Já está gerada. Abrir o `.env` do projeto e copiar o valor de `TOKEN_ENC_KEY` (a linha inteira depois do `=`, sem as aspas).

### 3. Preencher as variáveis no Easypanel

1. Abrir http://31.97.170.105:3000/projects/aladdin/app/squadone-app/environment
2. Adicionar três linhas ao final:

```
GOOGLE_CLIENT_SECRET=<o secret do passo 1>
TOKEN_ENC_KEY=<o valor do passo 2>
IPS_PERMITIDOS=177.156.80.134
```

3. Clicar **Salvar**.

> Eu não posso digitar credencial em campo nenhum — por isso esses três são seus.

### 4. Implantar

Clicar **Implantar** na mesma página. Esperar o build.

### 5. Conferir que funcionou

1. Abrir https://aladdin-squadone-app.jicnzg.easypanel.host — deve carregar (você está no IP permitido).
2. Clicar **🔌 Conectar Google Calendar**. Vai sair da SPA e ir para a tela do Google.
3. Aceitar. Deve voltar para o app com o aviso "Calendário conectado".
4. **O teste que importa:** dar F5. Deve continuar conectado, sem pedir nada.
5. Segundo teste: voltar no Easypanel, clicar **Implantar** de novo, esperar, reabrir o app. Ainda conectado e com o roster intacto.

### 6. Conferir que o porteiro fecha

Abrir o app pelo 4G do celular (IP diferente). Deve dar **403**. Se der, a trava funciona.

> Se o seu IP mudar e você se trancar do lado de fora: esvaziar `IPS_PERMITIDOS` no Easypanel e implantar.

### 7. (Opcional) Tentar publicar o app

Só se quiser matar o prazo de 7 dias.

1. Abrir https://console.cloud.google.com/auth/audience?project=gen-lang-client-0086006291
2. Ver se **"Publicar app"** está clicável. Se estiver, clicar e seguir.
3. Se continuar desabilitado, ir na página **Branding** e preencher "Página inicial", "Política de Privacidade" e "Termos de Serviço". Voltar e tentar de novo.
4. Se o Google exigir **domínio autorizado verificado**, aí sim precisa de domínio próprio — `easypanel.host` não é seu e não passa no Search Console.

Publicar **não muda uma linha de código**. É só status.

---

## Tarefas do agente de IA

Prompts prontos para colar. Cada um é autossuficiente.

### A. Testar a persistência de verdade

> No SquadOne, quero prova de que a persistência funciona, não suposição. Escreva um teste de ponta a ponta que: (1) sobe o servidor com um `data/` temporário vazio e `seed/squad.seed.json` presente, confere que o roster foi semeado; (2) contrata alguém via `POST /api/squad/hire`; (3) derruba o processo e sobe de novo apontando para o MESMO `data/`; (4) confere que a pessoa contratada continua lá. Faça o mesmo para a credencial: grave um refresh_token falso pelo `auth-store`, reinicie, confira que `estaConectado()` continua true e que a cifra decifra. Não use mocks para o filesystem — o ponto é justamente o disco. Rode e me mostre a saída.

### B. Avisar antes dos 7 dias vencerem

> No SquadOne o refresh_token do Google expira em 7 dias enquanto o consent screen está em "Externo + Testando" (ver CLAUDE.md). Hoje o usuário só descobre quando a Mochila quebra. Faça a interface avisar antes: `server/auth-store.ts` já grava `obtidoEm` na credencial — exponha a idade dela em `GET /api/auth/status` e mostre no header do app um aviso discreto quando passar de 5 dias, com o botão de reconectar à mão. Não invente contagem regressiva exata: o prazo do Google não é garantido ao segundo.

### C. Tornar o 403 do porteiro legível

> No SquadOne, `server/acesso.ts` responde um `403` de texto puro para quem não está em `IPS_PERMITIDOS`. Isso é indistinguível de o app estar quebrado. Troque por uma página HTML mínima, sem framework e sem chamada externa, que diga que o acesso é restrito e mostre o IP de quem tentou — o IP ajuda o próprio dono a se readmitir quando o IP residencial muda. Não vaze nada além disso: nem nome do app, nem versão, nem rota.

### D. Fazer o roster caber num backup

> No SquadOne o roster e a credencial vivem num volume Docker que ninguém faz backup. Adicione uma rota `GET /api/export` que devolve o `squad.json` atual como download JSON, e um `POST /api/import` que aceita um JSON no mesmo formato e substitui o roster (validando o formato antes, e recusando se `dominios` não for uma lista). Não inclua a credencial do Google no export — ela é cifrada com uma chave que pode não existir do outro lado, e um refresh_token em arquivo solto é justamente o que não queremos. Ambas as rotas ficam atrás do porteiro de IP, que já protege tudo.

### E. Limpar o que o spec §3.4 dizia

> No SquadOne, vários comentários ainda descrevem o desenho antigo de autenticação — token do GIS em memória, reconexão a cada 1h, "sem sessão no backend". Isso deixou de ser verdade no commit `ac48654`. Varra `src/`, `server/` e `docs/` atrás dessas afirmações e corrija cada uma para descrever o que o código faz hoje. Não apague os comentários: reescreva. A razão de existirem (explicar a decisão) continua valendo, só a decisão mudou.

---

## Decisões registradas

| Decisão | Motivo |
|---|---|
| Sem banco na V1 | Dois blobs de ~1KB. Postgres/Firestore foram avaliados e recusados como peso desnecessário. |
| Sem sessão, sem cookie, sem tabela de usuários | Um usuário só, atrás do porteiro de IP. O servidor guarda uma credencial e pronto. |
| Porteiro de IP em vez de login | Projeto pessoal numa URL pública adivinhável. Login seria mais código para proteger uma pessoa. |
| Refresh token cifrado mesmo sendo projeto pessoal | A chave já existia e custou 10 linhas. O volume entra em qualquer backup. |
| Seed fora de `data/` | Volume novo sobe vazio e sombreia o conteúdo da imagem. |
| `prompt=consent` fixo | Sem ele o Google omite o refresh_token em consentimento repetido. |

## Fora de escopo da V1

Levantado e deliberadamente adiado: histórico de turnos, log de orquestração, quests locais (vivem no Calendar), multiusuário, multi-réplica, backup automático do volume.
