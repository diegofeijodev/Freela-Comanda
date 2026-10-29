import { NotFoundException, PipeTransform } from '@nestjs/common';
import { isUuid } from './uuid';

/** `@Param('id', ParseUuidPipe)` — id malformado vira 404 (e não 500 do Prisma). */
export class ParseUuidPipeImpl implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!isUuid(value)) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Não encontrado.' });
    return value;
  }
}
export const ParseUuidPipe = new ParseUuidPipeImpl();
