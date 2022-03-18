# axolotl

> This is not a Minecraft launcher, but it can launch Minecraft.

## Experimental

```
 _    _  ___  ______ _   _ _____ _   _ _____
| |  | |/ _ \ | ___ \ \ | |_   _| \ | |  __ \
| |  | / /_\ \| |_/ /  \| | | | |  \| | |  \/
| |/\| |  _  ||    /| . ` | | | | . ` | | __
\  /\  / | | || |\ \| |\  |_| |_| |\  | |_\ \
 \/  \/\_| |_/\_| \_\_| \_/\___/\_| \_/\____/

(Sorry about the cheesy 90s ASCII art.)
```

This isn't meant to be a useable product or anything serious.

I might try to make it nice someday, if the mood strikes, or if anyone asks for it.

## Usage

For convenience, install `cli.ts` with Deno and launch with `axolotl`.

```sh
deno install --config deno.json --allow-all --name axolotl cli.ts
```

On Windows, another method to launch is creating a shortcut to the `axolotl.cmd` created by Deno. Change the `Start in` property to be empty.

To prevent accidents, `axolotl.json` must exist in the current directory.

```sh
echo {} > axolotl.json
```

The current directory will contain the game session, options, and worlds.

Libraries and assets are shared with the official launcher (best effort).

## Security

### [CVE-2021-44228](https://nvd.nist.gov/vuln/detail/CVE-2021-44228)

CVE-2021-44228 is mitigated upstream. This project uses the log4j version and configuration that Mojang distributes via launchermeta.mojang.com.

If you play Minecraft with a custom launcher or run a server, you should go read http://redsto.ne/java if you don't like data loss, ransomware, or being doxxed.
