import * as exec from '@actions/exec'

/**
 * Build packages
 * @param {string} packagesDir - Directory containing packages
 * @param {string} buildCommand - Command to run to build packages
 */
export async function buildPackages(packagesDir, buildCommand) {
	await exec.exec(buildCommand, [], {
		cwd: packagesDir,
	})
}
