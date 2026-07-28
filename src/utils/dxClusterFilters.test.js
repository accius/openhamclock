import { describe, it, expect, beforeEach } from 'vitest';
import { applyDXFilters, filterDXPaths, balanceSpotWindow, collapseDuplicateSpots } from '../utils/dxClusterFilters.js';

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

  describe('DXpeditions-Only Filter', () => {
    it('should include all spots when dxpeditionsOnly is not set', () => {
      expect(applyDXFilters(mockSpot, {})).toBe(true);
      expect(applyDXFilters({ ...mockSpot, isDXpedition: true }, {})).toBe(true);
    });

    it('should include only server-tagged DXpedition spots when enabled', () => {
      const filters = { dxpeditionsOnly: true };
      expect(applyDXFilters({ ...mockSpot, isDXpedition: true }, filters)).toBe(true);
      expect(applyDXFilters({ ...mockSpot, isDXpedition: false }, filters)).toBe(false);
    });

    it('should treat untagged spots as non-DXpeditions when enabled', () => {
      const filters = { dxpeditionsOnly: true };
      expect(applyDXFilters(mockSpot, filters)).toBe(false);
    });

    it('should compose with other filters', () => {
      const filters = { dxpeditionsOnly: true, watchlistOnly: true, watchlist: ['W1'] };
      expect(applyDXFilters({ ...mockSpot, isDXpedition: true }, filters)).toBe(true);
      // Passes DXpedition check but fails watchlist
      const offWatchlist = { ...mockSpot, dxCall: 'TX5U', isDXpedition: true };
      expect(applyDXFilters(offWatchlist, filters)).toBe(false);
    });
  });

  describe('Contest Filter', () => {
    const fdSpot = (comment) => ({ ...mockSpot, comment });

    it('should include all spots when no contest is selected', () => {
      expect(applyDXFilters(fdSpot('just a comment'), {})).toBe(true);
    });

    it('should match Field Day signatures', () => {
      const filters = { contest: 'field-day' };
      expect(applyDXFilters(fdSpot('FD'), filters)).toBe(true);
      expect(applyDXFilters(fdSpot('Field Day station'), filters)).toBe(true);
      expect(applyDXFilters(fdSpot('CQ FD 3A MO'), filters)).toBe(true);
      expect(applyDXFilters(fdSpot('12E STX'), filters)).toBe(true);
    });

    it('should not match unrelated comments or FD inside words', () => {
      const filters = { contest: 'field-day' };
      expect(applyDXFilters(fdSpot('up 2 loud'), filters)).toBe(false);
      expect(applyDXFilters(fdSpot('DFDX net'), filters)).toBe(false);
      expect(applyDXFilters(fdSpot(''), filters)).toBe(false);
      expect(applyDXFilters({ ...mockSpot, comment: undefined }, filters)).toBe(false);
    });

    it('should match Winter Field Day separately', () => {
      expect(applyDXFilters(fdSpot('WFD 2H IL'), { contest: 'winter-field-day' })).toBe(true);
      expect(applyDXFilters(fdSpot('WFD'), { contest: 'field-day' })).toBe(false);
    });

    it('should ignore unknown contest keys', () => {
      expect(applyDXFilters(fdSpot('anything'), { contest: 'not-a-real-contest' })).toBe(true);
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

    it('should exclude spot when mode cannot be detected from comment or frequency', () => {
      // Use a frequency in the digital segment (7.070-7.150) where mode is ambiguous
      const spot = { ...mockSpot, comment: 'no mode info', freq: '7.100' };
      const filters = {
        modes: ['FT8'],
      };
      expect(applyDXFilters(spot, filters)).toBe(false);
    });

    it('should infer FT8 from frequency when comment has no mode', () => {
      const spot = { ...mockSpot, comment: 'CQ DX', freq: '14.074' };
      const filters = {
        modes: ['FT8'],
      };
      expect(applyDXFilters(spot, filters)).toBe(true);
    });

    it('should infer SSB from frequency when comment has no mode', () => {
      const spot = { ...mockSpot, comment: '599', freq: '14.250' };
      const filters = {
        modes: ['SSB'],
      };
      expect(applyDXFilters(spot, filters)).toBe(true);
    });

    it('should infer CW from frequency when comment has no mode', () => {
      const spot = { ...mockSpot, comment: '599', freq: '14.030' };
      const filters = {
        modes: ['CW'],
      };
      expect(applyDXFilters(spot, filters)).toBe(true);
    });

    it('should prefer comment mode over frequency inference', () => {
      // Comment says CW but frequency is SSB range — comment wins
      const spot = { ...mockSpot, comment: 'CW contest', freq: '14.250' };
      const filters = {
        modes: ['CW'],
      };
      expect(applyDXFilters(spot, filters)).toBe(true);
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

    it('should infer mode from frequency when comment is missing', () => {
      // 14.074 MHz is the official FT8 calling frequency on 20m.
      // When no comment is provided, detectMode() infers 'FT8' from the frequency.
      const spot = {
        dxCall: 'W1AW',
        spotter: 'K2ABC',
        freq: '14.074',
      };
      const filters = {
        modes: ['FT8'],
      };
      expect(applyDXFilters(spot, filters)).toBe(true);
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
      const paths = [{ dxCall: 'W1AW', spotter: 'K2ABC', freq: '14.074', comment: 'FT8' }];
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

  describe('balanceSpotWindow', () => {
    // Spots in the shape the panel actually receives via useDXClusterData:
    // the paths endpoint drops mode/source and strips the -# skimmer suffix,
    // so comment + frequency are the only mode signals available.
    const ft8Spot = (i) => ({
      call: `F${i}T8`,
      spotter: 'KM3T',
      freq: '14.074',
      comment: 'FT8 -12 dB CQ',
      source: 'DXCluster',
    });
    const cwSpot = (i) => ({
      call: `C${i}W`,
      spotter: 'W3OA',
      freq: '14.025',
      comment: 'CW 20 dB 22 WPM CQ',
      source: 'DXCluster',
    });
    const ssbSpot = (i) => ({
      call: `S${i}SB`,
      spotter: 'K0CJH',
      freq: '14.2',
      comment: '59 tnx',
      source: 'DXCluster',
    });

    it('returns the list untouched when it fits the window', () => {
      const spots = [ft8Spot(0), ssbSpot(0)];
      expect(balanceSpotWindow(spots, 50)).toEqual(spots);
    });

    it('keeps SSB spots buried deep behind skimmer churn', () => {
      // 100 fresh FT8 spots ahead of 10 aging SSB spots — a plain
      // newest-50 slice would show zero SSB
      const spots = [
        ...Array.from({ length: 100 }, (_, i) => ft8Spot(i)),
        ...Array.from({ length: 10 }, (_, i) => ssbSpot(i)),
      ];
      const windowed = balanceSpotWindow(spots, 50);
      expect(windowed).toHaveLength(50);
      expect(windowed.filter((s) => s.spotter === 'K0CJH')).toHaveLength(10);
    });

    it('caps FT8/FT4 so other modes survive', () => {
      const spots = [];
      for (let i = 0; i < 60; i++) spots.push(ft8Spot(i));
      for (let i = 0; i < 60; i++) spots.push(cwSpot(i));
      const windowed = balanceSpotWindow(spots, 40);
      expect(windowed).toHaveLength(40);
      expect(windowed.filter((s) => s.comment.startsWith('FT8')).length).toBeLessThanOrEqual(20);
      expect(windowed.filter((s) => s.comment.startsWith('CW')).length).toBeGreaterThanOrEqual(20);
    });

    it('backfills the window when only FT8 is on the air', () => {
      const spots = Array.from({ length: 80 }, (_, i) => ft8Spot(i));
      expect(balanceSpotWindow(spots, 50)).toHaveLength(50);
    });

    it('preserves feed order in the output', () => {
      const spots = [...Array.from({ length: 60 }, (_, i) => ft8Spot(i)), ssbSpot(0)];
      const windowed = balanceSpotWindow(spots, 50);
      const idx = (call) => spots.findIndex((s) => s.call === call);
      for (let i = 1; i < windowed.length; i++) {
        expect(idx(windowed[i].call)).toBeGreaterThan(idx(windowed[i - 1].call));
      }
    });

    it('prefers an explicit mode field over comment/frequency inference', () => {
      // OHC spots-endpoint shape carries mode; a "SSB" mode on an odd
      // frequency must still land in the voice reserve
      const spots = [
        ...Array.from({ length: 60 }, (_, i) => ft8Spot(i)),
        { call: 'PY6RT', spotter: 'K0CJH', freq: '14.347', comment: '', mode: 'SSB' },
      ];
      const windowed = balanceSpotWindow(spots, 50);
      expect(windowed.some((s) => s.call === 'PY6RT')).toBe(true);
    });

    it('treats mode-unknown spots as voice so human spots are never starved', () => {
      const spots = [
        ...Array.from({ length: 60 }, (_, i) => ft8Spot(i)),
        { call: 'ZL1XYZ', spotter: 'K0CJH', freq: '14.100', comment: 'loud', source: 'DXCluster' },
      ];
      const windowed = balanceSpotWindow(spots, 50);
      expect(windowed.some((s) => s.call === 'ZL1XYZ')).toBe(true);
    });
  });

  describe('collapseDuplicateSpots', () => {
    const spot = (over = {}) => ({
      dxCall: 'NX9T',
      spotter: 'K0CJH',
      freq: '7.225',
      comment: 'POTA US-1502',
      timestamp: 1000,
      ...over,
    });

    it('collapses re-spots of the same station by different spotters, keeping the newest', () => {
      // newest-first input, as the accumulator provides
      const spots = [
        spot({ spotter: 'W1AW', comment: 'POTA US-1502 59 OH', timestamp: 3000 }),
        spot({ spotter: 'K2ABC', timestamp: 2000 }),
        spot({ timestamp: 1000 }),
      ];
      const out = collapseDuplicateSpots(spots);
      expect(out).toHaveLength(1);
      expect(out[0].spotter).toBe('W1AW');
    });

    it('collapses slightly-off frequencies (within 2 kHz) of the same call', () => {
      const spots = [spot({ freq: '14.208' }), spot({ freq: '14.2085', spotter: 'W2XYZ' })];
      expect(collapseDuplicateSpots(spots)).toHaveLength(1);
    });

    it('keeps a real QSY as a separate row', () => {
      const spots = [spot({ freq: '14.208' }), spot({ freq: '14.288', spotter: 'W2XYZ' })];
      expect(collapseDuplicateSpots(spots)).toHaveLength(2);
    });

    it('keeps different stations on the same frequency', () => {
      const spots = [spot(), spot({ dxCall: 'K2LT', spotter: 'W2XYZ' })];
      expect(collapseDuplicateSpots(spots)).toHaveLength(2);
    });

    it('handles the legacy call field and kHz frequencies', () => {
      const spots = [
        { call: 'ZF2OO', spotter: 'A1AA', freq: 14208, comment: '' },
        { call: 'ZF2OO', spotter: 'B2BB', freq: 14208.5, comment: '' },
      ];
      expect(collapseDuplicateSpots(spots)).toHaveLength(1);
    });

    it('passes through rows it cannot key', () => {
      const spots = [spot({ dxCall: '', call: '' }), spot({ freq: 'garbage', dxCall: 'W9XYZ' })];
      expect(collapseDuplicateSpots(spots)).toHaveLength(2);
    });
  });
});
