import { describe, expect, it } from 'vitest';
import { classify } from './categories';

describe('classify', () => {
  it.each([
    ['highway=cycleway foot=no oneway=yes', 'dedicated'],
    ['highway=cycleway surface=asphalt foot=use_sidepath cycleway=crossing', 'dedicated'],
    ['highway=cycleway foot=designated bicycle=designated segregated=yes', 'dedicated'],
    ['highway=path bicycle=designated foot=no', 'dedicated'],
    ['highway=cycleway surface=concrete foot=designated bicycle=designated', 'shared'],
    ['highway=cycleway foot=yes bicycle=yes', 'shared'],
    ['highway=footway bicycle=yes', 'shared'],
    ['highway=path bicycle=designated foot=designated', 'shared'],
    ['highway=secondary oneway=yes cycleway:right=no cycleway:left=track', 'lane'],
    ['highway=residential cycleway=lane', 'lane'],
    ['highway=unclassified cycleway:left=shared_lane', 'road'],
    ['highway=tertiary surface=asphalt cycleway:both=no oneway=yes', 'road'],
    ['highway=residential', 'road'],
    ['reversedirection=yes highway=footway', 'footpath'],
    ['highway=footway surface=paving_stones bicycle=no', 'footpath'],
    ['highway=steps bicycle=yes', 'footpath'],
    ['highway=pedestrian', 'footpath'],
  ])('%s -> %s', (tags, expected) => {
    expect(classify(tags)).toBe(expected);
  });
});
