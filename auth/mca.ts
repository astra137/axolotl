// deno-lint-ignore-file camelcase

export type MCAResponse = {
	expires_in: number;
	username: string; // this is not the uuid of the account
	roles: unknown[];
	access_token: string;
};

/** https://wiki.vg/Microsoft_Authentication_Scheme#Authenticate_with_Minecraft */
export async function authenticateWithMinecraft(
	userHash: string,
	XSTSToken: string
) {
	const res = await fetch(
		'https://api.minecraftservices.com/authentication/login_with_xbox',
		{
			method: 'POST',
			headers: {
				Accept: 'application/json',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				identityToken: `XBL3.0 x=${userHash};${XSTSToken}`,
			}),
		}
	);
	if (!res.ok) throw new Error(await res.text());
	const data: MCAResponse = await res.json();
	return {
		...data,
		expiry: Date.now() + data.expires_in * 1000,
	};
}
