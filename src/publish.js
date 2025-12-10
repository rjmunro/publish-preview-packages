import * as core from '@actions/core'
import * as exec from '@actions/exec'
import * as path from 'path'

/**
 * Check if a version already exists in the registry
 * @param {string} packageName
 * @param {string} version
 * @param {string} registry
 * @param {string} token
 * @returns {Promise<boolean>}
 */
async function versionExists(packageName, version, registry, token) {
	try {
		await exec.exec(
			'npm',
			['view', `${packageName}@${version}`, 'version', '--json', `--registry=${registry}`],
			{
				silent: true,
				env: {
					...process.env,
					NPM_CONFIG_//npm.pkg.github.com/:_authToken: token,
				},
			}
		)
		return true
	} catch (error) {
		// 404 means version doesn't exist
		if (error.message?.includes('404') || error.message?.includes('E404')) {
			return false
		}
		// Other errors should be logged
		core.warning(`Failed to check if ${packageName}@${version} exists: ${error.message}`)
		return false
	}
}

/**
 * Add dist-tag to existing version
 * @param {string} packageName
 * @param {string} version
 * @param {string} tag
 * @param {string} registry
 * @param {string} token
 */
async function addDistTag(packageName, version, tag, registry, token) {
	try {
		await exec.exec('npm', ['dist-tag', 'add', `${packageName}@${version}`, tag, `--registry=${registry}`], {
			env: {
				...process.env,
				NPM_CONFIG_//npm.pkg.github.com/:_authToken: token,
			},
		})
		core.info(`  ✓ Tagged ${packageName}@${version} as ${tag}`)
	} catch (error) {
		throw new Error(`Failed to add dist-tag ${tag} to ${packageName}@${version}: ${error.message}`)
	}
}

/**
 * Publish package to registry
 * @param {string} packageDir
 * @param {string} version
 * @param {string} tag
 * @param {string} registry
 * @param {string} token
 */
async function publishPackage(packageDir, version, tag, registry, token) {
	const packageJsonPath = path.join(packageDir, 'package.json')
	const packageJson = JSON.parse(await require('fs').promises.readFile(packageJsonPath, 'utf8'))
	const packageName = packageJson.name

	try {
		// Set version in package.json temporarily
		const originalVersion = packageJson.version
		packageJson.version = version

		await require('fs').promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')

		// Publish with tag
		await exec.exec('npm', ['publish', '--tag', tag, `--registry=${registry}`], {
			cwd: packageDir,
			env: {
				...process.env,
				NPM_CONFIG_//npm.pkg.github.com/:_authToken: token,
			},
		})

		core.info(`  ✓ Published ${packageName}@${version} with tag ${tag}`)

		// Restore original version
		packageJson.version = originalVersion
		await require('fs').promises.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n', 'utf8')
	} catch (error) {
		// Try to restore original version on error
		try {
			const originalJson = JSON.parse(await require('fs').promises.readFile(packageJsonPath, 'utf8'))
			await require('fs').promises.writeFile(packageJsonPath, JSON.stringify(originalJson, null, 2) + '\n', 'utf8')
		} catch (restoreError) {
			core.warning(`Failed to restore package.json: ${restoreError.message}`)
		}

		throw new Error(`Failed to publish ${packageName}@${version}: ${error.message}`)
	}
}

/**
 * Publish or tag packages
 * @param {Array<{name: string, path: string, version: string, branchTag: string}>} versions
 * @param {string} registry
 * @param {string} token
 * @returns {Promise<Array<{name: string, version: string, tag: string}>>}
 */
export async function publishPackages(versions, registry, token) {
	const published = []

	for (const pkg of versions) {
		core.info(`\nProcessing ${pkg.name}...`)

		const exists = await versionExists(pkg.name, pkg.version, registry, token)

		if (exists) {
			core.info(`  ℹ️  Version ${pkg.version} already exists`)
			await addDistTag(pkg.name, pkg.version, pkg.branchTag, registry, token)
		} else {
			core.info(`  📦 Publishing new version ${pkg.version}`)
			await publishPackage(pkg.path, pkg.version, pkg.branchTag, registry, token)
		}

		published.push({
			name: pkg.name,
			version: pkg.version,
			tag: pkg.branchTag,
		})
	}

	return published
}
