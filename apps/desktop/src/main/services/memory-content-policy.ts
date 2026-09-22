import { createHash } from 'node:crypto';

import { countCodePoints } from '@betterwork/agent-protocol';

/**
 * 记忆正文的规范化与敏感内容策略。
 *
 * normalizedHash 只做 NFC、换行统一和首尾空白去除：数字、单位、标点和否定词全部保留，
 * 否则「不得合并 / 可以合并」「10万元 / 100万元」这类必须区分的口径会被误判为重复。
 */

export const normalizeMemoryText = (value: string): string =>
  value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();

export const normalizedMemoryHash = (value: string): string =>
  createHash('sha256').update(normalizeMemoryText(value), 'utf8').digest('hex');

export const memoryContentHash = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export type SensitiveMemoryReason =
  'private-key' | 'authorization-header' | 'credential-assignment' | 'known-credential';

const privateKeyPattern =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/iu;

const authorizationHeaderPattern =
  /(?:authorization\s*:\s*)?(?:bearer|basic)\s+[A-Za-z0-9._~+/-]{8,}=*/iu;

const credentialAssignmentPattern =
  /(?:password|passwd|pwd|secret|api[_ -]?key|access[_ -]?token|auth[_ -]?token|private[_ -]?token)\s*[:=]\s*\S/iu;

/**
 * 返回命中的敏感原因；调用方只可持久化原因码，绝不可持久化命中的原文片段。
 */
export const findSensitiveMemoryContent = (
  value: string,
  knownSecrets: readonly string[] = [],
): SensitiveMemoryReason[] => {
  const reasons: SensitiveMemoryReason[] = [];
  if (privateKeyPattern.test(value)) reasons.push('private-key');
  if (authorizationHeaderPattern.test(value)) reasons.push('authorization-header');
  if (credentialAssignmentPattern.test(value)) reasons.push('credential-assignment');
  if (
    knownSecrets.some(
      (secret) => secret.trim().length >= 8 && normalizeMemoryText(value).includes(secret.trim()),
    )
  ) {
    reasons.push('known-credential');
  }
  return reasons;
};

export const isSensitiveMemoryContent = (
  value: string,
  knownSecrets: readonly string[] = [],
): boolean => findSensitiveMemoryContent(value, knownSecrets).length > 0;

/** 同一计口径：所有记忆长度与预算都按 code point 比较，不用 UTF-16 长度。 */
export const memoryTextLength = (value: string): number => countCodePoints(value);
