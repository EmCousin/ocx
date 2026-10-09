import { describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runProfileDoctor } from "../../src/commands/profile/index"
import { ProfileManager } from "../../src/profile/manager"
import { getProfileDir } from "../../src/profile/paths"
import { ConfigError } from "../../src/utils/errors"

async function withIsolatedConfig(run: () => Promise<void>): Promise<void> {
	const originalXdg = process.env.XDG_CONFIG_HOME
	const root = await mkdtemp(join(tmpdir(), "ocx-profile-doctor-"))
	process.env.XDG_CONFIG_HOME = root
	try {
		await run()
	} finally {
		if (originalXdg !== undefined) process.env.XDG_CONFIG_HOME = originalXdg
		else delete process.env.XDG_CONFIG_HOME
		await rm(root, { recursive: true, force: true })
	}
}

describe("profile doctor", () => {
	it("runs the executable doctor owned by the selected profile", async () => {
		await withIsolatedConfig(async () => {
			await ProfileManager.create().add("checked")
			const doctor = join(getProfileDir("checked"), "doctor")
			await writeFile(doctor, "#!/bin/sh\nprintf 'checked ok\\n'\nexit 0\n")
			await chmod(doctor, 0o755)

			expect(await runProfileDoctor("checked")).toBe(0)
		})
	})

	it("returns the profile doctor exit code", async () => {
		await withIsolatedConfig(async () => {
			await ProfileManager.create().add("failing")
			const doctor = join(getProfileDir("failing"), "doctor")
			await writeFile(doctor, "#!/bin/sh\nprintf 'missing token\\n' >&2\nexit 7\n")
			await chmod(doctor, 0o755)

			expect(await runProfileDoctor("failing")).toBe(7)
		})
	})

	it("names a profile that does not provide a doctor", async () => {
		await withIsolatedConfig(async () => {
			await ProfileManager.create().add("empty")

			await expect(runProfileDoctor("empty")).rejects.toThrow(
				'Profile "empty" has no executable doctor script',
			)
		})
	})

	it("rejects a directory named doctor", async () => {
		await withIsolatedConfig(async () => {
			await ProfileManager.create().add("directory")
			await mkdir(join(getProfileDir("directory"), "doctor"))

			await expect(runProfileDoctor("directory")).rejects.toThrow("must be a regular file")
		})
	})

	it("keeps doctor stdout out of the JSON result stream", async () => {
		await withIsolatedConfig(async () => {
			await ProfileManager.create().add("json")
			const doctor = join(getProfileDir("json"), "doctor")
			await writeFile(doctor, "#!/bin/sh\nprintf 'not json\\n'\nexit 3\n")
			await chmod(doctor, 0o755)
			const lines: string[] = []
			const originalWrite = process.stdout.write.bind(process.stdout)
			process.stdout.write = ((chunk: string | Uint8Array) => {
				lines.push(chunk.toString())
				return true
			}) as typeof process.stdout.write
			try {
				expect(await runProfileDoctor("json", { json: true })).toBe(3)
			} finally {
				process.stdout.write = originalWrite
			}
			expect(lines.join("")).not.toContain("not json")
		})
	})

	it("rejects a doctor that is not executable", async () => {
		await withIsolatedConfig(async () => {
			await ProfileManager.create().add("plain")
			await mkdir(getProfileDir("plain"), { recursive: true })
			await writeFile(join(getProfileDir("plain"), "doctor"), "#!/bin/sh\nexit 0\n", { mode: 0o644 })

			await expect(runProfileDoctor("plain")).rejects.toBeInstanceOf(ConfigError)
		})
	})
})
