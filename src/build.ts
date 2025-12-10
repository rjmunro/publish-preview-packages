import * as exec from '@actions/exec'

/**
 * Build packages
 */
export async function buildPackages(packagesDir: string, buildCommand: string): Promise<void> {
	await exec.exec(buildCommand, [], {
		cwd: packagesDir,
	})
}
