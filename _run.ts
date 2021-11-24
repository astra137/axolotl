import { move } from 'https://deno.land/std/fs/mod.ts';
import { join } from 'https://deno.land/std/path/mod.ts';

const decoder = new TextDecoder('utf-8');

/** Deno.run().output() and wrapping code. */
export async function run(params: {
	cmd: string[];
	cwd?: string;
	env?: Record<string, string>;
}) {
	const p = Deno.run({
		...params,
		stdin: 'null',
		stdout: 'piped',
		stderr: 'piped',
	});
	const [{ success, code }, out, err] = await Promise.all([
		p.status(),
		p.output(),
		p.stderrOutput(),
	]);
	p.close();
	if (success) {
		return decoder.decode(out).trim();
	} else {
		const msg = decoder.decode(err).trim();
		throw new Error(`Exit ${code}: ${msg}`);
	}
}

/** https://docs.microsoft.com/en-us/windows/win32/shell/knownfolderid */
export async function pwshKnownFolder(id: 'ApplicationData') {
	const value = `[Environment]::GetFolderPath([Environment+SpecialFolder]::${id})`;
	return await run({ cmd: ['pwsh', '-noprofile', '-command', value] });
}

/** Use PowerShell Core on Windows, or unzip otherwise. */
export async function unzip(
	path: string,
	dest: string,
	opt?: { xlist: string[] }
) {
	if (Deno.build.os === 'windows') {
		const tmp = await Deno.makeTempDir();
		const c = ['Expand-Archive', '-Path', path, '-DestinationPath', tmp];
		await run({ cmd: ['pwsh', '-noprofile', '-command', ...c] });
		entries: for await (const dirEntry of Deno.readDir(tmp)) {
			for (const exclude of opt?.xlist ?? []) {
				if (dirEntry.name.startsWith(exclude)) {
					continue entries;
				}
			}
			if (dirEntry.name.startsWith('META-INF')) {
				continue entries;
			}
			await move(join(tmp, dirEntry.name), join(dest, dirEntry.name), {
				overwrite: true,
			});
		}
	} else {
		const cmd = ['unzip', '-uo', path, '-d', dest];
		if (opt?.xlist) cmd.push('-x', ...opt.xlist);
		await run({ cmd });
	}
}
