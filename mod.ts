// deno-lint-ignore-file camelcase
import type {
	AssetIndexJson,
	Features,
	VersionJson,
	ManifestJson,
	LibraryJson,
	Artifact,
} from './types.d.ts';
import { download, sha1sum } from './_fs.ts';
import { unzip } from './_run.ts';
import { findJavaForMinecraft } from './java.ts';
import { allowed } from './rules.ts';
import { kunokazu } from './async.ts';
import { AuthState, Profile } from './auth/mod.ts';

import { join, parse, format } from 'https://deno.land/std/path/mod.ts';
import { ensureDir, ensureLink } from 'https://deno.land/std/fs/mod.ts';

// import {} from 'https://deno.land/x/Thread@v3.0.0/Thread.ts';

export const LAUNCHER_NAME = 'astra137/allay';
export const LAUNCHER_VERSION = '0.0.0';
export const MANIFEST_URL =
	'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

export function getMinecraftFolder() {
	switch (Deno.build.os) {
		case 'darwin': {
			const home = Deno.env.get('HOME');
			if (!home) throw new Deno.errors.NotFound();
			return join(home, 'Library/Application Support/minecraft');
		}

		case 'linux': {
			const home = Deno.env.get('HOME');
			if (!home) throw new Deno.errors.NotFound();
			return join(home, '.minecraft');
		}

		case 'windows': {
			const appdata = Deno.env.get('APPDATA');
			if (!appdata) throw new Deno.errors.NotFound();
			return join(appdata, '.minecraft');
		}

		default:
			throw Error('unreachable');
	}
}

interface Library {
	path: string;
	url: string;
	size: number;
	sha1: string;
	natives?: boolean;
}

export interface Version {
	id: string;
	ids: string[];
	paths: {
		assets: string;
		libraries: string;
		natives: string;
		runtime: string;
		resources?: string;
	};
	assets: {
		id: string;
		totalSize: number;
		objects: Map<string, Artifact>;
	};
	logging?: {
		type: string;
		argument: string;
		file: { id: string; sha1: string; size: number; url: string; path: string };
	};
	jars: Library[];
	java: {
		version: number;
		matches: {
			path: string;
			JAVA_VERSION: string;
		}[];
	};
	type: string;
	jvmArgs: string[];
	mainClass: string;
	gameArgs: string[];
}

function pathManifest(dir: string) {
	return join(dir, 'versions/version_manifest_v2.json');
}

function pathVersion(dir: string, id: string) {
	return join(dir, `versions/${id}/${id}.json`);
}

function pathVersionClient(cache: string, id: string) {
	const { dir, name } = parse(pathVersion(cache, id));
	return format({ dir, name, ext: '.jar' });
}

function pathAssetIndex(dir: string, id: string) {
	return join(dir, `assets/indexes/${id}.json`);
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await Deno.readTextFile(path));
}

async function cacheManifest(dir: string, mustBeFresh: boolean) {
	const path = pathManifest(dir);
	// TODO: proper logic for this
	if (!mustBeFresh) {
		try {
			return await readJson<ManifestJson>(path);
		} catch (err) {
			if (!(err instanceof Deno.errors.NotFound)) throw err;
		}
	}
	await download(path, MANIFEST_URL);
	return await readJson<ManifestJson>(path);
}

async function cacheVersion(dir: string, id: string) {
	const path = pathVersion(dir, id);
	try {
		return await readJson<VersionJson>(path);
	} catch (err) {
		if (!(err instanceof Deno.errors.NotFound)) throw err;
	}
	const manifest = await cacheManifest(dir, true);
	const versmeta = manifest.versions.find((x) => x.id === id);
	if (!versmeta) throw new Error(`version "${id}" cannot be found`);
	await download(path, versmeta.url);
	await sha1sum(path, versmeta.sha1);
	return await readJson<VersionJson>(path);
}

async function cacheAssetIndex(
	dir: string,
	id: string,
	meta: { url: string; sha1: string; size: number }
) {
	const path = pathAssetIndex(dir, id);
	try {
		return await readJson<AssetIndexJson>(path);
	} catch (err) {
		if (!(err instanceof Deno.errors.NotFound)) throw err;
	}
	await download(path, meta.url);
	await sha1sum(path, meta.sha1);
	return await readJson<AssetIndexJson>(path);
}

function untemplate(defs: Record<string, string>, x: string) {
	const match = x.matchAll(/\$\{(\w+)\}/gi);
	for (const [full, name] of match) {
		if (typeof defs[name] === 'string') {
			x = x.replace(full, defs[name]);
		} else {
			throw new Error(`Undefined templated value: ${x}`);
		}
	}
	return x;
}

