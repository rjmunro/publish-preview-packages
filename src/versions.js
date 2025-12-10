import { createHash } from 'crypto'
import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'

/**
 * Compute content hash for a directory
 * @param {string} dirPath - Directory to hash
 * @returns {Promise<string>} - SHA256 hash (first 12 chars)
 */
async function hashDirectory(dirPath) {
	const hash = createHash('sha256')
	const files = []

	async function walkDir(dir) {
		const entries = await readdir(dir, { withFileTypes: true })
		for (const entry of entries) {
			const fullPath = join(dir, entry.name)
			const stats = await stat(fullPath)

			if (stats.isDirectory()) {
				await walkDir(fullPath)
			} else if (stats.isFile()) {
				files.push(fullPath)
			}
		}
	}

	await walkDir(dirPath)

	// Sort files for reproducibility
	files.sort()

	for (const file of files) {
		const relativePath = file.substring(dirPath.length + 1)
		const content = await readFile(file)
		hash.update(relativePath)
		hash.update(content)
	}

	return hash.digest('hex').substring(0, 12)
}

/**
 * Sanitize branch name for use in dist-tag
 * @param {string} branch - Branch name
 * @returns {string} - Sanitized branch name
 */
function sanitizeBranchName(branch) {
	return branch.replace(/[^a-zA-Z0-9_-]/g, '-')
}

/**
 * Compute preview versions for packages
 * @param {Array<{name: string, path: string, version: string}>} packages
 * @param {string} branchName
 * @returns {Promise<Array<{name: string, path: string, currentVersion: string, previewVersion: string, contentHash: string, branchTag: string, distPath: string}>>}
 */
export async function computeVersions(packages, branchName) {
	const results = []
	const sanitizedBranch = sanitizeBranchName(branchName)

	for (const pkg of packages) {
		const distPath = join(pkg.path, 'dist')

		try {
			await stat(distPath)
		} catch {
			throw new Error(`Package ${pkg.name} has no dist folder at ${distPath}`)
		}

		const contentHash = await hashDirectory(distPath)
		const baseVersion = pkg.version.replace(/-in-development$/, '').replace(/-.*$/, '')
		const previewVersion = `${baseVersion}-preview.${contentHash}`
		const branchTag = `branch-${sanitizedBranch}`

		results.push({
			name: pkg.name,
			path: pkg.path,
			currentVersion: pkg.version,
			previewVersion,
			contentHash,
			branchTag,
			distPath,
		})
	}

	return results
}
