import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import {createActionAuth} from '@octokit/auth-action';
import {Octokit} from '@octokit/rest';

import {createHash} from 'crypto';
import {promises as fs} from 'fs';
import os from 'os';
import path from 'path';

const PLATFORM = process.platform;
const CPU_ARCH = os.arch();
const EXE_NAME = PLATFORM === 'win32' ? 'argocd.exe' : 'argocd';

const CPU_ARCHITECTURES: Record<string, string> = {
  x64: 'amd64',
  arm64: 'arm64',
  ppc64: 'ppc64le',
  s390x: 's390x',
};

const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

const SENSITIVE_ENV_KEYS = [
  'GITHUB_TOKEN',
  'ACTIONS_RUNTIME_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_TOKEN',
  'ACTIONS_ID_TOKEN_REQUEST_URL',
];

export default class ArgoCD {
  private readonly exePath: string;

  private constructor(exePath: string) {
    this.exePath = exePath;
  }

  static validateVersion(version: string): void {
    if (!version || !SEMVER_REGEX.test(version)) {
      throw new Error(
        `Invalid version "${version}". Must be a valid semver (e.g., 3.3.2)`,
      );
    }
  }

  static async getOrDownload(
    version: string,
    downloadUrl?: string,
  ): Promise<ArgoCD> {
    ArgoCD.validateVersion(version);

    const cachedDir = tc.find('argocd', version);
    if (cachedDir) {
      core.addPath(cachedDir);
      core.debug(`Found "argocd" executable at: ${cachedDir}`);
      return new ArgoCD('argocd');
    }

    core.debug('Unable to find "argocd" executable, downloading it now');

    if (downloadUrl) {
      return await ArgoCD.downloadFromUrl(downloadUrl, version);
    }

    return await ArgoCD.downloadFromGitHub(version);
  }

  static getExecutableName(): string {
    const arch = CPU_ARCHITECTURES[CPU_ARCH];
    if (!arch) {
      throw new Error(`Unsupported CPU architecture: ${CPU_ARCH}`);
    }

    if (PLATFORM === 'win32') {
      return `argocd-windows-${arch}.exe`;
    }

    return `argocd-${PLATFORM}-${arch}`;
  }

  static async downloadFromUrl(
    url: string,
    version: string,
  ): Promise<ArgoCD> {
    if (!url.startsWith('https://')) {
      throw new Error(
        `Invalid download URL: "${url}". Only HTTPS URLs are allowed.`,
      );
    }

    core.debug(`Downloading ArgoCD from custom URL: ${url}`);
    const assetPath = await tc.downloadTool(url);

    return await ArgoCD.cacheAndInstall(assetPath, version);
  }

  static async downloadFromGitHub(version: string): Promise<ArgoCD> {
    const executable = ArgoCD.getExecutableName();
    const octokit = ArgoCD.createOctokit();

    // Single API call to fetch the release
    const release = await octokit.repos.getReleaseByTag({
      owner: 'argoproj',
      repo: 'argo-cd',
      tag: `v${version}`,
    });

    // Find the binary asset
    const binaryAsset = release.data.assets.find(
      (rel) => rel.name === executable,
    );
    if (!binaryAsset) {
      throw new Error(
        `Could not find asset "${executable}" for Argo CD v${version}`,
      );
    }

    core.debug(`Downloading ArgoCD from: ${binaryAsset.browser_download_url}`);
    const assetPath = await tc.downloadTool(binaryAsset.browser_download_url);

    // Verify checksum if available
    const checksumAsset = release.data.assets.find(
      (rel) => rel.name === 'cli_checksums.txt',
    );
    if (checksumAsset) {
      const checksumPath = await tc.downloadTool(
        checksumAsset.browser_download_url,
      );
      const checksumContent = await fs.readFile(checksumPath, 'utf-8');
      const expectedHash = ArgoCD.findChecksum(checksumContent, executable);

      if (expectedHash) {
        const fileBuffer = await fs.readFile(assetPath);
        ArgoCD.verifyChecksum(fileBuffer, expectedHash, executable);
      } else {
        core.warning(
          `No checksum entry found for "${executable}", skipping verification`,
        );
      }
    } else {
      core.warning(
        `No checksums file found for Argo CD v${version}, skipping verification`,
      );
    }

    return await ArgoCD.cacheAndInstall(assetPath, version);
  }

  private static async cacheAndInstall(
    assetPath: string,
    version: string,
  ): Promise<ArgoCD> {
    const cachedPath = await tc.cacheFile(
      assetPath,
      EXE_NAME,
      'argocd',
      version,
    );
    core.addPath(cachedPath);

    const cachedBinaryPath = path.join(cachedPath, EXE_NAME);
    await fs.chmod(cachedBinaryPath, 0o755);

    return new ArgoCD('argocd');
  }

  static findChecksum(
    checksumContent: string,
    filename: string,
  ): string | undefined {
    for (const line of checksumContent.trim().split('\n')) {
      const [hash, name] = line.trim().split(/\s+/);
      if (name === filename && hash) {
        return hash;
      }
    }
    return undefined;
  }

  static verifyChecksum(
    fileBuffer: Buffer,
    expectedHash: string,
    filename: string,
  ): void {
    const actualHash = createHash('sha256').update(fileBuffer).digest('hex');
    if (actualHash !== expectedHash) {
      throw new Error(
        `Checksum mismatch for ${filename}. Expected: ${expectedHash}, Got: ${actualHash}`,
      );
    }
    core.debug(`Checksum verified: ${actualHash}`);
  }

  static filterEnv(
    env: Record<string, string | undefined>,
    keysToFilter: string[] = SENSITIVE_ENV_KEYS,
  ): Record<string, string> {
    const filtered: Record<string, string> = {};
    const filterSet = new Set(keysToFilter);
    for (const [key, value] of Object.entries(env)) {
      if (!filterSet.has(key) && value !== undefined) {
        filtered[key] = value;
      }
    }
    return filtered;
  }

  private static createOctokit(): Octokit {
    // If hitting GitHub API rate limit, add `GITHUB_TOKEN` to raise limit
    const options = process.env.GITHUB_TOKEN
      ? {authStrategy: createActionAuth}
      : {};
    return new Octokit(options);
  }

  async call(args: string[], options?: exec.ExecOptions): Promise<number> {
    const opts: exec.ExecOptions = {
      ...options,
      env: options?.env ?? ArgoCD.filterEnv(process.env),
    };
    return await exec.exec(this.exePath, args, opts);
  }

  async callStdout(
    args: string[],
    options?: exec.ExecOptions,
  ): Promise<string> {
    let stdout = '';
    const existingStdout = options?.listeners?.stdout;
    const opts: exec.ExecOptions = {
      ...options,
      env: options?.env ?? ArgoCD.filterEnv(process.env),
      listeners: {
        ...options?.listeners,
        stdout: (buffer: Buffer) => {
          stdout += buffer.toString();
          existingStdout?.(buffer);
        },
      },
    };

    await exec.exec(this.exePath, args, opts);
    return stdout;
  }
}
