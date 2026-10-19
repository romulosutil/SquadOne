# Envio pelo WhatsApp sem cair no antispam (15/10/2026)

> **Revisão de 18/10/2026:** o pedido atual substitui a rampa abaixo por teto interno de
> **100 primeiros contatos por dia de São Paulo, 12 por hora móvel e 5 min entre contatos**,
> mantendo expediente, pausa por restrição e envio manual. Não há garantia de envio sem riscos:
> esses números não são limites antispam publicados pela Meta. O limite de 250 da Cloud API
> não é uma franquia para o aplicativo. Ter telefone público ou link de WhatsApp não comprova
> consentimento; o destinatário precisa ter autorizado o contato. O relato de restrição não
> confirma sua causa, nem permite prever a duração de uma próxima restrição. As afirmações
> categóricas do plano histórico abaixo não devem ser usadas como diagnóstico ou garantia.
> A contagem do sistema não cobre necessariamente os envios feitos diretamente no celular.

> Plano escrito no dia do bloqueio de 24 h no número pessoal do Rômulo. Os números vêm do
> `GET /api/operations/crm` da Mel.
>
> **Fase 1 feita no mesmo dia** (`src/operations/trava-de-ritmo.ts`, `server/crm.ts`,
> `site-acompanhamento.py`), com duas diferenças do texto abaixo, achadas nos dados:
> - A prioridade do "WhatsApp do site" vale só no Revisar (Iris e estamparias, coluna
>   `origem_do_whatsapp`). Os leads do Site são empresas **sem** site (é o produto): o número
>   deles é sempre o do Google, e a planilha não guarda nada que separe um do outro.
> - Com o follow-up só para quem leu, não existe mais "follow-up sem leitura" para contar no
>   teto; o que conta é envio, convite e o reenvio do só-robô (os mesmos da trava de horário).
>
> **CORREÇÃO de 16/10/2026 (11:50): a Fase 2 está feita pela metade.** A Evolution foi conectada ao chip
> **27 99976-2786**, o MESMO em que o Hermes está pareado desde 09/10 (conta "Prumo"); eu havia comparado só com o
> número antigo (…0954) e anunciei "número separado" por engano. A parte técnica (gateway, adaptador, observador,
> recibos, monitor) funciona, mas **a separação entre prospecção e Hermes não existe**: restrição ou banimento deste
> número derruba os dois. O Hermes foi pareado de novo em 16/10 12:02 (estava "Logged out" desde 15/10 08:32). **Decisão do Rômulo no
> mesmo dia: não haverá segundo número**; o risco compartilhado fica coberto pelas travas de horário e de ritmo. A
> Fase 3 (Cloud API / e-mail como primeiro toque) segue como opção futura. O texto abaixo foi escrito antes da correção; onde diz "número do
> PRUMO" ou "Hermes só no pessoal", leia "o número da Evolution" e "ainda não separados".
>
> **Fase 2 feita em 16/10/2026** (número do PRUMO conectado; o ensaio do recibo de leitura passou):
> - **Gateway:** Evolution API **v2.3.7** em Docker na Mel (`deploy/dell/evolution/`), instância `prumo`
>   (Baileys), só leitura. Foi a escolha entre WA-AKG, WAHA Core e Evolution: a Evolution permite trocar
>   para a Cloud API oficial sem refazer a integração (Fase 3). A 2.4.x ficou de fora porque exige ativação
>   com e-mail e telefone do dono e manda heartbeats com o IP do servidor à fundação; a 2.3.7 não.
> - **Estrutura:** o Hermes continua só no número pessoal (modo conversa-comigo, canal dos avisos, sessão
>   única); o número do PRUMO é da Evolution. `evolution-adaptador.py` traduz o webhook para o formato da
>   bridge e uma segunda instância do `observador.py` fala com o n8n. Nada de contrato mudou.
> - **O que isso NÃO muda:** o primeiro contato continua sendo um toque seu, com as travas de horário e de
>   ritmo. Nenhum código envia mensagem pelo gateway. Detalhes e comandos: `deploy/dell/README.md`, seção
>   "Observador do número do PRUMO (Evolution API)".
> - **Descoberto no ensaio:** o recibo de leitura chega só com o `@lid` e o `keyId`, sem telefone; o adaptador
>   resolve pelo id da mensagem enviada (em memória, só de lead).
> - O número novo já tinha histórico (mais de 1000 conversas), então `inicioDoNumero` (16/10) é conservador:
>   a rampa 10/20/30 por dia vale mesmo assim.
>
> Fase 3 (Cloud API com opt-in, ou e-mail/formulário como primeiro toque) continua como decisão do Rômulo.

