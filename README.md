<p align="center">
  <img src=".github/argo-cd.png" alt="argo-cd" height="296px">
</p>
<h1 style="font-size: 56px; margin: 0; padding: 0;" align="center">
  argo-cd-action
</h1>
<p align="center">
  <img src="https://badgen.net/badge/TypeScript/strict%20%F0%9F%92%AA/blue" alt="Strict TypeScript">
  <a href="http://commitizen.github.io/cz-cli/" alt="commitizen cli">
    <img src="https://img.shields.io/badge/commitizen-friendly-brightgreen.svg" alt="Commitizen friendly">
  </a>
  <a href="https://snyk.io/test/github/clowdhaus/argo-cd-action">
    <img src="https://snyk.io/test/github/clowdhaus/argo-cd-action/badge.svg" alt="Known Vulnerabilities" data-canonical-src="https://snyk.io/test/github/clowdhaus/argo-cd-action">
  </a>
</p>
<p align="center">
  <a href="https://github.com/clowdhaus/argo-cd-action/actions?query=workflow%3Aintegration">
    <img src="https://github.com/clowdhaus/argo-cd-action/workflows/integration/badge.svg" alt="integration test">
  </a>
</p>

GitHub action for executing Argo CD 🦑

## Usage

See the [ArgoCD CLI documentation](https://argoproj.github.io/argo-cd/user-guide/commands/argocd/) for the list of available commands and options.

```yml
- uses: clowdhaus/argo-cd-action/@main
  with:
    version: 2.1.2
    command: version
    options: --client
```

### With GitHub API authentication

If you are running a lot of workflows/jobs quite frequently, you may run into GitHub's API rate limit due to pulling the CLI from the ArgoCD repository. To get around this limitation, add the `GITHUB_TOKEN` as shown below (or see [here](https://github.com/octokit/auth-action.js#createactionauth) for more examples) to utilize a higher rate limit when authenticated.

```yml
- uses: clowdhaus/argo-cd-action/@main
  env:
    # Only required for first step in job where API is called
    # All subsequent setps in a job will not re-download the CLI
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    command: version
    options: --client
- uses: clowdhaus/argo-cd-action/@main
  # CLI has already been downloaded in prior step, no call to GitHub API
  with:
    command: version
    options: --client
```

## Getting Started

The following instructions will help you get setup for development and testing purposes.

### Prerequisites

#### [yarn](https://github.com/yarnpkg/yarn)

`yarn` is used to handle dependencies and executing scripts on the codebase.

See [here](https://yarnpkg.com/en/docs/install#debian-stable) for instructions on installing yarn on your local machine.

Once you have installed `yarn`, you can install the project dependencies by running the following command from within the project root directory:

```bash
  $ yarn
```

## Contributing

Please read [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md) for details on our code of conduct and the process for submitting pull requests.

## Changelog

Please see the [CHANGELOG.md](CHANGELOG.md) for details on individual releases.
