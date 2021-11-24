import { Features, Rule } from './types.d.ts';

export function allowed(rules: Rule[], feat: Features) {
	let allow = rules.length ? false : true;
	for (const r of rules ?? []) {
		const applies = ruleApplies(r, feat);
		if (applies && r.action === 'allow') {
			allow = true;
		} else if (applies) {
			allow = false;
		}
	}
	return allow;
}

function ruleApplies(rule: Rule, feats: Features) {
	if (rule.os?.name) {
		switch (rule.os.name) {
			case 'osx':
				if (Deno.build.os !== 'darwin') return false;
				break;
			case 'windows':
				// TODO version too
				if (Deno.build.os !== 'windows') return false;
				break;
			case 'linux':
				if (Deno.build.os !== 'linux') return false;
				break;
			default:
				throw new Error(`unknown os: ${rule.os.name}`);
		}
	}

	if (rule.os?.arch) {
		switch (rule.os.arch) {
			case 'x64':
				if (Deno.build.arch !== 'x86_64') return false;
				break;
			case 'arm64':
				// TODO: Does Minecraft even support arm?
				if (Deno.build.arch !== 'aarch64') return false;
				break;
			case 'x86':
				// TODO: Deno does not have a x86 build, right?
				return false;
			default:
				throw new Error(`unknown os: ${rule.os.name}`);
		}
	}

	if (rule.features) {
		if (rule.features?.has_custom_resolution) {
			if (!feats.has_custom_resolution) return false;
		}
		if (rule.features?.is_demo_user) {
			if (!feats.is_demo_user) return false;
		}
	}

	return true;
}
