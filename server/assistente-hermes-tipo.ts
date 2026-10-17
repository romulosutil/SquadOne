// Contrato provisório com server/hermes-consulta.ts, escrito em paralelo por outro trabalhador
// (RULES 20, "Exceção do Assistente"). Fica aqui só para o Assistente compilar sem ele; na junção,
// os imports deste arquivo passam a vir de lá e este arquivo sai. Mudar a forma aqui é mudar lá.

export interface ConsultaAoHermes {
  consultar(pergunta: string, pacote: string): Promise<{ texto: string; ms: number }>;
}

export class HermesFalhou extends Error {
  constructor(readonly motivo: "timeout" | "ocupado" | "saida" | "desligado" | "teto", mensagem?: string) {
    super(mensagem ?? `O Hermes não respondeu (${motivo}).`);
    this.name = "HermesFalhou";
  }
}
