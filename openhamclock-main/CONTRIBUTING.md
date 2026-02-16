# Contributing to OpenHamClock

Thank you for your interest in contributing! This document explains how to work with the modular codebase.

## 📐 Architecture Overview

OpenHamClock uses a clean separation of concerns:

```
src/
├── components/    # React UI components
├── hooks/         # Data fetching & state management
├── utils/         # Pure utility functions
└── styles/        # CSS with theme variables
```

## 🔧 Working on Components

Each component is self-contained in its own file. To modify a component:

1. Open the component file in `src/components/`
2. Make your changes
3. Test with `npm run dev`
4. Ensure all three themes still work

### Component Guidelines

```jsx
// Good component structure
export const MyComponent = ({ prop1, prop2, onAction }) => {
  // Hooks at the top
  const [state, setState] = useState(initial);
  
  // Event handlers
  const handleClick = () => {
    onAction?.(state);
  };
  
  // Early returns for loading/empty states
  if (!prop1) return null;
  
  // Main render
  return (
    <div className="panel">
      {/* Use CSS variables for colors */}
      <div style={{ color: 'var(--accent-cyan)' }}>
        {prop1}
      </div>
    </div>
  );
};
```

## 🪝 Working on Hooks

Hooks handle data fetching and state. Each hook:
- Fetches from a specific API endpoint
- Manages loading state
- Handles errors gracefully
- Returns consistent shape: `{ data, loading, error? }`

### Hook Guidelines

```jsx
// Good hook structure
export const useMyData = (param) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!param) {
      setLoading(false);
      return;
    }

    const fetchData = async () => {
      try {
        const response = await fetch(`/api/endpoint/${param}`);
        if (response.ok) {
          const result = await response.json();
          setData(result);
        }
      } catch (err) {
        console.error('MyData error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
    const interval = setInterval(fetchData, 30000); // 30 sec refresh
    return () => clearInterval(interval);
  }, [param]);

  return { data, loading };
};
```

## 🛠️ Working on Utilities

Utilities are pure functions with no side effects:

```jsx
// Good utility
export const calculateSomething = (input1, input2) => {
  // Pure calculation, no API calls or DOM access
  return result;
};
```

## 🎨 CSS & Theming

Use CSS variables for all colors:

```css
/* ✅ Good - uses theme variable */
.my-element {
  color: var(--accent-cyan);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
}

/* ❌ Bad - hardcoded color */
.my-element {
  color: #00ddff;
}
```

Available theme variables:
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary`, `--bg-panel`
- `--border-color`
- `--text-primary`, `--text-secondary`, `--text-muted`
- `--accent-amber`, `--accent-green`, `--accent-red`, `--accent-blue`, `--accent-cyan`, `--accent-purple`

## 📝 Adding a New Feature

### New Component

1. Create `src/components/MyComponent.jsx`
2. Export from `src/components/index.js`
3. Import and use in `App.jsx`

### New Hook

1. Create `src/hooks/useMyHook.js`
2. Export from `src/hooks/index.js`
3. Import and use in component

### New Utility

1. Add function to appropriate file in `src/utils/`
2. Export from `src/utils/index.js`
3. Import where needed

## 🧪 Testing Your Changes

```bash
# Start dev servers
node server.js  # Terminal 1
npm run dev     # Terminal 2

# Test checklist:
# [ ] Component renders correctly
# [ ] Works in Dark theme
# [ ] Works in Light theme
# [ ] Works in Legacy theme
# [ ] Responsive on smaller screens
# [ ] No console errors
# [ ] Data fetches correctly
```

## 📋 Pull Request Checklist

- [ ] Code follows existing patterns
- [ ] All themes work correctly
- [ ] No console errors/warnings
- [ ] Component is exported from index.js
- [ ] Added JSDoc comments if needed
- [ ] Tested on different screen sizes

## 🐛 Reporting Bugs

1. Check existing issues first
2. Include browser and screen size
3. Include console errors if any
4. Include steps to reproduce

## 💡 Feature Requests

1. Describe the feature
2. Explain the use case
3. Show how it would work (mockups welcome)

## 🏗️ Reference Implementation

The original monolithic version is preserved at `public/index-monolithic.html` (5714 lines). Use it as reference for:

- Line numbers for each feature section
- Complete implementation details
- Original styling decisions

### Key Sections in Monolithic Version

| Lines | Section |
|-------|---------|
| 30-335 | CSS styles & themes |
| 340-640 | Config & map providers |
| 438-636 | Utility functions (geo) |
| 641-691 | useSpaceWeather |
| 721-810 | useBandConditions |
| 812-837 | usePOTASpots |
| 839-1067 | DX cluster filters & helpers |
| 1069-1696 | useDXCluster with filtering |
| 2290-3022 | WorldMap component |
| 3024-3190 | Header component |
| 3195-3800 | DXFilterManager |
| 3800-4200 | SettingsPanel |
| 5019-5714 | Main App & rendering |

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License.
