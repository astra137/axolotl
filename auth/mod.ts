import {
	MSAResponse,
	authorizeUsingCallback,
	authorizeUsingDeviceCode,
	refresh,
} from './msa.ts';

import {
	XBLExchangeRpsTicketResponse,
	XBLExchangeTokensResponse,
	authenticateWithXBL,
	authenticateWithXSTS,
} from './xba.ts';

import { MCAResponse, authenticateWithMinecraft } from './mca.ts';

export interface AuthState {
	clientId: string;
	msa: MSAResponse & { expiry: number };
	xbl: XBLExchangeRpsTicketResponse & { expiry: number };
	xsts: XBLExchangeTokensResponse & { expiry: number };
	mca: MCAResponse & { expiry: number };
}

/** */
export async function createSession(callback = false) {
	const msa = callback
		? await authorizeUsingCallback()
		: await authorizeUsingDeviceCode();
	const xbl = await authenticateWithXBL(msa.access_token);
	const [{ uhs }] = xbl.DisplayClaims.xui;
	const xsts = await authenticateWithXSTS([xbl.Token]);
	const mca = await authenticateWithMinecraft(uhs, xsts.Token);
	const auth: AuthState = {
		clientId: crypto.randomUUID(),
		msa,
		xbl,
		xsts,
		mca,
	};
	const profile = await getProfile(mca.access_token);
	await Deno.writeTextFile('session.json', JSON.stringify(auth));
	return { auth, profile };
}

/** */
export async function resumeSession() {
	const auth: AuthState = JSON.parse(await Deno.readTextFile('session.json'));

	// TODO: proper refresh flow

	try {
		const profile = await getProfile(auth.mca.access_token);
		return { auth, profile };
	} catch (err) {
		console.error(err);
	}

	try {
		const [{ uhs }] = auth.xbl.DisplayClaims.xui;
		auth.mca = await authenticateWithMinecraft(uhs, auth.xsts.Token);
		const profile = await getProfile(auth.mca.access_token);
		await Deno.writeTextFile('session.json', JSON.stringify(auth));
		return { auth, profile };
	} catch (err) {
		console.error(err);
	}

	try {
		auth.xsts = await authenticateWithXSTS([auth.xbl.Token]);
		const [{ uhs }] = auth.xbl.DisplayClaims.xui;
		auth.mca = await authenticateWithMinecraft(uhs, auth.xsts.Token);
		const profile = await getProfile(auth.mca.access_token);
		await Deno.writeTextFile('session.json', JSON.stringify(auth));
		return { auth, profile };
	} catch (err) {
		console.error(err);
	}

	try {
		auth.xbl = await authenticateWithXBL(auth.msa.access_token);
		auth.xsts = await authenticateWithXSTS([auth.xbl.Token]);
		const [{ uhs }] = auth.xbl.DisplayClaims.xui;
		auth.mca = await authenticateWithMinecraft(uhs, auth.xsts.Token);
		const profile = await getProfile(auth.mca.access_token);
		await Deno.writeTextFile('session.json', JSON.stringify(auth));
		return { auth, profile };
	} catch (err) {
		console.error(err);
	}

	auth.msa = await refresh(auth.msa);
	auth.xbl = await authenticateWithXBL(auth.msa.access_token);
	auth.xsts = await authenticateWithXSTS([auth.xbl.Token]);
	const [{ uhs }] = auth.xbl.DisplayClaims.xui;
	auth.mca = await authenticateWithMinecraft(uhs, auth.xsts.Token);
	const profile = await getProfile(auth.mca.access_token);
	await Deno.writeTextFile('session.json', JSON.stringify(auth));
	return { auth, profile };
}

/** */
export type Profile = {
	id: string;
	name: string;
	skins: Array<{
		id: string;
		state: 'ACTIVE' | string; // TODO
		url: string;
		variant: 'CLASSIC' | 'SLIM';
		alias: 'STEVE' | 'ALEX' | string; // TODO
	}>;
	capes: Array<{
		id: string;
		state: 'ACTIVE' | string; // TODO
		url: string;
		alias: string; // Migrator
	}>;
};

/** https://wiki.vg/Microsoft_Authentication_Scheme#Get_the_profile */
export async function getProfile(accessToken: string) {
	const res = await fetch(
		'https://api.minecraftservices.com/minecraft/profile',
		{ headers: { Authorization: `Bearer ${accessToken}` } }
	);
	if (!res.ok) throw new Error(await res.text());
	return (await res.json()) as Profile;
}
