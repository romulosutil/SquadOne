import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const filas = new Map<string,Promise<unknown>>();
export const processoVivo = (pid:number):boolean => { try {process.kill(pid,0);return true} catch(e) {return (e as NodeJS.ErrnoException).code!=='ESRCH'} };
export async function sincronizarPasta(pasta:string):Promise<void> {
  if(process.platform==='win32')return;
  const h=await fs.open(pasta,'r');try{await h.sync()}finally{await h.close()}
}
export async function gravarPrivadoAtomico(arquivo:string,valor:unknown,limiteBytes=16*1024*1024):Promise<void> {
  const bytes=JSON.stringify(valor);if(Buffer.byteLength(bytes,'utf8')>limiteBytes)throw new Error('Journal operacional atingiu o limite; preserve o acervo e confira antes de repetir.');
  const tmp=arquivo+'.'+randomUUID()+'.tmp',h=await fs.open(tmp,'wx',0o600);
  try {await h.writeFile(bytes);await h.sync()}finally{await h.close()}
  try {await fs.rename(tmp,arquivo);await fs.chmod(arquivo,0o600);await sincronizarPasta(path.dirname(arquivo))}
  finally {await fs.rm(tmp,{force:true}).catch(()=>undefined)}
}
/** Estado derivado privado. Corrupção/trava incerta bloqueia; nunca zera o journal. */
export class EstadoOperacionalDuravel<T> {
  readonly arquivo:string;
  constructor(arquivo:string,private readonly inicial:()=>T,private readonly validar:(v:unknown)=>T,private readonly prazoLockMs=30000,private readonly limiteBytes=16*1024*1024) {this.arquivo=path.resolve(arquivo)}
  async usar<R>(fn:(estado:T,salvar:()=>Promise<void>)=>Promise<R>):Promise<R> {
    const anterior=filas.get(this.arquivo)??Promise.resolve();
    const atual=anterior.catch(()=>undefined).then(async()=>{
      const pasta=path.dirname(this.arquivo);await fs.mkdir(pasta,{recursive:true,mode:0o700});await fs.chmod(pasta,0o700);
      const lock=this.arquivo+'.lock',recovery=lock+'.recovery',token=randomUUID(),inicio=Date.now();
      let h:Awaited<ReturnType<typeof fs.open>>|undefined;
      while(!h&&Date.now()-inicio<this.prazoLockMs){
        try {h=await fs.open(lock,'wx',0o600);await h.writeFile(JSON.stringify({pid:process.pid,token}));await h.sync()}
        catch(e){
          if((e as NodeJS.ErrnoException).code!=='EEXIST')throw new Error('Trava operacional indisponível.');
          // Um único recuperador: impede dois processos removerem a nova trava um do outro.
          let recuperador:Awaited<ReturnType<typeof fs.open>>|undefined;
          try{
            recuperador=await fs.open(recovery,'wx',0o600);
            const antes=await fs.readFile(lock,'utf8'),d=JSON.parse(antes) as {pid?:number;token?:string};
            if(Number.isInteger(d.pid)&&d.pid!>0&&typeof d.token==='string'&&!processoVivo(d.pid!)&&await fs.readFile(lock,'utf8')===antes)await fs.unlink(lock);
          }catch{/* Sem comprovar dono morto, permanece fechado. */}
          finally{if(recuperador){await recuperador.close();await fs.unlink(recovery).catch(()=>undefined)}}
          await new Promise(r=>setTimeout(r,20));
        }
      }
      if(!h)throw new Error('Outra operação mantém a reserva; confira a fila antes de repetir.');
      try{
        let estado:T;
        try {const s=await fs.lstat(this.arquivo);if(!s.isFile()||s.isSymbolicLink()||s.size>this.limiteBytes)throw new Error();estado=this.validar(JSON.parse(await fs.readFile(this.arquivo,'utf8')))}
        catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')estado=this.inicial();else throw new Error('Estado operacional ilegível; confira o journal privado. Não repetir.');}
        return await fn(estado,async()=>{this.validar(estado);await gravarPrivadoAtomico(this.arquivo,estado,this.limiteBytes)});
      }finally{
        await h.close();
        const dono=await fs.readFile(lock,'utf8').then(s=>JSON.parse(s) as {token?:string}).catch(()=>null);
        if(dono?.token===token){await fs.unlink(lock);await sincronizarPasta(pasta)}
      }
    });
    filas.set(this.arquivo,atual);try{return await atual}finally{if(filas.get(this.arquivo)===atual)filas.delete(this.arquivo)}
  }
}

export class PrazoOperacionalEsgotado extends Error {constructor(){super('A operação não respondeu a tempo.');this.name='PrazoOperacionalEsgotado'}}
/** Limita também dublê/provider que ignore AbortSignal. Resultado tardio nunca confirma localmente. */
export async function comPrazoOperacional<T>(fn:(sinal:AbortSignal)=>Promise<T>,ms=20000):Promise<T>{
  const c=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([Promise.resolve().then(()=>fn(c.signal)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{c.abort();reject(new PrazoOperacionalEsgotado())},ms)})])}
  finally{if(timer)clearTimeout(timer)}
}
