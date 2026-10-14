import policy from './coverage-policy.json' with { type: 'json' };

export const coverageExceptions = policy.exceptions;

export function isProductionSource(file) {
  return (
    /^(?:apps\/desktop\/src|packages\/[^/]+\/src)\/.+\.tsx?$/u.test(file) &&
    !/\.test\.tsx?$|\.d\.ts$|\/fixtures\//u.test(file) &&
    !coverageExceptions.some((entry) => entry.path === file)
  );
}
