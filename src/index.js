import * as core from '@actions/core'
import * as github from '@actions/github'
import { discoverPackages } from './discover.js'
import { buildPackages } from './build.js'
import { computeVersions } from './versions.js'
import { cleanupOldVersions } from './cleanup.js'
import { publishPackages } from './publish.js'

async function run() {
	try {
		// Get inputs
		const inputs = {
			registry: core.getInput('registry') || 'https://npm.pkg.github.com',
			registryToken: core.getInput('registry-token', { required: true }),
			packagesDir: core.getInput('packages-dir') || 'packages',
			buildCommand: core.getInput('build-command') || 'yarn build',
			packageList: core.getInput('package-list') || '',
			maxVersions: parseInt(core.getInput('max-versions') || '150'),
			minAgeDays: parseInt(core.getInput('min-age-days') || '30'),
			skipBuild: core.getInput('skip-build') === 'true',
		}

		const branchName = github.context.ref.replace('refs/heads/', '')
		const repository = github.context.repo

		core.info(`📦 Publishing preview packages for branch: ${branchName}`)
		core.info(`Registry: ${inputs.registry}`)
		core.info(`Packages directory: ${inputs.packagesDir}`)

		// Step 1: Discover packages
		core.startGroup('🔍 Discovering packages')
		const packages = await discoverPackages(inputs.packagesDir, inputs.packageList)
		core.info(`Found ${packages.length} packages to process`)
		for (const pkg of packages) {
			core.info(`  - ${pkg.name} (${pkg.path})`)
		}
		core.endGroup()

		// Step 2: Build packages (if not skipped)
		if (!inputs.skipBuild) {
			core.startGroup('🔨 Building packages')
			await buildPackages(inputs.packagesDir, inputs.buildCommand)
			core.endGroup()
		} else {
			core.info('⏭️  Skipping build (skip-build=true)')
		}

		// Step 3: Compute versions based on content hashes
		core.startGroup('🔢 Computing preview versions')
		const versions = await computeVersions(packages, branchName)
		core.info(`Computed ${versions.length} package versions`)
		for (const v of versions) {
			core.info(`  - ${v.name}: ${v.previewVersion} (hash: ${v.contentHash})`)
		}
		core.endGroup()

		// Step 4: Cleanup old versions if needed
		core.startGroup('🧹 Cleaning up old versions')
		await cleanupOldVersions(
			versions,
			repository,
			inputs.maxVersions,
			inputs.minAgeDays,
			inputs.registry,
			inputs.registryToken
		)
		core.endGroup()

		// Step 5: Publish packages
		core.startGroup('📤 Publishing packages')
		const results = await publishPackages(
			versions,
			inputs.registry,
			inputs.registryToken,
			github.context.repo.owner
		)
		core.endGroup()

		// Set output
		core.setOutput('published-packages', JSON.stringify(results))

		// Summary
		const published = results.filter((r) => r.isNew).length
		const tagged = results.filter((r) => !r.isNew).length

		core.summary
			.addHeading('📦 Preview Packages Published')
			.addTable([
				[
					{ data: 'Package', header: true },
					{ data: 'Version', header: true },
					{ data: 'Branch Tag', header: true },
					{ data: 'Status', header: true },
				],
				...results.map((r) => [
					r.name,
					r.version,
					r.branchTag,
					r.isNew ? '✨ New' : '🏷️ Tagged',
				]),
			])
			.addRaw(`\n**Summary:** ${published} published, ${tagged} tagged\n`)
			.write()

		core.info(`✅ Complete! Published ${published}, tagged ${tagged}`)
	} catch (error) {
		core.setFailed(error.message)
	}
}

run()
