import { BadRequestException } from '@nestjs/common';
import { cnpjValido, formatarCnpj, normalizarCnpj } from '../../common/fiscal/cnpj';
import { cpfValido } from '../../common/fiscal/documentos';
import { dayToDb } from '../../common/time/dates';
import type { EmpresaDto } from './dto/empresa.dto';

const invalido = (message: string) => new BadRequestException({ code: 'VALIDATION_ERROR', message });
const txt = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
const digitos = (s: string | null | undefined) => (s ? s.replace(/\D/g, '') : '');

/** Formulário → linha do banco: normaliza documentos (CNPJ maiúsculo [0-9A-Z], nunca `\D`), confere dígitos e troca vazio por null. */
export function dadosEmpresa(dto: EmpresaDto) {
  const cnpj = normalizarCnpj(dto.cnpj);
  if (!cnpjValido(cnpj)) throw invalido('CNPJ inválido. Confira os 14 caracteres (pode ter letras).');
  const cep = digitos(dto.cep);
  if (cep && cep.length !== 8) throw invalido('CEP deve ter 8 números');
  const codMun = digitos(dto.cod_municipio);
  if (codMun && codMun.length !== 7) throw invalido('Código do município (IBGE) deve ter 7 números');
  const cpf = digitos(dto.responsavel_cpf);
  if (cpf && !cpfValido(cpf)) throw invalido('CPF do responsável inválido');
  return {
    razao_social: dto.razao_social.trim(),
    nome_fantasia: txt(dto.nome_fantasia),
    cnpj,
    inscricao_estadual: txt(dto.inscricao_estadual)?.toUpperCase() ?? null,
    inscricao_municipal: txt(dto.inscricao_municipal),
    regime_tributario: dto.regime_tributario || null,
    cnae: txt(dto.cnae),
    data_abertura: dto.data_abertura ? dayToDb(dto.data_abertura) : null,
    cep: cep || null,
    logradouro: txt(dto.logradouro),
    numero: txt(dto.numero),
    complemento: txt(dto.complemento),
    bairro: txt(dto.bairro),
    cidade: txt(dto.cidade),
    uf: dto.uf || null,
    cod_municipio: codMun || null,
    telefone: txt(dto.telefone),
    celular: txt(dto.celular),
    email: txt(dto.email)?.toLowerCase() ?? null,
    site: txt(dto.site),
    responsavel_nome: txt(dto.responsavel_nome),
    responsavel_cpf: cpf || null,
    contador_nome: txt(dto.contador_nome),
    contador_email: txt(dto.contador_email)?.toLowerCase() ?? null,
    contador_telefone: txt(dto.contador_telefone),
    observacoes: txt(dto.observacoes),
    ativo: dto.ativo ?? true,
  };
}

type EnderecoEmpresa = { logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep: string | null };

/** Endereço numa linha (o que `configuracoes.endereco` guarda): "Rua X, 10 - sala 2 - Centro - Valinhos/SP - CEP 13270-000". */
export function enderecoEmUmaLinha(e: EnderecoEmpresa): string {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ');
  const cidade = [e.cidade, e.uf].filter(Boolean).join('/');
  const cep = e.cep ? `CEP ${e.cep.slice(0, 5)}-${e.cep.slice(5)}` : '';
  return [rua, e.complemento, e.bairro, cidade, cep].filter(Boolean).join(' - ');
}

export { formatarCnpj };
