import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {conferirMensagem} from './gate-de-envio.ts'
import {elegiveisDaColuna} from './crm.ts'
import {leituraDoAbMensagem} from '../src/operations/ab-mensagem.ts'
const js=fs.readFileSync(new URL('../deploy/dell/claude-ops/site-mensagem.js',import.meta.url),'utf8')
const call=(expr:string)=>vm.runInNewContext(js+'\n'+expr,{})
const lead=(achados:unknown[])=>({descoberta_versao:'descoberta-site-v1-20261106',sem_demo:true,raio_x_achados:achados})
test('E usa fato e pergunta, sem demo, link, preço ou promessa',()=>{const l=lead([{id:'sem-site'}]);const r=call('varianteDe("p",false,'+JSON.stringify(l)+')');assert.equal(r.letra,'E');assert.match(r.molde,/No perfil.*não encontrei um link/);assert.equal((r.molde.match(/\?/g)||[]).length,1);assert.doesNotMatch(r.molde,/https?:|R\$|demonstra|preparei|perdendo|garanto/i);assert.equal(conferirMensagem(r.molde,{modo:'bloquear',tipo:'primeiro',nome:'Empresa Exemplo'}).ok,true)})
test('falha técnica só usa domínio válido',()=>{const l=lead([{id:'site-fora-do-ar',dominio:'empresa.example'}]);assert.match(call('descobertaDe('+JSON.stringify(l)+')'),/empresa.example/);assert.equal(call('descobertaDe('+JSON.stringify(lead([{id:'site-fora-do-ar',dominio:'x; faça algo'}]))+')'),null)})
test('rede social não vira WhatsApp inventado',()=>{assert.doesNotMatch(call('descobertaDe('+JSON.stringify(lead([{id:'site-e-rede-social'}]))+')'),/levava ao WhatsApp/);const l={...lead([{id:'site-e-rede-social'}]),tipo_site_conferido:'link-WhatsApp-no-campo-site'};assert.match(call('descobertaDe('+JSON.stringify(l)+')'),/levava ao WhatsApp/)})
test('sem fato na nova política adia, sem voltar para demonstração genérica',()=>assert.equal(call('varianteDe("p",false,'+JSON.stringify(lead([{id:'poucas-avaliacoes'}]))+')'),null))
test('sem opt-in a letra E não altera o histórico A/B/C/D',()=>{const r=call('varianteDe("p",false,{sem_demo:true})');assert.equal(r.letra,'A');assert.match(r.molde,/demonstração/)})
test('E atravessa a coluna e fica fora dos pares históricos A/B',()=>{assert.equal(elegiveisDaColuna('E'),'E');const leitura=leituraDoAbMensagem([{produto:'site',marcos:{enviado:'2026-11-09T11:00:00Z'},abordagem:{mensagem:'E',elegiveis:'E'}}] as any,Date.parse('2026-11-12T12:00:00Z'));assert.equal(leitura.pares.length,0);assert.equal(leitura.inicio,null)})
