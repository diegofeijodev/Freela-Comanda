/**
 * Só para o import-lovable-e2e.sh: entra pelo AuthService.login DE VERDADE (mesmo código da rota POST /v1/auth/login) com as senhas
 * definidas pelo definir-senha (e confere que a senha antiga do Lovable não entra). Imprime "e-mail → ok <perfil>|recusado" por tentativa.
 *   DATABASE_URL=… npx ts-node --transpile-only scripts/import-lovable-login.ts <email> <senha> [<email> <senha> …]
 */
import-lovable-e2e.sh: entra pelo AuthService.login DE VERDADE (mesmo código da rota POST /v1/auth/login) com as senhas
 * que o Lovable falso guardou via pgcrypto. Imprime uma linha "e-mail senha → ok|recusado" por tentativa.
 *   DATABASE_URL=… npx ts-node --transpile-only scripts/import-lovable-login.ts <email> <senha> [<email> <senha> …]
 */
import 'reflect-metadata';
import { JwtService } from '@nestjs/jwt';
import { PrismaClient } from '@prisma/client';
import { AuthService } from '../src/modules/auth/auth.service';

async function main() {
  const prisma = new PrismaClient();
  const auth = new AuthService(prisma as never, new JwtService({ secret: 'e2e-segredo-0123456789' }));
  const args = process.argv.slice(2);
  try {
    for (let i = 0; i < args.length; i += 2) {
      const r = await auth.login(args[i]!, args[i + 1]!).then(
        (s) => `ok ${s.user.perfil}`,
        () => 'recusado',
      );
      console.log(`${args[i]} → ${r}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
void main();
