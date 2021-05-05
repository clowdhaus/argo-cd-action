import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as tc from '@actions/tool-cache';
import * as os from 'os';
import * as path from 'path';
import * as process from 'process';
import {createActionAuth} from '@octokit/auth-action';
import {Octokit} from '@octokit/rest';
import {existsSync, promises as fs} from 'fs';

const PLATFORM = process.platform;
const EXE_NAME = PLATFORM === 'win32' ? 'argocd.exe' : 'argocd';
const ASSET_DEST = path.join(os.homedir(), EXE_NAME);

enum Executable {
  aix,
  android,
  cygwin,
  freebsd,
  netbsd,
  openbsd,
  sunos,
  darwin = 'argocd-darwin-amd64',
  linux = 'argocd-linux-amd64',
  win32 = 'argocd-windows-amd64.exe',
}

export default class ArgoCD {
  private readonly path: string;

  private constructor(exePath: string) {
    this.path = exePath;
  }

  static async getOrDownload(version: string): Promise<ArgoCD> {
    const argoBinaryDirectory = tc.find('argocd', version);
    if (existsSync(argoBinaryDirectory)) {
      core.debug(`Found "argocd" executable at: ${argoBinaryDirectory}`);
      const argoBinary = path.join(argoBinaryDirectory, EXE_NAME);
      core.addPath(argoBinary);
      return new ArgoCD('argocd');
    } else {
      core.debug('Unable to find "argocd" executable, downloading it now');
      return await ArgoCD.download(version);
    }
  }

  static async getExecutableUrl(version: string): Promise<string> {
    // If hitting GitHub API rate limit, add `GITHUB_TOKEN` to raise limit
    const octoConfig = process.env.GITHUB_TOKEN ? {authStrategy: createActionAuth} : {};
    const octokit = new Octokit(octoConfig);
    const executable = Executable[PLATFORM];

    try {
      const releases = await octokit.repos.getReleaseByTag({
        owner: 'argoproj',
        repo: 'argo-cd',
        tag: `v${version}`,
      });

      const asset = releases.data.assets.filter((rel: any) => rel.name === executable)[0];
      return asset.browser_download_url;
    } catch (err) {
      core.setFailed(`Action failed with error ${err}`);
      return '';
    }
  }

  // download executable for the appropriate platform
  static async download(version: string): Promise<ArgoCD> {
    const exeutableUrl = await ArgoCD.getExecutableUrl(version);
    core.debug(`[debug()] getExecutableUrl: ${exeutableUrl}`);
    const assetPath = await tc.downloadTool(exeutableUrl, ASSET_DEST);

    const cachedPath = await tc.cacheFile(assetPath, EXE_NAME, 'argocd', version);
    core.addPath(cachedPath);

    const cachedBinaryPath = path.join(cachedPath, EXE_NAME);
    await fs.chmod(cachedBinaryPath, 0o755);

    return new ArgoCD('argocd');
  }

  async version(): Promise<string> {
    const stdout = await this.callStdout(['version', '--client']);
    return stdout.split(' ')[1];
  }

  async call(args: string[], options?: Record<string, unknown>): Promise<number> {
    return await exec.exec(this.path, args, options);
  }

  // Call the cli and return stdout
  async callStdout(args: string[], options?: Record<string, unknown>): Promise<string> {
    let stdout = '';
    const resOptions = Object.assign({}, options, {
      listeners: {
        stdout: (buffer: Buffer) => {
          stdout += buffer.toString();
        },
      },
    });

    await this.call(args, resOptions);

    return stdout;
  }
}
