/** Observação derivada. Nunca confirma qualificação humana, compra ou aceite. */
export const VERSAO_QUALIFICACAO_ENCONTRADO = 'encontrado-qualificacao-materiais-local-v1'
export interface EvidenciaEncontrado { id:string; em:string; hash:string; trecho:string }
export interface QualificacaoEncontrado {
  necessidade?:EvidenciaEncontrado
  decisao?:EvidenciaEncontrado
  intencao?:{tipo:'avaliando'|'pesquisando';evidencia:EvidenciaEncontrado}
  materiais:Array<{tipo:'demo'|'raio-x';evidencia:EvidenciaEncontrado}>
}
export interface ObservacaoEncontrado { v:1; origem:'conversa-verificada'; em:string; qualificacao:QualificacaoEncontrado }
export const PERGUNTAS_ENCONTRADO = {
  necessidade:'O que você gostaria que o cliente conseguisse encontrar ou fazer no site da sua empresa?',
  intencao:'Você está avaliando um site para sua empresa ou só pesquisando por enquanto?',
  decisao:'Além de você, quem participa de aprovar o site e o conteúdo?',
  material:'Você gostaria de ver uma prévia de site da sua empresa ou um Raio-X da presença digital?',
  esclarecer:'Você pode me contar um pouco mais sobre o que precisa para o site da sua empresa?',
} as const
