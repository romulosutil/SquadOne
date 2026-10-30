# Pilotos dos produtos novos (30/10/2026)

Decisão do Rômulo em 30/10/2026: procurar clientes **piloto** para quatro produtos em incubação (PDV, SGP, Fiscal/TaxShield
e Dieta). O congelamento do PM de 28/10 ("nada de linha ou nicho novo até o 1º pagamento", `docs/PRUMO-DECISOES-PM-2026-10-28.md`)
fica levantado **só para descoberta e piloto declarado como teste** destes quatro. O registro da decisão está no repo `prumo`,
`00-contexto/decisoes.md` (entrada de 30/10/2026). Revisão em **06/11/2026**.

O 1º pagamento até 08/11/2026 continua vindo **só do Site** (Bruno Gouveia e as permissões quentes). Nada aqui tira tempo dos
blocos 1 e 2 nem muda a fila de venda. Os alvos com fonte pública estão em [`pilotos-alvos.md`](pilotos-alvos.md).

## O que não muda

- **WhatsApp do PRUMO fora da prospecção dos pilotos.** As travas seguem iguais: teto de 15 primeiros contatos por dia,
  2 por hora, 30 min entre envios e dez pendentes por rodada, seg–sex 8h–17h30 (`REGRAS_DO_RITMO`). Nenhum primeiro contato
  de piloto sai desse número. Os canais são visita presencial, ligação à secretaria, e-mail, LinkedIn, Instagram e indicação.
  Se a pessoa escrever por conta própria no WhatsApp do PRUMO, responde-se normalmente; a primeira mensagem nunca sai dele.
- **Continua proibido:** preço público, "pronto", selo Profissional, proposta, "cliente fundador", desconto, caçador no n8n,
  linha nova no funil de Vendas e tela nova. Os produtos continuam em incubação em `prumo/06-qualidade/` e fora do site.
- **Piloto é teste, e se diz assim.** "Versão de teste", "estamos testando com cinco lojas", "queremos ouvir antes de construir".
  Não é desconto nem favor: é a condição de uma versão que ainda não cobra.
- **Sem código para os pilotos.** O que se mostra é o que já existe (seção "O que se pode mostrar hoje" de cada produto).
  A Dieta não tem código e não ganha código antes de a H1 passar.

## Limite de esforço: bloco 3

**90 minutos por dia útil, das 15h30 às 17h00**, depois do bloco 2 (conversar, 14h00–15h30). Bloco 1 (fechar, 09h00–10h30) e
bloco 2 continuam sendo do Site. Acabou o bloco, para; o que sobrou vai para o dia seguinte. Se um lead de Site pedir algo
durante o bloco 3, o Site vem primeiro.

Divisão sugerida da semana (ajuste livre, mantendo os 90 min):

| Dia | Bloco 3 (15h30–17h00) |
|---|---|
| Segunda | PDV: visita a uma rua comercial (a primeira tarde usa a lista C de [`pilotos-alvos.md`](pilotos-alvos.md)) |
| Terça | SGP: ligações às secretarias (5 a 8 colégios) |
| Quarta | Fiscal: e-mails e LinkedIn aos escritórios contábeis; sessões marcadas |
| Quinta | PDV: volta às lojas instaladas (D+3, D+7, D+10) e novas visitas |
| Sexta | Dieta (só na janela de 48 h da H1) ou SGP/Fiscal; preencher a tabela de acompanhamento |

## PDV (Prisma PDV, app Android)

**Quem é o piloto.** Comércio de balcão de bairro, independente, com 1 a 3 pessoas no caixa: mercearia, padaria, banca,
hortifruti, pet shop, papelaria. De preferência quem hoje anota no caderno, na calculadora ou numa maquininha sem controle.
Rede e supermercado ficam de fora.

**Meta do teste.** Instalar o app em **5 lojas**, piloto grátis de **14 dias** como **versão de teste**; no **D+10**, a
pergunta de preço (R$ 34,90, plano Negócio). Cobrança só quando existir cobrança real.

