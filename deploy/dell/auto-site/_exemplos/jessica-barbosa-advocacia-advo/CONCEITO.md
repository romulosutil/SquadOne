# Jéssica Barbosa Advocacia: o exemplo aprovado (14/10/2026)

No ar: https://demo-jessica-barbosa-advocacia-advo.vercel.app (Raio-X em `/raio-x`).
Aprovado pelo Rômulo no mesmo dia: "acertou no design!". É o piso de qualidade da
esteira, não um molde: cada lead segue o shot do Dribbble dele (passo 1.6).

## Título

"Advogada trabalhista e previdenciária no Centro de Ribeirão Preto". O ofício nas
palavras de quem procura, mais o bairro e a cidade. O jeito dela vai no subtítulo,
com fato: trabalho e INSS vistos no mesmo atendimento, sala 1402 do Monte Líbano.

## O fato que distingue

Duas áreas no mesmo escritório (trabalho e previdência), com formação em Direito e
Economia e pós em perícia judicial (site do escritório, 2021). CNPJ aberto em
08/03/2023 (Receita Federal). Advocacia: sem avaliações na página (Provimento 205/2021).

## O shot do Dribbble

"Alden & Vale — Premium Law Firm Website Design" (Usman A.),
https://dribbble.com/shots/27806443. Busca: "law firm website", popular.

O que veio dele:

- **Hero em painel recuado**: metade de cor escura com o título em grotesca leve e
  grande, metade com a foto, cantos arredondados, margem de 16 px até a borda.
- **Botão claro sobre o escuro** (areia sobre vinho), o secundário em contorno.
- **Faixa de três pontos** logo abaixo do hero, numa cor de areia.
- **Lista de situações à esquerda e painel do caso à direita** (no shot, "I'm building
  something / thinking ahead / at a crossroads"): aqui, "Saí da empresa", "Me acidentei",
  "Vou ter bebê"... cada uma com o seu WhatsApp de mensagem pronta. Sem JS, todas à vista.
- **Passos em quatro painéis lado a lado**, um deles escuro e mais largo ("O que levar").
- **Fecho em duas metades**: foto de um lado, contato do outro.

O que NÃO veio: o rótulo em caixa alta espaçada com ponto acima de cada título, os
cards numerados 01-04, a foto de banco de imagem (seção "Cara de IA" do CLAUDE.md).

## Da marca real

- **Vinho**: o blazer bordô do ensaio de retratos que o escritório publicou no Google.
- **Areia e rosa claro**: o fundo das fotos do ensaio.
- **DM Sans** variável (300–600), subset latino, embutida: a mesma família do shot.

## Celular e desktop

CSS do celular primeiro (5,6 telas a 390 px; a faixa de três pontos sai no celular
porque repete o topo e o contato). O desktop foi desenhado a 1440 px a partir do shot:
painel do hero com 640 px de altura, grade de 2, 3 e 4 colunas, nada de coluna estreita.

## Movimento

- Entrada do título e da foto do hero: CSS puro, até 0,6 s (padrão da esteira).
- Troca do caso nas Áreas: o painel sobe 12 px ao aparecer, porque a escolha mudou
  o conteúdo. Nada mais anima.
