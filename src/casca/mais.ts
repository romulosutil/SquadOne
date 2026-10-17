/**
 * PURO: as regras da tela Mais que dá para fixar em tabela (17/10/2026, auditoria da Central).
 * Sem Vue nem window: quem chama passa o `location.search` e as ferramentas do /overview.
 */
import { soNoDell } from '../operations/alertas'
import type { OperationTool } from '../operations/types'

/** Qual seção o endereço pede aberta. `fluxo` é o link do robô do Escritório (?fluxo=&passo=). */
export interface SecaoDoMais {
  fluxo: boolean
  abrir: 'manutencao' | 'roteiro' | null
}

/**
 * `?abrir=manutencao` vem da Hoje (AC-17); `?abrir=roteiro` vem do antigo `/crm?ver=roteiro`
 * (AC-20: o roteiro saiu das abas de Vendas). Outro valor não abre nada: o endereço é digitável.
 */
export function secaoDoMais(search: string): SecaoDoMais {
  const p = new URLSearchParams(search)
  const abrir = p.get('abrir')
  return { fluxo: p.has('fluxo'), abrir: abrir === 'manutencao' || abrir === 'roteiro' ? abrir : null }
}

export interface FerramentaDoMais {
  id: OperationTool['id']
  nome: string
  dica: string
  url: string
  /** Classe do ponto ao lado: vazio quando responde (a palavra já basta). */
  ponto: '' | 'is-falha' | 'is-neutro'
}

// Só as ferramentas de verdade, pela ordem do uso (AC-24). Fora: o Syncthing (aposentado em
// 12/10/2026; mesmo que volte à configuração, não aparece), e os atalhos que repetiam a barra
// ("CRM" é Vendas; "Agentes do SquadOne" é o Escritório, e no operations sem agenda redirecionava).
const ORDEM: OperationTool['id'][] = ['ide', 'n8n', 'hermes', 'remote']
const DICA: Partial<Record<OperationTool['id'], string>> = {
  ide: 'Terminal e arquivos do Dell',
  n8n: 'Fluxos e execuções',
  hermes: 'Conversas e rotinas',
  remote: 'A cópia do app no Easypanel, para se o Dell morrer',
}

/**
 * O Easypanel é reserva fria (RULES 25): travado e sem o Telegram, então não responder é o estado
 * normal dele. Pintar de vermelho era alarme falso numa tela que ensina a ler vermelho como
 * "precisa de você"; fica neutro, com a palavra.
 */
export function ferramentasDoMais(tools: readonly OperationTool[]): FerramentaDoMais[] {
  return ORDEM.flatMap((id) => {
    const t = tools.find((x) => x.id === id)
    if (!t) return []
    const fora = t.state === 'unavailable'
    const reserva = t.id === 'remote'
    return [{
      id: t.id,
      nome: t.id === 'ide' ? 'Terminal' : reserva ? 'SquadOne na nuvem' : t.label,
      dica: fora
        ? (reserva ? 'Reserva fria (desligada de propósito)' : 'Sem resposta agora')
        : `${DICA[t.id] ?? t.description}${soNoDell(t.launchUrl) ? ' · só no Dell' : ''}`,
      url: t.launchUrl,
      ponto: fora ? (reserva ? 'is-neutro' : 'is-falha') : '',
    }]
  })
}