**Onde achar os 10 primeiros.** Visita presencial numa rua comercial só, a pé, dentro do bloco 3 (15h30–17h00), fora do pico
do café e do almoço. A primeira tarde está montada na lista C de [`pilotos-alvos.md`](pilotos-alvos.md) (Guarapari, Muquiçaba e Praia do
Morro, com o método do Google Maps). Indicação de quem instalou vale mais que a próxima porta: no D+7, pergunte "conhece outra
loja aqui perto que sofre com o caixa?".

**O que se pode mostrar hoje, sem mentir** (`prisma pdv app/README.md`, `docs/arquitetura.md`, `docs/produto-planos-e-cobranca.md`):

| É real | É simulado ou falta |
|---|---|
| Frente de caixa no celular Android, APK de teste 0.1.3 (`builds/`), instalado direto, fora da Play Store | Cobrança: `MockBillingProvider`; o cartão do cadastro é **de teste** (use `4242 4242 4242 4242`, nunca o cartão do lojista) |
| Leitura do código de barras pela câmera, cadastro de produto bipando, venda em dinheiro, cartão (registro manual) e Pix por chave | Pix com confirmação, Tap no celular, InfinitePay e Mercado Pago: simulados ("Simular pagamento recebido") |
| Funciona sem internet; não limita vendas; resumo do dia | **Os dados ficam só no aparelho** (AsyncStorage): a API não está publicada, não há backup. Desinstalar ou "Zerar dados do app" apaga tudo |
| Diagnóstico da versão de teste (Ajustes) copia os eventos para conferir o uso | **Não emite NFC-e.** Quem precisa emitir nota segue com o emissor de hoje; o PDV serve de controle de caixa ao lado |

Diga isso antes de instalar, em uma frase: *"É uma versão de teste: fica tudo só neste celular, não cobra nada e não emite
nota. Se servir, a gente conversa; se não servir, o senhor apaga."* As ferramentas de teste aparecem no APK (relógio de teste,
"Simular bip"): mostre quais não tocar. No D+7 o app simula a primeira cobrança com o cartão de teste; nada é cobrado.

**Perguntas de descoberta (SPICED / SPIN).**
- *Situação:* "Como o senhor fecha o caixa no fim do dia hoje?" · "Quantas pessoas ficam no balcão?" · "Como emite nota hoje?"
- *Problema / dor:* "O que dá mais trabalho no caixa?" · "Já faltou dinheiro no fechamento sem saber por quê?"
- *Impacto:* "Quanto tempo leva para fechar o caixa?" · "Quando falta, quanto costuma ser?" (só o que ele disser; nada de estimar)
- *Evento crítico:* "Tem alguma mudança chegando (funcionário novo, maquininha nova, contador cobrando nota)?"
- *Decisão:* "Quem decide trocar a forma de controlar o caixa: o senhor ou mais alguém?"
- *Necessidade (SPIN):* "Se o celular mostrasse o total do dia e o que mais vendeu, o que o senhor faria com isso?"

**Abordagem na porta (30 segundos).** *"Boa tarde, aqui é o Rômulo, do PRUMO. A gente está testando um caixa que roda no
celular, lê o código de barras pela câmera e funciona sem internet. Estou procurando cinco lojas do bairro para usar 14 dias,
de graça, como teste, e me dizer o que falta. Como o senhor controla o caixa hoje?"* Uma pergunta, sem preço, sem link. Se
houver fila, volte depois; não instale com cliente esperando.

**Acompanhamento.** D+0 instala e cadastra 10 produtos junto com ele. D+3 visita rápida (está usando? travou em quê?). D+7
pergunta de indicação. **D+10 a pergunta de preço**, presencial: *"Se fosse R$ 34,90 por mês, no plano Negócio, o senhor
continuaria usando?"* Anote a resposta literal. D+14 fim do teste: ou apaga, ou segue em teste até existir cobrança real.

**Sucesso (critério proposto, confirmar em 06/11).** 5 lojas instaladas; pelo menos 3 ainda registrando vendas no D+10;
pelo menos 2 dizem "sim" ou "sim, se…" à pergunta de preço.

**Encerrar o teste (kill criteria, proposta).** Menos de 2 das 5 lojas usando no D+7; ou nenhuma aceita o preço no D+10; ou
3 ou mais dizem que sem nota (NFC-e) não serve, sinal de que a nota vem antes do piloto; ou 10 visitas sem nenhuma instalação.
Qualquer perda de dados de uma loja suspende as instalações novas até a troca para SQLite.

