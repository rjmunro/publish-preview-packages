# Publish Preview Packages

GitHub Action to publish branch preview packages to GitHub Packages (or any npm registry) with intelligent content-based versioning and automatic cleanup.

## Features

- 🎯 **Content-based versioning** - Same code = same version (reproducible builds)
- 🏷️ **Branch tagging** - Each branch gets its own dist-tag
- 🧹 **Automatic cleanup** - Maintains rolling window of N versions
- 📦 **Monorepo support** - Works with Yarn workspaces, Lerna, pnpm
- 🔒 **Safe deletion** - Only deletes versions when all referencing branches are gone
- 🚀 **Zero config** - Auto-detects packages and workspace setup

## Usage

### Basic Setup

```yaml
name: Publish Branch Preview

on:
  push:
    branches:
      - '**'
      - '!main'
      - '!release**'

permissions:
  contents: read
  packages: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: yarn install
      
      - name: Publish preview packages
        uses: rjmunro/publish-preview-packages@v1
        with:
          registry-token: ${{ secrets.GITHUB_TOKEN }}
```

### Advanced Configuration

```yaml
- uses: rjmunro/publish-preview-packages@v1
  with:
    # Custom registry (default: GitHub Packages)
    registry: 'https://npm.pkg.github.com'
    
    # Registry authentication token
    registry-token: ${{ secrets.GITHUB_TOKEN }}
    
    # Packages directory (default: packages)
    packages-dir: 'packages'
    
    # Build command (default: yarn build)
    build-command: 'yarn build'
    
    # Specific packages to publish (default: auto-detect)
    package-list: 'shared-lib,blueprints-integration,corelib'
    
    # Maximum versions per package (default: 150)
    max-versions: '100'
    
    # Minimum age before deletion (default: 30 days)
    min-age-days: '7'
    
    # Skip build if already built (default: false)
    skip-build: 'false'
```

## How It Works

### Content-Based Versioning

The action hashes the `dist/` folder of each package. If the content hasn't changed, it reuses the existing version and just adds a new branch tag.

**Version format**: `1.0.0-preview.<contenthash>`

Example:

- Branch `feature-a` builds → hash `abc123` → publishes `1.0.0-preview.abc123` with tag `branch-feature-a`
- Branch `feature-b` builds → same hash `abc123` → reuses `1.0.0-preview.abc123`, adds tag `branch-feature-b`
- Branch `feature-a` changes code → new hash `def456` → publishes `1.0.0-preview.def456` with tag `branch-feature-a`

### Automatic Cleanup

Before publishing, if a package has more than `max-versions` preview versions:

1. Fetches all branches from the repository
2. For each preview version, checks if any branch tags point to deleted branches
3. Deletes the oldest versions where all referencing branches are gone
4. Respects `min-age-days` - never deletes recent versions

### Installing Preview Packages

After the action runs, install with:

```bash
# Configure registry
echo "@your-org:registry=https://npm.pkg.github.com" >> .npmrc

# Install specific branch
yarn add @your-org/package-name@branch-feature-name

# Or install specific content version
yarn add @your-org/package-name@1.0.0-preview.abc123
```

## Outputs

The action outputs JSON with published package information:

```yaml
- uses: rjmunro/publish-preview-packages@v1
  id: publish
  with:
    registry-token: ${{ secrets.GITHUB_TOKEN }}

- name: Display results
  run: |
    echo "Published packages: ${{ steps.publish.outputs.published-packages }}"
```

Output format:

```json
[
  {
    "name": "@org/shared-lib",
    "version": "1.0.0-preview.abc123",
    "tag": "branch-feature-name"
  }
]
```

### Posting Results to PR Comments

You can use the output to comment on pull requests:

```yaml
- uses: rjmunro/publish-preview-packages@v1
  id: publish
  with:
    registry-token: ${{ secrets.GITHUB_TOKEN }}

- name: Comment on PR
  if: github.event_name == 'pull_request'
  uses: actions/github-script@v7
  with:
    script: |
      const packages = JSON.parse('${{ steps.publish.outputs.published-packages }}');
      
      const body = `## 📦 Preview Packages Published

${packages.map(pkg => 
  `- **${pkg.name}**@\`${pkg.version}\`\n  \`\`\`bash\n  yarn add ${pkg.name}@${pkg.tag}\n  \`\`\``
).join('\n\n')}

*Preview packages are available on GitHub Packages. Configure your \`.npmrc\` to use them.*`;

      github.rest.issues.createComment({
        issue_number: context.issue.number,
        owner: context.repo.owner,
        repo: context.repo.repo,
        body: body
      });
```

This will post a comment like:

> ## 📦 Preview Packages Published
>
> - **@org/shared-lib**@`1.0.0-preview.abc123`
>   ```bash
>   yarn add @org/shared-lib@branch-feature-name
>   ```
>
> *Preview packages are available on GitHub Packages. Configure your `.npmrc` to use them.*

## Requirements

- Node.js 20+
- Yarn, npm, or pnpm
- Lerna (optional, auto-detected)
- Packages must have a `dist/` folder after build

## License

MIT License - see [LICENSE](LICENSE) file for details.