## O que aconteceu (medido)

| Dia | 1º contatos | Como saíram |
|---|---|---|
| 13/10 | 18 | três rajadas, 4 a 5 em menos de 1 min cada |
| 14/10 | 26 | rajadas parecidas, ao longo do dia |
| 15/10 | 25 | **25 em 25 minutos** (08h22–08h47), 10 a 50 s entre um e outro → bloqueio |

- Desde 08/10: 119 primeiros contatos, **23 responderam (19 %)**, 98 nem aparecem como lidos.
- A 1ª mensagem já sai sem link desde 05/10 (regime `duas_mensagens`). O link não é o problema.
- Tudo sai do **número pessoal**, o mesmo em que o Hermes está vinculado. Bloqueou um, parou o outro.

O que o WhatsApp mede (não publica os limites, mas o comportamento é conhecido): muitas
conversas novas com quem não tem o seu número salvo, em pouco tempo, com pouca resposta, e
quanto disso vira "bloquear" ou "denunciar". 25 desconhecidos em 25 minutos com 80 % sem
resposta é o perfil exato. Uma segunda restrição costuma ser mais longa; a terceira pode ser
banimento do número, e aí some o Hermes junto.

## O que este plano não faz

Não entra aqui o que existe para **enganar** o filtro: rodízio de chips, "aquecimento" de
número, texto embaralhado para cada mensagem parecer diferente, disparo pela API não
oficial (Baileys, Evolution, WAHA) a partir de um número comum. Funciona por umas semanas e
termina em banimento, e é contra os termos do WhatsApp. O sinal que o filtro mede é real:
gente que não conhece o PRUMO e não quer a mensagem. O plano abaixo baixa esse sinal em vez
de escondê-lo.

## Decisão 1 (a mais importante): tirar a prospecção do número pessoal

- **Número novo só do PRUMO**, no app **WhatsApp Business** (chip ou eSIM próprio), com o
  perfil completo: nome "PRUMO", logo, descrição de uma linha, site, horário, cidade. Quem
  recebe vê uma empresa, não um desconhecido: menos denúncia.
- O pessoal fica com amigos, família, clientes e o **Hermes**, sem risco de prospecção.
- O observador do Hermes (bridge com o remendo `patch_bridge_envios.py`) hoje lê o número
  pessoal. Para ler as respostas dos leads no número do PRUMO é preciso **uma segunda
  sessão vinculada** (aparelho conectado no número do PRUMO), só leitura, como hoje.
  Esse é o maior trabalho de código do plano (ver Fase 2).
- Leads que já estão em conversa no pessoal continuam lá; o número novo vale para
  primeiros contatos a partir da troca.

Enquanto o número novo não existe: **no pessoal, nenhum primeiro contato** nos próximos
dias (só responder quem já respondeu).

## Decisão 2: ritmo com trava no CRM (vale para qualquer número)

O "Enviar um por um" (`CrmFilaDeEnvio.vue`, `fila-de-envio.ts`) passa a ter uma **trava de
ritmo**, como a trava de horário de 14/10:

| Regra | Valor inicial | Por quê |
|---|---|---|
| Intervalo entre 1º contatos | **no mínimo 4 min** | hoje foram 10 a 50 s |
| Por hora | **no máximo 8** | sem rajada |
| Por dia (número novo) | semana 1: **10**; semana 2: **20**; depois **30** de teto | número novo começa sem histórico |
| Horário | o da trava de 14/10 (expediente) | já existe |
| Follow-up sem leitura | conta no teto do dia | 2ª mensagem para quem nem leu é a mais denunciada |
| Pausa | qualquer aviso/restrição do WhatsApp para tudo por 72 h | é a regra de parada do A/B do vídeo, agora para todo envio |

Os valores são conservadores e chutados com folga: o WhatsApp não publica limite. Ficam em
um lugar só (constantes em `fila-de-envio.ts` ou na config da Central) para ajustar sem
mexer em regra. A fila mostra "próximo envio às 10h14" em vez do botão, e a Hoje não
oferece link de primeiro contato antes da hora (mesmo mecanismo de `linksDePrimeiroContato`).

