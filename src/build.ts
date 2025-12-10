/**
 * © 2025 Robert (Jamie) Munro
 * Licensed under the MIT license, see LICENSE file for details
 */

import * as exec from '@actions/exec'

/**
 * Build packages
 */
export async function buildPackages(buildCommand: string): Promise<void> {
	await exec.exec(buildCommand)
}
