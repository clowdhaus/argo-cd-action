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
      return 'argocd-windows-amd64.exe';
    }

    return `argocd-${PLATFORM}-${arch}`;
  }

  static async downloadFromUrl(
    url: string,
    version: string,
  ): Promise<ArgoCD> {
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
      const content = await fs.readFile(checksumPath, 'utf-8');

      for (const line of content.trim().split('\n')) {
        const [hash, filename] = line.trim().split(/\s+/);
        if (filename === executable && hash) {
          const fileBuffer = await fs.readFile(assetPath);
          const actualHash = createHash('sha256')
            .update(fileBuffer)
            .digest('hex');

          if (actualHash !== hash) {
            throw new Error(
              `Checksum mismatch for ${executable}. Expected: ${hash}, Got: ${actualHash}`,
            );
          }

          core.debug(`Checksum verified: ${actualHash}`);
          break;
        }
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

  private static createOctokit(): Octokit {
    // If hitting GitHub API rate limit, add `GITHUB_TOKEN` to raise limit
    const options = process.env.GITHUB_TOKEN
      ? {authStrategy: createActionAuth}
      : {};
    return new Octokit(options);
  }

  private getFilteredEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (key !== 'GITHUB_TOKEN' && value !== undefined) {
        env[key] = value;
      }
    }
    return env;
  }

  async call(args: string[], options?: exec.ExecOptions): Promise<number> {
    const opts: exec.ExecOptions = {
      ...options,
      env: options?.env ?? this.getFilteredEnv(),
    };
    return await exec.exec(this.exePath, args, opts);
  }

  async callStdout(
    args: string[],
    options?: exec.ExecOptions,
  ): Promise<string> {
    let stdout = '';
    const opts: exec.ExecOptions = {
      ...options,
      env: options?.env ?? this.getFilteredEnv(),
      listeners: {
        ...options?.listeners,
        stdout: (buffer: Buffer) => {
          stdout += buffer.toString();
        },
      },
    };

    await exec.exec(this.exePath, args, opts);
    return stdout;
  }
}
