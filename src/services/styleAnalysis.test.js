import assert from 'node:assert/strict'

import { cosineSimilarity, createStyleFamilies, findSimilar, kMeans, projectTo2D, scoreStyleMatch } from './styleAnalysis.js'

function vec(values) {
  return Float32Array.from(values)
}

{
  assert.equal(cosineSimilarity(vec([1, 0]), vec([1, 0])), 1)
  assert.equal(cosineSimilarity(vec([1, 0]), vec([0, 1])), 0)
  assert.equal(Math.round(cosineSimilarity(vec([1, 1]), vec([1, 1])) * 1000) / 1000, 1)
}

{
  const vectors = [vec([1, 1]), vec([1.1, 1.05]), vec([-1, -1]), vec([-1.1, -0.9])]
  const result = kMeans(vectors, 2, { seed: 7, maxIterations: 50 })
  assert.equal(result.k, 2)
  assert.equal(result.assignments.length, vectors.length)
  assert.ok(result.iterations >= 1)
}

{
  const descriptors = [
    { id: 'a', styleVector: vec([1, 1]) },
    { id: 'b', styleVector: vec([1.1, 0.9]) },
    { id: 'c', styleVector: vec([-1, -1]) },
    { id: 'd', styleVector: vec([-1.2, -0.8]) },
  ]
  const families = createStyleFamilies(descriptors, { k: 2, seed: 7 })
  assert.equal(families.families.length, 2)
  assert.equal(families.families.reduce((sum, fam) => sum + fam.members.length, 0), 4)
}

{
  const target = {
    id: 't',
    styleVector: vec([1, 0]),
    analysis: { dominantColors: [{ hex: '#ff0000', pct: 1 }], subjects: ['nebulae'], brightness: 50, complexity: 30, temperature: 'cool' },
  }
  const candidates = [
    { id: 'x', styleVector: vec([0.99, 0.01]), analysis: { dominantColors: [{ hex: '#ff1100', pct: 1 }], subjects: ['nebulae'], brightness: 52, complexity: 28, temperature: 'cool' } },
    { id: 'y', styleVector: vec([0, 1]), analysis: { dominantColors: [{ hex: '#00ff00', pct: 1 }], subjects: ['planets'], brightness: 10, complexity: 90, temperature: 'warm' } },
  ]
  const top = findSimilar(target, candidates, { limit: 1 })[0]
  assert.equal(top.candidate.id, 'x')
  assert.ok(top.score > 0.7)
  const scored = scoreStyleMatch(target, candidates[0])
  assert.ok(scored.score >= 0 && scored.score <= 1)
}

{
  const descriptors = Array.from({ length: 10 }, (_, i) => ({ id: String(i), styleVector: vec([i, i * 0.5, -i]) }))
  const { points } = projectTo2D(descriptors, { seed: 3, iters: 10 })
  assert.equal(points.length, 10)
  assert.ok(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)))
}

