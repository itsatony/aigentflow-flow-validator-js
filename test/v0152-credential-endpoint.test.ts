// 0.15.2: credential_endpoint_unpaired (AIgentFlow DC-FORGE-231 / DC-FORGE-233),
// ported together with the Go port (go-aigentflow-validator v0.6.2). The
// conformance fixtures pin the code per fixture; these pin what a code set
// cannot show — the exact fields, the severity, the boundaries one shape at a
// time (the same shapes as the Go port's tests, each measured against the
// reference), and the Go URL semantics the default-origin comparison needs.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateFlow } from '../src/index.js';
import { CREDENTIAL_ENDPOINT_PAIRING } from '../src/spec/index.js';
import { goEndpointOrigin, goToLower, goTrimSpace } from '../src/validators/goUrl.js';

const CODE = 'credential_endpoint_unpaired';
const FIXTURES = join(__dirname, 'conformance', 'fixtures');

function unpairedFields(src: string): string[] {
  const r = validateFlow(src);
  expect(r.errors.filter((e) => e.code === CODE)).toEqual([]);
  return r.warnings
    .filter((w) => w.code === CODE)
    .map((w) => w.field)
    .sort();
}

const FIXTURE_FIELDS: Record<string, string[]> = {
  'warn-credential-endpoint-ai-step-query.yaml': [
    'steps.literal.query.openai_base_url',
    'steps.other_key.query.mistral_base_url',
    'steps.templated.query.anthropic_base_url',
  ],
  'warn-credential-endpoint-ai-loop-sub-step.yaml': [
    'steps.rounds.loop.steps.stored.query.openai_base_url',
  ],
  'warn-credential-endpoint-ai-executor-config.yaml': [
    'executor_config.anthropic.base_url',
    'executor_config.mistral.base_url',
    'executor_config.openai.base_url',
  ],
  'warn-credential-endpoint-family-step-query.yaml': [
    'steps.broker.query.broker_url',
    'steps.rounds.loop.steps.map.query.base_url',
    'steps.vectors.query.base_url',
  ],
  'warn-credential-endpoint-family-executor-config.yaml': [
    'executor_config.api.base_url',
    'executor_config.s3.extra.endpoint',
    'steps.research.query.base_url',
  ],
  'warn-credential-endpoint-nexus.yaml': [
    'steps.agent.query.base_url',
    'steps.alias.query.aigentchat_base_url',
  ],
  'valid-credential-endpoint-own-key-own-url.yaml': [],
  'valid-credential-endpoint-server-endpoints.yaml': [],
  'valid-credential-endpoint-keyless-providers.yaml': [],
  'valid-credential-endpoint-not-judged.yaml': [],
};