function findNatives(lib: LibraryJson) {
	if (!lib.natives) return;
	if (!lib.downloads.classifiers) return;
	let clazz;
	switch (Deno.build.os) {
		case 'darwin':
			clazz = lib.natives.osx;
			break;
		case 'linux':
			clazz = lib.natives.linux;
			break;
		case 'windows':
			clazz = lib.natives.windows;
			break;
		default:
			throw new Error(`unreachable`);
	}
	if (!clazz) return;
	const file = lib.downloads.classifiers[untemplate({ arch: '64' }, clazz)];
	if (!file) throw new Error(`${lib.name} is missing downloads.${clazz}`);
	return file;
}

async function compileVersion(
	dir: string,
	feat: Features,
	input: string | VersionJson,
	ids: string[]
): Promise<Version> {
	if (typeof input === 'string') {
		const parent = await cacheVersion(dir, input);
		return await compileVersion(dir, feat, parent, [...ids]);
	}

	const json: VersionJson = input;
	if (!json.id) throw new Error('expected property id');
	if (ids.includes(json.id))
		throw new Error(`inheritance loop: ${[...ids, json.id]}`);

	function mergeLibraries(version: Version) {
		const additions: Library[] = [];

		for (const lib of json.libraries ?? []) {
			if (!allowed(lib.rules ?? [], feat)) continue;
			if (lib.downloads.artifact) {
				const { sha1, size, url, path: mavenPath } = lib.downloads.artifact;
				const path = join(dir, 'libraries', mavenPath);
				if (!additions.find((x) => x.sha1 === sha1)) {
					additions.push({ path, sha1, size, url } as const);
				}
			}
			const binaryArtifact = findNatives(lib);
			if (binaryArtifact) {
				const { sha1, size, url, path: mavenPath } = binaryArtifact;
				const path = join(dir, 'libraries', mavenPath);
				if (!additions.find((x) => x.sha1 === sha1 && x.natives)) {
					additions.push({ natives: true, path, sha1, size, url } as const);
				}
			}
		}

		version.jars.unshift(...additions);
	}

	function mergeArguments(version: Version) {
		for (const arg of json.arguments?.jvm ?? []) {
			if (typeof arg === 'string') {
				version.jvmArgs.push(arg);
			} else if (allowed(arg.rules, feat)) {
				version.jvmArgs.push(
					...(Array.isArray(arg.value) ? arg.value : [arg.value])
				);
			}
		}
		for (const arg of json.arguments?.game ?? []) {
			if (typeof arg === 'string') {
				version.gameArgs.push(arg);
			} else if (allowed(arg.rules, feat)) {
				version.gameArgs.push(
					...(Array.isArray(arg.value) ? arg.value : [arg.value])
				);
			}
		}
	}

	function parseLogging() {
		if (!json.logging) return;
		if (!json.logging.client) return;
		return {
			type: json.logging.client.type,
			argument: json.logging.client.argument,
			file: {
				...json.logging.client.file,
				path: join(dir, `assets/log_configs/${json.logging.client.file.id}`),
			},
		};
	}

	if (json.inheritsFrom) {
		const parent = await cacheVersion(dir, json.inheritsFrom);
		const version = await compileVersion(dir, feat, parent, [...ids, json.id]);

		// version.id = json.id ?? version.id;
		// version.type = json.type ?? version.type;
		version.logging = parseLogging() ?? version.logging; // TODO
		version.mainClass = json.mainClass ?? version.mainClass;
		mergeLibraries(version);
		mergeArguments(version);

		return version;
	} else {
		if (!json.type) throw new Error(`Expected property type`);
		if (!json.assets) throw new Error(`Expected property assets`);
		if (!json.assetIndex) throw new Error(`Expected property assetIndex`);
		if (!json.downloads) throw new Error(`Expected property downloads`);
		if (!json.mainClass) throw new Error(`Expected property mainClass`);
		if (json.assets !== json.assetIndex.id) throw new Error('Different assets');

		const index = await cacheAssetIndex(dir, json.assets, json.assetIndex);

		if (index.virtual && index.map_to_resources) {
			throw new Error('Expected either virtual or map_to_resources, not both!');
		}

		/**
		 * For some reason, the pre-1.6 asset index does not include these files,
		 * but the game client still looks for (and uses) them.
		 */
		const defaultPre16Objects = {
			'icons/icon_16x16.png': {
				hash: 'bdf48ef6b5d0d23bbb02e17d04865216179f510a',
				size: 3665,
			},
			'icons/icon_32x32.png': {
				hash: '92750c5f93c312ba9ab413d546f32190c56d6f1f',
				size: 5362,
			},
			'icons/minecraft.icns': {
				hash: '991b421dfd401f115241601b2b373140a8d78572',
				size: 114786,
			},
		};

		for (const [name, { hash, size }] of Object.entries(defaultPre16Objects)) {
			if (!(name in index.objects)) {
				console.trace('stub', name);
				index.objects[name] = { hash, size };
			}
		}

		const objects = new Map<string, Artifact>(
			Object.entries(index.objects).map(([name, { hash, size }]) => {
				const prefix = hash.slice(0, 2);
				const path = join(dir, 'assets', `objects`, prefix, hash);
				const url = `https://resources.download.minecraft.net/${prefix}/${hash}`;
				return [name, { sha1: hash, size, path, url }];
			})
		);

		// Snap 16 to 17 for LTS status.
		let javaVersion = json.javaVersion?.majorVersion ?? 8;
		if (javaVersion === 16) javaVersion = 17;

		const version: Version = {
			id: json.id,
			ids,
			paths: {
				assets: join(dir, 'assets'),
				libraries: join(dir, 'libraries'),
				natives: join(dir, 'bin/natives', json.id),
				runtime: join(dir, 'runtime'),
				resources: index.map_to_resources
					? join(dir, 'resources')
					: index.virtual
					? join(dir, `assets/virtual/${json.assets}`)
					: undefined,
			},
			assets: {
				id: json.assetIndex.id,
				totalSize: json.assetIndex.totalSize,
				objects,
			},
			logging: parseLogging(),
			jars: [
				{
					path: pathVersionClient(dir, json.id),
					...json.downloads.client,
				},
			],
			java: {
				version: javaVersion,
				matches: await findJavaForMinecraft(
					join(dir, 'runtime'),
					json.javaVersion?.component ?? 'jre-legacy',
					javaVersion
				),
			},
			type: json.type,
			jvmArgs: [],
			mainClass: json.mainClass ?? 'net.minecraft.client.main.Main',
			gameArgs: [],
		};

		mergeLibraries(version);
		mergeArguments(version);

		if (version.jvmArgs.length === 0) {
			version.jvmArgs.push(
				'-Djava.library.path=${natives_directory}',
				'-Dminecraft.launcher.brand=${launcher_name}',
				'-Dminecraft.launcher.version=${launcher_version}',
				'-cp',
				'${classpath}'
			);
		}

		if (version.gameArgs.length === 0) {
			if (!json.minecraftArguments)
				throw new Error(`Expected property minecraftArguments`);
			version.gameArgs.push(...json.minecraftArguments.split(' '));
		}

		return version;
	}
}

