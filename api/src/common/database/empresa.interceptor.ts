import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { type EmpresaContexto, rodarNaEmpresa } from './empresa-contexto';

/**
 * Roda o handler (pipes incluídos) dentro da empresa escolhida pelo guard. O Nest liga o contexto assíncrono no momento do
 * `next.handle()` (AsyncResource.bind), por isso ele é chamado DENTRO do `rodarNaEmpresa`. Rota pública: sem contexto (`public`).
 */
@Injectable()
export class EmpresaInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const ctx = context.switchToHttp().getRequest<{ empresaContexto?: EmpresaContexto }>().empresaContexto;
    return ctx ? rodarNaEmpresa(ctx, () => next.handle()) : next.handle();
  }
}
