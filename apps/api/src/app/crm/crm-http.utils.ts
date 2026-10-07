import { BadRequestException } from '@nestjs/common';

const DUPLICATE_KEY = 11000;

export function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: number })?.code === DUPLICATE_KEY;
}

export function requiredName(value: unknown, label = 'Le nom'): string {
  if (typeof value !== 'string' || !value.trim()) throw new BadRequestException(`${label} est obligatoire`);
  if (value.trim().length > 120) throw new BadRequestException(`${label} ne doit pas dépasser 120 caractères`);

  return value.trim();
}

export function optionalText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new BadRequestException('Texte attendu');

  return value.trim() || undefined;
}