## SGP Escolar

**Quem é o piloto.** Colégio particular com Fundamental II e Ensino Médio, **200 a 800 alunos**, decisão local (não unidade
de rede nacional). Quem conversa: coordenação pedagógica; quem decide: direção. A escolha do sistema de 2027 acontece entre
**novembro e janeiro**: a janela é agora.

**Onde achar os 10 primeiros.** Lista A de [`pilotos-alvos.md`](pilotos-alvos.md) (Guarapari primeiro, depois Vila Velha,
Vitória, Serra e Cariacica, com a matrícula do Censo pelo QEdu). Canal: **ligação à secretaria** para marcar com a coordenação;
e-mail institucional como segundo passo; indicação de uma coordenadora para outra.

**O que se pode mostrar hoje, sem mentir** (`sgp/index.html`, `sgp/screens/fase-1` a `fase-4`):

| É real | É simulado ou falta |
|---|---|
| Protótipo navegável de alta fidelidade das quatro fases: chamada, conteúdo de aula, conformidade de diários; notas, boletim, recuperação, ata de conselho; planos de aula, BNCC, prontuário; alerta precoce e painel da diretoria | **Sem backend**: dados fictícios (`mock-data.js`), nada é salvo fora do navegador, sem login real |
| Whitelabel: a mesma tela com a marca da escola | Integrações (ERP da secretaria, Educacenso), nome comercial, preço, prazo e quem dá suporte: não existem |

**Formato do piloto.** **Duas sessões de 40 minutos** com a coordenação. Na 1ª, o protótipo e as perguntas. Na 2ª, o
protótipo diante dos **modelos reais da escola, anonimizados**: diário e ata de conselho **em branco ou com nomes tarjados**.
Nunca receber, fotografar nem levar documento com nome, nota ou dado de aluno (menor de idade, LGPD).

**Perguntas de descoberta (SPICED / SPIN).**
- *Situação:* "Que sistema vocês usam hoje para diário e notas?" · "Até quando vai o contrato?"
- *Problema:* "Onde o diário atrasa ou fica incompleto?" · "Como é montar a ata do conselho de classe?"
- *Impacto:* "Quantas horas a coordenação gasta por bimestre cobrando diário?" · "Já houve problema com diário na fiscalização?"
- *Evento crítico:* "Quando a escola decide o sistema de 2027?" · "O que faria vocês trocarem?"
- *Decisão:* "Quem participa da escolha: direção, mantenedora, TI?"
- *Necessidade (SPIN):* "Se o painel mostrasse no meio do bimestre quem está em risco, o que a coordenação faria diferente?"

**Ligação à secretaria (roteiro de 30 segundos).** *"Bom dia, aqui é o Rômulo, do PRUMO. Estou conversando com coordenações
de colégios do Fundamental II e do Médio sobre como fica o diário de classe e a ata de conselho no dia a dia. Não é venda:
quero mostrar um protótipo em 40 minutos e ouvir a coordenação. Com quem eu falo sobre isso, e qual é o melhor horário?"*
Se pedirem e-mail, mande três linhas com a mesma pergunta, sem anexo, sem link e sem preço.

**Sucesso (critério proposto).** 3 coordenações fazem a 1ª sessão; 2 aceitam a 2ª com os modelos anonimizados; 1 pede para
continuar com a direção na escolha de 2027, como piloto declarado de teste.

**Encerrar o teste (kill criteria, proposta).** 15 colégios contatados sem nenhuma 1ª sessão marcada até 06/11; ou nenhuma
coordenação aceita a 2ª sessão; ou as escolas ouvidas dizem que o diário e a ata já estão resolvidos no sistema atual (sem dor);
ou a decisão de 2027 já foi tomada na maioria delas (fica para a janela de 2028).

## Fiscal (TaxShield, IBS e CBS)

**Quem é o piloto.** O **escritório contábil médio que atende distribuidores e atacadistas** (Lucro Real ou Presumido,
incentivos como o COMPETE-ES). Segundo piloto: **uma software house de ERP**. O objetivo é apresentar o produto e conversar
sobre como ele evolui, não vender.

