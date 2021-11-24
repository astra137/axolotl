import { assertEquals } from 'https://deno.land/std/testing/asserts.ts';
import { crypto } from 'https://deno.land/std/crypto/mod.ts';
import * as hex from 'https://deno.land/std/encoding/hex.ts';
import { ensureFile } from 'https://deno.land/std/fs/mod.ts';
import { readableStreamFromReader } from 'https://deno.land/std/streams/conversion.ts';
import { writableStreamFromWriter } from 'https://deno.land/std/streams/conversion.ts';

const decoder = new TextDecoder('utf-8');

export async function read(path: string): Promise<ReadableStream<Uint8Array>> {
	const reader = await Deno.open(path, { read: true });
	return readableStreamFromReader(reader);
}

export async function write(path: string): Promise<WritableStream<Uint8Array>> {
	await ensureFile(path);
	const writer = await Deno.create(path);
	return writableStreamFromWriter(writer);
}

export async function sha1sum(path: string, sha1: string) {
	const readable = await read(path);
	const digest = await crypto.subtle.digest('SHA-1', readable);
	const actual = decoder.decode(hex.encode(new Uint8Array(digest)));
	assertEquals(actual, sha1, `Unexpected sha1sum of ${path}`);
}

export async function sha256sum(path: string, sha256: string) {
	const readable = await read(path);
	const pointer = await crypto.subtle.digest('SHA-256', readable);
	const actual = decoder.decode(hex.encode(new Uint8Array(pointer)));
	assertEquals(actual, sha256, `Unexpected sha1sum of ${path}`);
}

export async function download(path: string, url: string) {
	const writable = await write(path);
	let res;
	try {
		res = await fetch(url);
		if (!res.ok) throw new Deno.errors.Http(`${res.statusText} (${url})`);
		if (!res.body) throw new Deno.errors.Http(`Missing body (${url})`);
		// pipeTo() is not awaited, since writableStreamFromWriter() handles errors already.
		return res.body.pipeTo(writable);
		// EXPERIMENT:
		// Abstract:    Try hashing using tee() instead of a separate read() step.
		// Hypothesis:  Better performance because of concurrent writing and hashing.
		// Methods:     Compare two variations of download(), with and without tee().
		// Results:     tee() variation was ~2x slower.
		// Discussion:  I actually have no clue what's going on.
	} catch (err) {
		writable.abort();
		res?.body?.cancel();
		throw err;
	}
}
