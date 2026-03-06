import ArgoCD from './argo-cd';

import * as core from '@actions/core';
import stringArgv from 'string-argv';

async function run(): Promise<void> {
  try {
    const command = stringArgv(core.getInput('command', {required: false}).trim());
    core.debug(`[index] command: ${command}`);
    const options = stringArgv(core.getInput('options', {required: false}).trim());
    core.debug(`[index] options: ${options}`);
    const version = core.getInput('version', {required: false}).trim();
    core.debug(`[index] version: ${version}`);
    const downloadUrl = core.getInput('download-url', {required: false}).trim() || undefined;
    core.debug(`[index] download-url: ${downloadUrl}`);

    // Get executable
    const argocd = await ArgoCD.getOrDownload(version, downloadUrl);

    const args = [...command, ...options];
    if (args.length) {
      const result = await argocd.callStdout(args);
      core.setOutput('output', result);
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

run();
