import type {Router} from 'express';
import type {GarantiasAgenda,DemandasAgendaDuraveis} from './garantias-agenda.ts';
import type {FilaTelegramDuravel} from './fila-telegram-duravel.ts';
export interface DependenciasGarantiasAgenda {
  calendario(squadId:unknown):Promise<string>;
  garantias:Pick<GarantiasAgenda,'status'|'reconciliar'>;
  demandas:Pick<DemandasAgendaDuraveis,'status'>;
  fila:Pick<FilaTelegramDuravel,'status'>;
  token():Promise<string>;
}
/** Montar apenas no router interno já protegido. Conferir lê Calendar; nunca cria ou repete eventos. */
export function montarGarantiasAgenda(router:Router,d:DependenciasGarantiasAgenda){
  router.get('/api/agenda/garantias',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      const calendario=await d.calendario(req.query.squadId);
      const [agenda,demandas,telegram]=await Promise.all([d.garantias.status(calendario),d.demandas.status(),d.fila.status()]);
      res.json({modo:'assistido',agenda,demandas,telegram,orientacao:'Resultado ambíguo não autoriza repetir. Confira os eventos originais no Calendar e o pedido original; a conferência não agenda nem envia.'});
    }catch{res.status(503).json({erro:'Não foi possível conferir a fila privada; novas execuções permanecem protegidas.'})}
  });
  router.post('/api/agenda/conferir-reservas',async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    if(typeof req.body?.squadId!=='string'||!req.body.squadId||Object.keys(req.body).some(k=>k!=='squadId'))return void res.status(400).json({erro:'Informe somente a squad que será conferida.'});
    try{
      const calendario=await d.calendario(req.body.squadId),token=await d.token();
      const conferencia=await d.garantias.reconciliar(calendario,token);
      res.json({...conferencia,agenda:await d.garantias.status(calendario),reenvioAutorizado:false,orientacao:'Somente eventos comprovados atualizaram a reserva derivada. Ausência ou divergência mantém bloqueio; nenhum evento foi criado ou repetido.'});
    }catch{res.status(503).json({erro:'Conferência indisponível. Confira o Calendar original antes de repetir qualquer pedido.'})}
  });
}
