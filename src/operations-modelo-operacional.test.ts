import assert from 'node:assert/strict'
import {describe,it} from 'node:test'
import {ENDERECO_MODELO_OPERACIONAL,SECOES_MODELO,documentosModelo,itensModelo,camposModelo,textosModelo,estadoFrenteModelo,estadoDefinicaoModelo,destaquesModelo,referenciasModelo} from './operations/modelo-operacional.ts'

describe('modelo operacional: consulta sem efeitos comerciais',()=>{
 it('acesso interno abre só a seção operacional e preserva Vendas como origem de trabalho',()=>{
  const u=new URL(ENDERECO_MODELO_OPERACIONAL,'https://central.invalid');assert.equal(u.origin,'https://central.invalid');assert.equal(u.pathname,'/mais');assert.equal(u.searchParams.get('abrir'),'operacao');assert.equal(u.hash,'#modelo-operacional');assert.equal(new Set(SECOES_MODELO.map(s=>s.id)).size,7)
 })
 it('uma frente ausente não vira procedimento vazio certificado nem impede as outras',()=>{
  const docs=documentosModelo({'./modelo-operacional/rotina.json':{blocos:[{id:'abrir',nome:'Abrir'}]},'./modelo-operacional/ruim.json':null});assert.equal(itensModelo('rotina',docs).length,1);assert.deepEqual(itensModelo('automacao',docs),[]);assert.equal(docs.ruim,undefined)
 })
 it('catálogo e passagens mantêm as diferenças entre seus contratos',()=>{
  const docs={catalogo:{ofertas:[{id:'a',nome:'Oferta',condicaoComercial:'Valor a confirmar'}]},passagens:{etapas:[{id:'aceite',nome:'Aceite',evidencia:'Versão exata e prova real'}]}};assert.equal(itensModelo('catalogo',docs)[0].id,'a');assert.equal(itensModelo('passagens',docs)[0].evidencia,'Versão exata e prova real')
 })
 it('metadados técnicos não viram campos do operador, e arrays permanecem legíveis',()=>{
  const c=camposModelo({id:'x',nome:'Oferta',sha256:'hash',fonte:'arquivo',entregaveis:['Um','Dois'],prazo:'A confirmar'});assert.deepEqual(c,[{rotulo:'Entregáveis',textos:['Um','Dois']},{rotulo:'Prazo',textos:['A confirmar']}]);assert.deepEqual(textosModelo(null),[])
 })
 it('áreas são ordenadas por nome e não incluem outros documentos',()=>{
  const a=itensModelo('areas',{'area-whatsapp':{nome:'WhatsApp'},catalogo:{nome:'Catálogo'},'area-hermes':{nome:'Hermes'}});assert.deepEqual(a.map(x=>x.nome),['Hermes','WhatsApp'])
 })
 it('falha da leitura não é exibida como pausa ou liberação presumida',()=>{
  assert.equal(estadoFrenteModelo(null),'Estado da frente não verificado');assert.equal(estadoFrenteModelo({ativo:'false'}),'Estado da frente não verificado');assert.match(estadoFrenteModelo({ativo:false}),/pausada/);assert.match(estadoFrenteModelo({ativo:true,estado:'ocioso'}),/não altera permissões/)
 })
})
it('pausa automática e ausência de sinal prevalecem sobre configuração ativa',()=>{
 assert.match(estadoFrenteModelo({ativo:true,estado:'pausado'}),/pausada/)
 assert.match(estadoFrenteModelo({ativo:true,estado:'ocioso',pausaAutomatica:{motivo:'restricao'}}),/pausada/)
 assert.equal(estadoFrenteModelo({ativo:true,estado:'sem-sinal'}),'Estado da frente não verificado')
 assert.equal(estadoFrenteModelo({ativo:true}),'Estado da frente não verificado')
 assert.match(estadoFrenteModelo({ativo:true,estado:'falha'}),/requer conferência/)
})

it('campos finais de capacidade e automação ficam visíveis como política de consulta',()=>{
 const docs={capacidade:{criterioGlobalLiberacao:['Escopo definido','Executor confirmado']},automacao:{estadoAtual:'Prospecção pausada',reversao:['Preservar evidências'],niveis:[{nome:'Preparar',permitido:['Rascunho'],quemDecide:'Rômulo'}],gates:[{nome:'Autorização',criterio:'Decisão atual',consequencia:'Não enviar'}]}}
 assert.deepEqual(destaquesModelo('capacidade',docs)[0].textos,['Escopo definido','Executor confirmado'])
 assert.deepEqual(destaquesModelo('automacao',docs).map(c=>c.rotulo),['Política de autonomia — definição versionada','Reversão'])
 assert.deepEqual(itensModelo('automacao',docs).map(c=>c.nome),['Preparar','Autorização'])
 assert.deepEqual(camposModelo(docs.automacao.niveis[0]).map(c=>c.rotulo),['Permitido neste contrato','Quem decide'])
})
it('referências textuais mantêm a versão e não viram instrução ou link acionável',()=>{
 assert.deepEqual(referenciasModelo({fonte:'CRM atual; prioridade-comercial.ts'}),['CRM atual; prioridade-comercial.ts'])
 assert.deepEqual(referenciasModelo({fontes:[{id:'precos',arquivo:'precos.json',versao:'v1',sha256:'tecnico'}]}),['Arquivo: precos.json · Versão: v1'])
 assert.deepEqual(referenciasModelo(undefined),[])
})

it('situação comercial recebe acento no texto visível sem mudar o valor canônico',()=>{
 const oferta={id:'customizado',estado:'pode-orcar'}
 assert.equal(estadoDefinicaoModelo(oferta.estado),'pode orçar')
 assert.deepEqual(camposModelo(oferta),[{rotulo:'Estado',textos:['pode orçar']}])
 assert.equal(oferta.estado,'pode-orcar')
 assert.equal(estadoDefinicaoModelo('pronta'),'pronta')
})
