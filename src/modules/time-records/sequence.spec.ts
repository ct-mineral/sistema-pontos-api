import { describe, expect, it } from 'vitest';
import { nextRecordTypes } from './sequence.js';

describe('nextRecordTypes', () => {
  it('inicia somente com entrada', () => {
    expect(nextRecordTypes()).toEqual(['entrada']);
  });

  it('exige pausa depois da entrada', () => {
    expect(nextRecordTypes('entrada')).toEqual(['pausa', 'saida']);
  });

  it('exige retorno depois da pausa', () => {
    expect(nextRecordTypes('pausa')).toEqual(['retorno']);
  });

  it('permite nova pausa ou saída depois do retorno', () => {
    expect(nextRecordTypes('retorno')).toEqual(['pausa', 'saida']);
  });

  it('impede tipos duplicados e reinicia após a saída', () => {
    expect(nextRecordTypes('saida')).toEqual(['entrada']);
  });
});
