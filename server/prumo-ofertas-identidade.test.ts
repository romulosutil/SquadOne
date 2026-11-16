import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, it } from 'node:test';

const config = JSON.parse(fs.readFileSync(new URL('../deploy/dell/claude-ops/prumo-ofertas.json', import.meta.url), 'utf8'));
const template = fs.readFileSync(new URL('../deploy/dell/claude-ops/prumo-ofertas-triar.js', import.meta.url), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const clinicHtml = '<title>Clínica Infantil</title><main>Equipe multidisciplinar, TEA, terapia ABA e fonoaudiologia.</main><a href="https://wa.me/5511998765432">WhatsApp</a>';
const villageHtml = '<title>Unimed – Village WSTC – Viva seu Espaço</title><nav>Home | Sou cliente | Sou lojista | Lojas</nav><main>Unimed WSTC - Centro de Terapias Especializadas. Clínica para crianças com autismo e equipe multidisciplinar. Central de consultas: (85) 4020-1818.</main><footer><a href="https://wa.me/5585996625212">Comercial Village WSTC</a></footer>';

async function triage(overrides: Record<string, unknown> = {}, html: string | null = clinicHtml, offer = 'iris') {
  const place = { id: 'clinica-regressao', displayName: { text: 'Centro de Terapias Especializadas Unimed' },
    primaryTypeDisplayName: { text: 'Policlínica' }, businessStatus: 'OPERATIONAL',
    websiteUri: 'https://villagewstc.com.br/unimed/', internationalPhoneNumber: '+55 85 4020-1818',
    userRatingCount: 15, rating: 2.4, ...overrides };
  const cfg = { ...config.ofertas[offer], clientes: config.clientes, leitores: [],
    proxima_revisar: config.proxima_revisar, convite_url: 'https://example.test/convite?id=' };
  const source = template.replace('__CONFIG__', JSON.stringify(cfg));
  let requests = 0;
  const select = (name: string) => name === 'Escolher a busca'
    ? { first: () => ({ json: { query: 'clínica de autismo em Fortaleza CE', nicho: 'clínica' } }) }
    : { all: () => [{ json: { places: [place] } }] };
  const context = { helpers: { httpRequest: async () => { requests++; if (html === null) throw new Error('indisponível'); return html; } } };
  const result = await new AsyncFunction('$', source).call(context, select);
  return { row: result.find((item: any) => item.json.ID === place.id)?.json, requests };
}

describe('Iris: identidade da clínica e titularidade do contato', () => {
  it('rejeita o caso real: página da Unimed com WhatsApp comercial do Village no rodapé', async () => {
    const { row } = await triage({}, villageHtml);
    assert.equal(row._tipo, 'descarte');
    assert.match(row.Motivo, /contato da clínica não confirmado/);
    assert.equal(row.Telefone, '+55 85 4020-1818', 'preserva o telefone da clínica para resgate manual');
    assert.equal(row.WhatsApp, undefined);
  });

  it('rejeita centros comerciais pelo nome ou categoria, antes de buscar contatos', async () => {
    for (const [name, type] of [
      ['Comercial Village WSTC', 'Policlínica'], ['Village WSTC', 'Centro comercial'],
      ['Shopping Infantil', 'Shopping center'], ['Condomínio Comercial Village', 'Empresa'],
      ['Centro Comercial Terapia ABA', 'Centro comercial'], ['Village', 'shopping_mall'],
    ]) {
      const { row, requests } = await triage({ displayName: { text: name }, primaryTypeDisplayName: { text: type } }, villageHtml);
      assert.equal(row._tipo, 'descarte', name);
      assert.match(row.Motivo, /centro comercial/, name);
      assert.equal(requests, 0, name);
    }
  });

  it('rejeita a página principal do shopping mesmo se listar serviços de TEA', async () => {
    const { row } = await triage({}, '<title>Shopping Village</title>Unimed, terapias infantis TEA <a href="https://wa.me/5585996625212">WhatsApp</a>');
    assert.equal(row._tipo, 'descarte');
  });

  it('preserva clínicas com site próprio, inclusive as que atendem dentro de centro comercial', async () => {
    for (const name of ['Clínica Infantil ABA', 'Centro de Terapias Especializadas Unimed', 'Clínica Infantil - Shopping Village']) {
      const { row } = await triage({ displayName: { text: name }, websiteUri: 'https://clinica.example/' },
        clinicHtml + '<address>Centro Comercial Village, sala 34, shopping do bairro</address>');
      assert.equal(row._tipo, 'prospect', name);
      assert.equal(row['Origem do WhatsApp'], 'link no site', name);
    }
  });

  it('preserva clínica sem site e continua adiando site temporariamente indisponível', async () => {
    const noSite = await triage({ displayName: { text: 'Clínica Infantil ABA' }, websiteUri: '', internationalPhoneNumber: '+55 11 99876-5432' });
    assert.equal(noSite.row._tipo, 'prospect');
    assert.match(noSite.row['Origem do WhatsApp'], /não confirmado/);
    const unavailable = await triage({}, null);
    assert.equal(unavailable.row, undefined);
  });

  it('mantém a oferta de estamparias com suas regras próprias', async () => {
    const { row } = await triage({ displayName: { text: 'Estamparia Village' }, primaryTypeDisplayName: { text: 'Estamparia' } },
      '<title>Estamparia Village</title>Nossas lojas: camisetas e uniformes <a href="https://wa.me/5511998765432">WhatsApp</a>', 'estampa');
    assert.equal(row._tipo, 'prospect');
  });
});
