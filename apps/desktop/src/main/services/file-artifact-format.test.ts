import { afterEach, describe, expect, it, vi } from 'vitest';

import { fileArtifactExtensionForMimeType } from './file-artifact-format';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fileArtifactExtensionForMimeType resolves a user-facing extension from a MIME type', () => {
  it.each([
    ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
    ['application/pdf', 'pdf'],
    ['application/json', 'json'],
    ['application/zip', 'zip'],
    ['text/csv', 'csv'],
    ['text/html', 'html'],
    ['text/markdown', 'md'],
    ['text/plain', 'txt'],
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/svg+xml', 'svg'],
  ])('returns "%s" for MIME type "%s"', (mimeType, expected) => {
    expect(fileArtifactExtensionForMimeType(mimeType)).toBe(expected);
  });

  it('returns "bin" for an unknown MIME type', () => {
    expect(fileArtifactExtensionForMimeType('application/octet-stream')).toBe('bin');
  });

  it('returns "bin" for an empty string', () => {
    expect(fileArtifactExtensionForMimeType('')).toBe('bin');
  });

  it('strips parameters after semicolon before lookup', () => {
    expect(fileArtifactExtensionForMimeType('text/plain; charset=utf-8')).toBe('txt');
  });

  it('trims whitespace around the MIME type', () => {
    expect(fileArtifactExtensionForMimeType('  application/pdf  ')).toBe('pdf');
  });

  it('normalizes the MIME type to lowercase', () => {
    expect(fileArtifactExtensionForMimeType('Application/PDF')).toBe('pdf');
  });

  it('strips parameters and normalizes case simultaneously', () => {
    expect(fileArtifactExtensionForMimeType('Text/HTML; charset=UTF-8')).toBe('html');
  });
});
