import { install, InstallState, play, inspect } from './mod.ts';
import { createSession, resumeSession } from './auth/mod.ts';
import { zuluInstall } from './java.ts';

import { wait } from 'https://deno.land/x/wait/mod.ts';
// import { timeAgo } from 'https://deno.land/x/time_ago/mod.ts';
// import { open } from 'https://deno.land/x/open/index.ts';

export const STANDARD_GALACTIC_ALPHABET = 'ᔑʖᓵ↸ᒷ⎓⊣⍑╎⋮ꖌꖎᒲリ𝙹!¡ᑑ∷ᓭℸ̣⚍⍊∴̇/||⨅';

function intoMiB(B: number) {
	return (B / 2 ** 20).toFixed(1);
}

async function ensureSession() {
	try {
		return await resumeSession();
	} catch (err) {
		console.error('Could not resume:', err.message);
		return await createSession();
	}
}

//
//
//

try {
	const spinner = wait({
		text: 'Session',
		interval: 50,
		spinner: {
			interval: 50, // Doesn't seem to get used
			frames: STANDARD_GALACTIC_ALPHABET.split(''),
		},
	}).start();

	const { auth, profile } = await ensureSession();
	spinner.succeed(`Logged in as ${profile.name}`);

	// console.debug('msa  expiry', timeAgo(new Date(auth.msa.expiry)));
	// console.debug('xbl  expiry', timeAgo(new Date(auth.xbl.expiry)));
	// console.debug('xsts expiry', timeAgo(new Date(auth.xsts.expiry)));
	// console.debug('mca  expiry', timeAgo(new Date(auth.mca.expiry)));

	spinner.text = `Inspect ${Deno.cwd()}`;
	spinner.start();
	let info = await inspect(Deno.args[0], auth, profile);
	spinner.succeed();

	// console.dir(info, { depth: 5 });

	if (info.version.java.matches.length === 0) {
		console.warn('No JVM found!');
		const msg = `Download Java ${info.version.java.version} (Azul Zulu OpenJDK JRE bundle)?`;
		const ok = confirm(msg);
		if (!ok) throw new Error('A JVM is required');
		const { version } = info.version.java;
		spinner.text = `Download Azul Zulu OpenJDK JRE ${version}`;
		spinner.start();
		const home = await zuluInstall(info.version.paths.runtime, version);
		spinner.succeed(`JVM saved to ${home.path}`);

		spinner.text = 'Inspect (again)';
		spinner.start();
		info = await inspect(Deno.args[0], auth, profile);
		if (info.version.java.matches.length === 0) throw Error('unreachable');
		spinner.succeed();
	}

	// Install game files
	let state: InstallState;

	spinner.text = 'Install';
	spinner.start();
	for await (const s of install(info.version)) {
		state = s;
		spinner.text = `${s.tasks.files.completed}/${s.tasks.files.total} files, ${s.tasks.bytes.completed}/${s.tasks.bytes.total} bytes, ${s.tasks.fetch.completed}/${s.tasks.fetch.total} fetched, ${s.active} active`;
	}
	spinner.succeed();

	const cached = intoMiB(state!.tasks.bytes.total);
	const fetched = intoMiB(state!.tasks.fetch.total);
	console.debug(`Downloaded ${fetched} MiB and cached ${cached} MiB.`);

	await play(info.version, info.params, info.customArgs);

	//
	//
	//
} catch (err) {
	console.error(err);
	if (err instanceof AggregateError) {
		console.error(err.errors);
		console.error(err.cause);
	}
	console.debug(Deno.resources());
	Deno.exit(1);
}
