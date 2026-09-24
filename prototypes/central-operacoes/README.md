# Central conectada — exploração visual

Protótipo estático e isolado da futura Central de Operações do SquadOne. Ele
não importa módulos da aplicação, não chama endpoints, não altera rotas e não
interfere no perfil remoto usado como agendador pessoal.

O acesso ao SquadOne publicado permanece explícito nas três direções:

- <https://aladdin-squadone-app.jicnzg.easypanel.host/>

## Abrir

Abra `index.html` diretamente ou sirva esta pasta com um servidor HTTP
estático. O seletor inferior alterna entre três direções completas:

1. **Comando** — densidade operacional e fila de atenção;
2. **Portfólio** — narrativa de produto e momentos de cada projeto;
3. **Fluxo** — relações entre PC, Dell, nuvem, projetos e evidências.

As três direções compartilham o sistema visual do Comando/SquadOne — marca S1,
paleta, tipografia, superfícies e estados. Elas divergem apenas na organização
da informação, não na identidade do produto.

Use `1`–`3` ou as setas para trocar de direção e `R` para remontar a tela.
Dentro de cada direção, navegue entre `Hoje`, `Projetos` e `Leituras`.

## Limites

- Todos os dados apresentados são exemplos baseados no inventário observado.
- Nenhuma credencial, arquivo de cliente ou conteúdo de conversa está incluído.
- Botões demonstrativos não executam serviços nem persistem alterações.
- O link do agendador abre a aplicação remota existente em nova aba.
