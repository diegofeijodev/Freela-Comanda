// Agendador leve da busca na SEFAZ, dentro da própria API (uma instância, sem fila externa). Com o ambiente `desligado` (padrão)
// nenhum timer é criado. O horário da próxima consulta mora no banco: reiniciar a API não antecipa nada. Cada tique: busca →
// classificação → respostas à SEFAZ (no máximo um lote; sem `SEFAZ_MANIFESTACAO=ligada` volta na hora, sem tocar no banco).
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PRIMEIRO_TIQUE_MS, TIQUE_MS } from './agenda';
import { CicloSefazService, descreverErro } from './ciclo.service';
import { RespostasSefazService } from './respostas.service';

@Injectable()
export class AgendadorSefaz implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AgendadorSefaz.name);
  private primeiro: ReturnType<typeof setTimeout> | null = null;
  private intervalo: ReturnType<typeof setInterval> | null = null;
  private rodando = false;
  private parado = false;

  constructor(
    private readonly ciclo: CicloSefazService,
    private readonly respostas: RespostasSefazService,
  ) {}

  onApplicationBootstrap(): void {
    if (this.ciclo.ambiente() === 'desligado') return;
    // `unref`: o timer nunca segura o processo aberto.
    this.primeiro = setTimeout(() => {
      this.primeiro = null;
      if (this.parado) return;
      this.intervalo = setInterval(() => void this.tique(), TIQUE_MS);
      this.intervalo.unref();
      void this.tique();
    }, PRIMEIRO_TIQUE_MS);
    this.primeiro.unref();
  }

  onModuleDestroy(): void {
    this.parado = true;
    if (this.primeiro) clearTimeout(this.primeiro);
    if (this.intervalo) clearInterval(this.intervalo);
    this.primeiro = null;
    this.intervalo = null;
  }

  /** Um tique por vez no processo (além da trava no banco). Nunca lança: erro vai para o log com a classe e o code. */
  async tique(): Promise<void> {
    if (this.rodando || this.parado) return;
    this.rodando = true;
    try {
      try {
        await this.ciclo.ciclo('agendada', null);
      } catch (e) {
        this.logger.error(`sefaz.agendador: ciclo falhou (${descreverErro(e)})`);
      }
      try {
        await this.ciclo.classificarPendentes();
      } catch (e) {
        this.logger.error(`sefaz.agendador: classificação falhou (${descreverErro(e)})`);
      }
      // Depois da classificação: a ciência só nasce para nota que já está na caixa. Busca desligada ou parada não para a fila.
      try {
        await this.respostas.processar();
      } catch (e) {
        this.logger.error(`sefaz.agendador: respostas falharam (${descreverErro(e)})`);
      }
    } finally {
      this.rodando = false;
    }
  }
}
