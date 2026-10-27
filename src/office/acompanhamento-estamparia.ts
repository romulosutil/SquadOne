import type { CrmLead } from '../operations/types'
export function acompanhamentosEstamparia(leads:readonly CrmLead[]) {
  return leads.filter(l=>l.produto==='estampa'&&l.atendimentoComercial?.id.startsWith('estampa-')).map(l=>{
    const a=l.atendimentoComercial!,humano=a.alvo!=='time'||a.tipo==='handoff'
    const esperaPessoa=/aguardar uma pessoa/i.test(a.texto||a.motivo)
    return {id:l.id,empresa:l.empresa,acao:a.texto||a.motivo||a.titulo,
      responsavel:humano?'Rômulo':a.estado==='restrito'?'Carla · contato suspenso':a.estado==='responder'?'Carla · resposta na fila':esperaPessoa?'Carla · aguarda uma pessoa':['enviada','aguardando-cliente'].includes(a.estado)?'Carla · aguarda o cliente':'Carla · acompanhamento',
      humano,identidade:a.identidade,ordem:humano?0:a.estado==='responder'?1:2}
  }).sort((a,b)=>a.ordem-b.ordem||a.empresa.localeCompare(b.empresa,'pt-BR'))
}
