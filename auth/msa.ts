// deno-lint-ignore-file camelcase
import * as b64u from 'https://deno.land/std/encoding/base64url.ts';
import { serve } from 'https://deno.land/std/http/mod.ts';
import { delay } from 'https://deno.land/std/async/mod.ts';

const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const AUTHORITY = 'https://login.microsoftonline.com/consumers/';
// Minecraft launcher might be "000000004C12AE6F"
const CLIENT_ID = '08bd845f-aa9b-40bb-bceb-ed866007286c';
const SCOPE = 'XboxLive.signin XboxLive.offline_access';

async function pkce() {
	const verifier = b64u.encode(crypto.getRandomValues(new Uint8Array(64)));
	const ascii = new TextEncoder().encode(verifier);
	const sha256 = await crypto.subtle.digest('SHA-256', ascii);
	const challenge = b64u.encode(new Uint8Array(sha256));
	return { challenge, verifier };
}

function acceptCallback() {
	return new Promise<{
		code?: string;
		state?: string;
		addr: Deno.Addr;
	}>((resolve, _reject) => {
		const ac = new AbortController();
		const server = serve(
			(req, conn) => {
				console.dir('acceptCallback', conn.remoteAddr);
				const url = new URL(req.url);
				const state = url.searchParams.get('state') ?? undefined;
				const code = url.searchParams.get('code') ?? undefined;
				const error = url.searchParams.get('error') ?? undefined;
				const desc = url.searchParams.get('error_description') ?? undefined;
				resolve(
					Promise.resolve().then(async () => {
						await new Promise((r) => setTimeout(r, 500)); // Wait for current request
						ac.abort(); // Shutdown server
						await server; // Wait for shutdown and capture errors
						if (error) throw new Error(`${error}: ${desc}`);
						return { state, code, addr: conn.remoteAddr };
					})
				);
				return new Response('Callback accepted. Close this tab.');
			},
			{ signal: ac.signal }
		);
	});
}

export type MSAResponse = {
	access_token: string;
	token_type: 'Bearer';
	expires_in: number;
	scope: string;
	refresh_token?: string;
	id_token?: string;
};

/** */
export async function authorizeUsingCallback() {
	const redirect = `http://localhost:8000/${CLIENT_ID}`;
	const state = crypto.randomUUID();
	const { challenge, verifier } = await pkce();

	{
		const url = new URL(`oauth2/v2.0/authorize`, AUTHORITY);
		url.searchParams.set('client_id', CLIENT_ID);
		url.searchParams.set('response_type', 'code');
		url.searchParams.set('redirect_uri', redirect);
		url.searchParams.set('scope', SCOPE);
		url.searchParams.set('response_mode', 'query');
		url.searchParams.set('state', state);
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');
		console.log();
		console.log(url.href);
		console.log();
	}

	const callback = await acceptCallback();
	if (callback.state !== state) throw new Error('state mismatch');

	const url = new URL(`oauth2/v2.0/token`, AUTHORITY);
	const body = new URLSearchParams();
	body.set('client_id', CLIENT_ID);
	body.set('code', callback.code!);
	body.set('redirect_uri', redirect);
	body.set('grant_type', 'authorization_code');
	body.set('code_verifier', verifier);

	const res = await fetch(url, { method: 'POST', body });
	if (!res.ok) throw new Error(await res.text());
	const data: MSAResponse = await res.json();
	return {
		...data,
		expiry: Date.now() + data.expires_in * 1000,
	};
}

/** */
type DeviceAuthorization = {
	device_code: string;
	user_code: string;
	verification_uri: string;
	expires_in: number;
	interval: number;
	message: string;
};

/** */
export async function authorizeUsingDeviceCode() {
	const start = async () => {
		const url = new URL(`oauth2/v2.0/devicecode`, AUTHORITY);
		url.searchParams.set('client_id', CLIENT_ID);
		url.searchParams.set('scope', SCOPE);
		const res = await fetch(url);
		const data: DeviceAuthorization = await res.json();
		return data;
	};

	const poll = async (devAuth: DeviceAuthorization) => {
		while (true) {
			const url = new URL(`oauth2/v2.0/token`, AUTHORITY);
			const body = new URLSearchParams();
			body.set('client_id', CLIENT_ID);
			body.set('grant_type', DEVICE_GRANT);
			body.set('device_code', devAuth.device_code);
			const res = await fetch(url, { method: 'POST', body });
			const data = await res.json();
			if (res.ok) {
				return {
					...(data as MSAResponse),
					expiry: Date.now() + data.expires_in * 1000,
				};
			} else if (data.error === 'authorization_pending') {
				await delay(devAuth.interval * 1000);
				continue;
			} else {
				throw new Error(await res.text());
			}
		}
	};

	const deviceAuth = await start();
	console.log();
	console.log(deviceAuth.message);
	console.log();
	return await poll(deviceAuth);
}

/** */
export async function refresh(prev: MSAResponse) {
	const tenant = 'consumers';
	const authority = `https://login.microsoftonline.com/${tenant}/`;
	const clientId = '08bd845f-aa9b-40bb-bceb-ed866007286c';
	const redirect = `http://localhost:8000/${clientId}`;
	const url = new URL(`oauth2/v2.0/token`, authority);
	const body = new URLSearchParams();
	body.set('client_id', clientId);
	body.set('refresh_token', prev.refresh_token!);
	body.set('grant_type', 'refresh_token');
	body.set('redirect_uri', redirect);

	const res = await fetch(url, { method: 'POST', body });
	if (!res.ok) throw new Error(await res.text());
	const data: MSAResponse = await res.json();
	return {
		...data,
		expiry: Date.now() + data.expires_in * 1000,
	};
}
