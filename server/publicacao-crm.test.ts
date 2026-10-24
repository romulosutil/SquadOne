import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, it } from 'node:test';
import { validarPublicacaoCrm, falhaMaisRecenteQueRetrato, type CrmPublicacao } from './publicacao-crm.ts';
import { CrmStore, configDoCrm, validarRetrato, montarCrm } from './crm.ts';

// Só fixtures de schema/ordem e diretórios temporários; nenhum append, modelo ou envio.
const EM = '2026-10-24T15:00:00.000Z';
const AGORA = new Date('2026-10-24T15:01:00.000Z');
const pub = (id: string, hash = 'a'.repeat(64)): CrmPublicacao => ({ v: 1, execucaoId: id, conteudoHash: hash, publicadoEm: EM });
function retrato(publicacao?: CrmPublicacao) {
  return { versao: 1, geradoEm: EM, links: {}, fontes: Object.fromEntries(['site','prumo','iris','estampa','registros'].map(k => [k,{colunas:[],linhas:[]}])), ...(publicacao ? {publicacao} : {}) };
}

describe('Publicação CRM: metadado e ordem local', () => {
  it('preserva metadado validado no retrato e na visão sem tornar o legado obrigatório', () => {
    const metadata = pub('900719925474099300000000001');
    const r = validarRetrato(retrato(metadata));
    assert.deepEqual(r.publicacao, metadata);
    assert.deepEqual(montarCrm(r,{agora:AGORA}).publicacao, metadata);
    assert.equal(validarRetrato(retrato()).publicacao, undefined);
  });
  it('rejeita metadado presente inválido em vez de tratá-lo como legado', () => {
    for (const publicacao of [null,[],{}, {...pub('1'),v:true}, {...pub('1'),v:2}, pub('01'),pub('0'),pub('-1'),pub('1.1'),pub('1'.repeat(31)),pub('1','A'.repeat(64)),pub('1','a'),{...pub('1'),publicadoEm:'2026-02-30T15:00:00.000Z'},{...pub('1'),extra:true}]) {
      assert.throws(() => validarPublicacaoCrm(publicacao), /Metadados/);
      assert.throws(() => validarRetrato({...retrato(),publicacao}), /Metadados/);
    }
  });
  it('não arredonda IDs adjacentes além de Number.MAX_SAFE_INTEGER', () => {
    const r={geradoEm:EM,publicacao:pub('900719925474099300000000001')};
    assert.equal(falhaMaisRecenteQueRetrato({em:EM,erro:'fixture',publicacao:pub('900719925474099300000000002')},r),true);
    assert.equal(falhaMaisRecenteQueRetrato({em:EM,erro:'fixture',publicacao:pub('900719925474099300000000000')},r),false);
  });
  it('usa execução para falha posterior com mesmo milissegundo ou horário anterior', () => {
    for (const em of [EM,'2026-10-24T14:00:00.000Z']) {
      assert.equal(falhaMaisRecenteQueRetrato({em,erro:'fixture',publicacao:pub('11')},{geradoEm:EM,publicacao:pub('10')}),true);
    }
  });
  it('não ressuscita falha de execução anterior com relógio posterior', () => {
    assert.equal(falhaMaisRecenteQueRetrato({em:'2026-10-24T15:30:00.000Z',erro:'fixture',publicacao:pub('9')},{geradoEm:EM,publicacao:pub('10')}),false);
  });
  it('mesma execução nos dois arquivos bloqueia, inclusive com hash diferente', () => {
    for (const hash of ['a'.repeat(64),'b'.repeat(64)]) assert.equal(falhaMaisRecenteQueRetrato({em:EM,erro:'fixture',publicacao:pub('10',hash)},{geradoEm:EM,publicacao:pub('10')}),true);
  });
  it('usa horário quando um ou ambos os arquivos são legados', () => {
    for (const [publicacaoFalha,publicacaoRetrato] of [[undefined,undefined],[pub('1'),undefined],[undefined,pub('2')]]) {
      const r={geradoEm:EM,publicacao:publicacaoRetrato};
      assert.equal(falhaMaisRecenteQueRetrato({em:EM,erro:'fixture',publicacao:publicacaoFalha},r),false);
      assert.equal(falhaMaisRecenteQueRetrato({em:'2026-10-24T15:00:00.001Z',erro:'fixture',publicacao:publicacaoFalha},r),true);
    }
  });
});

describe('CrmStore: estado publicado e falha', () => {
  const pastas: string[]=[];
  afterEach(async () => { await Promise.all(pastas.splice(0).map(p => fs.rm(p,{recursive:true,force:true}))); });
  async function loja(metadata?: CrmPublicacao, falha?: unknown) {
    const pasta = await fs.mkdtemp(path.join(os.tmpdir(),'crm-publicacao-reader-')); pastas.push(pasta);
    const arquivo=path.join(pasta,'crm.json');
    await fs.writeFile(arquivo,JSON.stringify(retrato(metadata)));
    if(falha!==undefined) await fs.writeFile(path.join(pasta,'crm-falha.json'),JSON.stringify(falha));
    return new CrmStore(configDoCrm({retrato:arquivo,entregasPrumo:path.join(pasta,'entregas')},undefined,pasta));
  }
  it('expõe falha posterior mesmo com geradoEm igual, mantendo o último retrato íntegro', async () => {
    const v=await (await loja(pub('10'),{falhouEm:EM,erro:'Fonte temporariamente indisponível.',publicacao:pub('11')})).visao(AGORA);
    assert.equal(v.estado,'ok');assert.deepEqual(v.publicacao,pub('10'));
    assert.equal(v.ultimaFalha?.publicacao?.execucaoId,'11');
  });
  it('não exibe falha antiga depois que o retrato de execução maior está publicado', async () => {
    const v=await (await loja(pub('12'),{falhouEm:'2026-10-24T15:30:00.000Z',erro:'fixture',publicacao:pub('11')})).visao(AGORA);
    assert.equal(v.ultimaFalha,undefined);assert.equal(v.publicacao?.execucaoId,'12');
  });
  it('trata metadado ilegível da falha como bloqueio explícito sem expor conteúdo livre', async () => {
    const v=await (await loja(pub('12'),{falhouEm:'2026-10-24T14:00:00.000Z',erro:'segredo privado fixture',publicacao:pub('inválido')})).visao(AGORA);
    assert.equal(v.ultimaFalha?.publicacaoInvalida,true);assert.equal(v.ultimaFalha?.publicacao,undefined);
    assert.doesNotMatch(v.ultimaFalha!.erro,/segredo/);
  });
  it('não oculta falha publicada com horário ilegível', async () => {
    const v=await (await loja(pub('12'),{falhouEm:'sem data',erro:'fixture',publicacao:pub('13')})).visao(AGORA);
    assert.equal(v.ultimaFalha?.publicacaoInvalida,true);assert.equal(v.ultimaFalha?.em,'');
  });
  it('mantém seleção por data da falha legada', async () => {
    const v=await (await loja(undefined,{falhouEm:'2026-10-24T15:00:00.001Z',erro:'fixture'})).visao(AGORA);
    assert.deepEqual(v.ultimaFalha,{em:'2026-10-24T15:00:00.001Z',erro:'fixture'});
  });
});
