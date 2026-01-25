import assert from 'node:assert/strict'

import { classifyMoods, getMoodCriteria, getMoodConfidenceScores, MOODS } from './moodClassifier.js'

function color(rgb, weight) {
  return { rgb, weight, hex: '#000000' }
}

function topMood(result) {
  return result?.[0]?.mood ?? null
}

assert.deepEqual(MOODS, ['Calming', 'Energizing', 'Mysterious', 'Inspiring', 'Cosmic'])

{
  const features = {
    dominantColors: [color([40, 90, 200], 0.7), color([90, 50, 160], 0.3)],
    subjects: ['nebulae'],
    brightness: 0.45,
    temperature: 'cool',
    complexity: 0.2,
  }
  const result = classifyMoods(features)
  assert.equal(topMood(result), 'Calming')
  assert.ok(result[0].confidence >= 65)
}

{
  const features = {
    dominantColors: [color([250, 90, 20], 0.55), color([10, 10, 10], 0.45)],
    subjects: ['rockets', 'galaxies'],
    brightness: 0.7,
    temperature: 'warm',
    complexity: 0.8,
  }
  const result = classifyMoods(features)
  assert.equal(topMood(result), 'Energizing')
}

{
  const features = {
    dominantColors: [color([8, 10, 18], 0.75), color([30, 40, 60], 0.25)],
    subjects: ['galaxies'],
    brightness: 0.2,
    temperature: 'cool',
    complexity: 0.75,
  }
  const result = classifyMoods(features)
  assert.equal(topMood(result), 'Mysterious')
}

{
  const features = {
    dominantColors: [color([30, 160, 230], 0.4), color([200, 60, 220], 0.35), color([240, 220, 120], 0.25)],
    subjects: ['earth', 'stars'],
    brightness: 0.65,
    temperature: 'cool',
    complexity: 0.5,
  }
  const result = classifyMoods(features)
  assert.equal(topMood(result), 'Inspiring')
}

{
  const features = {
    dominantColors: [color([40, 40, 120], 0.35), color([180, 70, 200], 0.35), color([240, 240, 240], 0.3)],
    subjects: ['galaxies', 'nebulae', 'stars'],
    brightness: 0.55,
    temperature: 'cool',
    complexity: 0.65,
  }
  const result = classifyMoods(features)
  assert.ok(result.some((r) => r.mood === 'Cosmic'))
  const scores = getMoodConfidenceScores(features)
  assert.ok(scores.Cosmic >= 40)
}

for (const mood of MOODS) {
  const criteria = getMoodCriteria(mood)
  assert.equal(criteria?.mood, mood)
  assert.ok(criteria?.criteria)
}

