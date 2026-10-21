import type { CrmLead } from '../src/operations/types.ts';
import { respondeuDeGente } from '../src/operations/resultados.ts';
import { papelDaMensagem } from '../src/operations/marcadores-da-conversa.ts';
import { chaveDoNumero } from './conversa-do-lead.ts';

const diaSP = (em: number) => new Date(em - 3 * 60 * 60_000).toISOString().slice(0, 10);

/** Um destinatário por disparo confirmado hoje. Abrir um link ou reservar não é enviar. */
export function respostasDoDia(leads: readonly CrmLead[], agora: number) {
  const dia = diaSP(agora);
  const grupos = new Map<string, { humana: boolean; robo: boolean }>();
  for (const lead of leads) {
    const enviado = Date.parse(lead.marcos.enviado ?? '');
    if (!Number.isFinite(enviado) || enviado > agora || diaSP(enviado) !== dia) continue;
    const depois = (em: string | undefined) => {
      const t = Date.parse(em ?? '');
      return Number.isFinite(t) && t >= enviado && t <= agora;
    };
    const recentes = [...(lead.conversa?.recentes ?? []), ...(lead.conversa?.ultima ? [lead.conversa.ultima] : [])]
      .filter(m => m.direcao === 'entrada' && depois(m.em));
    const humanaExplicita = recentes.some(m => ['gente', 'recepcao'].includes(m.papel ?? ''));
    // A classificação bot prevalece sobre ultimaEntrada de observadores antigos, que incluíam saudações.
    const humana = humanaExplicita || depois(lead.marcos.respondeu) || (lead.resposta?.tipo !== 'bot' && (
      (respondeuDeGente(lead) && (depois(lead.marcos.respondeu) || depois(lead.resposta?.em)))
      || depois(lead.conversa?.ultimaEntrada)));
    const robo = (lead.resposta?.tipo === 'bot' && depois(lead.resposta.em))
      || depois(lead.conversa?.ultimaEntradaRobo)
      || recentes.some(m => papelDaMensagem(m.trecho, m.papel) === 'robo');
    const chave = chaveDoNumero(lead.links.whatsapp) || lead.id;
    const anterior = grupos.get(chave);
    grupos.set(chave, { humana: humana || Boolean(anterior?.humana), robo: robo || Boolean(anterior?.robo) });
  }
  const valores = [...grupos.values()];
  const humanas = valores.filter(v => v.humana).length;
  const robos = valores.filter(v => !v.humana && v.robo).length;
  return { dia, enviados: valores.length, humanas, robos, semResposta: valores.length - humanas - robos };
}
