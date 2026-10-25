# SquadOne - visibilidade do modelo operacional

Entrega de 25/10/2026. O acesso **Como vender e operar** aparece no topo de Vendas e como seção própria em Mais/Configurações, no endereço `/mais?abrir=operacao#modelo-operacional`. O escritório permanece montado e seus quadros, personagens, câmera e navegação não foram substituídos.

## O que o operador encontra

- Resumo das seis definições gerais: rotina, catálogo, passagens, capacidade, indicadores e automação.
- Consulta por seções e fichas recolhíveis, sem uma nova tela de clientes ou configuração de campanha.
- Papel de cada área, com entrada, saída, responsabilidade, falha e forma de conferir.
- Indicadores calculados pelas regras canônicas sobre o CRM lido naquele momento; fonte incompleta/antiga/ausente não equivale a zero.
- Estado da frente consultado da fonte viva, sem botão de ativação. Se a fonte não responder, a situação é declarada não verificada.

## Comportamento e fronteiras

O componente lê somente `GET /api/operations/crm` e `GET /api/operations/crm/frente`, com prazo de rede, cancelamento ao desmontar e atualização ao retornar. A leitura pode usar a reconciliação derivada normal do servidor; não cria nota, qualificação, responsável, proposta, aceite ou pagamento. Nenhum texto da definição vira ferramenta, prompt ou ordem de envio.

Os JSON de `src/operations/modelo-operacional/` são definições versionadas e minimizadas, sem contatos, conversas ou clientes. Não são base comercial editável. O operador continua agindo pela ficha e pelas filas existentes.

## Aceite e verificação

1. Abrir Vendas, escolher Como vender e operar e verificar o destino interno.
2. Abrir a seção diretamente em Mais/Configurações e alternar catálogo, passagens, rotina, capacidade, indicadores, automação e áreas.
3. Conferir no desktop e no celular: rótulos legíveis, teclado, expansão e ausência de rolagem horizontal.
4. Simular fonte ausente/antiga/incompleta em teste: mostrar dado não verificado; nunca contar ausência como zero.
5. Voltar a Vendas e fechar o painel para o escritório. Não abrir WhatsApp nem acionar registros para verificar esta consulta.

Tipagem aprovada e 28 testes de acesso, normalização e navegação de Vendas passaram localmente, sem falhas ou skips. O build local passou com client ID público fictício, apenas para homologação; o `dist/` local não é artefato de produção e não deve ser publicado. A construção no Dell deve usar seu ambiente real, preservando as alterações anteriores. A verificação visual e publicação real são feitas na integração coordenada, preservando fontes anteriores do Dell. Não tratar este documento como prova de publicação antes desse registro.

## Compatibilidade das definições finais

Revisão de integração: os campos fora das listas também aparecem na consulta. O catálogo explica seus estados comerciais; capacidade mostra a confirmação qualitativa do operador e os critérios gerais para assumir entrega; automação distingue política versionada de estado vivo e inclui a reversão. As referências das definições e as versões de suas fontes ficam recolhíveis, como texto sem ação externa. As áreas mostram responsável, execução, limites, entradas/saídas, falhas e verificação.

O objetivo inicial declarado fica no topo: primeira venda nova com recebimento confirmado e, depois, R$ 10 mil de faturamento mensal. Isso não é resultado alcançado nem transforma receita existente em nova venda. Nesta revisão, 31 testes de acesso, leitura e navegação e quatro de indicadores passaram. Não foi gerado novo artefato de publicação.
