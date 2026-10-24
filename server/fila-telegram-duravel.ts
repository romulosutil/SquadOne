import {randomUUID} from 'node:crypto';
import {EstadoOperacionalDuravel,processoVivo} from './estado-operacional-duravel.ts';
import {hashCanonicoComercial} from './registro-comercial-duravel.ts';
interface EntradaDuravel {id:number;hash:string;update:unknown;estado:'pendente'|'processando'|'concluido'|'ambiguo';pid?:number;token?:string;avisoTentado?:true;em:string}
interface Estado {v:1;entradas:EntradaDuravel[]}
function validar(v:unknown):Estado {
  const e=v as Estado;
  if(!e||e.v!==1||!Array.isArray(e.entradas))throw new Error('Fila inválida.');
  const ids=new Set<number>();
  for(const r of e.entradas){
    if(!Number.isSafeInteger(r.id)||r.id<0||ids.has(r.id)||!['pendente','processando','concluido','ambiguo'].includes(r.estado)||!Number.isFinite(Date.parse(r.em))||hashCanonicoComercial(r.update)!==r.hash||(r.update as {update_id?:unknown})?.update_id!==r.id||r.avisoTentado!==undefined&&r.avisoTentado!==true||r.estado==='processando'&&(!Number.isInteger(r.pid)||!r.token))throw new Error('Entrada da fila inválida.');
    ids.add(r.id);
  }
  return e;
}
/** Fila privada dos turnos; conteúdo nunca aparece em status ou logs. ACK só depois de receber. */
export class FilaTelegramDuravel {
  private readonly estado:EstadoOperacionalDuravel<Estado>;
  constructor(arquivo:string,private readonly vivo:(pid:number)=>boolean=processoVivo){this.estado=new EstadoOperacionalDuravel(arquivo,()=>({v:1,entradas:[]}),validar)}
  async receber(update:unknown):Promise<EntradaDuravel>{
    const id=(update as {update_id?:unknown})?.update_id;
    if(typeof id!=='number'||!Number.isSafeInteger(id)||id<0||Buffer.byteLength(JSON.stringify(update),'utf8')>256*1024)throw new Error('Update do Telegram inválido para persistência.');
    const hash=hashCanonicoComercial(update);
    return this.estado.usar(async(e,salvar)=>{
      const antiga=e.entradas.find(r=>r.id===id);
      if(antiga){if(antiga.hash!==hash)throw new Error('Update do Telegram com identidade conflitante; não executar.');return structuredClone(antiga)}
      const r:EntradaDuravel={id,hash,update:structuredClone(update),estado:'pendente',em:new Date().toISOString()};e.entradas.push(r);await salvar();return structuredClone(r);
    });
  }
  async iniciar(id:number):Promise<string|null>{return this.estado.usar(async(e,salvar)=>{
    const r=e.entradas.find(r=>r.id===id);if(!r||r.estado!=='pendente')return null;
    r.estado='processando';r.pid=process.pid;r.token=randomUUID();await salvar();return r.token;
  })}
  async concluir(id:number,token:string):Promise<void>{await this.estado.usar(async(e,salvar)=>{
    const r=e.entradas.find(r=>r.id===id);if(!r||r.estado!=='processando'||r.token!==token)throw new Error('Reserva Telegram não confirmada.');
    r.estado='concluido';delete r.pid;delete r.token;await salvar();
  })}
  async marcarAmbiguo(id:number,token:string):Promise<void>{await this.estado.usar(async(e,salvar)=>{
    const r=e.entradas.find(r=>r.id===id);if(r?.estado==='processando'&&r.token===token){r.estado='ambiguo';delete r.pid;delete r.token;await salvar()}
  })}
  async descartarPendente(id:number):Promise<void>{await this.estado.usar(async(e,salvar)=>{
    const r=e.entradas.find(r=>r.id===id);if(r?.estado==='pendente'){r.estado='concluido';await salvar()}
  })}
  async pendentes():Promise<EntradaDuravel[]>{return this.estado.usar(async(e,salvar)=>{
    let mudou=false;
    for(const r of e.entradas)if(r.estado==='processando'&&r.pid&&!this.vivo(r.pid)){r.estado='ambiguo';delete r.pid;delete r.token;mudou=true}
    if(mudou)await salvar();return e.entradas.filter(r=>r.estado==='pendente').map(r=>structuredClone(r));
  })}
  /** Reserva do aviso antes do transporte: restart não duplica uma entrega de resultado incerto. */
  async avisosAmbiguos():Promise<EntradaDuravel[]>{return this.estado.usar(async(e,salvar)=>{
    const rs=e.entradas.filter(r=>r.estado==='ambiguo'&&!r.avisoTentado);
    if(rs.length){for(const r of rs)r.avisoTentado=true;await salvar()}
    return rs.map(r=>structuredClone(r));
  })}
  async status(){return this.estado.usar(async e=>({entradas:e.entradas.map(r=>({id:r.id,estado:r.estado,...(r.avisoTentado?{avisoTentado:true}:{})}))}))}
}
