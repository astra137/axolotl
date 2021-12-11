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

```sh
axolotl 1.18.1
```

Authenticates, downloads, and launches some version of the game.

It tries to share the official launcher's folder (.minecraft) for assets/libraries/versions. Saves, session, options, etc. are saved in the current working directory.

## Security

### [CVE-2021-44228](https://nvd.nist.gov/vuln/detail/CVE-2021-44228)

CVE-2021-44228 is mitigated in axolotl via Mojang's upstream mitigation, a change to the logging configuration XML they distribute as a part of the launcher_manifest_v2.json chain. Running axolotl as normal will detect the out-of-date client-1.12.xml and replace it.

If you play Minecraft with a custom launcher or run a server, you should go read http://redsto.ne/java if you don't like data loss, ransomware, or being doxxed.
