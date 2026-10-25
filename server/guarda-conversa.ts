import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'

/** Mesma trava para transporte e tomada humana; nunca fornece permissão de envio. */
export async function comGuardaConversa<T>(pasta:string,conversa:string,acao:()=>Promise<T>):Promise<T> {
  if(!/^[1-9]\d{9}$/.test(conversa))throw new Error('Conversa inválida para a reserva.')
  await fs.mkdir(pasta,{recursive:true,mode:0o700})
  const arquivo=path.join(pasta,createHash('sha256').update(conversa).digest('hex')+'.lock'),token=randomUUID()
  let h:Awaited<ReturnType<typeof fs.open>>|undefined
  for(let i=0;i<80&&!h;i++) {
    try {h=await fs.open(arquivo,'wx',0o600);await h.writeFile(JSON.stringify({pid:process.pid,token}));await h.sync()}
    catch(e) {
      if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e
      const raw=await fs.readFile(arquivo,'utf8').catch(()=>null)
      if(raw)try {
        const dono=JSON.parse(raw)
        if(Number.isInteger(dono.pid)&&dono.pid>0&&typeof dono.token==='string') {
          let morto=false
          try{process.kill(dono.pid,0)}catch(err){morto=(err as NodeJS.ErrnoException).code==='ESRCH'}
          if(morto&&await fs.readFile(arquivo,'utf8')===raw)await fs.unlink(arquivo)
        }
      } catch { /* Trava ilegível não autoriza outro escritor. */ }
      await new Promise(r=>setTimeout(r,100))
    }
  }
  if(!h)throw new Error('Conversa ocupada; aguarde a operação atual.')
  try{return await acao()}finally{
    await h.close()
    const dono=await fs.readFile(arquivo,'utf8').then(JSON.parse).catch(()=>null)
    if(dono?.token===token)await fs.unlink(arquivo)
  }
}
