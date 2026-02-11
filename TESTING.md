# Unit Testing
This guide explains how to run unit tests for this project

Note that this document, the initial setup and configuration of testing,
and the initial set of tests for utils/dxClusterFilters.js was created
with the help of the AI agent "Claude Code" at https://claude.ai
- Rich Freedman, N2EHL 2026-02-07

## Running Tests

### Run tests in watch mode (recommended for development)
```bash
npm test
```

### Run tests once
```bash
npm run test:run
```

### Run tests with UI (interactive browser interface)
```bash
npm run test:ui
```

### Run tests with coverage report
```bash
npm run test:coverage
```

## Test File Structure

```
openhamclock/
├── src/
│   ├── utils/
│   │   ├── dxClusterFilters.js      # Source file
│   │   └── dxClusterFilters.test.js # Test file
│   └── test/
│       └── setup.js                  # Test setup/configuration
├── vitest.config.js                  # Vitest configuration
└── package.json                      # Updated with test scripts
```

## Writing Additional Tests

To add more tests, follow this pattern:

```javascript
import { describe, it, expect } from 'vitest';
import { applyDXFilters } from '../utils/dxClusterFilters.js';

describe('Feature Name', () => {
  it('should do something specific', () => {
    const spot = {
      dxCall: 'W1AW',
      spotter: 'K2ABC',
      freq: '14.074',
      comment: 'FT8'
    };
    const filters = { /* your filters */ };
    
    expect(applyDXFilters(spot, filters)).toBe(true);
  });
});
```

## CI/CD Integration

Add this to your CI pipeline:

```yaml
# Example GitHub Actions workflow
- name: Run tests
  run: npm run test:run

- name: Generate coverage
  run: npm run test:coverage

- name: Upload coverage
  uses: codecov/codecov-action@v3
```

## Troubleshooting

### Tests not running?
1. Make sure all dependencies are installed: `npm install`
2. Check that Node.js version is 18+ : `node --version`

### Import errors?
- Ensure file paths use `.js` extensions in imports
- Check that `vitest.config.js` is in the project root

### Coverage not generating?
- Make sure `@vitest/coverage-v8` is installed
- Run: `npm install --save-dev @vitest/coverage-v8`

## Next Steps

1. Add tests for other utility files (`callsign.js`, etc.)
2. Add integration tests for React components
3. Set up pre-commit hooks to run tests automatically
4. Configure coverage thresholds in `vitest.config.js`

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Vitest UI](https://vitest.dev/guide/ui.html)
- [Coverage Documentation](https://vitest.dev/guide/coverage.html)
