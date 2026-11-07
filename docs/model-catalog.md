# Provider model catalog

The studio includes curated model presets and can discover current models from
providers. Availability depends on the provider, API endpoint, account, and region.
A preset is not a successful paid inference test. Refresh the provider's model
list before choosing a newly released model, or enter its exact API model ID.
Model labels shown on marketing pages are not necessarily API model IDs.

## Sources checked on 2026-11-06

The following provider-maintained sources were inspected for this update:

| Provider | Source | Presets supported by this source |
| --- | --- | --- |
| OpenAI | [Python SDK chat model IDs](https://github.com/openai/openai-python/blob/main/src/openai/types/shared_params/chat_model.py) | GPT-6.1 Sol/Terra, GPT-6 Astra/Luna, GPT-5.6 Sol, GPT-5.5, GPT-5.4 Mini |
| Anthropic | [Python SDK model IDs](https://github.com/anthropics/anthropic-sdk-python/blob/main/src/anthropic/types/model.py) | Claude Opus/Sonnet/Haiku 5.5, Mythos/Fable 5.1 |
| Google | [Gemini API development documentation](https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-api-dev/SKILL.md), [Python SDK examples](https://github.com/googleapis/python-genai/blob/main/README.md) | Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.5 Flash Lite, Gemini 3.1 Flash Lite |
| Groq | [Python SDK chat model IDs](https://github.com/groq/groq-python/blob/main/src/groq/types/chat/completion_create_params.py) | Qwen 3.8/3.6 27B, GPT-OSS 120B/20B and existing Llama/Kimi models |
| Moonshot AI | [Kimi Code provider configuration](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/providers.md), [Kimi K2.5 model documentation](https://github.com/MoonshotAI/Kimi-K2.5/blob/master/README.md), [Kimi Code discovery tests](https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core-v2/test/app/kosongConfig/discovery.test.ts) | Direct Moonshot endpoint, Kimi K2.5 and Kimi K3 identifiers |
| Ollama | [Cloud API documentation](https://github.com/ollama/ollama/blob/main/docs/cloud.mdx), [cloud usage examples](https://github.com/ollama/ollama/blob/main/docs/api/cloud-usage.mdx), [Copilot CLI integration](https://github.com/ollama/ollama/blob/main/docs/integrations/copilot-cli.mdx) | Cloud listing endpoint and naming, GLM-5.3/Flash, Kimi K3 cloud naming |

The OpenAI SDK marks `o4-mini` as shut down on 2026-10-23; it has been removed
from the curated presets. The Google provider documentation identifies Gemini
2.5 as legacy, so current Gemini presets replace those entries. Other existing
presets remain available for compatibility; refresh models to check availability.
OpenRouter and Ollama model catalogs can change independently of upstream model
releases, so use their live discovery results for exact routing identifiers.

## Kimi K3.1 Pro

The requested display name **Kimi K3.1 Pro** could not be verified as an API model
identifier in the official Moonshot Kimi Code sources or the official Ollama
sources inspected for this update. The studio does not guess or silently alias
that name to another model. Select Moonshot AI, Ollama Cloud, or OpenRouter,
refresh its models, and use the exact identifier returned by your provider.
Manual model entry also allows newly available account-specific IDs without an
application update. Kimi K3 and Kimi K2.5 remain available as curated choices.

## Verification limits

Direct provider documentation and live cloud catalogs were blocked by this cloud
environment's outbound policy during source verification. Official GitHub SDKs
and documentation were accessible with TLS verification enabled. No provider
credentials were available, and no paid generation requests were made. Unit and
integration tests validate catalog selection and API request behavior separately
from actual cloud inference.
