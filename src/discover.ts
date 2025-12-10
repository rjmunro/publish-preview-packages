/**
 * © 2025 Robert (Jamie) Munro
 * Licensed under the MIT license, see LICENSE file for details
 */

import { readdir, readFile, stat, writeFile } from 'fs/promises'
import { join } from 'path'

export interface PackageInfo {
	name: string
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
async function ensurePackageScope(pkgPath: string, scope: string): Promise<{ name: string; version: string }> {
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
		version: pkgJson.version,
	}
}

/**
 * Discover packages to publish
 */
export async function discoverPackages(
	packagesDir: string,
	packageList: string,
	repositoryOwner: string
): Promise<PackageInfo[]> {
	const packages: PackageInfo[] = []

	// If specific packages are listed, use those
	if (packageList) {
		const names = packageList.split(',').map((s) => s.trim())
		for (const name of names) {
			const pkgPath = join(packagesDir, name)

			try {
				const pkgInfo = await ensurePackageScope(pkgPath, repositoryOwner)
				packages.push({
					name: pkgInfo.name,
					path: pkgPath,
					version: pkgInfo.version,
				})
			} catch (error) {
				throw new Error(`Failed to read package.json for ${name}: ${(error as Error).message}`)
			}
		}
		return packages
	}

	// Auto-discover from packages directory
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
					path: pkgPath,
					version: pkgInfo.version,
				})
			} catch {
				// Skip directories without package.json
				continue
			}
		}
	} catch (error) {
		throw new Error(`Failed to discover packages in ${packagesDir}: ${(error as Error).message}`)
	}

	if (packages.length === 0) {
		throw new Error(`No packages found in ${packagesDir}`)
	}

	return packages
}
