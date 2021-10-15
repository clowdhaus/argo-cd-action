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

    // Get executable
    const argocd = await ArgoCD.getOrDownload(version);

    const args = [...command, ...options];
    if (args) {
      const result = await argocd.callStdout(args);
      core.setOutput('output', result);
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
