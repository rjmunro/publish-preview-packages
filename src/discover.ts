import { readdir, readFile, stat } from 'fs/promises'
import { join } from 'path'

export interface PackageInfo {
	name: string
	path: string
	version: string
}

/**
 * Discover packages to publish
 */
export async function discoverPackages(
	packagesDir: string,
	packageList: string
): Promise<PackageInfo[]> {
	const packages: PackageInfo[] = []

	// If specific packages are listed, use those
	if (packageList) {
		const names = packageList.split(',').map((s) => s.trim())
		for (const name of names) {
			const pkgPath = join(packagesDir, name)
			const pkgJsonPath = join(pkgPath, 'package.json')

			try {
				const pkgJson = JSON.parse(await readFile(pkgJsonPath, 'utf8'))
				packages.push({
					name: pkgJson.name,
					path: pkgPath,
					version: pkgJson.version,
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

				packages.push({
					name: pkgJson.name,
					path: pkgPath,
					version: pkgJson.version,
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
