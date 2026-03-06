import {createHash} from 'crypto';
import {describe, expect, it} from 'vitest';
import ArgoCD from '../src/argo-cd';

describe('validateVersion', () => {
  it('accepts valid semver versions', () => {
    expect(() => ArgoCD.validateVersion('3.3.2')).not.toThrow();
    expect(() => ArgoCD.validateVersion('2.7.0')).not.toThrow();
    expect(() => ArgoCD.validateVersion('1.0.0')).not.toThrow();
  });

  it('accepts pre-release versions', () => {
    expect(() => ArgoCD.validateVersion('3.3.2-rc1')).not.toThrow();
    expect(() => ArgoCD.validateVersion('2.7.0-beta.1')).not.toThrow();
  });

  it('rejects empty string', () => {
    expect(() => ArgoCD.validateVersion('')).toThrow('Invalid version');
  });

  it('rejects versions with v prefix', () => {
    expect(() => ArgoCD.validateVersion('v3.3.2')).toThrow('Invalid version');
  });

  it('rejects non-semver strings', () => {
    expect(() => ArgoCD.validateVersion('latest')).toThrow('Invalid version');
    expect(() => ArgoCD.validateVersion('3.3')).toThrow('Invalid version');
    expect(() => ArgoCD.validateVersion('abc')).toThrow('Invalid version');
  });
});

describe('downloadFromUrl', () => {
  it('rejects non-HTTPS URLs', async () => {
    await expect(
      ArgoCD.downloadFromUrl('http://example.com/argocd', '3.3.2'),
    ).rejects.toThrow('Only HTTPS URLs are allowed');
  });

  it('rejects file:// URLs', async () => {
    await expect(
      ArgoCD.downloadFromUrl('file:///etc/passwd', '3.3.2'),
    ).rejects.toThrow('Only HTTPS URLs are allowed');
  });
});

describe('getExecutableName', () => {
  it('returns a string containing the platform', () => {
    const name = ArgoCD.getExecutableName();
    expect(name).toContain('argocd-');
    expect(name.length).toBeGreaterThan(0);
  });

  it('contains a valid architecture suffix', () => {
    const name = ArgoCD.getExecutableName();
    expect(name).toMatch(/-(amd64|arm64|ppc64le|s390x)/);
  });
});

describe('findChecksum', () => {
  const checksumContent = [
    'abc123def456  argocd-linux-amd64',
    'fed789abc012  argocd-darwin-amd64',
    '111222333444  argocd-windows-amd64.exe',
  ].join('\n');

  it('finds the correct checksum for a matching filename', () => {
    expect(ArgoCD.findChecksum(checksumContent, 'argocd-linux-amd64')).toBe(
      'abc123def456',
    );
    expect(ArgoCD.findChecksum(checksumContent, 'argocd-darwin-amd64')).toBe(
      'fed789abc012',
    );
  });

  it('returns undefined for a non-existent filename', () => {
    expect(
      ArgoCD.findChecksum(checksumContent, 'argocd-linux-arm64'),
    ).toBeUndefined();
  });

  it('handles empty content', () => {
    expect(ArgoCD.findChecksum('', 'argocd-linux-amd64')).toBeUndefined();
  });

  it('handles extra whitespace in lines', () => {
    const content = '  abc123  argocd-linux-amd64  ';
    expect(ArgoCD.findChecksum(content, 'argocd-linux-amd64')).toBe('abc123');
  });
});

describe('verifyChecksum', () => {
  const testData = Buffer.from('hello world');
  const correctHash = createHash('sha256').update(testData).digest('hex');

  it('does not throw when checksum matches', () => {
    expect(() =>
      ArgoCD.verifyChecksum(testData, correctHash, 'test-file'),
    ).not.toThrow();
  });

  it('throws when checksum does not match', () => {
    expect(() =>
      ArgoCD.verifyChecksum(testData, 'badhash', 'test-file'),
    ).toThrow('Checksum mismatch for test-file');
  });

  it('includes expected and actual hashes in error message', () => {
    expect(() =>
      ArgoCD.verifyChecksum(testData, 'badhash', 'test-file'),
    ).toThrow(`Expected: badhash, Got: ${correctHash}`);
  });
});

describe('filterEnv', () => {
  it('filters all sensitive tokens by default', () => {
    const env = {
      PATH: '/usr/bin',
      HOME: '/home/user',
      GITHUB_TOKEN: 'ghp_secret',
      ACTIONS_RUNTIME_TOKEN: 'runtime-secret',
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc-secret',
      ACTIONS_ID_TOKEN_REQUEST_URL: 'https://token.actions.githubusercontent.com',
    };
    const filtered = ArgoCD.filterEnv(env);
    expect(filtered).toEqual({PATH: '/usr/bin', HOME: '/home/user'});
    expect(filtered).not.toHaveProperty('GITHUB_TOKEN');
    expect(filtered).not.toHaveProperty('ACTIONS_RUNTIME_TOKEN');
    expect(filtered).not.toHaveProperty('ACTIONS_ID_TOKEN_REQUEST_TOKEN');
    expect(filtered).not.toHaveProperty('ACTIONS_ID_TOKEN_REQUEST_URL');
  });

  it('filters custom keys when specified', () => {
    const env = {
      PATH: '/usr/bin',
      SECRET_KEY: 'secret',
      API_TOKEN: 'token',
    };
    const filtered = ArgoCD.filterEnv(env, ['SECRET_KEY', 'API_TOKEN']);
    expect(filtered).toEqual({PATH: '/usr/bin'});
  });

  it('excludes undefined values', () => {
    const env: Record<string, string | undefined> = {
      PATH: '/usr/bin',
      EMPTY: undefined,
    };
    const filtered = ArgoCD.filterEnv(env);
    expect(filtered).toEqual({PATH: '/usr/bin'});
    expect(filtered).not.toHaveProperty('EMPTY');
  });

  it('returns empty object for empty input', () => {
    expect(ArgoCD.filterEnv({})).toEqual({});
  });
});