/**
 *
 *
 *
 *
 *
 *
 *
 *
 */
export async function inspect(id: string, auth?: AuthState, profile?: Profile) {
	const feat: Features = {};
	const cache = getMinecraftFolder();
	const version = await compileVersion(cache, feat, id, []);

	// Default official launcher arguments as of Nov 2021
	const customArgs = [
		'-Xmx2G',
		'-XX:+UnlockExperimentalVMOptions',
		'-XX:+UseG1GC',
		'-XX:G1NewSizePercent=20',
		'-XX:G1ReservePercent=20',
		'-XX:MaxGCPauseMillis=50',
		'-XX:G1HeapRegionSize=32M',
	];

	const separator = Deno.build.os === 'windows' ? ';' : ':';

	const params: LaunchParams = {
		natives_directory: version.paths.natives,
		library_directory: version.paths.libraries, // Used by Forge
		launcher_name: LAUNCHER_NAME,
		launcher_version: LAUNCHER_VERSION,
		classpath_separator: separator, // Used by Forge
		classpath: version.jars.map((x) => x.path).join(separator),
		resolution_width: '1920',
		resolution_height: '1080',
		auth_xuid: '', // TODO: 1.18
		clientid: '', // TODO: 1.18

		// Game args <= 1.12
		auth_player_name: profile?.name ?? '',
		version_name: version.id,
		game_directory: '.',
		assets_root: version.paths.assets,
		assets_index_name: version.assets.id,
		auth_uuid: profile?.id ?? '',
		auth_access_token: auth?.mca.access_token ?? '',
		user_type: 'msa', // TODO: mojang, legacy, msa ?
		version_type: version.type,
		user_properties: '{}',

		// Game args <= 1.6
		auth_session: `token:${auth?.mca.access_token ?? ''}`, // TODO: verify
		game_assets: version.paths.resources ?? 'resources',
	};

	return {
		version,
		natives: version.jars.filter((x) => x.natives).length,
		feat,
		customArgs,
		params,
	};
}

