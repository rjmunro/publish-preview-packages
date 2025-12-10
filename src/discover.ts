/**
 * © 2025 Robert (Jamie) Munro
 * Licensed under the MIT license, see LICENSE file for details
 */

import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'

export interface PackageInfo {
	name: string
	originalName: string
	path: string
	version: string
}

/**
 * Replace or add scope to package name
 */
function applyScopeToPackage(packageName: string, scope: string): string {
	// Remove existing scope if present
	const nameWithoutScope = packageName.startsWith('@')
		? packageName.split('/')[1] || packageName
		: packageName

	return `@${scope}/${nameWithoutScope}`
}

/**
 * Update package.json to use repository owner's scope
 */
async function ensurePackageScope(pkgPath: string, scope: string): Promise<{ name: string; originalName: string; version: string }> {
	const pkgJsonPath = join(pkgPath, 'package.json')
	const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))

	const originalName = pkgJson.name
	const scopedName = applyScopeToPackage(originalName, scope)

	if (originalName !== scopedName) {
		pkgJson.name = scopedName
		await writeFile(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + '\n', 'utf8')
	}

	return {
		name: pkgJson.name,
		originalName: originalName,
		version: pkgJson.version,
	}
}

/**
 * Discover packages to publish
 */
export async function discoverPackages(
	packagesInput: string,
	repositoryOwner: string
): Promise<PackageInfo[]> {
	const packages: PackageInfo[] = []

	// Explicit package paths provided
	if (packagesInput) {
		const paths = packagesInput
			.split('\n')
			.map((s) => s.trim())
			.filter((s) => s.length > 0)

		for (const pkgPath of paths) {
			try {
				const pkgInfo = await ensurePackageScope(pkgPath, repositoryOwner)
				packages.push({
					name: pkgInfo.name,
					originalName: pkgInfo.originalName,
					path: pkgPath,
					version: pkgInfo.version,
				})
			} catch (error) {
				throw new Error(`Failed to read package.json at ${pkgPath}: ${(error as Error).message}`)
			}
		}
		return packages
	}

	// Auto-discover: Check if root is a package
	const rootPkgJsonPath = 'package.json'
	let isRootPackage = false
	try {
		const stats = await stat(rootPkgJsonPath)
		isRootPackage = stats.isFile()
	} catch {
		// Not a root package, will search packages/ directory
	}

	// If root is a package, publish it directly
	if (isRootPackage) {
		try {
			const pkgJson = JSON.parse(await readFile(rootPkgJsonPath, 'utf8'))

			// Skip if private
			if (pkgJson.private) {
				throw new Error('Root package is marked as private and cannot be published')
			}

			const pkgInfo = await ensurePackageScope('.', repositoryOwner)
			packages.push({
				name: pkgInfo.name,
				originalName: pkgInfo.originalName,
				path: '.',
				version: pkgInfo.version,
			})
			return packages
		} catch (error) {
			throw new Error(`Failed to read root package.json: ${(error as Error).message}`)
		}
	}

	// Auto-discover from packages/ directory
	const packagesDir = 'packages'
	try {
		const entries = await readdir(packagesDir, { withFileTypes: true })

		for (const entry of entries) {
			if (!entry.isDirectory()) continue

			const pkgPath = join(packagesDir, entry.name)
			const pkgJsonPath = join(pkgPath, 'package.json')

			try {
				const stats = await stat(pkgJsonPath)
				if (!stats.isFile()) continue

				const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))

				// Skip private packages
				if (pkgJson.private) continue

				const pkgInfo = await ensurePackageScope(pkgPath, repositoryOwner)
				packages.push({
					name: pkgInfo.name,
					originalName: pkgInfo.originalName,
					path: pkgPath,
					version: pkgInfo.version,
				})
			} catch {
				// Skip directories without package.json
				continue
			}
		}
	} catch (error) {
		throw new Error(`Failed to discover packages in packages/: ${(error as Error).message}`)
	}

	if (packages.length === 0) {
		throw new Error('No packages found in packages/ directory')
	}

	return packages
}
