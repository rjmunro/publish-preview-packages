import * as core from '@actions/core'
import * as github from '@actions/github'
import * as exec from '@actions/exec'

/**
 * Get all branches from repository
 * @param {{owner: string, repo: string}} repository
 * @param {string} token
 * @returns {Promise<Set<string>>}
 */
async function getAllBranches(repository, token) {
	const octokit = github.getOctokit(token)

	try {
		const branches = await octokit.paginate(octokit.rest.repos.listBranches, {
			owner: repository.owner,
			repo: repository.repo,
			per_page: 100,
		})

		return new Set(branches.map((b) => b.name))
	} catch (error) {
		core.warning(`Failed to fetch branches: ${error.message}`)
		return new Set()
	}
}

/**
 * Get all preview versions for a package
 * @param {string} packageName
 * @param {string} registry
 * @param {string} token
 * @returns {Promise<Array<{version: string, tags: Array<string>, publishedAt: Date}>>}
 */
async function getPreviewVersions(packageName, registry, token) {
	let output = ''

	try {
		await exec.exec(
			'npm',
			['view', packageName, 'versions', 'time', 'dist-tags', '--json', `--registry=${registry}`],
			{
				silent: true,
				listeners: {
					stdout: (data) => {
						output += data.toString()
					},
				},
				env: {
					...process.env,
					NPM_CONFIG_//npm.pkg.github.com/:_authToken: token,
				},
			}
		)

		const data = JSON.parse(output)

		// Handle both single version and multiple versions response
		const versions = Array.isArray(data.versions) ? data.versions : data.versions ? [data.versions] : []
		const time = data.time || {}
		const distTags = data['dist-tags'] || {}

		// Build map of version -> tags
		const versionTags = {}
		for (const [tag, version] of Object.entries(distTags)) {
			if (!versionTags[version]) {
				versionTags[version] = []
			}
			versionTags[version].push(tag)
		}

		return versions
			.filter((v) => v.includes('-preview.'))
			.map((v) => ({
				version: v,
				tags: versionTags[v] || [],
				publishedAt: time[v] ? new Date(time[v]) : new Date(),
			}))
	} catch (error) {
		// Package might not exist yet
		if (error.message?.includes('404') || error.message?.includes('E404')) {
			return []
		}
		core.warning(`Failed to get versions for ${packageName}: ${error.message}`)
		return []
	}
}

/**
 * Delete a package version from GitHub Packages
 * @param {string} packageName
 * @param {string} version
 * @param {string} owner
 * @param {string} token
 */
async function deleteVersion(packageName, version, owner, token) {
	const octokit = github.getOctokit(token)
	const packageNameWithoutScope = packageName.split('/').pop()

	try {
		// Get all versions to find the ID
		const { data: versions } = await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
			package_type: 'npm',
			package_name: packageNameWithoutScope,
			org: owner,
		})

		const versionData = versions.find((v) => v.name === version)
		if (!versionData) {
			core.warning(`Version ${version} not found for ${packageName}`)
			return
		}

		await octokit.rest.packages.deletePackageVersionForOrg({
			package_type: 'npm',
			package_name: packageNameWithoutScope,
			org: owner,
			package_version_id: versionData.id,
		})

		core.info(`  🗑️  Deleted ${packageName}@${version}`)
	} catch (error) {
		core.warning(`Failed to delete ${packageName}@${version}: ${error.message}`)
	}
}

/**
 * Check if all branches referenced by a version's tags are deleted
 * @param {Array<string>} tags
 * @param {Set<string>} existingBranches
 * @returns {boolean}
 */
function areAllBranchesDeleted(tags, existingBranches) {
	const branchTags = tags.filter((tag) => tag.startsWith('branch-'))

	if (branchTags.length === 0) {
		// No branch tags = orphaned version
		return true
	}

	for (const tag of branchTags) {
		// Convert tag back to branch name (reverse sanitization)
		const branchName = tag.replace(/^branch-/, '')

		// Check if branch exists (exact match or with slashes restored)
		if (existingBranches.has(branchName) || existingBranches.has(branchName.replace(/-/g, '/'))) {
			return false
		}
	}

	return true
}

/**
 * Cleanup old preview versions
 * @param {Array<{name: string}>} versions
 * @param {{owner: string, repo: string}} repository
 * @param {number} maxVersions
 * @param {number} minAgeDays
 * @param {string} registry
 * @param {string} token
 */
export async function cleanupOldVersions(versions, repository, maxVersions, minAgeDays, registry, token) {
	core.info(`Max versions: ${maxVersions}, Min age: ${minAgeDays} days`)

	const existingBranches = await getAllBranches(repository, token)
	core.info(`Found ${existingBranches.size} branches in repository`)

	const now = new Date()
	const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000

	for (const pkg of versions) {
		core.info(`\nChecking ${pkg.name}...`)

		const previewVersions = await getPreviewVersions(pkg.name, registry, token)
		core.info(`  Total preview versions: ${previewVersions.length}`)

		if (previewVersions.length < maxVersions) {
			core.info(`  ✓ Under limit, no cleanup needed`)
			continue
		}

		// Find deletion candidates
		const candidates = []

		for (const v of previewVersions) {
			const ageMs = now - v.publishedAt

			// Skip versions younger than minimum age
			if (ageMs < minAgeMs) {
				continue
			}

			// Check if all branches are deleted
			if (areAllBranchesDeleted(v.tags, existingBranches)) {
				candidates.push({
					...v,
					ageDays: ageMs / (24 * 60 * 60 * 1000),
				})
			}
		}

		// Sort by age (oldest first)
		candidates.sort((a, b) => b.ageDays - a.ageDays)

		const toDelete = previewVersions.length - maxVersions + 1
		const deletions = candidates.slice(0, Math.max(toDelete, 0))

		core.info(`  Deletion candidates: ${candidates.length}`)
		core.info(`  Will delete: ${deletions.length}`)

		for (const v of deletions) {
			core.info(`  🗑️  Deleting ${v.version} (${Math.floor(v.ageDays)} days old)`)
			await deleteVersion(pkg.name, v.version, repository.owner, token)
		}
	}
}
