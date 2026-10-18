// Generate one cartoon avatar per student into web/avatars/<id>.svg (run once; the site stays offline).
//   npm i @dicebear/core@9.4.2 @dicebear/toon-head@9.4.2
//   node pipeline/avatars.mjs            (from the repo root)
// Art: "ToonHead" by Johan Melin, CC BY 4.0, via DiceBear. Hair colour comes from the dataset;
// everything else is seeded by student id so each face is stable between runs.
import { createAvatar } from '@dicebear/core';
import * as toonHead from '@dicebear/toon-head';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const data = JSON.parse(readFileSync('web/data.json', 'utf8'));
mkdirSync('web/avatars', { recursive: true });

for (const s of data.students) {
  const female = /^f/i.test(s.sex || '');
  const svg = createAvatar(toonHead, {
    seed: s.id,
    hairColor: [String(s.hair || '#2c1b18').replace('#', '')],
    beardProbability: female ? 0 : 30,
    rearHairProbability: female ? 70 : 10,
    rearHair: female ? ['longStraight', 'longWavy', 'shoulderHigh'] : ['neckHigh'],
    hair: female ? ['bun', 'sideComed', 'spiky'] : ['undercut', 'sideComed', 'spiky'],
    mouth: ['smile', 'laugh', 'agape'],
    eyes: ['happy', 'wide', 'humble', 'wink']
  }).toString();
  writeFileSync(`web/avatars/${s.id}.svg`, svg);
}
console.log(`wrote ${data.students.length} avatars to web/avatars/`);
