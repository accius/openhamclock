import { describe, it, expect, beforeEach } from 'vitest';
import { applyDXFilters, filterDXPaths } from '../utils/dxClusterFilters.js';

describe('dxClusterFilters', () => {
  let mockSpot;
  let emptyFilters;

  beforeEach(() => {
    // Standard mock spot for testing
    mockSpot = {
      dxCall: 'W1AW',
      spotter: 'K2ABC',
      freq: '14.074',
      comment: 'FT8 signal',
    };

    emptyFilters = {};
  });

  describe('applyDXFilters - Basic Functionality', () => {
    it('should return true when no filters are provided', () => {
      expect(applyDXFilters(mockSpot, emptyFilters)).toBe(true);
      expect(applyDXFilters(mockSpot, null)).toBe(true);
      expect(applyDXFilters(mockSpot, {})).toBe(true);
    });

    it('should handle legacy "call" field in addition to "dxCall"', () => {
      const legacySpot = {
        call: 'W1AW',
        spotter: 'K2ABC',
        freq: '14.074',
        comment: 'FT8 signal',
      };
      expect(applyDXFilters(legacySpot, emptyFilters)).toBe(true);
    });
  });

  describe('Watchlist Filter', () => {
    it('should include spot when watchlist is not active', () => {
      const filters = {
        watchlistOnly: false,
        watchlist: ['DL', 'G'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should include spot when callsign matches watchlist', () => {
      const filters = {
        watchlistOnly: true,
        watchlist: ['W1', 'K2'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude spot when callsign does not match watchlist', () => {
      const filters = {
        watchlistOnly: true,
        watchlist: ['DL', 'G'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });

    it('should be case-insensitive', () => {
      const filters = {
        watchlistOnly: true,
        watchlist: ['w1', 'k2'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should use prefix matching', () => {
      const filters = {
        watchlistOnly: true,
        watchlist: ['W'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should handle empty watchlist when watchlistOnly is true', () => {
      // if the watchlist is empty, watchlistOnly should have no effect
      const filters = {
        watchlistOnly: true,
        watchlist: [],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });
  });

  describe('Spotter Inclusion Filters', () => {
    describe('Continent Filter', () => {
      it('should include spot when spotter is from selected continent', () => {
        const filters = {
          continents: ['NA'], // K2ABC is from North America
        };
        const spot = {
          dxCall: 'DL1ABC', // Germany (Europe)
          spotter: 'K2ABC', // USA (North America)
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(true);
      });

      it('should exclude spot when spotter is not from selected continent', () => {
        const filters = {
          continents: ['EU'], // Looking for European spotters
        };
        const spot = {
          dxCall: 'DL1ABC',
          spotter: 'K2ABC', // USA (North America)
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });

      it('should exclude domestic spots (DX in same continent as spotter)', () => {
        const filters = {
          continents: ['NA'],
        };
        const spot = {
          dxCall: 'W1AW', // USA (North America)
          spotter: 'K2ABC', // USA (North America)
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });
    });

    describe('CQ Zone Filter', () => {
      it('should include spot when spotter is from selected CQ zone', () => {
        const filters = {
          cqZones: [5], // CQ zone 5 (USA)
        };
        const spot = {
          dxCall: 'DL1ABC',
          spotter: 'K2ABC', // CQ zone 5
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(true);
      });

      it('should exclude spot when spotter is not from selected CQ zone', () => {
        const filters = {
          cqZones: [14], // CQ zone 14 (Europe)
        };
        const spot = {
          dxCall: 'DL1ABC',
          spotter: 'K2ABC', // CQ zone 5 (USA)
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });
    });

    describe('ITU Zone Filter', () => {
      it('should include spot when spotter is from selected ITU zone', () => {
        const filters = {
          ituZones: [8], // ITU zone 8 (USA)
        };
        const spot = {
          dxCall: 'DL1ABC',
          spotter: 'K2ABC', // ITU zone 8
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(true);
      });

      it('should exclude spot when spotter is not from selected ITU zone', () => {
        const filters = {
          ituZones: [28], // ITU zone 28 (Europe)
        };
        const spot = {
          dxCall: 'DL1ABC',
          spotter: 'K2ABC', // ITU zone 8 (USA)
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });
    });
  });

  describe('Spot Exclusion Filters', () => {
    describe('Exclude Continents', () => {
      it('should exclude spot when DX is from excluded continent', () => {
        const filters = {
          excludeContinents: ['EU'],
        };
        const spot = {
          dxCall: 'DL1ABC', // Europe
          spotter: 'K2ABC',
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });

      it('should include spot when DX is not from excluded continent', () => {
        const filters = {
          excludeContinents: ['AS'],
        };
        const spot = {
          dxCall: 'DL1ABC', // Europe
          spotter: 'K2ABC',
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(true);
      });
    });

    describe('Exclude CQ Zones', () => {
      it('should exclude spot when DX is from excluded CQ zone', () => {
        const filters = {
          excludeCqZones: [14], // CQ zone 14 (Europe)
        };
        const spot = {
          dxCall: 'DL1ABC', // CQ zone 14
          spotter: 'K2ABC',
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });
    });

    describe('Exclude ITU Zones', () => {
      it('should exclude spot when DX is from excluded ITU zone', () => {
        const filters = {
          excludeItuZones: [28], // ITU zone 28 (Europe)
        };
        const spot = {
          dxCall: 'DL1ABC', // ITU zone 28
          spotter: 'K2ABC',
          freq: '14.074',
          comment: 'FT8',
        };
        expect(applyDXFilters(spot, filters)).toBe(false);
      });
    });

    describe('Exclude DX Callsigns', () => {
      it('should exclude spot when DX callsign matches exclude list', () => {
        const filters = {
          excludeDXCallList: ['W1', 'K2'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(false);
      });

      it('should include spot when DX callsign does not match exclude list', () => {
        const filters = {
          excludeDXCallList: ['DL', 'G'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(true);
      });

      it('should be case-insensitive', () => {
        const filters = {
          excludeDXCallList: ['w1', 'k2'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(false);
      });

      it('should use prefix matching', () => {
        const filters = {
          excludeDXCallList: ['W'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(false);
      });
    });

    describe('Exclude DE (Spotter) Callsigns', () => {
      it('should exclude spot when spotter callsign matches exclude list', () => {
        const filters = {
          excludeDECallList: ['K2'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(false);
      });

      it('should include spot when spotter callsign does not match exclude list', () => {
        const filters = {
          excludeDECallList: ['DL', 'G'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(true);
      });
    });

    describe('Legacy excludeList support', () => {
      it('should exclude spot when DX callsign matches legacy exclude list', () => {
        const filters = {
          excludeList: ['W1'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(false);
      });

      it('should include spot when DX callsign does not match legacy exclude list', () => {
        const filters = {
          excludeList: ['DL', 'G'],
        };
        expect(applyDXFilters(mockSpot, filters)).toBe(true);
      });
    });
  });

  describe('Band Filter', () => {
    it('should include spot when band matches filter', () => {
      const filters = {
        bands: ['20m'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude spot when band does not match filter', () => {
      const filters = {
        bands: ['40m', '80m'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });

    it('should handle multiple bands', () => {
      const filters = {
        bands: ['20m', '40m', '80m'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should work with different frequency formats', () => {
      const spot40m = { ...mockSpot, freq: '7.074' };
      const filters = {
        bands: ['40m'],
      };
      expect(applyDXFilters(spot40m, filters)).toBe(true);
    });
  });

  describe('Mode Filter', () => {
    it('should include spot when mode matches filter', () => {
      const filters = {
        modes: ['FT8'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude spot when mode does not match filter', () => {
      const filters = {
        modes: ['CW', 'SSB'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });

    it('should handle multiple modes', () => {
      const filters = {
        modes: ['FT8', 'FT4', 'CW'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude spot when mode cannot be detected', () => {
      const spot = { ...mockSpot, comment: 'no mode info' };
      const filters = {
        modes: ['FT8'],
      };
      expect(applyDXFilters(spot, filters)).toBe(false);
    });

    it('should work with different mode comments', () => {
      const cwSpot = { ...mockSpot, comment: 'CW 599' };
      const filters = {
        modes: ['CW'],
      };
      expect(applyDXFilters(cwSpot, filters)).toBe(true);
    });
  });

  describe('Quick Search Filter', () => {
    it('should include spot when DX callsign matches search', () => {
      const filters = {
        callsign: 'W1',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should include spot when spotter callsign matches search', () => {
      const filters = {
        callsign: 'K2',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude spot when neither callsign matches search', () => {
      const filters = {
        callsign: 'DL',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });

    it('should be case-insensitive', () => {
      const filters = {
        callsign: 'w1',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should handle partial matches', () => {
      const filters = {
        callsign: 'AW',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should ignore whitespace', () => {
      const filters = {
        callsign: '  W1  ',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should include spot when search is empty', () => {
      const filters = {
        callsign: '',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });
  });

  describe('Combined Filters', () => {
    it('should apply multiple filters correctly (AND logic)', () => {
      const filters = {
        bands: ['20m'],
        modes: ['FT8'],
        callsign: 'W1',
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude spot if any filter fails', () => {
      const filters = {
        bands: ['20m'], // passes
        modes: ['CW'], // fails
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });

    it('should handle complex filter combinations', () => {
      const filters = {
        watchlistOnly: true,
        watchlist: ['W'],
        bands: ['20m'],
        modes: ['FT8'],
        excludeDXCallList: ['W2'],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });

    it('should exclude when watchlist passes but other filters fail', () => {
      const filters = {
        watchlistOnly: true,
        watchlist: ['W'],
        bands: ['40m'], // fails
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    it('should handle null/undefined callsigns gracefully', () => {
      const spot = {
        dxCall: null,
        spotter: undefined,
        freq: '14.074',
        comment: 'FT8',
      };
      expect(applyDXFilters(spot, emptyFilters)).toBe(true);
    });

    it('should handle missing comment', () => {
      const spot = {
        dxCall: 'W1AW',
        spotter: 'K2ABC',
        freq: '14.074',
      };
      const filters = {
        modes: ['FT8'],
      };
      expect(applyDXFilters(spot, filters)).toBe(false);
    });

    it('should handle missing frequency', () => {
      const spot = {
        dxCall: 'W1AW',
        spotter: 'K2ABC',
        comment: 'FT8',
      };
      const filters = {
        bands: ['20m'],
      };
      expect(applyDXFilters(spot, filters)).toBe(false);
    });

    it('should handle empty filter arrays as no filter', () => {
      const filters = {
        bands: [],
        modes: [],
        watchlist: [],
      };
      expect(applyDXFilters(mockSpot, filters)).toBe(true);
    });
  });

  describe('filterDXPaths - Array Filtering', () => {
    it('should filter array of spots', () => {
      const paths = [
        { dxCall: 'W1AW', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
        { dxCall: 'DL1ABC', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
        { dxCall: 'W1XYZ', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
      ];
      const filters = {
        watchlistOnly: true,
        watchlist: ['W1'],
      };
      const result = filterDXPaths(paths, filters);
      expect(result).toHaveLength(2);
      expect(result[0].dxCall).toBe('W1AW');
      expect(result[1].dxCall).toBe('W1XYZ');
    });

    it('should return original array when no filters', () => {
      const paths = [
        { dxCall: 'W1AW', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
        { dxCall: 'DL1ABC', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
      ];
      const result = filterDXPaths(paths, {});
      expect(result).toEqual(paths);
      expect(result).toHaveLength(2);
    });

    it('should return original array when filters is null', () => {
      const paths = [
        { dxCall: 'W1AW', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
      ];
      const result = filterDXPaths(paths, null);
      expect(result).toEqual(paths);
    });

    it('should return original array when paths is null', () => {
      const result = filterDXPaths(null, {});
      expect(result).toBeNull();
    });

    it('should return empty array when all spots are filtered out', () => {
      const paths = [
        { dxCall: 'W1AW', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
        { dxCall: 'W1XYZ', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
      ];
      const filters = {
        watchlistOnly: true,
        watchlist: ['DL'],
      };
      const result = filterDXPaths(paths, filters);
      expect(result).toHaveLength(0);
    });

    it('should handle mixed filter results', () => {
      const paths = [
        { dxCall: 'W1AW', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' },
        { dxCall: 'DL1ABC', spotter: 'K2ABC', freq: '7.074', comment: 'CW' },
        { dxCall: 'W1XYZ', spotter: 'K2ABC', freq: '21.074', comment: 'FT8' },
      ];
      const filters = {
        bands: ['20m'],
        modes: ['FT8'],
      };
      const result = filterDXPaths(paths, filters);
      expect(result).toHaveLength(1);
      expect(result[0].dxCall).toBe('W1AW');
    });
  });

  describe('Real-World Scenarios', () => {
    it('should handle North American looking for DX in Europe', () => {
      const europeanSpot = {
        dxCall: 'DL1ABC',
        spotter: 'W1AW',
        freq: '14.074',
        comment: 'FT8 nice signal',
      };
      const filters = {
        continents: ['NA'], // Only spots from NA
        excludeContinents: [], // Don't exclude any DX
      };
      // This should PASS because spotter is from NA, and DX is from EU (not NA)
      expect(applyDXFilters(europeanSpot, filters)).toBe(true);
    });

    it('should exclude domestic (same continent) spots', () => {
      const domesticSpot = {
        dxCall: 'W1AW', // USA
        spotter: 'K2ABC', // USA
        freq: '14.074',
        comment: 'FT8',
      };
      const filters = {
        continents: ['NA'], // Only spots from NA, but excludes domestic
      };
      expect(applyDXFilters(domesticSpot, filters)).toBe(false);
    });

    it('should handle European looking for Asian DX', () => {
      const asianSpot = {
        dxCall: 'JA1ABC', // Japan
        spotter: 'DL1XYZ', // Germany
        freq: '14.074',
        comment: 'FT8',
      };
      const filters = {
        continents: ['EU'], // Spotter from Europe
        // DX is from Asia, so should pass
      };
      expect(applyDXFilters(asianSpot, filters)).toBe(true);
    });

    it('should handle contest mode filtering (CW only, multiple bands)', () => {
      const cwSpot = {
        dxCall: 'W1AW',
        spotter: 'K2ABC',
        freq: '14.025',
        comment: 'CW 599',
      };
      const filters = {
        modes: ['CW'],
        bands: ['20m', '40m', '15m'],
      };
      expect(applyDXFilters(cwSpot, filters)).toBe(true);
    });

    it('should filter out annoying beacon callsigns', () => {
      const beaconSpot = {
        dxCall: '4U1UN',
        spotter: 'K2ABC',
        freq: '14.100',
        comment: 'beacon',
      };
      const filters = {
        excludeDXCallList: ['4U1UN', '4X6TU'],
      };
      expect(applyDXFilters(beaconSpot, filters)).toBe(false);
    });
  });
});
