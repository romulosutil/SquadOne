# Arquitetura

## Aplicação atual

- Frontend Vue em `src/`, com o escritório visual em `src/office/` e
  `src/components/GameMap.vue`.
- Servidor Express em `server.ts` e módulos de domínio em `server/`.
- Dados locais e seeds em `data/` e `seed/`.
- Arte do escritório em `public/sprites/`.

## Protótipos

Protótipos em `prototypes/` são documentos executáveis e autocontidos em HTML,
CSS e JavaScript. Eles não importam módulos da aplicação, não usam endpoints e
não devem carregar segredos, métricas ou estados operacionais reais.

O protótipo `prototypes/central-operacoes/` explora a futura superfície de
operação sem implementar infraestrutura, túneis, autenticação ou integrações.