export type Task = {
	text: string;
	completed: number;
	total: number;
};

export type InstallState = {
	active: number;
	tasks: {
		bytes: Task;
		files: Task;
		fetch: Task;
	};
};

/** */
export async function* install(version: Version) {
	const $: InstallState = {
		active: 0,
		tasks: {
			bytes: { text: `bytes`, total: 0, completed: 0 },
			files: { text: `files`, total: 0, completed: 0 },
			fetch: { text: `fetch`, total: 0, completed: 0 },
		},
	};

	const _files = function* () {
		yield* version.jars;
		yield* version.assets.objects.values();
		if (version.logging) {
			yield version.logging.file;
		}
	};

	for (const x of _files()) {
		$.tasks.bytes.total += x.size;
		$.tasks.files.total += 1;
	}

	const seen = new Map<string, Artifact>();

	yield $;

	await ensureDir(version.paths.natives);

	yield* kunokazu(navigator.hardwareConcurrency, _files(), async function* (x) {
		if (seen.has(x.path)) {
			$.tasks.bytes.total -= x.size;
			$.tasks.files.total -= 1;
			yield $;
			return;
		} else {
			seen.set(x.path, x);
		}

		$.active++;
		yield $;

		try {
			await sha1sum(x.path, x.sha1);
		} catch {
			$.tasks.fetch.total += x.size;
			yield $;
			await download(x.path, x.url);
			await sha1sum(x.path, x.sha1);
			$.tasks.fetch.completed += x.size;
		}

		// TODO: replace with a TypeScript-enforceable flag, not this hidden one.
		if ('natives' in x) {
			await unzip(x.path, version.paths.natives, { xlist: ['META-INF/'] });
		}

		$.tasks.bytes.completed += x.size;
		$.tasks.files.completed += 1;
		$.active--;
		yield $;
	});
}

//
//
//
//
//
//
//
//
//
//
//

export type LaunchParams = {
	natives_directory: string;
	library_directory: string;
	launcher_name: string;
	launcher_version: string;
	classpath_separator: string;
	classpath: string;
	resolution_width: string;
	resolution_height: string;
	auth_xuid: string;
	clientid: string;

	// Game args <= 1.12
	auth_player_name: string;
	version_name: string;
	game_directory: string;
	assets_root: string;
	assets_index_name: string;
	auth_uuid: string;
	auth_access_token: string;
	user_type: 'msa' | 'mojang' | 'legacy';
	version_type: string;
	user_properties: string; // TODO

	// Game args <= 1.6
	auth_session: `token:${string}`;
	game_assets: string;
};

/** */
export async function play(
	version: Version,
	params: LaunchParams,
	customArgs: string[]
) {
	if (version.paths.resources) {
		for (const [name, { path }] of version.assets.objects) {
			await ensureLink(path, join(version.paths.resources, name));
		}
	}

	const icns = version.assets.objects.get('icons/minecraft.icns')!.path;

	const logArgList = version.logging ? [version.logging.argument] : [];
	const logArgDefs = { path: version.logging?.file.path ?? '' };

	const javaName = Deno.build.os === 'windows' ? 'javaw' : 'java';
	const javaPath = version.java.matches[0]
		? join(version.java.matches[0].path, 'bin', javaName)
		: javaName;

	const cmd = [
		javaPath,
		// '-client',
		// '-Xmn128M',
		...(Deno.build.os === 'darwin'
			? ['-Xdock:name=Minecraft', `-Xdock:icon=${icns}`]
			: []),
		// `-Dfml.log.level=ALL`,
		// `-Dfml.debugExit=true`,
		// `-Duser.language=en`,
		// `-Duser.country=us`,
		...version.jvmArgs.map((x) => untemplate(params, x)),
		...customArgs,
		...logArgList.map((x) => untemplate(logArgDefs, x)),
		version.mainClass,
		...version.gameArgs.map((x) => untemplate(params, x)),
	];

	// console.log(cmd);

	if (Deno.args.includes('--dry')) return;

	const p = Deno.run({
		cmd,
		stdin: 'inherit',
		stdout: 'inherit',
		stderr: 'inherit',
	});

	const { success, code } = await p.status();
	p.close();
	if (!success) throw new Error(`JVM Exited ${code}`);
}
