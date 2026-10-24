import type { Router } from 'express'
import { Router as criarRouter, json } from 'express'
import type { CrmStore } from './crm.ts'
import { projetarResponsavelConversa } from '../src/operations/responsavel-conversa.ts'

/** A única exceção técnica às guardas da página: loopback + segredo, somente inbox. */
export function entradaTecnicaAtendimento(deps: {
  autenticar(valor: unknown): Promise<boolean>
  receber(valor: unknown): Promise<{ novo: boolean; registro: { chave: string } } | null>
}) {
  const router = criarRouter()
  router.post('/api/operations/crm/atendimento/evento', json({limit:'8kb'}), async (req,res) => {
    try {
    if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '') || !await deps.autenticar(req.get('X-CRM'))) {
      res.status(403).json({error:'Integração não autorizada.'}); return
    }
      const r = await deps.receber(req.body)
      if (!r) { res.status(503).json({error:'Atendimento indisponível.'}); return }
      res.status(202).json({ok:true,persistido:true,estado:r.novo ? 'pendente' : 'repetido',chave:r.registro.chave})
    } catch { res.status(409).json({error:'Evento não confirmado. Confira identidade, fonte e horários; não altere o ID para repetir.'}) }
  })
  return router
}

/** Escritas humanas continuam sob as guardas de identidade e mesma origem da Central. */
export function montarResponsavelAtendimento(router: Router, crm?: CrmStore) {
  router.get('/crm/atendimento/responsavel', async (req,res) => {
    res.set('Cache-Control','no-store')
    if (!crm || typeof req.query.leadId !== 'string') { res.status(400).json({error:'Informe o cliente.'}); return }
    try {
      const v=await crm.visao(new Date()), lead=v.leads.find(l=>l.id===req.query.leadId)
      if (!lead || v.estado!=='ok') { res.status(409).json({error:'Releia o CRM.'}); return }
      res.json({projecao:projetarResponsavelConversa(lead,v.leads),bloqueio:await crm.bloqueioDaConversa(lead,v.leads)})
    } catch { res.status(503).json({error:'Não foi possível conferir a responsabilidade.'}) }
  })
}
