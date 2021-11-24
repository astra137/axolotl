// deno-lint-ignore-file camelcase
import type { MCLJavaComponent } from './types.d.ts';
import { download, sha256sum } from './_fs.ts';
import { run, unzip } from './_run.ts';

import { join } from 'https://deno.land/std/path/mod.ts';
import { expandGlob } from 'https://deno.land/std/fs/mod.ts';

const ZULU_DISCOVERY = `https://api.azul.com/zulu/download/community/v1.0/`;

const JavaVersionStrings: Record<MCLJavaComponent, string> = {
	'java-runtime-beta': '17', // 17.0.1
	'java-runtime-alpha': '16', // 16.0.1
	'jre-legacy': '1.8', // 8u51
	'jre-x64': '1.8', // Previous name of jre-legacy I think
} as const;

/** Search known paths for a compatible version of Java. */
export async function findJavaForMinecraft(
	runtimeDir: string,
	component: MCLJavaComponent,
	majorVersion: number
) {
	const homes: { path: string; JAVA_VERSION: string }[] = [];

	// 1st: cached Zulu OpenJDK bundles
	try {
		for await (const walkEntry of expandGlob(
			join(runtimeDir, `*{jre${majorVersion}}*`)
		)) {
			if (walkEntry.isDirectory) {
				const path = join(runtimeDir, walkEntry.name);
				homes.push(await inspectJavaHome(path));
			}
		}
	} catch (err) {
		console.warn('Zulu OpenJDK JVM error:', err.message);
	}

	// 2nd: Minecraft packaged Java
	try {
		switch (Deno.build.os) {
			case 'darwin': {
				const subpath = `${component}/mac-os/${component}/jre.bundle/Contents/Home`;
				const path = join(runtimeDir, subpath);
				homes.push(await inspectJavaHome(path));
				break;
			}
			case 'linux': {
				throw new Error('unimplemented');
			}
			case 'windows': {
				const path = `C:\\Program Files (x86)\\Minecraft Launcher\\runtime\\${component}\\windows-x64\\${component}`;
				homes.push(await inspectJavaHome(path));
				break;
			}
			default:
				throw new Error('unreachable');
		}
	} catch (err) {
		console.debug('Minecraft runtime JVM error:', err.message);
	}

	// Last-ditch system JVM test
	try {
		switch (Deno.build.os) {
			case 'darwin': {
				const vers = JavaVersionStrings[component];
				const cmd = ['/usr/libexec/java_home', '-F', '-v', vers];
				const path = await run({ cmd });
				homes.push(await inspectJavaHome(path));
				break;
			}
			case 'linux': {
				throw new Error('unimplemented');
			}
			case 'windows': {
				throw new Error('unimplemented');
			}
			default:
				throw new Error('unreachable');
		}
	} catch (err) {
		console.warn('System JVM error:', err.message);
	}

	return homes;
}

