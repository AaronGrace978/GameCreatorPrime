import assert from 'node:assert/strict'
import test from 'node:test'
import { PROVIDERS, getProvider, getModel } from '../src/main/providers/catalog.ts'

test('provider presets have unique IDs and preserve exact model routing', () => {
  assert.equal(new Set(PROVIDERS.map((p) => p.id)).size, PROVIDERS.length)
  for (const provider of PROVIDERS) {
    assert.equal(new Set(provider.models.map((m) => m.id)).size, provider.models.length, provider.id)
    assert.ok(provider.models.length, provider.id)
    for (const model of provider.models) {
      assert.equal(getModel(provider.id, model.id)?.id, model.id)
    }
  }
})

test('Moonshot routes to its own API and does not invent a K3.1 Pro alias', () => {
  const provider = getProvider('moonshot')
  assert.equal(provider.id, 'moonshot')
  assert.equal(provider.baseUrl, 'https://api.moonshot.ai/v1')
  assert.ok(provider.models.some((m) => m.id === 'kimi-k3'))
  assert.equal(getModel('moonshot', 'Kimi K3.1 Pro'), undefined)
})
