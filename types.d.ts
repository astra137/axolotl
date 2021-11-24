// deno-lint-ignore-file camelcase

export type ManifestJson = {
	latest: {
		release: string;
		snapshot: string;
	};
	versions: {
		id: string;
		type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
		url: string;
		time: string;
		releaseTime: string;
		sha1: string;
		complianceLevel: number;
	}[];
};

export type Artifact = {
	path: string;
	sha1: string;
	size: number;
	url: string;
};

export type Features = {
	is_demo_user?: boolean;
	has_custom_resolution?: boolean;
};

export type Rule = {
	action: 'allow' | 'deny';
	os?: {
		name?: 'osx' | 'windows' | 'linux';
		version?: string;
		/** TODO: arm ever? */
		arch?: 'x64' | 'x86' | 'arm64';
	};
	features?: Features;
};

export type Argument = string | { rules: Rule[]; value: string | string[] };

export type LibraryJson = {
	name: string;
	downloads: {
		artifact?: Artifact;
		classifiers?: Record<string, Artifact>;
	};
	rules?: Rule[];
	natives?: {
		osx?: string;
		linux?: string;
		windows?: string;
	};
	extract?: {
		exclude: string[];
	};
};

export type LoggingJson = {
	client?: {
		argument: string; // '-Dlog4j.configurationFile=${path}'
		file: {
			id: string;
			sha1: string;
			size: number;
			url: string;
		};
		type: string; // 'log4j2-xml'
	};
};

export type MCLJavaComponent =
	| 'java-runtime-alpha'
	| 'java-runtime-beta'
	| 'jre-legacy'
	| 'jre-x64'; // TODO: is this real?

export type VersionJson = {
	id?: string;
	inheritsFrom?: string;
	minecraftArguments?: string;
	arguments?: {
		game: Argument[];
		jvm: Argument[];
	};
	assets?: string;
	assetIndex?: {
		id: string;
		sha1: string;
		size: number;
		totalSize: number;
		url: string;
	};
	complianceLevel?: number;
	downloads?: {
		client: Omit<Artifact, 'path'>;
		client_mappings?: Omit<Artifact, 'path'>;
		server: Omit<Artifact, 'path'>;
		server_mappings?: Omit<Artifact, 'path'>;
	};
	javaVersion?: {
		component: MCLJavaComponent;
		majorVersion: number;
	};
	logging?: LoggingJson;
	libraries?: LibraryJson[];
	mainClass?: string;
	minimumLauncherVersion?: number;
	releaseTime?: string;
	time?: string;
	type?: 'release' | 'snapshot' | 'old_beta' | 'old_alpha';
};

export type AssetIndexJson = {
	virtual?: boolean;
	map_to_resources?: boolean;
	objects: Record<string, { hash: string; size: number }>;
};