const SHAPES: { name: string; src: string; want: string[] }[] = [
  {
    name: 'ai: a numeric key is no key (the reference reads query[k].(string))',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      api_key: 12345\n      openai_base_url: 'https://x.example.com'\n",
    want: ['steps.s.query.openai_base_url'],
  },
  {
    name: 'ai: a numeric endpoint is no endpoint',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      openai_base_url: 8080\n",
    want: [],
  },
  {
    name: 'ai: a timestamp is not a string to yaml.v3',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      openai_base_url: 2024-01-01\n",
    want: [],
  },
  {
    name: 'ai: an empty endpoint is none',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      openai_base_url: ''\n",
    want: [],
  },
  {
    name: 'ai: the provider is case-sensitive, as written',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: ai://OpenAI/chat\n    query:\n      OpenAI_base_url: 'https://x.example.com'\n",
    want: ['steps.s.query.OpenAI_base_url'],
  },
  {
    name: 'ai: a literal executor_config key covers a step endpoint',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  openai:\n    api_key: 12345\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      openai_base_url: 'https://x.example.com'\n",
    want: [],
  },
  {
    name: 'ai: an env-reference executor_config key does not',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  openai:\n    api_key: '${AIGENTFLOW_OPENAI_API_KEY}'\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      openai_base_url: 'https://x.example.com'\n",
    want: ['steps.s.query.openai_base_url'],
  },
  {
    name: 'ai: a null executor_config block is no key',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  openai: ~\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      openai_base_url: 'https://x.example.com'\n",
    want: ['steps.s.query.openai_base_url'],
  },
  {
    name: 'ai: executor_config base_url warns with no step using the provider',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  cohere:\n    base_url: 8080\n  not_a_provider:\n    base_url: 'https://x.example.com'\nsteps:\n  s:\n    executor: function://text/template\n    query:\n      message: hi\n",
    want: ['executor_config.cohere.base_url'],
  },
  {
    name: 'ai: a templated executor_config base_url is still a literal to the ai arm',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  openai:\n    base_url: '{{ .query.u }}'\nsteps:\n  s:\n    executor: ai://openai/chat\n    query:\n      prompt: hi\n",
    want: ['executor_config.openai.base_url'],
  },
  {
    name: "family: the step query's secret decides before executor_config's",
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  deepr:\n    api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\nsteps:\n  s:\n    executor: deepr://deepr/stats\n    query:\n      api_key: 'mine'\n      base_url: 'https://evil.example.com'\n",
    want: [],
  },
  {
    name: "family: a templated executor_config endpoint is not certainly the author's",
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  deepr:\n    api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\n    base_url: '{{ .query.u }}'\nsteps:\n  s:\n    executor: deepr://deepr/stats\n    query:\n      q: 1\n",
    want: [],
  },
  {
    name: 'family: executor_config api_key is read only when the family copies it into a secret (s3 copies it into access_key_id)',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  s3:\n    api_key: '${AIGENTFLOW_STORAGE_S3_ACCESS_KEY}'\n    base_url: 'https://objects.example.com'\nsteps:\n  s:\n    executor: storage://s3/upload\n    query:\n      key: a\n",
    want: [],
  },
  {
    name: 'family: ... and its base_url is read as the endpoint',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  s3:\n    base_url: 'https://objects.example.com'\nsteps:\n  s:\n    executor: storage://s3/upload\n    query:\n      secret_access_key: '${AIGENTFLOW_STORAGE_S3_SECRET_KEY}'\n",
    want: ['executor_config.s3.base_url'],
  },
  {
    name: 'family: an empty or numeric first endpoint falls through to the next',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: storage://s3/upload\n    query:\n      secret_access_key: '${AIGENTFLOW_STORAGE_S3_SECRET_KEY}'\n      endpoint: 9\n      public_endpoint: 'https://pub.example.com'\n",
    want: ['steps.s.query.public_endpoint'],
  },
  {
    name: 'family: the default by origin \u2014 userinfo, path, query, fragment and case do not matter',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: deepr://deepr/stats\n    query:\n      api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\n      base_url: 'http://u:p@LOCALHOST:28081/x?y=1#z'\n",
    want: [],
  },
  {
    name: 'family: the default origin survives surrounding space',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: staticmap://geoapify/render\n    query:\n      api_key: '${AIGENTFLOW_GEOAPIFY_API_KEY}'\n      base_url: '  https://MAPS.geoapify.com/  '\n",
    want: [],
  },
  {
    name: "family: the default port is filled (http 80 is not the default's 8123)",
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: homeassistant://api/get_states\n    query:\n      token: '${AIGENTFLOW_HOMEASSISTANT_TOKEN}'\n      base_url: 'http://homeassistant.local'\n",
    want: ['steps.s.query.base_url'],
  },
  {
    name: 'family: another scheme is another origin',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: homeassistant://api/get_states\n    query:\n      token: '${AIGENTFLOW_HOMEASSISTANT_TOKEN}'\n      base_url: 'https://homeassistant.local:8123'\n",
    want: ['steps.s.query.base_url'],
  },
  {
    name: 'family: a URL net/url refuses is compared as text, so it is no default',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: deepr://deepr/stats\n    query:\n      api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\n      base_url: 'http://localhost:28081/%zz'\n",
    want: ['steps.s.query.base_url'],
  },
  {
    name: 'family: a host:port with no scheme is no default',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: deepr://deepr/stats\n    query:\n      api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\n      base_url: 'localhost:28081'\n",
    want: ['steps.s.query.base_url'],
  },
  {
    name: 'family: an empty port is kept as written, so it is no default',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: deepr://deepr/stats\n    query:\n      api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\n      base_url: 'http://localhost:28081:'\n",
    want: ['steps.s.query.base_url'],
  },
  {
    name: "family: a reference to ANOTHER family's variable is no server secret here",
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: db://weaviate/search\n    query:\n      api_key: '${AIGENTFLOW_OPENAI_API_KEY}'\n      base_url: 'https://v.example.com'\n",
    want: [],
  },
  {
    name: 'family: the driver picks the row (storage/trove is implicit, never judged)',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: storage://trove/upload\n    query:\n      trove_auth_token: '${AIGENTFLOW_TROVE_AUTH_TOKEN}'\n      trove_base_url: 'https://t.example.com'\n",
    want: [],
  },
  {
    name: 'family: an extra-block secret and endpoint on a loop sub-step',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nexecutor_config:\n  broker:\n    extra:\n      password: '${AIGENTFLOW_MQTT_PASSWORD}'\n      broker_url: 'tcp://evil.example.com:1883'\nsteps:\n  s:\n    loop:\n      while: '{{ false }}'\n      max_iterations: 1\n      steps:\n        - id: 7\n          executor: mqtt://broker/publish\n          query:\n            topic: t\n",
    want: ['executor_config.broker.extra.broker_url'],
  },
  {
    name: 'nexus: a null credentials entry and a numeric key are no key of its own',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: nexus://org/agent\n    query:\n      credentials: ~\n      api_key: 42\n      base_url: 'https://chat.example.com'\n",
    want: ['steps.s.query.base_url'],
  },
  {
    name: 'nexus: an empty credentials mapping is a key of its own',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: nexus://org/agent\n    query:\n      credentials: {}\n      base_url: 'https://chat.example.com'\n",
    want: [],
  },
  {
    name: 'nexus: only the first endpoint warns',
    src: "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\nsteps:\n  s:\n    executor: nexus://org/agent\n    query:\n      aigentchat_base_url: 'https://a.example.com'\n      base_url: 'https://b.example.com'\n",
    want: ['steps.s.query.aigentchat_base_url'],
  },
];