**Onde achar os 10 primeiros.** Lista B de [`pilotos-alvos.md`](pilotos-alvos.md) (Grande Vitória, com o trecho do site que
mostra o foco). Canais: e-mail institucional e LinkedIn do sócio ou do responsável fiscal; indicação de um contador para outro.
A software house ainda não foi levantada (ver lacunas em `pilotos-alvos.md`).

**O que se pode mostrar hoje, sem mentir** (`taxshield/PRODUCT.md`, `JORNADAS.md`, `prototype/`):

| É real | É simulado ou falta |
|---|---|
| Protótipo navegável feito como **mesa de teste de 20 minutos**: Rejeições (J1), Saneador de cadastro (J2), Caixa com *split payment* (J3), console da Pre-flight API (J4) e Trilha de aceites | Leitura de XML e de XLSX simulada; **não há motor de regras**, base normativa versionada, API, persistência nem login |
| **6 casos de regra** com regras reais (NT 2025.002, IT 2025.002 v1.70, LC 214/2025): parafuso, arroz, luva, cabo, chapa e óleo | Empresa fictícia (Atlas Atacado Ltda); nenhum cliente, métrica, preço ou benchmark |
| Fato e hipótese separados; o humano assina o aceite | **Não emite nota**, não transmite, não grava no ERP, não é parecer |

Antes de cada sessão, confira se alguma nota técnica nova mudou um dos 6 casos; regra desatualizada vira hipótese na fala.

**Formato do piloto.** **Sessão de 20 minutos por vídeo**, com os 6 casos. **Nunca receber XML real**, planilha de cadastro
real nem dado de cliente do escritório; se oferecerem, recuse e siga com os casos do protótipo.

**Perguntas de descoberta (SPICED / SPIN).**
- *Situação:* "Quantos clientes atacadistas ou distribuidores o escritório atende?" · "Quem cuida das rejeições hoje: o escritório ou o cliente?"
- *Problema:* "Qual rejeição mais toma tempo desde que o IBS e a CBS entraram na nota?" · "Como vocês saneiam o cadastro de NCM?"
- *Impacto:* "Quanto tempo leva uma rejeição dessas, do aviso à nota autorizada?" · "Já parou caminhão de cliente por nota?"
- *Evento crítico:* "O que muda para vocês em 2027?" · "Algum cliente já cobrou o efeito do *split payment* no caixa?"
- *Decisão:* "Uma ferramenta assim seria escolha do escritório ou do cliente? Quem decide no escritório?"
- *Necessidade (SPIN):* "Se a rejeição viesse traduzida, com a regra citada e o aceite registrado, o que mudaria no fechamento do mês?"

**Primeira mensagem (e-mail ou LinkedIn).** *"Olá, aqui é o Rômulo, do PRUMO. Estou testando um protótipo que traduz
rejeições de NF-e do IBS e da CBS (par CST × cClassTrib, NCM, alíquota de 2026) e quero ouvir escritórios que atendem
atacadistas antes de construir o resto. Topa 20 minutos por vídeo, com seis casos de exemplo, para me dizer onde ele erra?"*
Uma pergunta, sem preço, sem link, sem anexo.

**Sucesso (critério proposto).** 3 sessões feitas até 06/11; 2 escritórios dizem que usariam com clientes ou pedem uma 2ª
conversa; 1 conversa com software house marcada.

**Encerrar o teste (kill criteria, proposta).** 10 escritórios abordados sem nenhuma sessão; ou as sessões mostram que a dor
não está nas rejeições (o ERP do cliente já resolve, ou a rejeição é rara); ou nenhum escritório aceita que a decisão final
fique com o contribuinte (o risco de responder por regra errada mata o produto). Lembrete: a Prumo não faz contabilidade do
cliente; nenhuma fala promete "conformidade".

## Dieta (Pep Diet), só a hipótese H1

**Hipótese H1.** Nutricionista que atende pacientes em uso de GLP-1 (semaglutida, tirzepatida) quer uma ferramenta para
acompanhar a proteína e as refeições do paciente conforme a fase da dose (modelo B2B2C: a nutricionista indica ao paciente).
É a única hipótese testada; as outras (consumidor final, telemedicina, plano de saúde) ficam fora.

