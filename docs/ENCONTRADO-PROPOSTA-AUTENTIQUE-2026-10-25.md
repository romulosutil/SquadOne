# Encontrado — proposta padrão e aceite pela Autentique

Rômulo autorizou o terceiro lote e confirmou que a prestadora será pessoa jurídica.
Ainda não há conta Autentique. O lote prepara o fluxo, o documento e o cadastro
privado; emissão real depende de conectar a conta e aprovar o padrão concreto uma
vez. Nenhuma assinatura, conta ou condição individual foi fabricada.

## Padrão comercial revisável

Preço e escopo vêm do catálogo do Encontrado: R$ 690 de implantação + R$ 39/mês,
com domínio, hospedagem e um ajuste por mês. Cobrança inicial somente após o cliente
ver o site funcionando no ar. Assinar a proposta não satisfaz esse gatilho.

A minuta é específica desta oferta, sem exemplos de outros serviços, campos soltos,
scripts ou recursos remotos. A paleta vem de `prumo/04-venda/proposta-modelo.html`.
Prazo de cinco dias úteis após materiais/aprovações, validade de quinze dias,
mensalidade no mês seguinte à entrega aprovada e aviso de trinta dias são sugestões
para a revisão única da operação, não decisões comerciais presumidas. A tela permite
ajustar prazo, validade e aviso antes da aprovação. Condições individuais continuam
exigindo decisão própria e não são substituídas pelo padrão.

Cadastro e revisão em **Mais → Proposta padrão e assinatura**,
`/mais#encontrado-proposta`. Razão social, CNPJ, representante e e-mail da prestadora
ficam no cadastro privado. A aprovação é vinculada ao hash do HTML, catálogo e
condições; mudar qualquer parte invalida a aprovação anterior. Confirmar a mesma
versão novamente não retroage nem avança seu corte de ativação.

Ao conectar a conta, uma conferência automática cria somente um documento fictício
em sandbox, sem dados da Prumo ou de clientes e sem disparar e-mail. Confere upload,
link e PDF original antes de liberar a aprovação do padrão. Esse teste não assina
documentos nem comprova aceite real.

## Caminho automático após ativar

1. Uma entrada natural, comprovada e posterior ao corte pede proposta/contratação.
   Pausa, recusa, tomada humana, compromisso, condição individual e ciclo assistido
   anterior conservam seus vetos. Permissão genérica para material não pede contrato.
2. O cliente fornece os campos rotulados que faltam: razão social, CNPJ, representante
   e e-mail. Cada campo conserva a referência da mensagem original. Não se usam
   notas humanas fictícias nem inferência de representação. CNPJ aceita o formato
   numérico e o alfanumérico; validar dígitos não comprova situação cadastral.
3. A proposta é um artefato privado imutável: versão, catálogo, condições, partes,
   referências e hash do HTML. O HTML enviado não contém conversa ou credencial.
4. A emissão reserva a tentativa antes da API. Usa somente o endpoint oficial e
   um signatário cliente, com link vinculado ao e-mail informado. Não chama
   `signDocument`, não assina pela Prumo nem pelo cliente e não contrata plano.
5. O ID remoto, signatário e PDF original são conferidos. O hash do original fica
   vinculado à proposta. O convite só sai após nova conferência de contexto,
   responsabilidade, validade, assinatura e bytes do original. Reserva de saída
   continua precedendo o transporte. Abrir o link não confirma aceite.
6. Consultas periódicas, com espaçamento de dez minutos por documento pendente,
   acompanham apenas as propostas geridas. Não há webhook público novo. Cada volta
   processa no máximo um documento; emissões conservam intervalo de dois minutos.
   Conversão do HTML e arquivo assinado ainda em preparação aguardam novas leituras.
7. Assinatura final da pessoa e versão vinculadas, original inalterado, sem recusa
   ou biometria pendente, confirma o aceite observado. O resumo da ficha e a leitura
   segura do Hermes distinguem esse marco do ciclo humano e do pagamento.

O acompanhamento da assinatura é leitura, não nova abordagem. O link só é reenviado
quando há novo pedido comprovado; agradecimento e texto “aceito” não produzem
assinatura. O próximo lote de cobrança continuará precisando da entrega vista.

## Duplicidade, versões e exceções

Criar documento não tem retry cego. Timeout anterior ao recibo bloqueia outra
criação; a referência única permite localizar o documento. Recuperação sem recibo
não comprova sozinha quais bytes foram enviados: o operador confere o original
privado e a proposta na ficha antes de liberar esse caso. Falha de download depois
de receber o ID conserva o vínculo e retenta somente a leitura.

Recusa, versão alterada, signatário divergente, perda de validade, dados mudados
após emissão e falha persistente recebem decisão específica. Um documento sandbox
nunca confirma aceite real. Cadastro/política alterados antes da reserva vetam a
emissão; tomada humana posterior pode coexistir com preparação já iniciada, mas
impede a entrega automática. Ativar assinatura conserva a identidade dos materiais
dos lotes anteriores e não reenvia material já entregue.

## Credencial e limite

O token é informado somente na tela privada da Central, guardado em arquivo 600
fora do Git, e nunca retorna ao navegador. Rotas exigem operador Tailscale permitido
e as guardas de origem da Central. Tokens não vão a storage, logs ou prompts.

Esta versão exige conta gratuita e limita a dez tentativas de emissão por mês de
São Paulo e por conta, com reserva global de franquia. O provedor também aplica sua
franquia, incluindo documentos criados fora desta automação. Conta em plano pago ou
limite atingido pede decisão antes de prosseguir; não amplia custo automaticamente.

## Fontes da integração

- [Criar documento, HTML e link vinculado](https://docs.autentique.com.br/api/mutations/criando-um-documento)
- [Conta e organização](https://docs.autentique.com.br/api/queries/fetch-current-user)
- [Consulta de documento e eventos de assinatura](https://docs.autentique.com.br/api/queries/resgatando-documentos)
- [Sandbox: não comprova assinatura real](https://docs.autentique.com.br/api/integration-basics/sandbox-testes)
- [Planos, franquia gratuita e limites de API](https://docs.autentique.com.br/api/api-pricing)
- [RFB: dígitos do CNPJ alfanumérico](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj/manual-dv-cnpj.pdf)

## Publicação e reversão

Comparar preimagens, preservar código/bundle/política e instalar somente este lote
após homologação Linux. O leitor Hermes instalado acompanha sua fonte versionada.
A política de atendimento e o corte da qualificação permanecem intactos. A nova
capacidade não é inserida por deploy sem cadastro e aprovação: somente o botão
humano de aprovação cria `proposta` com instante real, hash de política e do modelo.

Na reversão, pausar primeiro, esperar runtime ocioso e preservar propostas, PDFs,
reservas, capturas e recibos. Restaurar somente os arquivos do lote; a capacidade
de proposta precisa ser retirada antes de retornar ao validador antigo. Não apagar
evidência comercial nem reativar aquisição.

Homologação usa empresas fictícias, transporte e Autentique dublados. Nenhuma conta,
mensagem, documento real, assinatura ou cobrança é criada para testar. A conta real,
seus termos, dados da prestadora e aprovação do padrão ainda dependem de Rômulo;
uma entrada natural futura comprovará a operação com cliente.
