import { describe, expect, it } from 'vitest';
import { photonLabel, photonUrl } from './geocode';

describe('photonLabel', () => {
  it('lists the name then wider areas, dropping repeats', () => {
    expect(
      photonLabel({ name: 'Flinders Street', street: 'Flinders Street', district: 'Melbourne', city: 'Melbourne', state: 'Victoria', country: 'Australia' }),
    ).toBe('Flinders Street, Melbourne, Victoria, Australia');
  });

  it('uses the house number and street for an unnamed address', () => {
    expect(photonLabel({ housenumber: '12', street: 'Smith Street', city: 'Fitzroy', country: 'Australia' })).toBe(
      '12 Smith Street, Fitzroy, Australia',
    );
  });
});

describe('photonUrl', () => {
  it('biases towards the centre of the view, reaching about as far as the view', () => {
    const url = new URL(photonUrl('cafe', { west: 144.9, east: 145.0, south: -37.9, north: -37.7 }));
    expect(url.searchParams.get('q')).toBe('cafe');
    expect(Number(url.searchParams.get('lat'))).toBeCloseTo(-37.8);
    expect(Number(url.searchParams.get('lon'))).toBeCloseTo(144.95);
    expect(url.searchParams.get('zoom')).toBe('12');
  });

  it('leaves out the bias with no view', () => {
    const url = new URL(photonUrl('cafe'));
    expect(url.searchParams.has('lat')).toBe(false);
  });
});