**O que se pode mostrar hoje.** **Nada de produto.** Existe só texto de ideia (`pep diet/pepdiet.md`) e um PRD
(`prd_e_backlog_do_produto_companion_app_glp_1.md`). Não se mostra tela, não se promete app. **Zero código antes de a H1 passar.**

**Teste de 48 horas.** Cerca de **20 mensagens no Instagram** a nutricionistas que publicam sobre GLP-1 (busca por "nutricionista
GLP-1", "nutri Mounjaro", "nutricionista Ozempic"; o Instagram não depende de região). Mensagem enviada pela conta do PRUMO ou do
Rômulo, espaçada, dentro do bloco 3.

**Primeira mensagem (Instagram).** *"Oi, aqui é o Rômulo, do PRUMO. Vi que você acompanha pacientes em GLP-1. Estou estudando
se faz sentido uma ferramenta para a nutricionista acompanhar a proteína do paciente conforme a fase da dose, e ainda não construí
nada. Hoje, como você acompanha o que eles comem entre as consultas?"*

**Perguntas de descoberta (se responderem).** Situação: quantos pacientes em GLP-1 e como acompanha entre consultas · Problema:
o que mais dá errado (proteína baixa, náusea, abandono) · Impacto: quantos interrompem o tratamento ou a consulta · Decisão:
pagaria ela, o paciente ou a clínica · Necessidade: o que ela precisaria ver para indicar a um paciente.

**Riscos regulatórios a registrar (antes de qualquer desenho).** Modelar a concentração do remédio e ajustar metas por dose pode
ser enquadrado como **software como dispositivo médico pela Anvisa**; prescrição dietética é atribuição do nutricionista (**CFN**);
orientação sobre dose de medicamento é ato médico (**CFM**); dados de saúde são **dados sensíveis (LGPD, art. 11)**. No teste
não se coleta dado de paciente nenhum: a conversa é com a profissional, sobre o trabalho dela.

**Passa (critério proposto).** Em 48 h, pelo menos 5 respostas de 20 e pelo menos 2 aceitam uma conversa de 15 min; e pelo menos
1 diz que indicaria ou pagaria. Só então se discute desenho, com um responsável de saúde no time.

**Encerrar (kill criteria).** Menos de 5 respostas, ou nenhuma aceita conversa, ou as que respondem dizem que já usam algo que
resolve: a Pep Diet volta para a gaveta e o registro fica em `prumo/00-contexto/decisoes.md` na revisão de 06/11.

## Tabela de acompanhamento

Preencha à mão, uma linha por toque (visita, ligação, e-mail, mensagem, sessão). **Nome** é o do negócio ou da instituição;
sem telefone pessoal, CPF ou dado de aluno. **Sinal forte** é o que a pessoa disse ou fez de concreto (instalou, marcou a 2ª
sessão, disse "pagaria", indicou alguém), com as palavras dela.

| Data | Produto | Nome | Canal | Resultado | Sinal forte | Próximo passo |
|---|---|---|---|---|---|---|
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |
| | | | | | | |

Valores sugeridos: **Produto** PDV · SGP · Fiscal · Dieta. **Canal** visita · ligação · e-mail · LinkedIn · Instagram ·
indicação · sessão. **Resultado** sem resposta · recusou · conversou · instalou · sessão marcada · sessão feita · encerrado.

## Suposições a confirmar

- **Região das visitas.** Os textos do PRUMO dizem "Espírito Santo como base" (`prumo/00-contexto/negocio.md`); a empresa está
  registrada em Guarapari/ES (`prumo/00-contexto/pendencias.md`), o site dizia "Base em Guarapari" e o piloto da CDL é com a CDL
  Guarapari. **Que o Rômulo visita lojas em Guarapari é suposição a validar**; Guarapari faz parte da Região Metropolitana da
  Grande Vitória, então colégios e escritórios incluem Vila Velha, Vitória, Serra e Cariacica.
- **Critérios de sucesso e de encerramento** marcados "proposta" são deste documento; os números firmes (5 lojas, 14 dias,
  D+10, R$ 34,90 Negócio, 2 sessões de 40 min, 200–800 alunos, 20 min com 6 casos, ~20 mensagens em 48 h, bloco 3) vêm da
  decisão de 30/10. Confirmar ou ajustar na revisão de 06/11.
