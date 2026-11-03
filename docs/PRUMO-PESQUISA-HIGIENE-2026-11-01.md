# Pesquisa, higiene e semana comercial — 1/11/2026

## Correção vigente — escopo confirmado pelo Rômulo em 1/11, 16h13

Custo zero é exclusivo da pesquisa e do enriquecimento de leads. A IA e a
transcrição do Silmer foram restauradas em produção e DEV; nós, credenciais
referenciadas e conexões são iguais ao backup anterior à auditoria. Os dois
workflows estão ativos, com a versão restaurada publicada. O transformador
`custo_zero_silmer.py` agora preserva integralmente o workflow; a guarda geral
de publicação só trata os quatro workflows de pesquisa e seus subfluxos.
O capítulo de auditoria completa abaixo descreve o estado anterior a essa
correção, não uma restrição atual sobre atendimento ou transcrição.

Segunda, 2/11, mantém trabalho interno e pesquisa. De terça a sexta, o plano
passa a repetir disparar, conferir recibos e conversas, refinar o dia seguinte
e separar qualidade, perdas confirmadas e pendências. Meta: 60 primeiros
contatos únicos confirmados (15/dia) e três fechamentos dessa coorte (5%).
Fechamentos da carteira anterior têm indicador separado. Acompanhar a coorte
por 30 dias não altera retroativamente o resultado até sexta.

A capacidade depende da revisão das nove pendências atuais para o limite de
dez por rodada. Hoje há 37 elegíveis em Site/Encontrado; faltam 23 aprovados
para executar os 60 exclusivamente nessa oferta. Nenhum limite, recusa ou
critério foi reduzido para acomodar a meta. Última revisão de 30/10 registra
18 envios com recibo: dez silêncios, cinco robôs, duas recusas e um acesso,
sem interesse comercial classificado. Isso não sustenta previsão de 5% de
fechamento até sexta; o número permanece como meta ambiciosa.

## Política vigente: custo zero, após instrução do Rômulo

Esta atualização substitui qualquer possibilidade de ativação paga mencionada
no histórico abaixo. Não há orçamento autorizado para APIs: o teto é zero.
Apify foi removido do caminho executável, mesmo se houver token. A pesquisa
não lê chave nem consulta Google Places. O cliente JSON só aceita as fontes
gratuitas declaradas e a leitura local do CRM, sem autenticação comercial.
Os nós Places dos três caçadores foram substituídos por bloqueios explícitos,
preservados nas regenerações. Os três continuam pausados.

O catálogo `public-apis/public-apis`, enviado pelo Rômulo, foi consultado como
ponto de descoberta. A presença no catálogo não comprova gratuidade irrestrita;
foram conferidas as documentações das fontes escolhidas. A lista aprovada fica
em `config/fontes-pesquisa-gratuitas.json`: Minha Receita/BrasilAPI, IBGE e sites
institucionais. ViaCEP foi avaliado, sem integração desnecessária. LinkedIn fica
nos links públicos encontrados nas páginas, sem enriquecimento pago.

IBGE Localidades foi integrado por código de município do CNPJ e validado com
uma consulta real gratuita. Os nove cadastros existentes foram complementados
sem custo de API. Vinte e nove testes cobrem os bloqueios com credenciais
presentes, CNPJ, identidade, rede e resposta gzip limitada do IBGE.

As 42 consultas Places anteriores a essa instrução ficam no histórico. A auditoria
de faturamento encontrou R$ 0,00 líquido registrado em novembro, mas o painel
ainda não discrimina essas consultas e a fatura de novembro não está disponível.
O campo `websiteUri` é Place Details Enterprise: US$ 20/mil e franquia mensal
de 1.000, compartilhada na conta. As 42 equivalem a US$ 0,84 antes da franquia;
isso não é uma cobrança confirmada. Não afirmar retroativamente gratuidade final.
Não houve nova consulta Places durante a implantação de custo zero.

## Auditoria completa de APIs — 1/11, 14h18 de São Paulo

