/** Modelo operacional de consulta. Não contém executor, cliente ou permissão de envio. */
export const ENDERECO_MODELO_OPERACIONAL = '/mais?abrir=operacao#modelo-operacional'
export const SECOES_MODELO = [
 {id:'rotina',nome:'Rotina diária',resumo:'Abra a operação, escolha a próxima obrigação e confira sua conclusão.'},
 {id:'catalogo',nome:'Catálogo operacional',resumo:'Escolha uma oferta pelo problema, com escopo, condições e aceite definidos.'},
 {id:'passagens',nome:'Regras de passagem',resumo:'Veja o que entra, quem assume e qual evidência permite avançar.'},
 {id:'capacidade',nome:'Atendimento e entrega',resumo:'Assuma compromissos por escopo, materiais, acessos e disponibilidade real.'},
 {id:'indicadores',nome:'Indicadores',resumo:'Confira o trabalho e os marcos demonstrados, sem presumir receita ou resultado.'},
 {id:'automacao',nome:'Liberação da automação',resumo:'Permissões, condições de parada e provas exigidas para mudar a autonomia.'},
 {id:'areas',nome:'Papel de cada área',resumo:'Prumo, SquadOne, Hermes, Telegram, n8n e WhatsApp no mesmo processo.'},
] as const
export type SecaoModelo = typeof SECOES_MODELO[number]['id']
export type DadoModelo = Record<string,unknown>
const objeto=(v:unknown):v is DadoModelo=>!!v&&typeof v==='object'&&!Array.isArray(v)
const lista=(v:unknown):DadoModelo[]=>Array.isArray(v)?v.filter(objeto):[]
export function documentosModelo(modulos:Record<string,unknown>):Record<string,DadoModelo>{
 return Object.fromEntries(Object.entries(modulos).filter(([,v])=>objeto(v)).map(([k,v])=>[k.split('/').at(-1)!.replace(/\.json$/,''),v as DadoModelo]))
}
const CAMPOS:Record<string,string>={estados:'Como interpretar a situação das ofertas','pode-orcar':'Pode orçar',em:'Confirmado em',texto:'Declaração do operador',efeito:'Efeito operacional',estadoAtual:'Política de autonomia — definição versionada',criterioGlobalLiberacao:'Critérios para assumir uma entrega',permitido:'Permitido neste contrato',proibido:'Não permitido',quemDecide:'Quem decide',criterio:'Critério',consequencia:'Consequência',publico:'Público',problema:'Problema atendido',familia:'Família',entregaveis:'Entregáveis',exclusoes:'Não inclui',dependencias:'Dependências',condicaoComercial:'Condição comercial',prazo:'Prazo',suporte:'Suporte',criterioAceite:'Critério de aceite',estado:'Estado',decisoesPendentes:'Decisões pendentes',entrada:'Entrada',entradas:'Entradas',responsavel:'Responsável',acao:'O que fazer',saida:'Saída verificável',saidas:'Saídas',excecoes:'Exceções',evidencia:'Evidência',limiteAutomacao:'Limite da automação',quando:'Quando',objetivo:'Objetivo',passos:'Passos',concluidoQuando:'Concluído quando',excecao:'Exceção',preRequisitos:'Pré-requisitos',comoEstimar:'Como estimar',liberarQuando:'Liberar quando',pararQuando:'Parar quando',aceite:'Aceite',pergunta:'Pergunta que responde',formula:'Como calcular',unidade:'Unidade',frequencia:'Frequência',interpretacao:'Como interpretar',semDados:'Sem dados',executa:'O que executa',naoExecuta:'O que não executa',falhas:'Falhas e tratamento',verificacao:'Como verificar',limites:'Limites',condicoes:'Condições',criterios:'Critérios',parada:'Condição de parada',reversao:'Reversão',permissao:'Permissão',autorizacao:'Autorização',provas:'Provas exigidas',bloqueios:'Bloqueios'}
const OMITIR=new Set(['id','nome','titulo','fonte','fontes','versao','atualizadoEm','sha256','arquivo'])
function rotulo(k:string){return CAMPOS[k]??k.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase())}
export function textosModelo(v:unknown):string[]{
 if(typeof v==='string')return v.trim()?[v.trim()]:[]
 if(typeof v==='number'||typeof v==='boolean')return [String(v)]
 if(Array.isArray(v))return v.flatMap(textosModelo)
 if(objeto(v))return Object.entries(v).filter(([k])=>!OMITIR.has(k)).flatMap(([k,x])=>textosModelo(x).map(t=>`${rotulo(k)}: ${t}`))
 return []
}
export function estadoDefinicaoModelo(v:unknown):string{return v==='pode-orcar'?'pode orçar':String(v).replaceAll('-',' ')}
export function camposModelo(item:DadoModelo){return Object.entries(item).filter(([k])=>!OMITIR.has(k)).map(([k,v])=>({rotulo:rotulo(k),textos:textosModelo(k==='estado'?estadoDefinicaoModelo(v):v)})).filter(c=>c.textos.length)}
export function itensModelo(secao:SecaoModelo,docs:Record<string,DadoModelo>):DadoModelo[]{
 if(secao==='areas')return Object.entries(docs).filter(([k])=>k.startsWith('area-')).map(([,v])=>v).sort((a,b)=>String(a.nome).localeCompare(String(b.nome),'pt-BR'))
 const d=docs[secao];if(!d)return []
 const chaves:Record<string,string[]>={catalogo:['ofertas'],passagens:['etapas'],rotina:['blocos','rituais'],capacidade:['cicloCompromisso','porFamilia'],indicadores:['indicadores'],automacao:['niveis','gates','criterios','etapas','regras','permissoes','matriz']}
 return (chaves[secao]??[]).flatMap(k=>lista(d[k]))
}
export function regrasModelo(secao:SecaoModelo,docs:Record<string,DadoModelo>):string[]{
 const d=docs[secao];return d?textosModelo(d.regrasGerais??d.politica??[]):[]
}
export function estadoFrenteModelo(v:unknown):string{
 if(!objeto(v)||typeof v.ativo!=='boolean')return 'Estado da frente não verificado'
 if(!v.ativo||v.estado==='pausado'||objeto(v.pausaAutomatica))return 'Prospecção pausada na fonte'
 if(typeof v.estado!=='string'||!v.estado.trim()||v.estado==='sem-sinal')return 'Estado da frente não verificado'
 if(['erro','falha'].includes(v.estado))return 'Frente requer conferência; este painel não altera permissões'
 return 'Frente ativa na fonte; este painel não altera permissões'
}

/** Campos de definição fora das listas, sem convertê-los em estado vivo ou permissão. */
export function destaquesModelo(secao:SecaoModelo,docs:Record<string,DadoModelo>){
 const d=docs[secao];if(!d)return []
 const chaves=secao==='automacao'?['estadoAtual','reversao']:secao==='capacidade'?['criterioGlobalLiberacao']:secao==='catalogo'?['estados']:[]
 return camposModelo(Object.fromEntries(chaves.filter(k=>k in d).map(k=>[k,d[k]])))
}
/** Referências são texto de consulta, nunca links executáveis ou nova fonte comercial. */
export function referenciasModelo(item:DadoModelo|undefined):string[]{
 if(!item)return []
 const valor=item.fontes??item.fonte
 const referencias=Array.isArray(valor)?valor:[valor]
 return referencias.flatMap(v=>objeto(v)?[Object.entries(v).filter(([k])=>['arquivo','versao'].includes(k)).map(([k,x])=>`${k==='arquivo'?'Arquivo':'Versão'}: ${String(x)}`).join(' · ')].filter(Boolean):textosModelo(v))
}