const HEAD = "aigentflow_version: '2.0.0'\nname: p\nversion: '1.0.0'\ndescription: d\nstart: s\n";
const familyStep = (base: string): string =>
  HEAD +
  'steps:\n  s:\n    executor: homeassistant://api/get_states\n    query:\n' +
  "      token: '${AIGENTFLOW_HOMEASSISTANT_TOKEN}'\n" +
  `      base_url: ${JSON.stringify(base)}\n`;

describe('credential_endpoint_unpaired', () => {
  it('pins every credential-endpoint fixture field for field', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.includes('credential-endpoint'));
    expect(files.sort()).toEqual(Object.keys(FIXTURE_FIELDS).sort());
    for (const file of files) {
      expect(unpairedFields(readFileSync(join(FIXTURES, file), 'utf8')), file).toEqual(
        FIXTURE_FIELDS[file],
      );
    }
  });

  for (const shape of SHAPES) {
    it(shape.name, () => {
      expect(unpairedFields(shape.src)).toEqual(shape.want);
    });
  }

  it('lower-cases a host as Go does: U+0130 is "i", written or percent-encoded', () => {
    expect(unpairedFields(familyStep('http://homeass\u0130stant.local:8123'))).toEqual([]);
    expect(unpairedFields(familyStep('http://homeass%C4%B0stant.local:8123'))).toEqual([]);
  });

  it('trims space as Go does: U+0085 is space, U+FEFF is not', () => {
    expect(unpairedFields(familyStep('http://homeassistant.local:8123\u0085'))).toEqual([]);
    expect(unpairedFields(familyStep('\ufeffhttp://homeassistant.local:8123'))).toEqual([
      'steps.s.query.base_url',
    ]);
  });

  it('a timestamp-shaped endpoint is not read as a string (looser than the reference when quoted; PARITY.md)', () => {
    expect(unpairedFields(familyStep('2024-01-01'))).toEqual([]);
  });

  it('the family table is the spec data', () => {
    expect(Object.keys(CREDENTIAL_ENDPOINT_PAIRING.families).sort()).toEqual([
      'db',
      'deepr',
      'getmd',
      'homeassistant',
      'hosting',
      'mcp/http',
      'mqtt',
      'nexus',
      'opencorporates',
      'shelly',
      'staticmap',
      'storage/s3',
      'storage/trove',
    ]);
    expect(CREDENTIAL_ENDPOINT_PAIRING.ai.keylessProviders).toEqual(['ollama', 'vllm']);
    expect(CREDENTIAL_ENDPOINT_PAIRING.families.nexus?.storedKeyShape).toBeDefined();
  });

  it('an executor named like an Object.prototype member is no family', () => {
    const src =
      HEAD +
      'steps:\n  s:\n    executor: constructor://x/y\n    query:\n' +
      "      api_key: '${AIGENTFLOW_DEEPR_API_KEY}'\n      base_url: 'https://x.example.com'\n";
    expect(unpairedFields(src)).toEqual([]);
  });
});

describe('goEndpointOrigin', () => {
  const origin = (s: string): string =>
    goEndpointOrigin(
      s,
      CREDENTIAL_ENDPOINT_PAIRING.defaultPorts,
      CREDENTIAL_ENDPOINT_PAIRING.protocolSeparator,
    );
  const cases: [string, string][] = [
    ['https://Example.COM/v1', 'https://example.com:443'],
    ['http://example.com', 'http://example.com:80'],
    ['HTTP://example.com:8080/x', 'http://example.com:8080'],
    ['tcp://localhost:1883', 'tcp://localhost:1883'],
    ['tcp://localhost', 'tcp://localhost'],
    ['http://[::1]/x', 'http://[::1]:80'],
    ['http://[::1]:9/x', 'http://[::1]:9'],
    [' https://u:p@example.com/ ', 'https://example.com:443'],
    ['10.0.0.9', '10.0.0.9'],
    ['Host.Example//', 'host.example'],
    ['http://example.com/%zz', 'http://example.com/%zz'],
    ['http://example.com:8080:', 'http://example.com:8080:'],
    ['mailto:someone@example.com', 'mailto:someone@example.com'],
    ['https://example.com#fragment', 'https://example.com:443'],
    ['https://example.com#%zz', 'https://example.com#%zz'],
    ['http://ex ample.com', 'http://ex ample.com'],
    ['http://ex%41mple.com', 'http://ex%41mple.com'],
    ['http://u ser@example.com', 'http://u ser@example.com'],
    ['://example.com', '://example.com'],
    ['http://example.com\u0001', 'http://example.com\u0001'],
  ];
  for (const [input, want] of cases) {
    it(JSON.stringify(input), () => {
      expect(origin(input)).toBe(want);
    });
  }
  it('goTrimSpace and goToLower follow Go', () => {
    expect(goTrimSpace('\u0085 x \u00a0')).toBe('x');
    expect(goTrimSpace('\ufeffx')).toBe('\ufeffx');
    expect(goToLower('\u0130\u03a3K')).toBe('i\u03c3k');
  });
});
