/**
 * © 2025 Robert (Jamie) Munro
 * Licensed under the MIT license, see LICENSE file for details
 */

import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import type { VersionInfo } from './versions'

export interface PublishedPackage {
	name: string
	originalName: string
	version: string
	tag: string
	isNew: boolean // true if version was newly published, false if it already existed
}

/**
 * Check if a version already exists in the registry
 */
async function versionExists(
	packageName: string,
	version: string,
	registry: string,
	token: string
): Promise<boolean> {
	try {
		await exec.exec(
			'npm',
			['view', `${packageName}@${version}`, 'version', '--json', `--registry=${registry}`],
			{
				silent: true,
				env: {
					...process.env,
					'NPM_CONFIG_//npm.pkg.github.com/:_authToken': token,
				},
			}
		)
		return true
	} catch (error) {
		// 404 means version doesn't exist
		const err = error as Error
		if (err.message?.includes('404') || err.message?.includes('E404')) {
			return false
		}
		// Other errors should be logged
		core.warning(`Failed to check if ${packageName}@${version} exists: ${err.message}`)
		return false
	}
}

/**
 * Add dist-tag to existing version
 */
async function addDistTag(
	packageName: string,
	version: string,
	tag: string,
	registry: string,
	token: string
): Promise<void> {
		try {
			await exec.exec('npm', ['dist-tag', 'add', `${packageName}@${version}`, tag, `--registry=${registry}`], {
			env: {
				...process.env,
				'NPM_CONFIG_//npm.pkg.github.com/:_authToken': token,
			},
		})
		core.info(`  ✓ Tagged ${packageName}@${version} as ${tag}`)
	} catch (error) {
		throw new Error(`Failed to add dist-tag ${tag} to ${packageName}@${version}: ${(error as Error).message}`)
	}
}

/**
 * Publish package to registry
 */
async function publishPackage(
	packageDir: string,
	version: string,
	tag: string,
	registry: string,
	token: string
): Promise<void> {
	const packageJsonPath = path.join(packageDir, 'package.json')
	const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
	const packageName = packageJson.name
	const originalVersion = packageJson.version

	try {
		// Set version in package.json temporarily
		packageJson.version = version

		await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

		// Publish with tag
		await exec.exec('npm', ['publish', '--tag', tag, `--registry=${registry}`], {
			cwd: packageDir,
			env: {
				...process.env,
				'NPM_CONFIG_//npm.pkg.github.com/:_authToken': token,
			},
		})

		core.info(`  ✓ Published ${packageName}@${version} with tag ${tag}`)

		// Restore original version
		packageJson.version = originalVersion
		await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')
	} catch (error) {
		const err = error as Error

		// Check if this is a "version already exists" error (409 Conflict)
		if (err.message?.includes('409') || err.message?.includes('E409') || err.message?.includes('Cannot publish over existing version')) {
			core.info(`  ℹ️  Version ${version} already published, adding tag only`)

			// Restore original version first
			packageJson.version = originalVersion
			await writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

			// Add the dist-tag to the existing version
			await addDistTag(packageName, version, tag, registry, token)
			return
		}

		// Try to restore original version on error
		try {
			const originalJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
			await writeFile(packageJsonPath, JSON.stringify(originalJson, null, 2) + '\n', 'utf8')
		} catch (restoreError) {
			core.warning(`Failed to restore package.json: ${(restoreError as Error).message}`)
		}

		throw new Error(`Failed to publish ${packageName}@${version}: ${err.message}`)
	}
}

/**
 * Publish or tag packages
 */
export async function publishPackages(
	versions: VersionInfo[],
	registry: string,
	token: string
): Promise<PublishedPackage[]> {
	const published: PublishedPackage[] = []

	for (const pkg of versions) {
		core.info(`\nProcessing ${pkg.name}...`)

		const exists = await versionExists(pkg.name, pkg.previewVersion, registry, token)

		if (exists) {
			core.info(`  ℹ️  Version ${pkg.previewVersion} already exists`)
			await addDistTag(pkg.name, pkg.previewVersion, pkg.branchTag, registry, token)

			published.push({
				name: pkg.name,
				originalName: pkg.originalName,
				version: pkg.previewVersion,
				tag: pkg.branchTag,
				isNew: false,
			})
		} else {
			core.info(`  📦 Publishing new version ${pkg.previewVersion}`)
			await publishPackage(pkg.path, pkg.previewVersion, pkg.branchTag, registry, token)

			published.push({
				name: pkg.name,
				originalName: pkg.originalName,
				version: pkg.previewVersion,
				tag: pkg.branchTag,
				isNew: true,
			})
		}
	}

	return published
}
