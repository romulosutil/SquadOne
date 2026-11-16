import fs from 'node:fs'
import path from 'node:path'

const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor
let nodes=0
function verificar(w){
  const names=new Set(w.nodes.map(n=>n.name))
  for(const n of w.nodes){
    nodes++
    const p=n.parameters??{}
    if(typeof p.workflowJson==='string')verificar(JSON.parse(p.workflowJson))
    if(typeof p.jsCode==='string'){
      try{new AsyncFunction(p.jsCode)}catch(e){throw new Error(`${w.name}: ${n.name}: ${e.message}`)}
      for(const m of p.jsCode.matchAll(/\$\(['"]([^'"]+)['"]\)/g)){
        if(!names.has(m[1]))throw new Error(`${n.name}: referência ausente ${m[1]}`)
      }
    }
    function exp(v,key){
      if(key==='workflowJson'||key==='jsCode')return
      if(Array.isArray(v))v.forEach(x=>exp(x))
      else if(v&&typeof v==='object')Object.entries(v).forEach(([k,x])=>exp(x,k))
      else if(typeof v==='string'&&v.startsWith('={{')&&v.endsWith('}}')){
        try{new AsyncFunction(`return (${v.slice(3,-2)});`)}catch(e){throw new Error(`${n.name}: expressão inválida: ${e.message}`)}
      }
    }
    exp(p)
  }
}
for(const f of fs.readdirSync(process.argv[2]).filter(f=>f.endsWith('.json'))){verificar(JSON.parse(fs.readFileSync(path.join(process.argv[2],f),'utf8')))}
console.log(JSON.stringify({ok:true,nosVerificados:nodes}))
