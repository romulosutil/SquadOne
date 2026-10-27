/** Leitura do trabalho comercial existente; não agenda nem autoriza ações. */
export interface TrabalhoDoTime {
  ativo: boolean
  estado: string
  atualizadoEm: string | null
  detalhe?: string
  proximoEnvioEm?: string | null
  rodada?: { bloqueado: boolean; motivo: string } | null
  fila: readonly { id: string; empresa: string; estado: string; produto?: string }[]
}

export interface ProximoPassoDoTime {
  titulo: string
  responsavel: string
  acao: string
  quando: string
  depois: string
  tom: 'neutro' | 'atencao'
  condicao?: string
  cliente?: { id: string; empresa: string }
}

export function proximoPassoDoTime(frente: TrabalhoDoTime | null, erro = '', agora = Date.now()): ProximoPassoDoTime {
  const base = { responsavel: 'Time comercial', depois: 'Quando houver resposta do cliente, você conduz a conversa.', tom: 'neutro' as const }
  if (!frente && !erro) return { ...base, titulo: 'Conferindo o trabalho do time', acao: 'Consultar o andamento na integração.', quando: 'Aguardando a primeira leitura.', depois: 'O próximo passo aparece após a consulta.' }
  const atualizado = Date.parse(frente?.atualizadoEm ?? '')
  if (erro || !frente || frente.estado === 'sem-sinal' || !Number.isFinite(atualizado) || agora - atualizado > 10 * 60_000) {
    return { ...base, titulo: 'Próximo passo ainda não confirmado', acao: 'Atualizar a leitura do time.', quando: 'Sem informação recente para prever a próxima ação.', depois: 'Confira o estado atualizado antes de intervir.', tom: 'atencao' }
  }
  if (!frente.ativo || frente.estado === 'pausado') return { ...base, titulo: 'Primeiros contatos pausados', acao: 'Manter a pausa dos primeiros contatos.', quando: 'Sem retomada prevista nesta leitura.', depois: 'Você pode continuar as conversas já iniciadas.' }
  if (frente.estado === 'bloqueado' || frente.rodada?.bloqueado || frente.fila.some(c => c.estado === 'incerto')) {
    return { ...base, titulo: 'O time está aguardando uma conferência', acao: (frente.rodada?.bloqueado && frente.rodada.motivo) || frente.detalhe || 'Conferir o envio sem confirmação antes de continuar.', quando: 'Novos contatos aguardam a liberação da condição indicada.', depois: 'O time precisa confirmar a condição de espera antes de iniciar outro contato.', tom: 'atencao' }
  }
  const cliente = frente.fila.find(c => c.estado === 'pronto' && c.produto !== 'plus' && !c.id.startsWith('plus:'))
  const em = Date.parse(frente.proximoEnvioEm ?? '')
  const possibilidade = Number.isFinite(em) && em > agora
    ? `A partir de ${new Date(em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}, após nova conferência dos limites.`
    : 'Na próxima verificação do serviço, se expediente, ritmo e contexto permitirem.'
  if (frente.estado === 'avaliando' || frente.estado === 'iniciando') return { ...base, titulo: 'O time está avaliando os contatos', responsavel: 'Diego, Elisa e Carla', acao: 'Conferir perfil, entrega e abordagem antes de selecionar os primeiros contatos.', quando: 'A avaliação continua no serviço; sem horário de conclusão confirmado.', depois: 'Os contatos aprovados seguem para a fila de Carla.' }
  if (frente.estado === 'enviando') return { ...base, titulo: 'Carla está iniciando um contato', responsavel: 'Carla', acao: 'Aguardar a confirmação do WhatsApp e do registro em Vendas.', quando: 'Envio em andamento na última leitura.', depois: 'Com a confirmação, o time reavalia o próximo contato da fila.' }
  if (frente.estado === 'fora-do-horario') return { ...base, titulo: 'O time aguarda o expediente', responsavel: 'Carla · primeiros contatos', acao: 'Revalidar a fila no próximo expediente antes de iniciar outro contato.', quando: Number.isFinite(em) && em > agora ? possibilidade : 'Próximo expediente; sem horário atualizado nesta leitura.' }
  // "Concluído" também pode significar orçamento de avaliação atingido; não garante fim dos envios.
  if (frente.estado === 'concluido') return { ...base, titulo: 'A rodada de avaliação terminou', acao: frente.detalhe || 'Aguardar a próxima verificação do serviço.', quando: 'Sem novo envio confirmado nesta leitura.', depois: 'Contatos ainda na fila dependem de nova conferência do serviço.' }
  if (frente.estado === 'pronto' && cliente) return { ...base, titulo: `Próximo da fila: ${cliente.empresa}`, responsavel: 'Carla · primeiros contatos', acao: 'Conferir o cliente e a mensagem antes de iniciar o contato.', quando: possibilidade, condicao: frente.detalhe, cliente: { id: cliente.id, empresa: cliente.empresa } }
  if (frente.estado === 'pronto') return { ...base, titulo: 'Nenhum contato pronto nesta leitura', acao: 'Aguardar a avaliação de novos contatos elegíveis.', quando: 'Sem próximo envio definido.' }
  return { ...base, titulo: 'Próximo passo ainda não informado', acao: frente.detalhe || 'Consultar o andamento do serviço.', quando: 'Sem previsão confirmada.', tom: 'atencao' }
}