Foram lidos os 22 workflows da Mel e os 41 da VPS/Easypanel, incluindo subfluxos.
Dos 63, 18 permanecem ativos (15 Mel e 3 VPS), sem nós executáveis de provedores
pagos de pesquisa ou IA. Os 184 scripts nos fluxos ativos passaram na validação
de sintaxe. Nenhuma execução antiga estava rodando ou esperando nas duas instâncias.

- Classificação de respostas PRUMO: Gemini substituído pelas mesmas regras locais
  de `src/operations/classificacao-resposta.ts`; recusa, exclusão, robô, licença e
  interesse mantêm contratos distintos. O fluxo foi reativado e está operacional.
- Fonte com IA: pausada, com o endpoint de inferência bloqueado no grafo. A política
  operacional e o cliente de publicação impedem reativá-la inadvertidamente.
- Sombra OpenRouter/Jev: já estava desabilitada. Seu código de chamada foi removido.
- Silmer, produção e DEV: OpenAI e transcrição convertidos em bloqueios explícitos;
  o caminho de IA segue o handoff humano já existente, após as proteções de entrada
  e deduplicação. Recebimento, CRM, anexos de inbox e comandos humanos preservados.
  Os dois workflows continuam ativos e a versão publicada é a versão auditada.
- InfinitePay: checkout preservado; não cobra por consulta à API. Taxas sobre vendas
  continuam aplicáveis. Nenhuma cobrança ou pagamento de teste foi criado.

A guarda Python da Mel roda depois dos demais transformadores e também percorre
subfluxos. Ela não é ACL universal: edições diretas na UI/API administrativa podem
alterar a política. Na VPS foram corrigidos os dois grafos publicados; futuras
publicações devem preservar a transformação `custo_zero_silmer.py` e ser reauditadas.
Workflows antigos inativos da VPS não foram reativados nem tiveram histórico apagado.
Há um erro de sintaxe preexistente em um fluxo Food Helper inativo, fora desta mudança.

Dez testes novos de classificação, bloqueio e preservação de handoff passaram.
Backups privados completos estão em `~/.cache/mel-work/leads-20261101/auditoria-custos/`.
Evidência sem credenciais: `output/auditoria-custos-2026-11-01/verificacao.json`.
Tabela oficial: https://developers.google.com/maps/billing-and-pricing/pricing .

Rômulo aprovou preparar toda a operação no domingo, iniciar o trabalho em 2/11
e seguir até 6/11, com higiene da base e melhorias no n8n. A aprovação mantém
histórico e restrições; não é autorização para ignorar limites de contato.

## Publicado

- `pesquisa_leads.py`: pesquisa pública determinística, sem modelo ou transporte.
  Valida fonte completa e recente; usa Place ID, páginas institucionais e CNPJ.
  CNPJ exige associação por nome e município; divergência pede revisão.
- `filtro_leads.py`: gate de identidade, duplicidade, validade e contradição.
  É uma projeção privada reconstruível, não um novo CRM. Cache por versão de
  arquivo impede reler o JSON inteiro para cada lead. Falha fecha a seleção.
- `calendario_comercial.py` e `config/feriados-nacionais.json`: calendário comum
  de primeiros contatos. A Central também foi compilada com o calendário.
- n8n `PRUMO · Pesquisa e higiene de leads`, id `pwNiZI1rBGzMJ2dP`: ativo às
  07h10, 12h10 e 18h10 de segunda a sexta, em São Paulo. Pesquisa ampliada até
  6/11, até 60 empresas/dia; após a janela mantém higiene sem novos alvos.
  Webhook exige a credencial técnica existente; resposta contém só agregados.
- Caçadores Site, Íris e Estamparia: preservados pausados. As consultas Places
  têm timeout de 20s e duas tentativas. Nenhuma escrita ganha repetição.
  `pesquisa_fluxos.py`, integrado ao `n8n.py`, conserva essa regra ao regenerar.
- Plano de cada dia em `config/semana-comercial-2026-11-02.json`, copiado para
  a projeção operacional. Leitura interna publicada no painel existente.

## Resultado observado em 1/11, 13h04 de São Paulo

