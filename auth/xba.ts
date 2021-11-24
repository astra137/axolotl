import { writableStreamFromWriter } from 'https://deno.land/std/streams/conversion.ts';

export type XBLExchangeRpsTicketResponse = {
	IssueInstant: string;
	NotAfter: string;
	Token: string;
	DisplayClaims: {
		xui: Array<{
			uhs: string;
		}>;
	};
};

export type XBLExchangeTokensResponse = {
	IssueInstant: string;
	NotAfter: string;
	Token: string;
	DisplayClaims: {
		xui: Array<
			Record<string, string> & {
				xid?: string;
				uhs: string;
			}
		>;
	};
};

/**
 * Get around TLS issues by using a different fetch.
 *
 * MS's user.auth.xboxlive.com uses SSL renegotiation, and rustls does not.
 * So, to the best of my knowledge, Deno cannot fetch at all from that domain.
 * Using curl is my workaround for now.
 */
export async function curl(req: Request): Promise<Uint8Array> {
	const cmd = ['curl'];
	if (req.redirect === 'follow') cmd.push('-L');
	cmd.push('-X', req.method);
	for (const header of req.headers) {
		cmd.push('-H', `${header[0]}: ${header[1]}`);
	}
	if (req.body) cmd.push('--data-binary', '@-');
	cmd.push(req.url);

	const p = Deno.run({ cmd, stdin: 'piped', stdout: 'piped', stderr: 'piped' });
	await req.body?.pipeTo(writableStreamFromWriter(p.stdin));
	const [{ success, code }, out, err] = await Promise.all([
		p.status(),
		p.output(),
		p.stderrOutput(),
	]);
	p.close();
	if (success) {
		return out;
	} else {
		throw new Deno.errors.Http(
			`Exited ${code}: ${new TextDecoder().decode(err)}`
		);
	}
}

/** https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XBL */
export async function authenticateWithXBL(accessToken: string) {
	const req = new Request('https://user.auth.xboxlive.com/user/authenticate', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'x-xbl-contract-version': '2',
		},
		body: JSON.stringify({
			RelyingParty: 'http://auth.xboxlive.com',
			TokenType: 'JWT',
			Properties: {
				AuthMethod: 'RPS',
				SiteName: 'user.auth.xboxlive.com',
				RpsTicket: `d=${accessToken}`,
			},
		}),
	});

	const responseBody = await curl(req);
	const data: XBLExchangeTokensResponse = JSON.parse(
		new TextDecoder().decode(responseBody)
	);
	return {
		...data,
		expiry: Date.parse(data.NotAfter),
	};
}

/** https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_XSTS */
export async function authenticateWithXSTS(userTokens: string[]) {
	const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'x-xbl-contract-version': '2',
		},
		body: JSON.stringify({
			Properties: {
				UserTokens: userTokens,
				SandboxId: 'RETAIL',
			},
			RelyingParty: 'rp://api.minecraftservices.com/',
			TokenType: 'JWT',
		}),
	});
	if (!res.ok) throw new Error(`${res.statusText}: ${await res.text()}`);
	const data: XBLExchangeTokensResponse = await res.json();
	return {
		...data,
		expiry: Date.parse(data.NotAfter),
	};
}
