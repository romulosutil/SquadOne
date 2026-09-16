# Central de Operações — protótipo visual

Protótipo estático e isolado da futura Central de Operações do SquadOne. Não
altera a aplicação produtiva, não chama serviços e não contém integrações reais.

## Abrir

Abra `index.html` diretamente no navegador ou sirva esta pasta com qualquer
servidor HTTP estático. A tela inclui cinco cenários demonstrativos:

- tudo saudável;
- serviço indisponível;
- agenda vazia;
- Google não conectado;
- nenhum projeto configurado.

O painel lateral de projeto e os botões de ferramentas são interativos, mas as
ações terminam em mensagens de demonstração.

Projetos exigem apenas `Nome` e `Caminho ou link`. Associação a squad fica fora
do fluxo principal e poderá ser acrescentada futuramente como dado opcional.

O bloco `Seu escritório` usa uma prévia incorporada do SquadOne publicado. A
ação `Abrir janela` mostra a aplicação existente em uma janela ampla sobre a
Central, com alternativa para abrir em nova aba. Nenhum fluxo do SquadOne é
reimplementado na Central.

## Direção visual

O protótipo usa a mesma linguagem neo-brutalista do SquadOne publicado: amarelo
no cabeçalho, coral na navegação, verde nas confirmações, superfícies creme,
bordas pretas espessas e sombras rígidas. A área `Agora` reaproveita o azul
escuro do mapa do escritório para concentrar a atenção.

A Central é uma camada inicial de uma página, aberta antes da aplicação atual.
Ela resume o que exige atenção, oferece atalhos locais e mantém uma ação
principal clara: `Entrar no SquadOne`. Esse acesso leva ao produto existente,
onde continuam a Mochila de Quests, as salas, o escritório, os agentes e a
Command Bar. Não são propostas novas rotas nem um segundo sistema de navegação.

A área `Agora` continua dominante; agenda, projetos e serviços se organizam
pela proximidade da próxima decisão. O seletor de cenários existe apenas para
avaliar os estados visuais do protótipo.