3.527 fichas: 1.786 com histórico protegido; 875 pedem revisão; 558 podem
continuar na avaliação existente; 308 Plus permanecem no canal humano. Os
875 casos incluem 40 sem evidência específica de site, 112 sem confirmação de
público infantil/TEA e 723 estamparias sem qualificação comercial confirmada.
Esses motivos já eram relevantes na curadoria: não são 875 exclusões novas.

Pesquisa inicial: 20 Sites, 20 Íris e cinco candidatos por produto novo. A
execução real do n8n pesquisou mais cinco, chegando ao teto de 60 empresas.
Foram feitas 42 consultas Places, 58 operações de leitura de página e 18
operações de consulta/complementação de CNPJ, incluindo falhas iniciais.
Há 34 sites com identidade confirmada, nove cadastros obtidos e cinco vínculos
de CNPJ confirmados. Os quatro restantes não foram associados automaticamente.
Não há custo real apurado nem evidência de aumento de conversão nesta amostra.

As 55 primeiras pesquisas favorecem candidatos já selecionados; não são uma
amostra representativa de toda a base. Testes adversariais sintéticos cobrem
homônimos, dados desconhecidos, duplicidade e contradições. Não declarar um
nicho vencedor nem qualidade global comprovada com esse piloto.

## Preservação e limites

As linhas das fontes Site, Prumo, Íris, Estamparia e Registros foram comparadas
ao backup e permaneceram idênticas. Os 147 registros do executor foram
preservados; configuração, recusas, conversas e compromissos não mudaram.
Não houve mensagem de teste. A fila observada às 13h04 tinha 59 escolhas, ainda
em atualização normal, e próximo expediente em 3/11 às 8h. Pesquisa e trabalho
interno começam em 2/11; o feriado não libera primeiro contato automático.

O adapter Apify está implementado e testado com dublês, mas **não é chamado
pelo job**. A revisão automática rejeitou a execução potencial de runs pagos
sem autorização específica de egress/cobrança. Foi adotada a alternativa sem
Apify; falta credencial e autorização específica para sua ativação. O adapter
limita a cinco empresas/dia e US$0,05 por run, com reserva durável: timeout na
criação não dispara outra cobrança automaticamente.

Google Trends tem comparações preparadas por mercado no plano, mas nenhum
indicador coletado. A API oficial está em alpha restrito. Não fingir cruzamento
numérico nem usar interesse agregado como intenção individual. INEP/CNES
permanecem candidatos a fontes setoriais, não integrações implantadas.

## Validação e recuperação

83 testes Python sobre identidade, CNPJ, isolamento de rede, calendário,
curadoria e executor; 45 testes TypeScript de calendário/primeiro contato.
Build completo de frontend e servidor publicado, fluxo real n8n concluído e
leitura da Central confirmada. O teste legado de aberturas isoladas tem duas
falhas por `OFERTAS_DO_EXECUTOR` ausente no namespace do próprio teste;
reproduzidas também no executor original, sem o delta, e não contadas como
aprovação.

A primeira tentativa de build chamou o binário Linux de esbuild com Node;
o instalador restaurou as fontes. A segunda usou o executável corretamente,
compilou e publicou. O instalador nunca remove os assets da versão em serviço
durante a compilação.

Backup privado na Mel: `~/.cache/mel-work/leads-20261101/`, incluindo exports
originais do n8n, fontes, snapshot CRM, SQLite e arquivos substituídos.
Publicação: `backup-publicacao-20261101T155535Z/`; complemento em pasta própria.
O retorno deve restaurar somente os arquivos desse delta, conferir processos
e preservar qualquer fato comercial posterior; não restaurar planilhas ou
SQLite antigos sobre trabalho novo. Pausar o workflow de pesquisa se necessário;
os caçadores já estão pausados e não devem ser reativados pela recuperação.

Evidências locais: `output/higienizacao-2026-11-01/`. Fontes e instruções de
execução estão versionáveis; segredos, resultados empresariais e backups ficam
fora do Git. Não foi criado commit nem substituída a árvore de trabalho existente.