Contagem: os envios do dia vêm do retrato (`marcos.enviado`) mais os toques lembrados no
`localStorage`, o mesmo par que a fila já usa. Função PURA (`trava-de-ritmo.ts`), com teste
em tabela como a `trava-de-horario.ts`.

## Decisão 3: mandar para quem tem mais chance de querer

Menos mensagens, mais respostas = menos sinal de spam **e** mais venda.

- **Prioridade para WhatsApp publicado no site** da empresa (é o canal que ela escolheu).
  O "celular do Google não confirmado" (filtro de 14/10 dos caçadores do Iris e das
  estamparias) muitas vezes é o celular pessoal do dono: fica para depois do teto, nunca
  no começo do dia.
- **Follow-up só para quem leu.** Quem não leu em 3 dias não recebe o 05 · Acompanhamento;
  vai para "Perdido · sem leitura" (o observador já sabe quem leu).
- **Saída fácil na 1ª mensagem**: uma linha no fim, "se não fizer sentido, é só me dizer
  que eu não mando mais". Quem quer sair responde em vez de denunciar. Entra como texto
  novo do Balcão, medido como qualquer letra.

## Decisão 4 (opcional, para automatizar de verdade): API oficial só com permissão

O único envio automático que o WhatsApp aceita é a **WhatsApp Business Platform (Cloud
API)**: número verificado na Meta, mensagens que a empresa inicia só por **template
aprovado**, cobrança por mensagem (marketing no Brasil na casa de US$ 0,06; conferir a
tabela da Meta), começa com **250 contatos novos por dia** e sobe com a nota de qualidade,
que a API devolve por webhook (o app comum não diz nada antes de bloquear). A regra da Meta
exige **opt-in**: o contato precisa ter aceitado receber. Mandar template para número
tirado do Google Maps viola a política e derruba a nota rápido.

Então a automação vale para **depois** da permissão:

1. **Primeiro toque fora do WhatsApp** (o que pode ser automático sem antispam de mensageiro):
   e-mail do site da empresa (B2B, com remetente identificado e "não quero receber", base
   de legítimo interesse da LGPD) ou o formulário do próprio site, com o link "prefere
   conversar pelo WhatsApp? clique aqui". O clique abre conversa **iniciada pelo lead**.
2. **Conversa iniciada pelo lead** abre a janela de 24 h: dentro dela, 2ª mensagem,
   Raio-X e follow-up podem sair automáticos pela API sem template.
3. **Coexistência** (a Meta permite o mesmo número no app Business e na Cloud API):
   o Rômulo conversa à mão no app e a automação manda pelo mesmo número. Conferir se está
   disponível para o número do PRUMO antes de contar com isso.

Custo de implantar: número + verificação do negócio na Meta (há o MCP do WhatsApp Business
na sessão para conferir o perfil e os números), templates, nó do n8n para envio e webhook
de status/qualidade, e um caçador que também colete e-mail.

## Fases

| Fase | O quê | Quem | Tamanho |
|---|---|---|---|
| 0 (16/10) | Pessoal: zero 1º contato; Hermes volta sozinho quando o bloqueio cair. Conferir no celular se a restrição foi "24 h para conversas novas" ou algo maior. | Rômulo | minutos |
| 1 | Trava de ritmo no CRM (Decisão 2) + follow-up só para quem leu + prioridade do WhatsApp do site (Decisão 3) | código (CRM, Balcão, n8n 05) | 1 sessão |
| 2 | Número do PRUMO no WhatsApp Business, perfil completo; 2ª sessão do observador lendo esse número; `wa.me` da fila apontando para o app certo | Rômulo (chip) + código (bridge, observador) | 1–2 sessões |
| 3 | Só se as fases 1–2 não bastarem: e-mail como 1º toque + Cloud API com opt-in (Decisão 4) | Rômulo (Meta) + código | maior |

## Como saber se funcionou

- Nenhuma restrição em 4 semanas no número do PRUMO.
- Taxa de resposta do 1º contato **sobe** (hoje 19 % desde 08/10): menos envios, mais
  qualificados. Se cair abaixo de 15 % por duas semanas, o problema é a lista ou o texto,
  e aumentar o teto só piora.
- "Sem interesse" ou "pare" respondido em vez de silêncio: é o sinal de que a saída fácil
  está trocando denúncia por resposta.
