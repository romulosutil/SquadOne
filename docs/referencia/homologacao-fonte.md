# Fonte: operacao e homologacao

A implementacao publicada usa a fila duravel da Prumo, n8n no Dell e Luna. A unica base instalada na auditoria de 22/10/2026 e Vale Norte, uma empresa ficticia. Isso nao comprova implantacao em cliente.

## Antes da implantacao

O responsavel da Prumo e Romulo. Ele confirma empresa, publico, fichas, donos de regras, revisoes, perfis autorizados e aceite da versao. Validacao estrutural nao confirma a veracidade da regra. Validar toda base com `python3 ~/.local/share/claude-ops/prumo-fonte-cliente.py --base ARQUIVO --validar-base`. Em seguida homologar perguntas da equipe, limites, omissoes, conflitos e perfis. Nao colocar base real, codigos ou perguntas privadas no Git.

Cadastro: `--base ARQUIVO --perfil vendedor --dias 90`. A base e instalada atomicamente, com backup da anterior; codigo privado fica em arquivo 600. Entregar codigo somente a pessoa autorizada por canal separado. Revogacao: `--revogar ARQUIVO-DO-CODIGO`; impede novas perguntas, leituras daquele acesso e conclusao de consultas em voo. Nao revoga acessos de outras pessoas.

## Limites e incidentes

Sem memoria entre perguntas; os dados de cada caso precisam estar na propria pergunta. Nenhuma resposta executa compra, concede credito ou envia mensagem. Sem regra, a Fonte informa a ausencia; com conflito, encaminha a decisao com as duas fontes. A citacao tem dono/data da ficha e SHA256 da base completa (`base_versao`). Hash nao substitui aprovacao do conteudo.

Fila: 1 inferencia por vez, consulta a cada 30 s, lease de 150 s, ate 3 tentativas e expiracao de 10 min. Provedor: timeout de 60 s. Cotas persistentes: 100 perguntas/dia de SP no servico, 60 da demo, 50 por acesso; por IP ha limite por minuto. Essas cotas limitam volume, nao garantem valor monetario da fatura. Falhas tambem consomem inferencias: ate 300 tentativas no pior caso global. Reavaliar custo antes de ampliar uso.

O workflow da Fonte nao guarda payload em execucoes de sucesso, erro, manuais ou progresso. Seu errorWorkflow gera aviso com texto fixo e id numerico, sem mensagem do erro, pergunta, resposta ou lease. O aviso entra na fila operacional existente do Dell. Falha no proprio transporte do aviso ainda depende do monitor geral do Dell; nao prometer SLA com isso.

Primeiro diagnostico: conferir saude da API `/healthz`, `systemctl --user status luna-workflows prumo-metricas`, fila/erros no painel privado e settings do workflow `yNLwUy5bdEmC4Qss`. Nunca colar perguntas em alerta. Provedor volta: lease permite nova tentativa sem duplicar a conclusao. Uma resposta atrasada ou diferente da ja confirmada e recusada. Falha definitiva mostra erro honesto; o operador confirma a recuperacao com uma nova pergunta ficticia.

## Recuperar, atualizar e sair

Base: escolher backup privado, validar em todos os perfis, restaurar atomicamente e refazer perguntas de referencia antes de reabrir o acesso. API: backup consistente pelo SQLite backup API para arquivo privado; nao copiar apenas o `.sqlite3` aberto sem WAL. Restaurar primeiro em banco isolado; testar fila, lease e cotas. Nunca remover o volume `/data` no Easypanel. Retencao normal: perguntas/respostas 24 h; eventos deduplicados 7 dias; contagens 90 dias. Uma copia de seguranca privada tem sua propria retencao e deve ser incluida na retirada do cliente.

Saida do cliente: revogar todos os codigos do contrato, confirmar bloqueio, exportar base JSON aprovada para o responsavel por canal privado; remover base e backups conforme retencao acordada. Acesso ja entregue e pessoal: trocar equipe exige revogar o codigo antigo e criar outro.

## Reproduzir a homologacao

Testes isolados: `python3 deploy/dell/claude-ops/fonte_luna.test.py`, `fonte_homologacao.test.py`, `luna_workflows.test.py`, `workflow_confiabilidade.test.py`, `prumo-construtores.test.py`; na Prumo `python3 automacao-publica/test_app.py`. `npm test` antes de push.

Teste ao vivo, somente no Dell: `python3 scripts/fonte-homologar.py --real --saida CAMINHO-PRIVADO/resultado.json`. Usa perguntas ficticias pela mesma API/fila/workflow ativo da pagina; consome cota normal. Cria uma base ficticia isolada para testar conflito e perfil fixado no servidor; revoga seu acesso e remove sua base no finally. Nao grava codigos ou leases no resultado. O export do workflow remove credenciais.

## O que requer aceite

Romulo precisa aceitar explicitamente a versao e os resultados (C05). Para cliente real, o dono de cada regra/equipe aprova a base e a matriz de acesso (FT01), e repete a bateria com suas perguntas reais (FT02). Confirmar canal, horario, prazo de primeira resposta humana, escalonamento, fechamento, manutencao e retencao dos backups no contrato (C06/AC01/AC05). Os precos e condicoes comerciais existentes continuam os da Prumo. Este documento nao inventa SLA nem registra aceite. Enquanto houver requisito pendente, nenhuma entrega e Profissional.
