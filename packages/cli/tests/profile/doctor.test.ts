import { describe, expect, it } from "bun:test"
import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises"
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

			await expect(runProfileDoctor("empty")).rejects.toBeInstanceOf(ConfigError)
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