/** Parse the release file and test the java executable. */
export async function inspectJavaHome(path: string) {
	const text = await Deno.readTextFile(join(path, 'release'));
	const [, JAVA_VERSION] = text.match(/JAVA_VERSION="?([-_.\w]+)/) ?? [];
	if (!JAVA_VERSION)
		throw new Error('release file is missing field JAVA_VERSION');
	await run({ cmd: [join(path, 'bin', 'java'), '-version'] });
	if (Deno.build.os === 'windows') {
		await run({ cmd: [join(path, 'bin', 'javaw'), '-version'] });
	}
	return { path, JAVA_VERSION };
}

type BundleDetails = {
	id: number;
	arch: 'x86' | 'arm' | 'mips' | 'ppc' | 'sparcv9';
	hw_bitness: '32' | '64';
	os: 'linux' | 'linux_musl' | 'macos' | 'windows' | 'solaris' | 'qnx';
	ext: 'cab' | 'deb' | 'rpm' | 'msi' | 'dmg' | 'tar.gz' | 'zip';
	bundle_type: 'jdk' | 'jre';
	last_modified: string;
	url: string;
	name: string;
	java_version: [number, number, number, number];
	openjdk_build_number: number;
	jdk_version: [number, number, number, number];
	zulu_version: [number, number, number, number];
	abi: 1 | 'any';
	javafx: boolean;
	release_status: 'ga' | 'ea';
	support_term: 'lts' | 'mts' | 'sts';
	release_type: 'CPU' | 'PSU';
	cpu_gen: string[];
	latest: boolean;
	size: number;
	md5_hash: string;
	sha256_hash: string;
	signatures: Array<{
		type: string;
		url: string;
		details: unknown;
		sig_index: number;
	}>;
	autoupdater?: boolean;
	autoupdater_description?: null;
	bundle_uuid?: string;
	dsa_signature?: null;
	features: ('jdk' | 'cp3' | 'fx' | 'headfull' | 'headless')[];
};

type BundleSearchParams = {
	java_version: string;
	ext: BundleDetails['ext'];
	os: BundleDetails['os'];
	arch: BundleDetails['arch'];
	hw_bitness?: BundleDetails['hw_bitness'];
	features?: BundleDetails['features'];
};

function setZuluSearch(s: URLSearchParams, p: BundleSearchParams) {
	s.set('bundle_type', 'jre');
	s.set('release_status', 'ga');
	s.set('support_term', 'lts');
	s.set('java_version', p.java_version);
	s.set('ext', p.ext);
	s.set('os', p.os);
	s.set('arch', p.arch);
	p.hw_bitness && s.set('hw_bitness', p.hw_bitness);
	p.features?.length && s.set('features', p.features.join(','));
}

export async function zuluLatest(params: BundleSearchParams) {
	const url = new URL(`bundles/latest/`, ZULU_DISCOVERY);
	setZuluSearch(url.searchParams, params);
	const res = await fetch(url);
	if (!res.ok) throw new Error(res.statusText);
	const data: BundleDetails = await res.json();
	return data;
}

export async function zuluFind(dir: string, javaMajor: number) {
	try {
		for await (const x of Deno.readDir(dir)) {
			if (x.isDirectory && x.name.includes(`jre${javaMajor}`)) {
				const path = join(dir, x.name);
				const { JAVA_VERSION } = await inspectJavaHome(path);
				return { path, JAVA_VERSION };
			}
		}
	} catch (err) {
		if (err instanceof Deno.errors.NotFound) {
			return;
		} else {
			throw err;
		}
	}
}

export async function zuluInstall(dir: string, javaMajor: number) {
	switch (Deno.build.os) {
		case 'windows': {
			const bundle = await zuluLatest({
				java_version: javaMajor.toFixed(),
				ext: 'zip',
				os: 'windows',
				arch: Deno.build.arch === 'x86_64' ? 'x86' : 'arm',
				hw_bitness: '64',
				features: ['headfull'],
			});
			const zip = await Deno.makeTempFile({ suffix: bundle.name });
			await download(zip, bundle.url);
			await sha256sum(zip, bundle.sha256_hash);
			await unzip(zip, dir);
			await Deno.remove(zip);
			break;
		}
		case 'darwin':
		case 'linux': {
			const bundle = await zuluLatest({
				java_version: javaMajor.toFixed(),
				ext: 'tar.gz',
				os: Deno.build.os === 'darwin' ? 'macos' : 'linux',
				arch: Deno.build.arch === 'x86_64' ? 'x86' : 'arm',
				hw_bitness: '64',
				features: ['headfull'],
			});
			const targz = await Deno.makeTempFile({ suffix: bundle.name });
			await download(targz, bundle.url);
			await sha256sum(targz, bundle.sha256_hash);
			await run({ cmd: ['tar', '-xf', targz], cwd: dir });
			await Deno.remove(targz);
			break;
		}
		default:
			throw new Error('unreachable');
	}

	const home = await zuluFind(dir, javaMajor);
	if (!home) throw new Error('unreachable');
	return home;
}
